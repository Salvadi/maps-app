import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import reportWebVitals from './reportWebVitals';
import * as serviceWorkerRegistration from './serviceWorkerRegistration';

const root = ReactDOM.createRoot(
  document.getElementById('root') as HTMLElement
);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// Register service worker for offline support
serviceWorkerRegistration.register({
  onSuccess: () => {
    console.log('Service Worker: App is ready for offline use');
  },
  onUpdate: (registration) => {
    console.log('Service Worker: New content available');
    // Optionally show a notification to the user
    if (window.confirm('New version available! Reload to update?')) {
      if (registration.waiting) {
        registration.waiting.postMessage({ type: 'SKIP_WAITING' });
      }
      window.location.reload();
    }
  },
});

// If you want to start measuring performance in your app, pass a function
// to log results (for example: reportWebVitals(console.log))
// or send to an analytics endpoint. Learn more: https://bit.ly/CRA-vitals
reportWebVitals();
