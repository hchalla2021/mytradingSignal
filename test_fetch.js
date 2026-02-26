const http = require('http');

const options = {
  hostname: '127.0.0.1',
  port: 8000,
  path: '/api/analysis/oi-momentum/NIFTY',
  method: 'GET'
};

const req = http.request(options, (res) => {
  console.log(`STATUS: ${res.statusCode}`);
  let data = '';
  res.on('data', (chunk) => { data += chunk; });
  res.on('end', () => {
    try {
      const json = JSON.parse(data);
      console.log(`✓ Signal: ${json.final_signal}, Confidence: ${json.confidence}%`);
    } catch(e) {
      console.log('Response:', data);
    }
  });
});

req.on('error', (e) => console.log(`✗ Error: ${e.message}`));
req.setTimeout(5000);
req.end();
