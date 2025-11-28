import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import reportWebVitals from './reportWebVitals';
import * as serviceWorkerRegistration from './serviceWorkerRegistration';

const root = ReactDOM.createRoot(
  document.getElementById('root') as HTMLElement
);

// Create a simple event system for service worker updates
window.swUpdateAvailable = false;
window.swRegistration = null;

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
    // Store the registration globally
    window.swRegistration = registration;
    window.swUpdateAvailable = true;

    // Dispatch custom event to notify App
    window.dispatchEvent(new CustomEvent('swUpdate', { detail: registration }));
  },
});

// Extend Window interface
declare global {
  interface Window {
    swUpdateAvailable: boolean;
    swRegistration: ServiceWorkerRegistration | null;
  }
}

// If you want to start measuring performance in your app, pass a function
// to log results (for example: reportWebVitals(console.log))
// or send to an analytics endpoint. Learn more: https://bit.ly/CRA-vitals
reportWebVitals();
