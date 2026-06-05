import React, { useState, useEffect, useCallback } from 'react';
import {
  LogOut, RefreshCw, Trash2,
  Wifi, WifiOff, Shield, Plus, X, ChevronDown, Pencil, Check, Upload, Image as ImageIcon
} from 'lucide-react';
import { User, db, getDatabaseStats } from '../db';
import { refreshDropdownCaches } from '../db/dropdownOptions';
import { apiFetch, apiFetchJson } from '../lib/homeserver';
import {
  processFloorPlan,
  uploadFloorPlan,
  uploadFloorPlanPDF,
  deleteFloorPlan as deleteFloorPlanAssets,
} from '../utils/floorPlanUtils';
import {
  SyncStats,
  getSyncIncludeArchivedProjects,
  setSyncIncludeArchivedProjects
} from '../sync/syncEngine';

type DropdownCategory = 'supporto' | 'tipo_supporto' | 'attraversamento' | 'struttura' | 'tipo_struttura';

interface DropdownItem { id: string; category: string; value: string; label: string; sort_order: number; is_active: boolean; }
interface ProductItem { id: string; brand: string; name: string; sort_order: number; is_active: boolean; }
interface ProjectRow { id: string; title: string; client: string; }
interface FloorPlanRow {
  id: string;
  project_id: string;
  floor: string;
  image_url: string | null;
  thumbnail_url: string | null;
  pdf_url: string | null;
  original_filename: string | null;
  created_by: string | null;
}

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
  const [adminTab, setAdminTab] = useState<'dropdown' | 'products' | 'floorplans'>('dropdown');
  const [ddCategory, setDdCategory] = useState<DropdownCategory>('supporto');
  const [ddItems, setDdItems] = useState<DropdownItem[]>([]);
  const [ddLabel, setDdLabel] = useState('');
  const [ddValue, setDdValue] = useState('');
  const [ddLoading, setDdLoading] = useState(false);
  const [ddSaving, setDdSaving] = useState(false);
  // Modifica inline opzione dropdown
  const [ddEditingId, setDdEditingId] = useState<string | null>(null);
  const [ddEditLabel, setDdEditLabel] = useState('');
  const [ddEditValue, setDdEditValue] = useState('');

  const [prodItems, setProdItems] = useState<ProductItem[]>([]);
  const [prodBrand, setProdBrand] = useState('');
  const [prodName, setProdName] = useState('');
  const [prodLoading, setProdLoading] = useState(false);
  const [prodSaving, setProdSaving] = useState(false);
  // Modifica inline prodotto
  const [prodEditingId, setProdEditingId] = useState<string | null>(null);
  const [prodEditBrand, setProdEditBrand] = useState('');
  const [prodEditName, setProdEditName] = useState('');

  // Cambio planimetria (admin)
  const [fpProjects, setFpProjects] = useState<ProjectRow[]>([]);
  const [fpProjectsLoading, setFpProjectsLoading] = useState(false);
  const [fpSelectedProject, setFpSelectedProject] = useState('');
  const [fpPlans, setFpPlans] = useState<FloorPlanRow[]>([]);
  const [fpPlansLoading, setFpPlansLoading] = useState(false);
  const [fpPointCounts, setFpPointCounts] = useState<Record<string, number>>({});
  const [fpReplacingId, setFpReplacingId] = useState<string | null>(null);

  const [adminError, setAdminError] = useState('');

  const ensureAdminWriteOk = async (response: Response, fallbackMessage: string): Promise<void> => {
    if (response.ok) return;
    let message = fallbackMessage;
    try {
      const body = await response.json() as { error?: string };
      message = body.error || message;
    } catch {
      // Mantieni il messaggio locale se la risposta non è JSON.
    }
    throw new Error(message);
  };

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
    if (!navigator.onLine) return;
    setDdLoading(true);
    setAdminError('');
    try {
      const { data } = await apiFetchJson<{ data: DropdownItem[] }>(
        '/api/dropdown_options?select=*&order=sort_order.asc&limit=1000'
      );
      setDdItems((data || []).filter(item => item.category === category));
    } catch (e: any) {
      setAdminError(e.message || 'Errore caricamento dropdown');
    } finally {
      setDdLoading(false);
    }
  }, []);

  const loadProducts = useCallback(async () => {
    if (!navigator.onLine) return;
    setProdLoading(true);
    setAdminError('');
    try {
      const { data } = await apiFetchJson<{ data: ProductItem[] }>(
        '/api/products?select=*&order=sort_order.asc&limit=1000'
      );
      setProdItems((data || []).sort((a, b) => a.brand.localeCompare(b.brand) || a.sort_order - b.sort_order));
    } catch (e: any) {
      setAdminError(e.message || 'Errore caricamento prodotti');
    } finally {
      setProdLoading(false);
    }
  }, []);

  // ─── Cambio planimetria (admin) ──────────────────────────────────────────
  const loadFpProjects = useCallback(async () => {
    if (!navigator.onLine) return;
    setFpProjectsLoading(true);
    setAdminError('');
    try {
      const { data } = await apiFetchJson<{ data: ProjectRow[] }>(
        '/api/projects?select=id,title,client&order=title.asc&limit=2000'
      );
      setFpProjects(data || []);
    } catch (e: any) {
      setAdminError(e.message || 'Errore caricamento progetti');
    } finally {
      setFpProjectsLoading(false);
    }
  }, []);

  const loadFpPlans = useCallback(async (projectId: string) => {
    if (!projectId || !navigator.onLine) {
      setFpPlans([]);
      setFpPointCounts({});
      return;
    }
    setFpPlansLoading(true);
    setAdminError('');
    try {
      const { data } = await apiFetchJson<{ data: FloorPlanRow[] }>(
        `/api/floor_plans?project_id=eq.${projectId}&select=id,project_id,floor,image_url,thumbnail_url,pdf_url,original_filename,created_by&order=floor.asc&limit=1000`
      );
      const plans = data || [];
      setFpPlans(plans);
      // Conta i punti per ogni planimetria (per rassicurare che restano dopo lo swap)
      const counts: Record<string, number> = {};
      await Promise.all(plans.map(async (plan) => {
        try {
          const res = await apiFetchJson<{ data: { id: string }[]; count?: number }>(
            `/api/floor_plan_points?floor_plan_id=eq.${plan.id}&select=id&limit=1000`
          );
          counts[plan.id] = typeof res.count === 'number' ? res.count : (res.data?.length || 0);
        } catch {
          counts[plan.id] = 0;
        }
      }));
      setFpPointCounts(counts);
    } catch (e: any) {
      setAdminError(e.message || 'Errore caricamento planimetrie');
    } finally {
      setFpPlansLoading(false);
    }
  }, []);

  useEffect(() => {
    if (currentUser.role !== 'admin') return;
    if (adminTab === 'dropdown') loadDropdownItems(ddCategory);
    else if (adminTab === 'products') loadProducts();
    else if (adminTab === 'floorplans') loadFpProjects();
  }, [currentUser.role, adminTab, ddCategory, loadDropdownItems, loadProducts, loadFpProjects]);

  useEffect(() => {
    if (currentUser.role !== 'admin' || adminTab !== 'floorplans') return;
    loadFpPlans(fpSelectedProject);
  }, [currentUser.role, adminTab, fpSelectedProject, loadFpPlans]);

  const handleAddDropdown = async () => {
    if (!ddLabel.trim()) return;
    setDdSaving(true);
    setAdminError('');
    try {
      const val = ddValue.trim() || ddLabel.trim().toLowerCase().replace(/\s+/g, '_');
      const maxOrder = ddItems.length > 0 ? Math.max(...ddItems.map(i => i.sort_order)) : 0;
      const response = await apiFetch('/api/dropdown_options', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category: ddCategory,
          value: val,
          label: ddLabel.trim(),
          sort_order: maxOrder + 1,
          is_active: true,
        }),
      });
      await ensureAdminWriteOk(response, 'Errore aggiunta opzione');
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
      const response = await apiFetch(`/api/dropdown_options?id=eq.${id}`, { method: 'DELETE' });
      await ensureAdminWriteOk(response, 'Errore eliminazione');
      setDdItems(prev => prev.filter(i => i.id !== id));
      await refreshDropdownCaches();
    } catch (e: any) {
      setAdminError(e.message || 'Errore eliminazione');
    }
  };

  const startEditDropdown = (item: DropdownItem) => {
    setDdEditingId(item.id);
    setDdEditLabel(item.label);
    setDdEditValue(item.value);
    setAdminError('');
  };

  const cancelEditDropdown = () => {
    setDdEditingId(null);
    setDdEditLabel('');
    setDdEditValue('');
  };

  const handleSaveEditDropdown = async (id: string) => {
    if (!ddEditLabel.trim()) return;
    setDdSaving(true);
    setAdminError('');
    try {
      const val = ddEditValue.trim() || ddEditLabel.trim().toLowerCase().replace(/\s+/g, '_');
      const response = await apiFetch(`/api/dropdown_options?id=eq.${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: ddEditLabel.trim(), value: val }),
      });
      await ensureAdminWriteOk(response, 'Errore modifica opzione');
      cancelEditDropdown();
      await loadDropdownItems(ddCategory);
      await refreshDropdownCaches();
    } catch (e: any) {
      setAdminError(e.message || 'Errore modifica opzione');
    } finally {
      setDdSaving(false);
    }
  };

  const handleAddProduct = async () => {
    if (!prodBrand.trim() || !prodName.trim()) return;
    setProdSaving(true);
    setAdminError('');
    try {
      const sameBrand = prodItems.filter(i => i.brand === prodBrand.trim());
      const maxOrder = sameBrand.length > 0 ? Math.max(...sameBrand.map(i => i.sort_order)) : 0;
      const response = await apiFetch('/api/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          brand: prodBrand.trim(),
          name: prodName.trim(),
          sort_order: maxOrder + 1,
          is_active: true,
        }),
      });
      await ensureAdminWriteOk(response, 'Errore aggiunta prodotto');
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
      const response = await apiFetch(`/api/products?id=eq.${id}`, { method: 'DELETE' });
      await ensureAdminWriteOk(response, 'Errore eliminazione');
      setProdItems(prev => prev.filter(i => i.id !== id));
      await refreshDropdownCaches();
    } catch (e: any) {
      setAdminError(e.message || 'Errore eliminazione');
    }
  };

  const startEditProduct = (item: ProductItem) => {
    setProdEditingId(item.id);
    setProdEditBrand(item.brand);
    setProdEditName(item.name);
    setAdminError('');
  };

  const cancelEditProduct = () => {
    setProdEditingId(null);
    setProdEditBrand('');
    setProdEditName('');
  };

  const handleSaveEditProduct = async (id: string) => {
    if (!prodEditBrand.trim() || !prodEditName.trim()) return;
    setProdSaving(true);
    setAdminError('');
    try {
      const response = await apiFetch(`/api/products?id=eq.${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brand: prodEditBrand.trim(), name: prodEditName.trim() }),
      });
      await ensureAdminWriteOk(response, 'Errore modifica prodotto');
      cancelEditProduct();
      await loadProducts();
      await refreshDropdownCaches();
    } catch (e: any) {
      setAdminError(e.message || 'Errore modifica prodotto');
    } finally {
      setProdSaving(false);
    }
  };

  // Sostituzione in-place: stesso floor_plan id → punti/etichette restano collegati.
  const handleReplaceFloorPlan = async (plan: FloorPlanRow, file: File) => {
    setFpReplacingId(plan.id);
    setAdminError('');
    try {
      const { fullRes, thumbnail, width, height, originalFormat, pdfBlob } = await processFloorPlan(file);

      const { fullResUrl, thumbnailUrl } = await uploadFloorPlan(
        plan.project_id,
        plan.floor,
        fullRes,
        thumbnail,
        plan.created_by || currentUser.id
      );

      let pdfUrl: string | null = null;
      if (pdfBlob) {
        try {
          pdfUrl = await uploadFloorPlanPDF(plan.project_id, plan.floor, pdfBlob, plan.created_by || currentUser.id);
        } catch (pdfErr) {
          console.warn('Upload PDF originale fallito (planimetria comunque sostituita):', pdfErr);
        }
      }

      const response = await apiFetch(`/api/floor_plans?id=eq.${plan.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image_url: fullResUrl,
          thumbnail_url: thumbnailUrl,
          pdf_url: pdfUrl,
          original_filename: file.name,
          original_format: originalFormat,
          width,
          height,
        }),
      });
      await ensureAdminWriteOk(response, 'Errore sostituzione planimetria');

      // Pulizia asset vecchi dallo storage (best-effort, dopo PATCH riuscito).
      try {
        await deleteFloorPlanAssets(plan.image_url || undefined, plan.thumbnail_url || undefined, plan.pdf_url || undefined);
      } catch (cleanupErr) {
        console.warn('Pulizia asset planimetria precedente fallita:', cleanupErr);
      }

      await loadFpPlans(fpSelectedProject);
    } catch (e: any) {
      setAdminError(e.message || 'Errore sostituzione planimetria');
    } finally {
      setFpReplacingId(null);
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

          {!isOnline && (
            <div className="bg-orange-50 border border-orange-200 text-orange-700 text-sm px-4 py-3 rounded-2xl mb-3">
              Nessuna connessione — funzione non disponibile.
            </div>
          )}

          {isOnline && (
            <div className="bg-white rounded-2xl shadow-card overflow-hidden">
              {/* Tab selector */}
              <div className="flex border-b border-brand-100">
                {(['dropdown', 'products', 'floorplans'] as const).map(tab => (
                  <button
                    key={tab}
                    onClick={() => setAdminTab(tab)}
                    className={`flex-1 py-3 text-sm font-semibold transition-colors ${
                      adminTab === tab ? 'text-accent border-b-2 border-accent' : 'text-brand-500'
                    }`}
                  >
                    {tab === 'dropdown' ? 'Dropdown' : tab === 'products' ? 'Prodotti' : 'Planimetrie'}
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
                      <option value="struttura">Struttura</option>
                      <option value="tipo_struttura">Tipo Struttura</option>
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
                      ddEditingId === item.id ? (
                        <div key={item.id} className="flex items-center gap-2 px-2 py-2 bg-blue-50 rounded-xl">
                          <div className="flex-1 min-w-0 flex flex-col gap-1">
                            <input
                              value={ddEditLabel}
                              onChange={e => setDdEditLabel(e.target.value)}
                              placeholder="Etichetta *"
                              className="w-full px-2 py-1.5 bg-white border border-brand-200 rounded-lg text-sm text-brand-800 focus:outline-none focus:border-accent"
                            />
                            <input
                              value={ddEditValue}
                              onChange={e => setDdEditValue(e.target.value)}
                              placeholder="Value (opzionale)"
                              className="w-full px-2 py-1.5 bg-white border border-brand-200 rounded-lg text-xs text-brand-600 focus:outline-none focus:border-accent"
                            />
                          </div>
                          <button
                            onClick={() => handleSaveEditDropdown(item.id)}
                            disabled={!ddEditLabel.trim() || ddSaving}
                            className="w-7 h-7 flex items-center justify-center text-success hover:bg-green-50 rounded-lg flex-shrink-0 disabled:opacity-40"
                          >
                            <Check size={15} />
                          </button>
                          <button
                            onClick={cancelEditDropdown}
                            className="w-7 h-7 flex items-center justify-center text-brand-400 hover:bg-brand-100 rounded-lg flex-shrink-0"
                          >
                            <X size={15} />
                          </button>
                        </div>
                      ) : (
                        <div key={item.id} className="flex items-center gap-2 px-3 py-2 bg-brand-50 rounded-xl">
                          <div className="flex-1 min-w-0">
                            <span className="text-sm text-brand-700 font-medium">{item.label}</span>
                            <span className="ml-2 text-xs text-brand-400">{item.value}</span>
                          </div>
                          <button
                            onClick={() => startEditDropdown(item)}
                            className="w-7 h-7 flex items-center justify-center text-accent hover:bg-blue-50 rounded-lg flex-shrink-0"
                          >
                            <Pencil size={14} />
                          </button>
                          <button
                            onClick={() => handleDeleteDropdown(item.id)}
                            className="w-7 h-7 flex items-center justify-center text-danger hover:bg-red-50 rounded-lg flex-shrink-0"
                          >
                            <X size={14} />
                          </button>
                        </div>
                      )
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
                              prodEditingId === item.id ? (
                                <div key={item.id} className="flex items-center gap-2 px-2 py-2 bg-blue-50 rounded-xl">
                                  <div className="flex-1 min-w-0 flex flex-col gap-1">
                                    <input
                                      value={prodEditBrand}
                                      onChange={e => setProdEditBrand(e.target.value)}
                                      placeholder="Marca *"
                                      className="w-full px-2 py-1.5 bg-white border border-brand-200 rounded-lg text-xs text-brand-600 focus:outline-none focus:border-accent"
                                    />
                                    <input
                                      value={prodEditName}
                                      onChange={e => setProdEditName(e.target.value)}
                                      placeholder="Nome prodotto *"
                                      className="w-full px-2 py-1.5 bg-white border border-brand-200 rounded-lg text-sm text-brand-800 focus:outline-none focus:border-accent"
                                    />
                                  </div>
                                  <button
                                    onClick={() => handleSaveEditProduct(item.id)}
                                    disabled={!prodEditBrand.trim() || !prodEditName.trim() || prodSaving}
                                    className="w-7 h-7 flex items-center justify-center text-success hover:bg-green-50 rounded-lg flex-shrink-0 disabled:opacity-40"
                                  >
                                    <Check size={15} />
                                  </button>
                                  <button
                                    onClick={cancelEditProduct}
                                    className="w-7 h-7 flex items-center justify-center text-brand-400 hover:bg-brand-100 rounded-lg flex-shrink-0"
                                  >
                                    <X size={15} />
                                  </button>
                                </div>
                              ) : (
                                <div key={item.id} className="flex items-center gap-2 px-3 py-2 bg-brand-50 rounded-xl">
                                  <span className="flex-1 text-sm text-brand-700">{item.name}</span>
                                  <button
                                    onClick={() => startEditProduct(item)}
                                    className="w-7 h-7 flex items-center justify-center text-accent hover:bg-blue-50 rounded-lg flex-shrink-0"
                                  >
                                    <Pencil size={14} />
                                  </button>
                                  <button
                                    onClick={() => handleDeleteProduct(item.id)}
                                    className="w-7 h-7 flex items-center justify-center text-danger hover:bg-red-50 rounded-lg flex-shrink-0"
                                  >
                                    <X size={14} />
                                  </button>
                                </div>
                              )
                            ))}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}

              {/* Floor plans tab — cambio planimetria in-place */}
              {adminTab === 'floorplans' && (
                <div className="p-4 space-y-4">
                  <p className="text-xs text-brand-500 leading-relaxed">
                    Sostituisci l'immagine di una planimetria mantenendo intatti punti, etichette e dati associati
                    (le posizioni restano perché normalizzate sulla planimetria).
                  </p>

                  {/* Selettore progetto */}
                  <div className="relative">
                    <select
                      value={fpSelectedProject}
                      onChange={e => setFpSelectedProject(e.target.value)}
                      disabled={fpProjectsLoading}
                      className="w-full px-4 py-3 bg-brand-50 border border-brand-200 rounded-xl text-sm text-brand-800 focus:outline-none focus:border-accent appearance-none"
                    >
                      <option value="">{fpProjectsLoading ? 'Caricamento progetti...' : 'Seleziona progetto…'}</option>
                      {fpProjects.map(p => (
                        <option key={p.id} value={p.id}>
                          {p.title || '(senza titolo)'}{p.client ? ` — ${p.client}` : ''}
                        </option>
                      ))}
                    </select>
                    <ChevronDown size={15} className="absolute right-3 top-1/2 -translate-y-1/2 text-brand-400 pointer-events-none" />
                  </div>

                  {/* Lista planimetrie */}
                  {fpSelectedProject && (
                    <div className="space-y-2 max-h-96 overflow-y-auto">
                      {fpPlansLoading ? (
                        <div className="text-center py-6 text-brand-500 text-sm">Caricamento planimetrie...</div>
                      ) : fpPlans.length === 0 ? (
                        <div className="text-center py-6 text-brand-400 text-sm">Nessuna planimetria per questo progetto</div>
                      ) : fpPlans.map(plan => (
                        <div key={plan.id} className="flex items-center gap-3 px-3 py-3 bg-brand-50 rounded-xl">
                          <div className="w-12 h-12 rounded-lg bg-brand-100 flex items-center justify-center overflow-hidden flex-shrink-0">
                            {plan.thumbnail_url ? (
                              <img src={plan.thumbnail_url} alt={plan.floor} className="w-full h-full object-cover" />
                            ) : (
                              <ImageIcon size={18} className="text-brand-400" />
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-semibold text-brand-700">Piano {plan.floor}</div>
                            <div className="text-xs text-brand-400 truncate">{plan.original_filename || '—'}</div>
                            <div className="text-[11px] text-brand-500 mt-0.5">
                              {(fpPointCounts[plan.id] ?? 0)} punti/etichette mantenuti
                            </div>
                          </div>
                          <label
                            className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold flex-shrink-0 cursor-pointer ${
                              fpReplacingId === plan.id
                                ? 'bg-brand-200 text-brand-500 cursor-wait'
                                : 'bg-accent text-white hover:bg-accent/90'
                            }`}
                          >
                            <Upload size={14} />
                            {fpReplacingId === plan.id ? 'Carico...' : 'Sostituisci'}
                            <input
                              type="file"
                              accept="image/*,application/pdf"
                              className="hidden"
                              disabled={fpReplacingId !== null}
                              onChange={e => {
                                const file = e.target.files?.[0];
                                e.target.value = '';
                                if (!file) return;
                                if (window.confirm(`Sostituire la planimetria del piano "${plan.floor}"?\n\nL'immagine attuale verrà eliminata. Punti ed etichette restano invariati.`)) {
                                  handleReplaceFloorPlan(plan, file);
                                }
                              }}
                            />
                          </label>
                        </div>
                      ))}
                    </div>
                  )}
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
