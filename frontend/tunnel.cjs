const localtunnel = require('localtunnel');

(async () => {
  const port = process.env.TUNNEL_PORT ? parseInt(process.env.TUNNEL_PORT) : 8000;
  console.log(`Starting persistent tunnel to port ${port}...`);
  try {
    const tunnel = await localtunnel({ port });
    console.log(`🚀 TUNNEL_ACTIVE: ${tunnel.url}`);
    tunnel.on('close', () => {
      console.log('Tunnel closed');
    });
    tunnel.on('error', (err) => {
      console.error('Tunnel error:', err);
    });
  } catch (err) {
    console.error('Failed to create tunnel:', err);
  }
})();

// Keep node event loop alive indefinitely
setInterval(() => {}, 60000);
