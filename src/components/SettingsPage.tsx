import React, { useState, useEffect, useCallback } from 'react';
import {
  LogOut, RefreshCw, Trash2,
  Wifi, WifiOff, Shield, Plus, X, ChevronDown
} from 'lucide-react';
import { User, db, getDatabaseStats } from '../db';
import { refreshDropdownCaches } from '../db/dropdownOptions';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import {
  SyncStats,
  getSyncIncludeArchivedProjects,
  setSyncIncludeArchivedProjects
} from '../sync/syncEngine';

type DropdownCategory = 'supporto' | 'tipo_supporto' | 'attraversamento';

interface DropdownItem { id: string; category: string; value: string; label: string; sort_order: number; is_active: boolean; }
interface ProductItem { id: string; brand: string; name: string; sort_order: number; is_active: boolean; }

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
  const [floorPlanCount, setFloorPlanCount] = useState(0);
  const [failedSyncCount, setFailedSyncCount] = useState(0);
  const [cacheSizeMb, setCacheSizeMb] = useState('0.00');
  const [includeArchivedSync, setIncludeArchivedSync] = useState(false);
  const [syncPrefsLoading, setSyncPrefsLoading] = useState(true);

  // Admin data management state
  const [adminTab, setAdminTab] = useState<'dropdown' | 'products'>('dropdown');
  const [ddCategory, setDdCategory] = useState<DropdownCategory>('supporto');
  const [ddItems, setDdItems] = useState<DropdownItem[]>([]);
  const [ddLabel, setDdLabel] = useState('');
  const [ddValue, setDdValue] = useState('');
  const [ddLoading, setDdLoading] = useState(false);
  const [ddSaving, setDdSaving] = useState(false);

  const [prodItems, setProdItems] = useState<ProductItem[]>([]);
  const [prodBrand, setProdBrand] = useState('');
  const [prodName, setProdName] = useState('');
  const [prodLoading, setProdLoading] = useState(false);
  const [prodSaving, setProdSaving] = useState(false);

  const [adminError, setAdminError] = useState('');

  useEffect(() => {
    const loadStats = async () => {
      const [projects, mappings, photos, floorPlans, failedItems, stats] = await Promise.all([
        db.projects.count(),
        db.mappingEntries.count(),
        db.photos.count(),
        db.floorPlans.count(),
        db.syncQueue.where('synced').equals(2).count(),
        getDatabaseStats(),
      ]);
      setProjectCount(projects);
      setMappingCount(mappings);
      setPhotoCount(photos);
      setFloorPlanCount(floorPlans);
      setFailedSyncCount(failedItems);
      setCacheSizeMb(stats.totalStorageMB);
    };
    loadStats();
  }, []);

  useEffect(() => {
    const loadSyncPrefs = async () => {
      try {
        setIncludeArchivedSync(await getSyncIncludeArchivedProjects());
      } finally {
        setSyncPrefsLoading(false);
      }
    };

    loadSyncPrefs();
  }, []);

  const loadDropdownItems = useCallback(async (category: DropdownCategory) => {
    if (!isSupabaseConfigured()) return;
    setDdLoading(true);
    setAdminError('');
    try {
      const { data, error } = await supabase
        .from('dropdown_options')
        .select('*')
        .eq('category', category)
        .order('sort_order', { ascending: true });
      if (error) throw error;
      setDdItems(data || []);
    } catch (e: any) {
      setAdminError(e.message || 'Errore caricamento dropdown');
    } finally {
      setDdLoading(false);
    }
  }, []);

  const loadProducts = useCallback(async () => {
    if (!isSupabaseConfigured()) return;
    setProdLoading(true);
    setAdminError('');
    try {
      const { data, error } = await supabase
        .from('products')
        .select('*')
        .order('brand', { ascending: true })
        .order('sort_order', { ascending: true });
      if (error) throw error;
      setProdItems(data || []);
    } catch (e: any) {
      setAdminError(e.message || 'Errore caricamento prodotti');
    } finally {
      setProdLoading(false);
    }
  }, []);

  useEffect(() => {
    if (currentUser.role !== 'admin') return;
    if (adminTab === 'dropdown') loadDropdownItems(ddCategory);
    else loadProducts();
  }, [currentUser.role, adminTab, ddCategory, loadDropdownItems, loadProducts]);

  const handleAddDropdown = async () => {
    if (!ddLabel.trim()) return;
    setDdSaving(true);
    setAdminError('');
    try {
      const val = ddValue.trim() || ddLabel.trim().toLowerCase().replace(/\s+/g, '_');
      const maxOrder = ddItems.length > 0 ? Math.max(...ddItems.map(i => i.sort_order)) : 0;
      const { error } = await supabase.from('dropdown_options').insert({
        category: ddCategory,
        value: val,
        label: ddLabel.trim(),
        sort_order: maxOrder + 1,
        is_active: true,
      });
      if (error) throw error;
      setDdLabel('');
      setDdValue('');
      await loadDropdownItems(ddCategory);
      await refreshDropdownCaches();
    } catch (e: any) {
      setAdminError(e.message || 'Errore aggiunta opzione');
    } finally {
      setDdSaving(false);
    }
  };

  const handleDeleteDropdown = async (id: string) => {
    setAdminError('');
    try {
      const { error } = await supabase.from('dropdown_options').delete().eq('id', id);
      if (error) throw error;
      setDdItems(prev => prev.filter(i => i.id !== id));
      await refreshDropdownCaches();
    } catch (e: any) {
      setAdminError(e.message || 'Errore eliminazione');
    }
  };

  const handleAddProduct = async () => {
    if (!prodBrand.trim() || !prodName.trim()) return;
    setProdSaving(true);
    setAdminError('');
    try {
      const sameBrand = prodItems.filter(i => i.brand === prodBrand.trim());
      const maxOrder = sameBrand.length > 0 ? Math.max(...sameBrand.map(i => i.sort_order)) : 0;
      const { error } = await supabase.from('products').insert({
        brand: prodBrand.trim(),
        name: prodName.trim(),
        sort_order: maxOrder + 1,
        is_active: true,
      });
      if (error) throw error;
      setProdName('');
      await loadProducts();
      await refreshDropdownCaches();
    } catch (e: any) {
      setAdminError(e.message || 'Errore aggiunta prodotto');
    } finally {
      setProdSaving(false);
    }
  };

  const handleDeleteProduct = async (id: string) => {
    setAdminError('');
    try {
      const { error } = await supabase.from('products').delete().eq('id', id);
      if (error) throw error;
      setProdItems(prev => prev.filter(i => i.id !== id));
      await refreshDropdownCaches();
    } catch (e: any) {
      setAdminError(e.message || 'Errore eliminazione');
    }
  };

  const formatSyncTime = (ts: number | null) => {
    if (!ts) return 'Mai';
    return new Date(ts).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
  };

  const handleToggleArchivedSync = async () => {
    const nextValue = !includeArchivedSync;
    setIncludeArchivedSync(nextValue);

    try {
      await setSyncIncludeArchivedProjects(nextValue);
    } catch {
      setIncludeArchivedSync(!nextValue);
      alert('Errore durante il salvataggio delle preferenze di sincronizzazione.');
    }
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

      {/* Data Connection Section */}
      <div className="px-5 mb-5">
        <h2 className="text-xs font-semibold text-brand-500 uppercase tracking-wider mb-2 px-1">Dati e connessione</h2>
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
                Stato dati: {isOnline ? 'Online' : 'Offline'}
              </div>
              <div className="text-xs text-brand-500">
                Ultimo aggiornamento: {formatSyncTime(syncStats.lastSyncTime)}
              </div>
              {syncStats.pendingCount > 0 && (
                <div className="text-xs text-warning font-medium mt-0.5">
                  {syncStats.pendingCount} modifiche in coda locale
                </div>
              )}
            </div>
          </div>

          {/* Data actions */}
          <div className="border-t border-brand-100">
            <button
              onClick={onManualSync}
              disabled={syncStats.isSyncing}
              className="w-full flex items-center gap-3 px-4 py-3.5 text-accent hover:bg-blue-50 active:bg-blue-100 transition-colors disabled:opacity-50"
            >
              <RefreshCw size={18} className={syncStats.isSyncing ? 'animate-spin' : ''} />
              <span className="text-sm font-medium">
                {syncStats.isSyncing ? 'Aggiornamento dati...' : 'Aggiorna adesso'}
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
              <span className="text-sm font-medium">Reset cache locale</span>
            </button>
          </div>
          <div className="border-t border-brand-100 px-4 py-3.5">
            <label htmlFor="sync-include-archived" className="flex items-start gap-3 cursor-pointer">
              <input
                id="sync-include-archived"
                type="checkbox"
                checked={includeArchivedSync}
                disabled={syncStats.isSyncing || syncPrefsLoading}
                onChange={handleToggleArchivedSync}
                className="mt-1 h-4 w-4 rounded border-brand-300 text-accent focus:ring-accent"
              />
              <div className="flex-1">
                <div className="text-sm font-medium text-brand-700">Includi progetti archiviati nella sync</div>
                <div className="text-xs text-brand-500 mt-0.5">
                  Se disattivato, foto, mappature, planimetrie e SAL dei progetti archiviati vengono saltati per velocizzare la sincronizzazione.
                </div>
              </div>
            </label>
          </div>
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
          <div className="px-4 py-3.5 flex items-center justify-between">
            <span className="text-sm text-brand-700">Planimetrie in cache</span>
            <span className="text-sm font-semibold text-brand-800">{floorPlanCount}</span>
          </div>
          <div className="px-4 py-3.5 flex items-center justify-between">
            <span className="text-sm text-brand-700">Dimensione cache</span>
            <span className="text-sm font-semibold text-brand-800">{cacheSizeMb} MB</span>
          </div>
          <div className="px-4 py-3.5 flex items-center justify-between">
            <span className="text-sm text-brand-700">Errori permanenti nella coda modifiche</span>
            <span className={`text-sm font-semibold ${failedSyncCount > 0 ? 'text-warning' : 'text-brand-800'}`}>{failedSyncCount}</span>
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
            <span className="text-sm text-brand-500">PWA Online-First</span>
          </div>
        </div>
      </div>

      {/* Admin: Gestione Dati */}
      {currentUser.role === 'admin' && (
        <div className="px-5 mb-5">
          <h2 className="text-xs font-semibold text-brand-500 uppercase tracking-wider mb-2 px-1 flex items-center gap-2">
            Gestione Dati
            <span className="text-[11px] font-semibold bg-warning/10 text-warning px-2 py-0.5 rounded-full">ADMIN</span>
          </h2>

          {!isSupabaseConfigured() && (
            <div className="bg-orange-50 border border-orange-200 text-orange-700 text-sm px-4 py-3 rounded-2xl mb-3">
              Supabase non configurato — funzione non disponibile.
            </div>
          )}

          {isSupabaseConfigured() && (
            <div className="bg-white rounded-2xl shadow-card overflow-hidden">
              {/* Tab selector */}
              <div className="flex border-b border-brand-100">
                {(['dropdown', 'products'] as const).map(tab => (
                  <button
                    key={tab}
                    onClick={() => setAdminTab(tab)}
                    className={`flex-1 py-3 text-sm font-semibold transition-colors ${
                      adminTab === tab ? 'text-accent border-b-2 border-accent' : 'text-brand-500'
                    }`}
                  >
                    {tab === 'dropdown' ? 'Dropdown' : 'Prodotti'}
                  </button>
                ))}
              </div>

              {adminError && (
                <div className="mx-4 mt-3 bg-red-50 border border-red-200 text-red-700 text-xs px-3 py-2 rounded-xl">
                  {adminError}
                </div>
              )}

              {/* Dropdown tab */}
              {adminTab === 'dropdown' && (
                <div className="p-4 space-y-4">
                  {/* Category selector */}
                  <div className="relative">
                    <select
                      value={ddCategory}
                      onChange={e => setDdCategory(e.target.value as DropdownCategory)}
                      className="w-full px-4 py-3 bg-brand-50 border border-brand-200 rounded-xl text-sm text-brand-800 focus:outline-none focus:border-accent appearance-none"
                    >
                      <option value="supporto">Supporto</option>
                      <option value="tipo_supporto">Tipo Supporto</option>
                      <option value="attraversamento">Attraversamento</option>
                    </select>
                    <ChevronDown size={15} className="absolute right-3 top-1/2 -translate-y-1/2 text-brand-400 pointer-events-none" />
                  </div>

                  {/* Add form */}
                  <div className="space-y-2">
                    <input
                      value={ddLabel}
                      onChange={e => setDdLabel(e.target.value)}
                      placeholder="Etichetta *"
                      className="w-full px-3 py-2.5 bg-brand-50 border border-brand-200 rounded-xl text-sm text-brand-800 placeholder-brand-400 focus:outline-none focus:border-accent"
                    />
                    <div className="flex gap-2">
                      <input
                        value={ddValue}
                        onChange={e => setDdValue(e.target.value)}
                        placeholder="Value (opzionale)"
                        className="flex-1 min-w-0 px-3 py-2.5 bg-brand-50 border border-brand-200 rounded-xl text-sm text-brand-800 placeholder-brand-400 focus:outline-none focus:border-accent"
                      />
                      <button
                        onClick={handleAddDropdown}
                        disabled={!ddLabel.trim() || ddSaving}
                        className="w-10 h-10 flex items-center justify-center bg-accent text-white rounded-xl disabled:opacity-40 flex-shrink-0"
                      >
                        <Plus size={18} />
                      </button>
                    </div>
                  </div>

                  {/* List */}
                  <div className="space-y-1 max-h-64 overflow-y-auto">
                    {ddLoading ? (
                      <div className="text-center py-6 text-brand-500 text-sm">Caricamento...</div>
                    ) : ddItems.length === 0 ? (
                      <div className="text-center py-6 text-brand-400 text-sm">Nessuna opzione</div>
                    ) : ddItems.map(item => (
                      <div key={item.id} className="flex items-center gap-2 px-3 py-2 bg-brand-50 rounded-xl">
                        <div className="flex-1 min-w-0">
                          <span className="text-sm text-brand-700 font-medium">{item.label}</span>
                          <span className="ml-2 text-xs text-brand-400">{item.value}</span>
                        </div>
                        <button
                          onClick={() => handleDeleteDropdown(item.id)}
                          className="w-7 h-7 flex items-center justify-center text-danger hover:bg-red-50 rounded-lg flex-shrink-0"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Products tab */}
              {adminTab === 'products' && (
                <div className="p-4 space-y-4">
                  {/* Add form */}
                  <div className="space-y-2">
                    <input
                      value={prodBrand}
                      onChange={e => setProdBrand(e.target.value)}
                      placeholder="Marca *"
                      list="brand-suggestions"
                      className="w-full px-3 py-2.5 bg-brand-50 border border-brand-200 rounded-xl text-sm text-brand-800 placeholder-brand-400 focus:outline-none focus:border-accent"
                    />
                    <datalist id="brand-suggestions">
                      {Array.from(new Set(prodItems.map(p => p.brand))).map(b => (
                        <option key={b} value={b} />
                      ))}
                    </datalist>
                    <div className="flex gap-2">
                      <input
                        value={prodName}
                        onChange={e => setProdName(e.target.value)}
                        placeholder="Nome prodotto *"
                        className="flex-1 min-w-0 px-3 py-2.5 bg-brand-50 border border-brand-200 rounded-xl text-sm text-brand-800 placeholder-brand-400 focus:outline-none focus:border-accent"
                      />
                      <button
                        onClick={handleAddProduct}
                        disabled={!prodBrand.trim() || !prodName.trim() || prodSaving}
                        className="w-10 h-10 flex items-center justify-center bg-accent text-white rounded-xl disabled:opacity-40 flex-shrink-0"
                      >
                        <Plus size={18} />
                      </button>
                    </div>
                  </div>

                  {/* List grouped by brand */}
                  <div className="space-y-3 max-h-80 overflow-y-auto">
                    {prodLoading ? (
                      <div className="text-center py-6 text-brand-500 text-sm">Caricamento...</div>
                    ) : prodItems.length === 0 ? (
                      <div className="text-center py-6 text-brand-400 text-sm">Nessun prodotto</div>
                    ) : (
                      Object.entries(
                        prodItems.reduce<Record<string, ProductItem[]>>((acc, p) => {
                          if (!acc[p.brand]) acc[p.brand] = [];
                          acc[p.brand].push(p);
                          return acc;
                        }, {})
                      ).map(([brand, items]) => (
                        <div key={brand}>
                          <div className="text-xs font-semibold text-brand-500 uppercase tracking-wider mb-1 px-1">{brand}</div>
                          <div className="space-y-1">
                            {items.map(item => (
                              <div key={item.id} className="flex items-center gap-2 px-3 py-2 bg-brand-50 rounded-xl">
                                <span className="flex-1 text-sm text-brand-700">{item.name}</span>
                                <button
                                  onClick={() => handleDeleteProduct(item.id)}
                                  className="w-7 h-7 flex items-center justify-center text-danger hover:bg-red-50 rounded-lg flex-shrink-0"
                                >
                                  <X size={14} />
                                </button>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <div className="h-4" />
    </div>
  );
};

export default SettingsPage;
