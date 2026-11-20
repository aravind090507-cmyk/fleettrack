import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import './index.css';

// Auto-reload on dynamic import / chunk failure due to new deployment
window.addEventListener('vite:preloadError', (event) => {
  console.warn('Vite asset preload error detected, reloading page for latest assets:', event);
  window.location.reload();
});

// Register PWA Service Worker in production
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then((registration) => {
        // Immediately check for updated service worker
        registration.update();
      })
      .catch((err) => {
        console.warn('ServiceWorker registration skipped:', err);
      });
  });

  // Automatically refresh when a newly activated Service Worker takes control
  let refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!refreshing) {
      refreshing = true;
      window.location.reload();
    }
  });
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
