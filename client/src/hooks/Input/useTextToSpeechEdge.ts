import { useRecoilValue } from 'recoil';
import { useState, useCallback, useRef, useEffect } from 'react';
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';
import { useToastContext } from '~/Providers';
import useLocalize from '~/hooks/useLocalize';
import store from '~/store';

interface Voice {
  value: string;
  label: string;
}

interface UseTextToSpeechEdgeReturn {
  generateSpeechEdge: (text: string) => void;
  cancelSpeechEdge: () => void;
  isSpeaking: boolean;
  voices: Voice[];
}

function useTextToSpeechEdge(): UseTextToSpeechEdgeReturn {
  const localize = useLocalize();
  const [voices, setVoices] = useState<Voice[]>([]);
  const [isSpeaking, setIsSpeaking] = useState<boolean>(false);
  const voiceName = useRecoilValue(store.voice);
  const ttsRef = useRef<MsEdgeTTS | null>(null);
  const audioElementRef = useRef<HTMLAudioElement | null>(null);
  const mediaSourceRef = useRef<MediaSource | null>(null);
  const sourceBufferRef = useRef<SourceBuffer | null>(null);
  const pendingBuffers = useRef<Uint8Array[]>([]);
  const { showToast } = useToastContext();

  const fetchVoices = useCallback(() => {
    if (!ttsRef.current) {
      ttsRef.current = new MsEdgeTTS();
    }
    ttsRef.current
      .getVoices()
      .then((voicesList) => {
        setVoices(
          voicesList.map((v) => ({
            value: v.ShortName,
            label: v.FriendlyName,
          })),
        );
      })
      .catch((error) => {
        console.error('Error fetching voices:', error);
        showToast({
          message: localize('com_nav_voices_fetch_error'),
          status: 'error',
        });
      });
  }, [showToast, localize]);

  const initializeTTS = useCallback(() => {
    if (!ttsRef.current) {
      ttsRef.current = new MsEdgeTTS();
    }
    const availableVoice: Voice | undefined = voices.find((v) => v.value === voiceName);

    if (availableVoice) {
      ttsRef.current
        .setMetadata(availableVoice.value, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3)
        .catch((error) => {
          console.error('Error initializing TTS:', error);
          showToast({
            message: localize('com_nav_tts_init_error', (error as Error).message),
            status: 'error',
          });
        });
    } else if (voices.length > 0) {
      ttsRef.current
        .setMetadata(voices[0].value, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3)
        .catch((error) => {
          console.error('Error initializing TTS:', error);
          showToast({
            message: localize('com_nav_tts_init_error', (error as Error).message),
            status: 'error',
          });
        });
    }
  }, [voiceName, showToast, localize, voices]);

  const appendNextBuffer = useCallback(() => {
    if (
      sourceBufferRef.current &&
      !sourceBufferRef.current.updating &&
      pendingBuffers.current.length > 0
    ) {
      const nextBuffer = pendingBuffers.current.shift();
      if (nextBuffer) {
        try {
          sourceBufferRef.current.appendBuffer(nextBuffer);
        } catch (error) {
          console.error('Error appending buffer:', error);
          showToast({
            message: localize('com_nav_buffer_append_error'),
            status: 'error',
          });
          pendingBuffers.current.unshift(nextBuffer);
        }
      }
    }
  }, [showToast, localize]);

  const onSourceOpen = useCallback(() => {
    if (!sourceBufferRef.current && mediaSourceRef.current) {
      try {
        sourceBufferRef.current = mediaSourceRef.current.addSourceBuffer('audio/mpeg');
        sourceBufferRef.current.addEventListener('updateend', appendNextBuffer);
      } catch (error) {
        console.error('Error adding source buffer:', error);
        showToast({
          message: localize('com_nav_source_buffer_error'),
          status: 'error',
        });
      }
    }
  }, [showToast, localize, appendNextBuffer]);

  const initializeMediaSource = useCallback(() => {
    if (!mediaSourceRef.current) {
      mediaSourceRef.current = new MediaSource();
      audioElementRef.current = new Audio();
      audioElementRef.current.src = URL.createObjectURL(mediaSourceRef.current);
    }

    const mediaSource = mediaSourceRef.current;
    if (mediaSource.readyState === 'open') {
      onSourceOpen();
    } else {
      mediaSource.addEventListener('sourceopen', onSourceOpen);
    }
  }, [onSourceOpen]);

  const generateSpeechEdge = useCallback(
    (text: string) => {
      const generate = async () => {
        try {
          if (!ttsRef.current || !audioElementRef.current) {
            throw new Error('TTS or Audio element not initialized');
          }

          setIsSpeaking(true);
          pendingBuffers.current = [];

          const readable = await ttsRef.current.toStream(text);

          readable.on('data', (chunk: Buffer) => {
            pendingBuffers.current.push(new Uint8Array(chunk));
            appendNextBuffer();
          });

          readable.on('end', () => {
            if (mediaSourceRef.current && mediaSourceRef.current.readyState === 'open') {
              mediaSourceRef.current.endOfStream();
            }
          });

          audioElementRef.current.onended = () => {
            setIsSpeaking(false);
          };

          await audioElementRef.current.play();
        } catch (error) {
          console.error('Error generating speech:', error);
          showToast({
            message: localize('com_nav_audio_play_error', (error as Error).message),
            status: 'error',
          });
          setIsSpeaking(false);
        }
      };

      generate();
    },
    [appendNextBuffer, showToast, localize],
  );

  const cancelSpeechEdge = useCallback(() => {
    try {
      if (audioElementRef.current) {
        audioElementRef.current.pause();
        audioElementRef.current.currentTime = 0;
      }
      if (mediaSourceRef.current && mediaSourceRef.current.readyState === 'open') {
        mediaSourceRef.current.endOfStream();
      }
      pendingBuffers.current = [];
      setIsSpeaking(false);
    } catch (error) {
      console.error('Error cancelling speech:', error);
      showToast({
        message: localize('com_nav_speech_cancel_error'),
        status: 'error',
      });
    }
  }, [showToast, localize]);

  useEffect(() => {
    fetchVoices();
  }, [fetchVoices]);

  useEffect(() => {
    initializeTTS();
  }, [voiceName, initializeTTS]);

  useEffect(() => {
    initializeMediaSource();
    return () => {
      if (mediaSourceRef.current) {
        URL.revokeObjectURL(audioElementRef.current?.src ?? '');
      }
    };
  }, [initializeMediaSource]);

  return { generateSpeechEdge, cancelSpeechEdge, isSpeaking, voices };
}

export default useTextToSpeechEdge;
