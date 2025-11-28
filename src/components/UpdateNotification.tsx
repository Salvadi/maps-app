import React, { useEffect, useState } from 'react';
import './UpdateNotification.css';

interface UpdateNotificationProps {
  registration: ServiceWorkerRegistration | null;
}

const UpdateNotification: React.FC<UpdateNotificationProps> = ({ registration }) => {
  const [showUpdate, setShowUpdate] = useState(false);

  useEffect(() => {
    if (registration) {
      setShowUpdate(true);
    }
  }, [registration]);

  const handleUpdate = () => {
    if (registration?.waiting) {
      // Tell the service worker to skip waiting
      registration.waiting.postMessage({ type: 'SKIP_WAITING' });

      // Reload the page
      window.location.reload();
    }
  };

  const handleDismiss = () => {
    setShowUpdate(false);
  };

  if (!showUpdate) return null;

  return (
    <div className="update-notification">
      <div className="update-content">
        <div className="update-icon">🔄</div>
        <div className="update-text">
          <strong>Nuova versione disponibile!</strong>
          <p>Clicca "Aggiorna" per caricare l'ultima versione dell'app.</p>
        </div>
        <div className="update-actions">
          <button className="update-btn update-btn-primary" onClick={handleUpdate}>
            Aggiorna Ora
          </button>
          <button className="update-btn update-btn-secondary" onClick={handleDismiss}>
            Dopo
          </button>
        </div>
      </div>
    </div>
  );
};

export default UpdateNotification;
