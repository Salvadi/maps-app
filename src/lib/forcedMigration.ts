import { supabase, isSupabaseConfigured } from './supabase';

const FORCED_RESET_VERSION = 1;
const FORCED_RESET_STORAGE_KEY = 'forcedResetVersion';
const FORCED_RESET_RUNNING_KEY = 'forcedResetInProgress';

async function clearServiceWorkerRegistrations(): Promise<void> {
  if (!('serviceWorker' in navigator)) {
    return;
  }

  try {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((registration) => registration.unregister()));
  } catch (error) {
    console.warn('Failed to unregister service workers during forced reset', error);
  }
}

async function clearBrowserCaches(): Promise<void> {
  if (!('caches' in window)) {
    return;
  }

  try {
    const cacheNames = await caches.keys();
    await Promise.all(cacheNames.map((cacheName) => caches.delete(cacheName)));
  } catch (error) {
    console.warn('Failed to clear browser caches during forced reset', error);
  }
}

async function clearIndexedDbDatabases(): Promise<void> {
  const deleteDatabase = async (name: string): Promise<void> => {
    await new Promise<void>((resolve) => {
      const request = indexedDB.deleteDatabase(name);
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
      request.onblocked = () => resolve();
    });
  };

  try {
    if ('databases' in indexedDB) {
      const databases = await indexedDB.databases();
      await Promise.all(
        databases
          .map((database) => database.name)
          .filter((name): name is string => typeof name === 'string' && name.length > 0)
          .map((name) => deleteDatabase(name))
      );
      return;
    }
  } catch (error) {
    console.warn('Failed to enumerate IndexedDB databases during forced reset', error);
  }

  await deleteDatabase('MappingDatabase');
}

export async function enforceForcedMigrationIfNeeded(): Promise<boolean> {
  const appliedVersion = Number(window.localStorage.getItem(FORCED_RESET_STORAGE_KEY) || '0');
  if (appliedVersion >= FORCED_RESET_VERSION) {
    return false;
  }

  if (window.sessionStorage.getItem(FORCED_RESET_RUNNING_KEY) === '1') {
    return true;
  }

  window.sessionStorage.setItem(FORCED_RESET_RUNNING_KEY, '1');
  console.warn(`Forcing app reset for migration version ${FORCED_RESET_VERSION}`);

  try {
    if (isSupabaseConfigured()) {
      await supabase.auth.signOut().catch((error) => {
        console.warn('Failed to sign out during forced reset', error);
      });
    }

    await clearServiceWorkerRegistrations();
    await clearBrowserCaches();
    await clearIndexedDbDatabases();

    window.localStorage.clear();
    window.sessionStorage.clear();
    window.localStorage.setItem(FORCED_RESET_STORAGE_KEY, String(FORCED_RESET_VERSION));
  } finally {
    window.location.reload();
  }

  return true;
}
