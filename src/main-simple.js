const http = require('http');
const port = process.env.PORT || 3001;
const server = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json');
  if (req.url === '/health') {
    res.end(JSON.stringify({ status: 'ok', timestamp: new Date().toISOString() }));
  } else {
    res.end(JSON.stringify({ message: 'Kalokea API' }));
  }
});
server.listen(port, () => console.log('Running on port ' + port));
