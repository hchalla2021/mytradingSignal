const http = require('http');

const options = {
  hostname: '127.0.0.1',
  port: 3000,
  path: '/',
  method: 'GET'
};

const req = http.request(options, (res) => {
  console.log(`✓ Frontend Status: ${res.statusCode}`);
});

req.on('error', (e) => console.log(`✗ Frontend Error: ${e.message}`));
req.setTimeout(3000);
req.end();
