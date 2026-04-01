import React, { useState, useEffect } from 'react';
import {
  LogOut, RefreshCw, Trash2,
  Wifi, WifiOff, Shield, Unlock
} from 'lucide-react';
import { User, db } from '../db';
import { SyncStats } from '../sync/syncEngine';

interface SettingsPageProps {
  currentUser: User;
  syncStats: SyncStats;
  isOnline: boolean;
  onLogout: () => void;
  onManualSync: () => void;
  onClearAndSync: () => void;
}

const SettingsPage: React.FC<SettingsPageProps> = ({
  currentUser,
  syncStats,
  isOnline,
  onLogout,
  onManualSync,
  onClearAndSync,
}) => {
  const [projectCount, setProjectCount] = useState(0);
  const [mappingCount, setMappingCount] = useState(0);
  const [photoCount, setPhotoCount] = useState(0);

  useEffect(() => {
    const loadStats = async () => {
      const projects = await db.projects.count();
      const mappings = await db.mappingEntries.count();
      const photos = await db.photos.count();
      setProjectCount(projects);
      setMappingCount(mappings);
      setPhotoCount(photos);
    };
    loadStats();
  }, []);

  const handleResetSyncLock = async () => {
    try {
      await db.metadata.put({ key: 'isSyncing', value: false });
      window.location.reload();
    } catch (error) {
      alert('Errore durante il reset del lock di sincronizzazione');
    }
  };

  const formatSyncTime = (ts: number | null) => {
    if (!ts) return 'Mai';
    return new Date(ts).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="flex-1 overflow-auto pb-20 bg-brand-100">
      {/* Header */}
      <div className="px-5 pt-6 pb-4">
        <h1 className="text-2xl font-bold text-brand-800">Impostazioni</h1>
      </div>

      {/* Account Section */}
      <div className="px-5 mb-5">
        <h2 className="text-xs font-semibold text-brand-500 uppercase tracking-wider mb-2 px-1">Account</h2>
        <div className="bg-white rounded-2xl shadow-card overflow-hidden">
          <div className="p-4 flex items-center gap-3">
            <div className="w-12 h-12 rounded-full bg-accent/10 flex items-center justify-center">
              <span className="text-lg font-bold text-accent">
                {(currentUser.username || currentUser.email)[0].toUpperCase()}
              </span>
            </div>
            <div className="flex-1">
              <div className="text-sm font-semibold text-brand-800">{currentUser.email}</div>
              <div className="text-xs text-brand-500 flex items-center gap-1 mt-0.5">
                <Shield size={11} />
                {currentUser.role === 'admin' ? 'Amministratore' : 'Utente'}
              </div>
            </div>
          </div>
          <div className="border-t border-brand-100">
            <button
              onClick={onLogout}
              className="w-full flex items-center gap-3 px-4 py-3.5 text-danger hover:bg-red-50 active:bg-red-100 transition-colors"
            >
              <LogOut size={18} />
              <span className="text-sm font-medium">Logout</span>
            </button>
          </div>
        </div>
      </div>

      {/* Sync Section */}
      <div className="px-5 mb-5">
        <h2 className="text-xs font-semibold text-brand-500 uppercase tracking-wider mb-2 px-1">Sincronizzazione</h2>
        <div className="bg-white rounded-2xl shadow-card overflow-hidden">
          {/* Status */}
          <div className="p-4 flex items-center gap-3">
            <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
              isOnline ? 'bg-green-50' : 'bg-orange-50'
            }`}>
              {isOnline ? <Wifi size={18} className="text-success" /> : <WifiOff size={18} className="text-warning" />}
            </div>
            <div className="flex-1">
              <div className="text-sm font-semibold text-brand-700">
                Stato: {isOnline ? 'Online' : 'Offline'}
              </div>
              <div className="text-xs text-brand-500">
                Ultima sync: {formatSyncTime(syncStats.lastSyncTime)}
              </div>
              {syncStats.pendingCount > 0 && (
                <div className="text-xs text-warning font-medium mt-0.5">
                  {syncStats.pendingCount} elementi in coda
                </div>
              )}
            </div>
          </div>

          {/* Sync actions */}
          <div className="border-t border-brand-100">
            <button
              onClick={onManualSync}
              disabled={syncStats.isSyncing}
              className="w-full flex items-center gap-3 px-4 py-3.5 text-accent hover:bg-blue-50 active:bg-blue-100 transition-colors disabled:opacity-50"
            >
              <RefreshCw size={18} className={syncStats.isSyncing ? 'animate-spin' : ''} />
              <span className="text-sm font-medium">
                {syncStats.isSyncing ? 'Sincronizzazione...' : 'Sync manuale'}
              </span>
            </button>
          </div>
          <div className="border-t border-brand-100">
            <button
              onClick={onClearAndSync}
              disabled={syncStats.isSyncing}
              className="w-full flex items-center gap-3 px-4 py-3.5 text-warning hover:bg-orange-50 active:bg-orange-100 transition-colors disabled:opacity-50"
            >
              <Trash2 size={18} />
              <span className="text-sm font-medium">Clear & Resync</span>
            </button>
          </div>
          {syncStats.isSyncing && (
            <div className="border-t border-brand-100">
              <button
                onClick={handleResetSyncLock}
                className="w-full flex items-center gap-3 px-4 py-3.5 text-danger hover:bg-red-50 active:bg-red-100 transition-colors"
              >
                <Unlock size={18} />
                <span className="text-sm font-medium">Reset Lock Sync</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Data Section */}
      <div className="px-5 mb-5">
        <h2 className="text-xs font-semibold text-brand-500 uppercase tracking-wider mb-2 px-1">Dati locali</h2>
        <div className="bg-white rounded-2xl shadow-card overflow-hidden divide-y divide-brand-100">
          <div className="px-4 py-3.5 flex items-center justify-between">
            <span className="text-sm text-brand-700">Progetti</span>
            <span className="text-sm font-semibold text-brand-800">{projectCount}</span>
          </div>
          <div className="px-4 py-3.5 flex items-center justify-between">
            <span className="text-sm text-brand-700">Mappature</span>
            <span className="text-sm font-semibold text-brand-800">{mappingCount}</span>
          </div>
          <div className="px-4 py-3.5 flex items-center justify-between">
            <span className="text-sm text-brand-700">Foto salvate</span>
            <span className="text-sm font-semibold text-brand-800">{photoCount}</span>
          </div>
        </div>
      </div>

      {/* App Info */}
      <div className="px-5 mb-5">
        <h2 className="text-xs font-semibold text-brand-500 uppercase tracking-wider mb-2 px-1">App</h2>
        <div className="bg-white rounded-2xl shadow-card overflow-hidden divide-y divide-brand-100">
          <div className="px-4 py-3.5 flex items-center justify-between">
            <span className="text-sm text-brand-700">Versione</span>
            <span className="text-sm text-brand-500">1.0.0</span>
          </div>
          <div className="px-4 py-3.5 flex items-center justify-between">
            <span className="text-sm text-brand-700">OPImaPPA</span>
            <span className="text-sm text-brand-500">PWA Offline-First</span>
          </div>
        </div>
      </div>

      <div className="h-4" />
    </div>
  );
};

export default SettingsPage;
