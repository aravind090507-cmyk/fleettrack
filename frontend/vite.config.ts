import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vitejs.dev/config/
export default defineConfig(async ({ command }) => {
  const plugins = [react()];
  if (command === 'serve') {
    try {
      const basicSsl = (await import('@vitejs/plugin-basic-ssl')).default;
      plugins.push(basicSsl());
    } catch {
      // Graceful fallback if basic-ssl is not installed
    }
  }

  return {
    base: '/',
    plugins,
    server: {
      port: 5173,
      host: '0.0.0.0', // Binds to all network interfaces
      proxy: {
        '/api': {
          target: 'http://127.0.0.1:8000',
          changeOrigin: true,
        },
        '/ws': {
          target: 'ws://127.0.0.1:8000',
          ws: true,
          configure: (proxy, _options) => {
            proxy.on('error', (err, _req, _res) => {
              if ((err as any).code === 'ECONNABORTED' || (err as any).code === 'ECONNRESET') {
                return;
              }
              console.warn('[Vite WS Proxy]', err.message);
            });
          },
        }
      }
    }
  };
})
