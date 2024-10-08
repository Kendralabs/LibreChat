function setHeaders(req, res, next) {
  res.writeHead(200, {
    Connection: 'keep-alive',
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Access-Control-Allow-Origin': 'https://app.kendralabs.com',
    'X-Accel-Buffering': 'no',
  });
  next();
}

module.exports = setHeaders;
