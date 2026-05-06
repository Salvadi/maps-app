import React, { useEffect, useState, useRef } from 'react';
import './UpdateNotification.css';

interface UpdateNotificationProps {
  registration: ServiceWorkerRegistration | null;
}

const COUNTDOWN_SECONDS = 10;

const UpdateNotification: React.FC<UpdateNotificationProps> = ({ registration }) => {
  const [showUpdate, setShowUpdate] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [countdown, setCountdown] = useState(COUNTDOWN_SECONDS);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hasTriggeredRef = useRef(false);

  const clearIndexedDB = async (): Promise<void> => {
    try {
      if ('databases' in indexedDB) {
        const databases = await indexedDB.databases();
        for (const db of databases) {
          if (db.name) {
            await new Promise<void>((resolve) => {
              const request = indexedDB.deleteDatabase(db.name!);
              request.onsuccess = () => resolve();
              request.onerror = () => resolve();
              request.onblocked = () => resolve();
            });
          }
        }
      } else {
        await new Promise<void>((resolve) => {
          const request = indexedDB.deleteDatabase('MappingDatabase');
          request.onsuccess = () => resolve();
          request.onerror = () => resolve();
          request.onblocked = () => resolve();
        });
      }
    } catch {
      // continue with update even if this fails
    }
  };

  const clearCaches = async (): Promise<void> => {
    try {
      if ('caches' in window) {
        const cacheNames = await caches.keys();
        await Promise.all(cacheNames.map((name) => caches.delete(name)));
      }
    } catch {
      // continue with update even if this fails
    }
  };

  const clearLocalStorage = (): void => {
    try {
      const authToken = localStorage.getItem('supabase.auth.token');
      localStorage.clear();
      if (authToken) localStorage.setItem('supabase.auth.token', authToken);
    } catch {
      // continue with update even if this fails
    }
  };

  const handleUpdate = async () => {
    if (hasTriggeredRef.current) return;
    hasTriggeredRef.current = true;

    if (countdownRef.current) {
      clearInterval(countdownRef.current);
      countdownRef.current = null;
    }

    setIsUpdating(true);

    try {
      await clearIndexedDB();
      await clearCaches();
      clearLocalStorage();

      const target = registration?.waiting ?? (await navigator.serviceWorker.ready).waiting;
      if (target) {
        target.postMessage({ type: 'SKIP_WAITING' });
      }

      let refreshing = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!refreshing) {
          refreshing = true;
          window.location.reload();
        }
      });

      setTimeout(() => {
        if (!refreshing) window.location.reload();
      }, 2000);
    } catch {
      window.location.reload();
    }
  };

  useEffect(() => {
    if (!registration) return;

    setShowUpdate(true);
    setCountdown(COUNTDOWN_SECONDS);
    hasTriggeredRef.current = false;

    countdownRef.current = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(countdownRef.current!);
          countdownRef.current = null;
          handleUpdate();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (countdownRef.current) {
        clearInterval(countdownRef.current);
        countdownRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [registration]);

  if (!showUpdate) return null;

  return (
    <div className="update-notification">
      <div className="update-content">
        <div className="update-icon">{isUpdating ? '⏳' : '🔄'}</div>
        <div className="update-text">
          <strong>{isUpdating ? 'Aggiornamento in corso...' : 'Nuova versione disponibile!'}</strong>
          <p>
            {isUpdating
              ? 'Pulizia dati e ricaricamento app...'
              : `Aggiornamento automatico tra ${countdown}s. I dati locali verranno riscaricati da Supabase.`}
          </p>
        </div>
        {!isUpdating && (
          <div className="update-actions">
            <button
              className="update-btn update-btn-primary"
              onClick={handleUpdate}
            >
              Aggiorna Ora
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default UpdateNotification;
