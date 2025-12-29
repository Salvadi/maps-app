import React, { useEffect, useState } from 'react';
import './UpdateNotification.css';

interface UpdateNotificationProps {
  registration: ServiceWorkerRegistration | null;
}

const UpdateNotification: React.FC<UpdateNotificationProps> = ({ registration }) => {
  const [showUpdate, setShowUpdate] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);

  useEffect(() => {
    if (registration) {
      setShowUpdate(true);
    }
  }, [registration]);

  const clearIndexedDB = async (): Promise<void> => {
    console.log('🗑️  Clearing IndexedDB...');

    try {
      // Get all databases
      if ('databases' in indexedDB) {
        const databases = await indexedDB.databases();
        console.log('📦 Found databases:', databases.map(db => db.name));

        // Delete all databases
        for (const db of databases) {
          if (db.name) {
            await new Promise<void>((resolve, reject) => {
              const request = indexedDB.deleteDatabase(db.name!);
              request.onsuccess = () => {
                console.log('✅ Deleted database:', db.name);
                resolve();
              };
              request.onerror = () => {
                console.error('❌ Failed to delete database:', db.name);
                reject(request.error);
              };
              request.onblocked = () => {
                console.warn('⚠️  Database deletion blocked:', db.name);
                // Resolve anyway to not block the update
                resolve();
              };
            });
          }
        }
      } else {
        // Fallback for browsers that don't support indexedDB.databases()
        console.log('⚠️  indexedDB.databases() not supported, trying known databases');
        const knownDatabases = ['MappingDatabase'];
        for (const dbName of knownDatabases) {
          await new Promise<void>((resolve, reject) => {
            const request = indexedDB.deleteDatabase(dbName);
            request.onsuccess = () => {
              console.log('✅ Deleted database:', dbName);
              resolve();
            };
            request.onerror = () => {
              console.warn('⚠️  Could not delete database:', dbName);
              resolve(); // Resolve anyway
            };
            request.onblocked = () => {
              console.warn('⚠️  Database deletion blocked:', dbName);
              resolve();
            };
          });
        }
      }

      console.log('✅ IndexedDB cleared successfully');
    } catch (error) {
      console.error('❌ Error clearing IndexedDB:', error);
      // Don't throw - we want to continue with the update even if this fails
    }
  };

  const clearCaches = async (): Promise<void> => {
    console.log('🗑️  Clearing caches...');

    try {
      if ('caches' in window) {
        const cacheNames = await caches.keys();
        console.log('📦 Found caches:', cacheNames);

        await Promise.all(
          cacheNames.map(async (cacheName) => {
            await caches.delete(cacheName);
            console.log('✅ Deleted cache:', cacheName);
          })
        );

        console.log('✅ All caches cleared');
      }
    } catch (error) {
      console.error('❌ Error clearing caches:', error);
      // Don't throw - we want to continue with the update even if this fails
    }
  };

  const clearLocalStorage = (): void => {
    console.log('🗑️  Clearing localStorage...');
    try {
      const keysToPreserve = ['supabase.auth.token']; // Preserve auth token if needed
      const preserved: { [key: string]: string | null } = {};

      keysToPreserve.forEach(key => {
        preserved[key] = localStorage.getItem(key);
      });

      localStorage.clear();

      // Restore preserved keys
      Object.entries(preserved).forEach(([key, value]) => {
        if (value) {
          localStorage.setItem(key, value);
        }
      });

      console.log('✅ localStorage cleared');
    } catch (error) {
      console.error('❌ Error clearing localStorage:', error);
    }
  };

  const handleUpdate = async () => {
    if (!registration?.waiting) return;

    setIsUpdating(true);

    try {
      console.log('🔄 Starting update process...');

      // 1. Clear IndexedDB
      await clearIndexedDB();

      // 2. Clear caches
      await clearCaches();

      // 3. Clear localStorage (except auth token)
      clearLocalStorage();

      // 4. Tell the service worker to skip waiting
      console.log('📤 Sending SKIP_WAITING message to service worker');
      registration.waiting.postMessage({ type: 'SKIP_WAITING' });

      // 5. Listen for the controlling service worker to change
      let refreshing = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!refreshing) {
          refreshing = true;
          console.log('🔄 New service worker activated, reloading...');
          window.location.reload();
        }
      });

      // Fallback: reload after 2 seconds if controllerchange doesn't fire
      setTimeout(() => {
        if (!refreshing) {
          console.log('🔄 Fallback reload after timeout');
          window.location.reload();
        }
      }, 2000);

    } catch (error) {
      console.error('❌ Error during update:', error);
      // Reload anyway
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
        <div className="update-icon">{isUpdating ? '⏳' : '🔄'}</div>
        <div className="update-text">
          <strong>{isUpdating ? 'Aggiornamento in corso...' : 'Nuova versione disponibile!'}</strong>
          <p>
            {isUpdating
              ? 'Pulizia dati e ricaricamento app...'
              : 'Clicca "Aggiorna" per caricare l\'ultima versione. I dati locali verranno puliti e riscaricati da Supabase.'}
          </p>
        </div>
        <div className="update-actions">
          <button
            className="update-btn update-btn-primary"
            onClick={handleUpdate}
            disabled={isUpdating}
          >
            {isUpdating ? 'Aggiornamento...' : 'Aggiorna Ora'}
          </button>
          {!isUpdating && (
            <button className="update-btn update-btn-secondary" onClick={handleDismiss}>
              Dopo
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default UpdateNotification;
