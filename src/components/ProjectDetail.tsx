import React, { useState, useEffect, useMemo } from 'react';
import { useBlobUrl } from '../hooks/useBlobUrl';
import {
  ArrowLeft, Camera, Map, Info,
  ChevronDown, ChevronRight, Pencil, Trash2, AlertTriangle,
  RefreshCw, Tag, Package, Filter, X, DollarSign, Download, FileDown, ClipboardList
} from 'lucide-react';
import { SUPPORTO_OPTIONS } from '../config/supporto';
import { ATTRAVERSAMENTO_OPTIONS } from '../config/attraversamento';
import {
  Project, MappingEntry, Photo, User, FloorPlan, FloorPlanPoint,
  getMappingEntriesForProject, getPhotosForMappings, deleteMappingEntry,
  getFloorPlansByProject, getFloorPlanPointsForPlans, getAllUsers, ensureFloorPlanAsset,
  ProjectCachePref, getProjectCachePref, setProjectOfflinePinned, hydrateProjectForOffline,
} from '../db';
import { exportFloorPlanVectorPDF, ExportPoint } from '../utils/exportUtils';
import { useMappingExports } from './useMappingExports';
import PhotoPreviewModal from './PhotoPreviewModal';
import CostsTab from './CostsTab';
import SalTab from './SalTab';

interface ProjectDetailProps {
  project: Project;
  currentUser: User;
  onBack: () => void;
  onAddMapping: () => void;
  onEditMapping: (entry: MappingEntry) => void;
  onOpenFloorPlanEditor: (project: Project, floorPlan: FloorPlan) => void;
  onExport?: () => void;
  onSync?: () => void;
  isSyncing?: boolean;
}

type SubTab = 'mappings' | 'plans' | 'info' | 'costs' | 'sal';

const ProjectDetail: React.FC<ProjectDetailProps> = ({
  project,
  currentUser,
  onBack,
  onAddMapping,
  onEditMapping,
  onOpenFloorPlanEditor,
  onSync,
  isSyncing,
}) => {
  const [activeTab, setActiveTabRaw] = useState<SubTab>('mappings');

  const setActiveTab = (tab: SubTab) => {
    setActiveTabRaw(tab);
    window.history.pushState(
      { ...(window.history.state || {}), __subTab: tab },
      ''
    );
  };

  // Handle browser back to navigate between sub-tabs
  useEffect(() => {
    const handlePopState = (event: PopStateEvent) => {
      const state = event.state as { view?: string; __subTab?: SubTab } | null;
      if (state?.view === 'projectDetail') {
        // Restore the sub-tab that was active at this history entry (default to 'mappings')
        setActiveTabRaw(state.__subTab ?? 'mappings');
      }
      // If view changed away from 'projectDetail', App.tsx handles it and unmounts this component
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [mappings, setMappings] = useState<MappingEntry[]>([]);
  const [mappingPhotos, setMappingPhotos] = useState<Record<string, Photo[]>>({});
  const [floorPlans, setFloorPlans] = useState<FloorPlan[]>([]);
  const [floorPlanPoints, setFloorPlanPoints] = useState<Record<string, FloorPlanPoint[]>>({});
  const [users, setUsers] = useState<User[]>([]);
  const [expandedFloors, setExpandedFloors] = useState<Set<string>>(new Set());
  const [selectedPhoto, setSelectedPhoto] = useState<{ url: string; alt: string } | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [expandedMappings, setExpandedMappings] = useState<Set<string>>(new Set());
  const [exportingPlanId, setExportingPlanId] = useState<string | null>(null);
  const [projectCachePref, setProjectCachePref] = useState<ProjectCachePref | null>(null);
  const [isUpdatingOfflineCache, setIsUpdatingOfflineCache] = useState(false);

  // Filters (persisted in localStorage)
  const [showOnlyToComplete, setShowOnlyToComplete] = useState<boolean>(() => {
    return localStorage.getItem(`pd_${project.id}_toComplete`) === 'true';
  });
  const [filterTipologico, setFilterTipologico] = useState<string>(() => {
    return localStorage.getItem(`pd_${project.id}_tipologico`) || '';
  });
  const [filterSupporto, setFilterSupporto] = useState<string>(() => {
    return localStorage.getItem(`pd_${project.id}_supporto`) || '';
  });
  const [filterAttraversamento, setFilterAttraversamento] = useState<string>(() => {
    return localStorage.getItem(`pd_${project.id}_attraversamento`) || '';
  });
  const [filtersOpen, setFiltersOpen] = useState<boolean>(() => {
    return localStorage.getItem(`pd_${project.id}_filtersOpen`) === 'true';
  });

  const hasActiveFilters = showOnlyToComplete || !!filterTipologico || !!filterSupporto || !!filterAttraversamento;

  const clearFilters = () => {
    setShowOnlyToComplete(false);
    setFilterTipologico('');
    setFilterSupporto('');
    setFilterAttraversamento('');
    localStorage.removeItem(`pd_${project.id}_toComplete`);
    localStorage.removeItem(`pd_${project.id}_tipologico`);
    localStorage.removeItem(`pd_${project.id}_supporto`);
    localStorage.removeItem(`pd_${project.id}_attraversamento`);
  };

  // Persist filters
  useEffect(() => {
    localStorage.setItem(`pd_${project.id}_toComplete`, String(showOnlyToComplete));
  }, [showOnlyToComplete, project.id]);
  useEffect(() => {
    localStorage.setItem(`pd_${project.id}_tipologico`, filterTipologico);
  }, [filterTipologico, project.id]);
  useEffect(() => {
    localStorage.setItem(`pd_${project.id}_supporto`, filterSupporto);
  }, [filterSupporto, project.id]);
  useEffect(() => {
    localStorage.setItem(`pd_${project.id}_attraversamento`, filterAttraversamento);
  }, [filterAttraversamento, project.id]);
  useEffect(() => {
    localStorage.setItem(`pd_${project.id}_filtersOpen`, String(filtersOpen));
  }, [filtersOpen, project.id]);

  // Compute filtered + grouped mappings
  const filteredFloorGroups = useMemo(() => {
    let filtered = mappings;
    if (showOnlyToComplete) filtered = filtered.filter(m => m.toComplete === true);
    if (filterTipologico) filtered = filtered.filter(m => m.crossings.some(c => c.tipologicoId === filterTipologico));
    if (filterSupporto) filtered = filtered.filter(m => m.crossings.some(c => c.supporto === filterSupporto));
    if (filterAttraversamento) filtered = filtered.filter(m => m.crossings.some(c => c.attraversamento === filterAttraversamento));

    const grouped: Record<string, MappingEntry[]> = {};
    for (const entry of filtered) {
      const floor = entry.floor || 'N/D';
      if (!grouped[floor]) grouped[floor] = [];
      grouped[floor].push(entry);
    }
    return {
      count: filtered.length,
      groups: Object.keys(grouped)
        .sort((a, b) => parseFloat(a) - parseFloat(b))
        .map(floor => ({ floor, entries: grouped[floor].sort((a, b) => b.timestamp - a.timestamp) })),
    };
  }, [mappings, showOnlyToComplete, filterTipologico, filterSupporto, filterAttraversamento]);

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id]);

  useEffect(() => {
    const loadCachePref = async () => {
      const cachePref = await getProjectCachePref(project.id);
      setProjectCachePref(cachePref || null);
    };

    loadCachePref();
  }, [project.id]);

  const loadData = async () => {
    setIsLoading(true);
    const entries = await getMappingEntriesForProject(project.id);
    setMappings(entries);

    // Auto-expand first floor
    const floorSet: Record<string, boolean> = {};
    entries.forEach(e => { floorSet[e.floor || 'N/D'] = true; });
    const sorted = Object.keys(floorSet).sort((a, b) => parseFloat(a) - parseFloat(b));
    if (sorted.length > 0) {
      setExpandedFloors(new Set([sorted[0]]));
    }

    const photosMap = await getPhotosForMappings(entries.map(entry => entry.id));
    setMappingPhotos(photosMap);

    // Load floor plans + their points
    const plans = await getFloorPlansByProject(project.id);
    setFloorPlans(plans);
    const pointsMap = await getFloorPlanPointsForPlans(plans.map(plan => plan.id));
    setFloorPlanPoints(pointsMap);

    // Load users for export labels
    try {
      const loadedUsers = await getAllUsers();
      setUsers(loadedUsers);
    } catch {
      setUsers([currentUser]);
    }

    setIsLoading(false);
  };

  const toggleFloor = (floor: string) => {
    setExpandedFloors(prev => {
      const next = new Set(prev);
      if (next.has(floor)) next.delete(floor);
      else next.add(floor);
      return next;
    });
  };

  const handleEnableOffline = async () => {
    try {
      setIsUpdatingOfflineCache(true);
      const cachePref = await hydrateProjectForOffline(project.id);
      setProjectCachePref(cachePref);
    } catch (error) {
      console.error('Failed to hydrate project for offline use:', error);
      alert('Impossibile completare il download offline del progetto.');
    } finally {
      setIsUpdatingOfflineCache(false);
    }
  };

  const handleDisableOfflinePin = async () => {
    try {
      setIsUpdatingOfflineCache(true);
      const cachePref = await setProjectOfflinePinned(project.id, false);
      setProjectCachePref(cachePref);
    } catch (error) {
      console.error('Failed to disable offline pin:', error);
      alert('Impossibile aggiornare la preferenza offline del progetto.');
    } finally {
      setIsUpdatingOfflineCache(false);
    }
  };

  const toggleMappingExpand = (id: string) => {
    setExpandedMappings(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleDelete = async (entry: MappingEntry) => {
    if (window.confirm('Eliminare questa mappatura?')) {
      await deleteMappingEntry(entry.id);
      loadData();
    }
  };

  const totalToComplete = mappings.filter(m => m.toComplete).length;

  // ---- Export helpers ----
  const getTipologicoNumber = (tipologicoId: string): string => {
    const tip = project.typologies.find(t => t.id === tipologicoId);
    return tip ? tip.number.toString() : tipologicoId;
  };
  const getUsername = (userId: string): string => {
    const u = users.find(u => u.id === userId);
    return u ? u.username : userId;
  };
  const generatePhotoPrefix = (floor: string, room?: string, intervention?: string): string => {
    const parts: string[] = [];
    if (project.floors && project.floors.length > 1) parts.push(`P${floor}`);
    if (project.useRoomNumbering && room) parts.push(`S${room}`);
    if (project.useInterventionNumbering && intervention) parts.push(`Int${intervention}`);
    return parts.length > 0 ? parts.join('_') + '_' : '';
  };
  const generateMappingLabel = (entry: MappingEntry, photoCount: number): string[] => {
    const parts: string[] = [];
    if (project.floors && project.floors.length > 1) parts.push(`P${entry.floor}`);
    if (project.useRoomNumbering && entry.room) parts.push(`S${entry.room}`);
    if (project.useInterventionNumbering && entry.intervention) parts.push(`Int${entry.intervention}`);
    let firstLine = parts.length > 0 ? parts.join('_') : 'Punto';
    if (parts.length > 0 && photoCount > 1) {
      firstLine += `_01-${photoCount.toString().padStart(2, '0')}`;
    }
    const tipNumbers = entry.crossings
      .map(c => c.tipologicoId ? project.typologies.find(t => t.id === c.tipologicoId)?.number : null)
      .filter((n): n is number => n !== null)
      .filter((v, i, a) => a.indexOf(v) === i)
      .sort((a, b) => a - b);
    const result = [firstLine];
    if (tipNumbers.length > 0) result.push(`Tip. ${tipNumbers.join(' - ')}`);
    return result;
  };

  const { isExporting, handleExportZip } = useMappingExports({
    project,
    mappings,
    mappingPhotos,
    users,
    floorPlans,
    floorPlanPoints,
    setFloorPlanPoints,
    getTipologicoNumber,
    generatePhotoPrefix,
    getUsername,
    generateMappingLabel,
  });

  // Export a single floor plan as vector PDF
  const handleExportPlanPDF = async (plan: FloorPlan) => {
    setExportingPlanId(plan.id);
    try {
      const hydratedPlan = await ensureFloorPlanAsset(plan.id, 'full');
      const exportReadyPlan = hydratedPlan ? await ensureFloorPlanAsset(plan.id, 'pdf') : undefined;
      if (!exportReadyPlan?.imageBlob) {
        return;
      }

      const rawPoints = floorPlanPoints[plan.id] || [];
      const exportPoints: ExportPoint[] = rawPoints.map(point => ({
        type: point.pointType,
        pointX: point.pointX,
        pointY: point.pointY,
        labelX: point.labelX,
        labelY: point.labelY,
        labelText: point.metadata?.labelText || ((() => {
          const entry = mappings.find(m => m.id === point.mappingEntryId);
          if (!entry) return ['Punto'];
          const photos = mappingPhotos[entry.id] || [];
          return generateMappingLabel(entry, photos.length);
        })()),
        perimeterPoints: point.perimeterPoints,
        labelBackgroundColor: point.metadata?.labelBackgroundColor,
        labelTextColor: point.metadata?.labelTextColor,
      }));
      const savedCartiglio = plan.metadata?.cartiglio;
      const exportCartiglio = savedCartiglio?.enabled === false
        ? null
        : {
            positionX: savedCartiglio?.positionX ?? 0.03,
            positionY: savedCartiglio?.positionY ?? 0.68,
            tavola: savedCartiglio?.tavola ?? plan.floor,
            typologyNumbers: [...(project.typologies || [])].map((typology) => typology.number).sort((a, b) => a - b),
            typologyValues: { ...(savedCartiglio?.typologyValues || {}) },
            committente: savedCartiglio?.committente ?? [project.client.trim() || project.title.trim(), project.address.trim()].filter(Boolean).join(' - '),
            locali: savedCartiglio?.locali ?? '',
          };
      await exportFloorPlanVectorPDF(
        exportReadyPlan.imageBlob,
        exportPoints,
        `Piano_${plan.floor}_annotato.pdf`,
        exportReadyPlan.pdfBlobBase64,
        exportReadyPlan.metadata?.rotation || 0,
        undefined,
        exportCartiglio,
      );
      setFloorPlans(prev => prev.map(existing => existing.id === exportReadyPlan.id ? exportReadyPlan : existing));
    } finally {
      setExportingPlanId(null);
    }
  };

  const subTabs: { id: SubTab; label: string; icon: typeof Camera; count?: number }[] = [
    { id: 'mappings', label: 'Mappature', icon: Camera, count: mappings.length },
    { id: 'plans', label: 'Planimetrie', icon: Map, count: floorPlans.length },
    { id: 'info', label: 'Info', icon: Info },
    { id: 'costs', label: 'Contabilità', icon: DollarSign },
    { id: 'sal', label: 'SAL', icon: ClipboardList },
  ];

  return (
    <div className="flex flex-col h-full bg-brand-100">
      {/* Header */}
      <div className="bg-white shadow-card z-10">
        <div className="flex items-center gap-3 px-4 pt-4 pb-2">
          <button
            onClick={onBack}
            className="w-9 h-9 rounded-xl flex items-center justify-center text-brand-600 hover:bg-brand-50 active:bg-brand-100"
          >
            <ArrowLeft size={20} />
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="text-lg font-bold text-brand-800 truncate">{project.title}</h1>
            {project.client && (
              <p className="text-xs text-brand-500 truncate">{project.client}</p>
            )}
          </div>
          <button
            onClick={handleExportZip}
            disabled={isExporting || mappings.length === 0}
            title="Esporta ZIP (foto + Excel + planimetrie)"
            className="w-9 h-9 rounded-xl flex items-center justify-center text-brand-500 hover:bg-brand-50 disabled:opacity-40"
          >
            {isExporting
              ? <RefreshCw size={18} className="animate-spin" />
              : <Download size={18} />
            }
          </button>
          {onSync && (
            <button
              onClick={onSync}
              disabled={isSyncing}
              className="w-9 h-9 rounded-xl flex items-center justify-center text-brand-500 hover:bg-brand-50"
            >
              <RefreshCw size={18} className={isSyncing ? 'animate-spin' : ''} />
            </button>
          )}
        </div>

        {/* Sub-tabs */}
        <div className="flex overflow-x-auto px-4 gap-1 [&::-webkit-scrollbar]:hidden">
          {subTabs.map(tab => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex-shrink-0 flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium transition-all border-b-2 ${
                  isActive
                    ? 'border-accent text-accent'
                    : 'border-transparent text-brand-500 hover:text-brand-700'
                }`}
              >
                <Icon size={15} />
                <span>{tab.label}</span>
                {tab.count !== undefined && (
                  <span className={`text-[11px] px-1.5 py-0.5 rounded-full ${
                    isActive ? 'bg-accent/10 text-accent' : 'bg-brand-100 text-brand-500'
                  }`}>
                    {tab.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto pb-20">
        {isLoading ? (
          <div className="text-center py-12 text-brand-500 text-sm">Caricamento...</div>
        ) : (
          <>
            {/* Mappings Tab */}
            {activeTab === 'mappings' && (
              <div className="px-4 pt-4">
                {/* Stats bar + filter toggle */}
                {mappings.length > 0 && (
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-xs text-brand-500">{mappings.length} mappature</span>
                    {totalToComplete > 0 && (
                      <span className="flex items-center gap-1 text-xs text-warning font-medium bg-orange-50 px-2 py-0.5 rounded-full">
                        <AlertTriangle size={11} />
                        {totalToComplete} da completare
                      </span>
                    )}
                    <button
                      onClick={() => setFiltersOpen(f => !f)}
                      className={`ml-auto flex items-center gap-1 text-xs font-medium px-2.5 py-1.5 rounded-lg transition-colors ${
                        hasActiveFilters
                          ? 'bg-accent text-white'
                          : filtersOpen
                          ? 'bg-brand-200 text-brand-700'
                          : 'bg-brand-50 text-brand-500 hover:bg-brand-100'
                      }`}
                    >
                      <Filter size={12} />
                      Filtri
                      {hasActiveFilters && (
                        <span className="bg-white/30 text-[10px] px-1 rounded-full ml-0.5">
                          {[showOnlyToComplete, filterTipologico, filterSupporto, filterAttraversamento].filter(Boolean).length}
                        </span>
                      )}
                    </button>
                  </div>
                )}

                {/* Filter panel */}
                {filtersOpen && (
                  <div className="bg-white rounded-xl shadow-card p-3 mb-4 space-y-2.5">
                    {/* Da Completare toggle */}
                    <button
                      onClick={() => setShowOnlyToComplete(v => !v)}
                      className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                        showOnlyToComplete
                          ? 'bg-warning/10 text-warning'
                          : 'bg-brand-50 text-brand-600'
                      }`}
                    >
                      <span className="flex items-center gap-1.5">
                        <AlertTriangle size={12} />
                        Solo da completare
                      </span>
                      <span className={`w-4 h-4 rounded border-2 flex items-center justify-center ${
                        showOnlyToComplete ? 'bg-warning border-warning text-white' : 'border-brand-300'
                      }`}>
                        {showOnlyToComplete && <span className="text-[10px]">✓</span>}
                      </span>
                    </button>

                    {/* Tipologico */}
                    <div>
                      <select
                        value={filterTipologico}
                        onChange={e => setFilterTipologico(e.target.value)}
                        className="w-full text-xs bg-brand-50 border border-brand-200 rounded-lg px-3 py-2 text-brand-700 appearance-none"
                      >
                        <option value="">Tutti i tipologici</option>
                        {(project.typologies || []).sort((a, b) => a.number - b.number).map(t => (
                          <option key={t.id} value={t.id}>Tip. {t.number}</option>
                        ))}
                      </select>
                    </div>

                    {/* Supporto */}
                    <div>
                      <select
                        value={filterSupporto}
                        onChange={e => setFilterSupporto(e.target.value)}
                        className="w-full text-xs bg-brand-50 border border-brand-200 rounded-lg px-3 py-2 text-brand-700 appearance-none"
                      >
                        <option value="">Tutti i supporti</option>
                        {SUPPORTO_OPTIONS.filter(o => o.value).map(o => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </select>
                    </div>

                    {/* Attraversamento */}
                    <div>
                      <select
                        value={filterAttraversamento}
                        onChange={e => setFilterAttraversamento(e.target.value)}
                        className="w-full text-xs bg-brand-50 border border-brand-200 rounded-lg px-3 py-2 text-brand-700 appearance-none"
                      >
                        <option value="">Tutti gli attraversamenti</option>
                        {ATTRAVERSAMENTO_OPTIONS.filter(o => o.value).map(o => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </select>
                    </div>

                    {/* Clear button */}
                    {hasActiveFilters && (
                      <button
                        onClick={clearFilters}
                        className="w-full flex items-center justify-center gap-1.5 text-xs text-danger font-medium py-2 rounded-lg hover:bg-red-50 transition-colors"
                      >
                        <X size={12} />
                        Cancella filtri
                      </button>
                    )}
                  </div>
                )}

                {/* Filter results count */}
                {hasActiveFilters && (
                  filteredFloorGroups.count === 0 ? (
                    <div className="text-center py-8 text-brand-400 text-sm">
                      Nessuna mappatura trovata con i filtri attivi
                    </div>
                  ) : (
                    <div className="mb-2">
                      <span className="text-[11px] text-brand-400">
                        {filteredFloorGroups.count} di {mappings.length} mappature
                      </span>
                    </div>
                  )
                )}

                <div className="space-y-3">
                  {filteredFloorGroups.groups.map(group => (
                    <div key={group.floor}>
                      <button
                        onClick={() => toggleFloor(group.floor)}
                        className="w-full flex items-center gap-2 px-3 py-2.5 bg-white rounded-xl shadow-card mb-2"
                      >
                        {expandedFloors.has(group.floor) ? (
                          <ChevronDown size={16} className="text-brand-500" />
                        ) : (
                          <ChevronRight size={16} className="text-brand-500" />
                        )}
                        <span className="text-sm font-semibold text-brand-700">Piano {group.floor}</span>
                        <span className="text-xs text-brand-400 ml-auto">{group.entries.length} mappature</span>
                      </button>

                      {expandedFloors.has(group.floor) && (
                        <div className="space-y-2 ml-2">
                          {group.entries.map(entry => {
                            const photos = mappingPhotos[entry.id] || [];
                            const isExpanded = expandedMappings.has(entry.id);

                            return (
                              <div key={entry.id} className="bg-white rounded-xl shadow-card overflow-hidden">
                                {/* Entry header */}
                                <button
                                  onClick={() => toggleMappingExpand(entry.id)}
                                  className="w-full flex items-center gap-3 p-3 text-left"
                                >
                                  {/* Thumbnail */}
                                  <div className="w-12 h-12 rounded-lg bg-brand-50 flex-shrink-0 overflow-hidden">
                                    <EntryThumbnail
                                      blob={photos.length > 0 ? photos[0].thumbnailBlob || photos[0].blob : undefined}
                                      remoteUrl={photos.length > 0 ? photos[0].thumbnailRemoteUrl || photos[0].remoteUrl : undefined}
                                    />
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-1.5">
                                      <span className="text-sm font-medium text-brand-700">
                                        {entry.room ? `St. ${entry.room}` : 'Piano ' + entry.floor}
                                        {entry.intervention && ` · Int. ${entry.intervention}`}
                                      </span>
                                      {entry.toComplete && (
                                        <span className="w-2 h-2 rounded-full bg-warning flex-shrink-0" title="Da completare" />
                                      )}
                                    </div>
                                    <div className="text-xs text-brand-500 mt-0.5">
                                      {entry.crossings?.length || 0} attr. · {photos.length} foto
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-1.5 flex-shrink-0">
                                    <span className="text-[11px] text-brand-400">
                                      {new Date(entry.timestamp).toLocaleDateString('it-IT', { day: 'numeric', month: 'short' })}
                                    </span>
                                    <ChevronDown size={14} className={`text-brand-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                                  </div>
                                </button>

                                {/* Expanded content */}
                                {isExpanded && (
                                  <div className="border-t border-brand-100 px-3 pb-3 pt-2">
                                    {/* Crossings */}
                                    {entry.crossings && entry.crossings.length > 0 && (
                                      <div className="mb-3">
                                        {entry.crossings.map((crossing, ci) => {
                                          const linkedTypology = crossing.tipologicoId
                                            ? project.typologies?.find(t => t.id === crossing.tipologicoId)
                                            : undefined;
                                          return (
                                            <div key={ci} className="text-xs text-brand-600 py-1.5">
                                              <div className="flex items-center gap-2">
                                                <span className="w-1.5 h-1.5 rounded-full bg-brand-300 flex-shrink-0" />
                                                <span>
                                                  {crossing.supporto} · {crossing.tipoSupporto} · {crossing.attraversamento}
                                                  {crossing.quantita && ` × ${crossing.quantita}`}
                                                  {crossing.diametro && ` Ø${crossing.diametro}`}
                                                  {crossing.dimensioni && ` (${crossing.dimensioni})`}
                                                </span>
                                                {linkedTypology && (
                                                  <span className="text-[10px] font-bold text-accent bg-accent/10 px-1.5 py-0.5 rounded-full flex-shrink-0">
                                                    T#{linkedTypology.number}
                                                  </span>
                                                )}
                                              </div>
                                              {linkedTypology && (
                                                <div className="ml-[17px] mt-1 space-y-0.5">
                                                  {linkedTypology.marcaProdottoUtilizzato && (
                                                    <div className="flex items-center gap-1.5 text-brand-500">
                                                      <Tag size={10} className="text-brand-400" />
                                                      <span>{linkedTypology.marcaProdottoUtilizzato}</span>
                                                    </div>
                                                  )}
                                                  {linkedTypology.prodottiSelezionati && linkedTypology.prodottiSelezionati.length > 0 && (
                                                    <div className="flex items-center gap-1.5 text-brand-500">
                                                      <Package size={10} className="text-brand-400" />
                                                      <span>{linkedTypology.prodottiSelezionati.join(', ')}</span>
                                                    </div>
                                                  )}
                                                </div>
                                              )}
                                            </div>
                                          );
                                        })}
                                      </div>
                                    )}

                                    {/* Photo grid */}
                                    {photos.length > 0 && (
                                      <div className="grid grid-cols-4 gap-1.5 mb-3">
                                        {photos.map((photo, pi) => (
                                          <PhotoGridItem
                                            key={photo.id || pi}
                                            blob={photo.blob}
                                            remoteUrl={photo.remoteUrl}
                                            alt={`Foto ${pi + 1}`}
                                            onSelect={(url) => setSelectedPhoto({ url, alt: `Foto ${pi + 1}` })}
                                          />
                                        ))}
                                      </div>
                                    )}

                                    {/* Actions */}
                                    <div className="flex gap-2">
                                      <button
                                        onClick={() => onEditMapping(entry)}
                                        className="flex-1 flex items-center justify-center gap-1.5 py-2 bg-brand-50 text-brand-600 rounded-lg text-xs font-medium hover:bg-brand-100 transition-colors"
                                      >
                                        <Pencil size={13} />
                                        Modifica
                                      </button>
                                      <button
                                        onClick={() => handleDelete(entry)}
                                        className="flex items-center justify-center w-10 py-2 bg-red-50 text-danger rounded-lg hover:bg-red-100 transition-colors"
                                      >
                                        <Trash2 size={13} />
                                      </button>
                                    </div>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                {mappings.length === 0 && (
                  <div className="text-center py-12">
                    <Camera size={40} className="mx-auto text-brand-300 mb-3" />
                    <p className="text-brand-500 text-sm">Nessuna mappatura</p>
                    <p className="text-brand-400 text-xs mt-1">Usa il pulsante qui sotto per iniziare una nuova mappatura</p>
                  </div>
                )}

                {/* Add mapping button */}
                <button
                  onClick={onAddMapping}
                  className="w-full mt-4 py-3.5 bg-accent text-white rounded-xl font-semibold text-sm flex items-center justify-center gap-2 active:scale-[0.98] transition-transform shadow-card"
                >
                  Nuova mappatura
                </button>
              </div>
            )}

            {/* Plans Tab */}
            {activeTab === 'plans' && (
              <div className="px-4 pt-4">
                {floorPlans.length === 0 ? (
                  <div className="text-center py-12">
                    <Map size={40} className="mx-auto text-brand-300 mb-3" />
                    <p className="text-brand-500 text-sm">Nessuna planimetria</p>
                    <p className="text-brand-400 text-xs mt-1">Carica una planimetria nelle impostazioni del progetto</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-3">
                    {floorPlans.map(plan => (
                      <div key={plan.id} className="bg-white rounded-2xl shadow-card overflow-hidden">
                        <button
                          onClick={() => onOpenFloorPlanEditor(project, plan)}
                          className="w-full active:scale-[0.98] transition-transform"
                        >
                          <div className="aspect-[4/3] bg-brand-50 flex items-center justify-center">
                            <PlanThumbnail blob={plan.thumbnailBlob} remoteUrl={plan.thumbnailUrl || plan.imageUrl} alt={`Piano ${plan.floor}`} />
                          </div>
                        </button>
                        <div className="px-3 py-2.5 flex items-center justify-between">
                          <div className="text-sm font-semibold text-brand-700">Piano {plan.floor}</div>
                          <button
                            onClick={() => handleExportPlanPDF(plan)}
                            disabled={exportingPlanId === plan.id}
                            title="Scarica PDF"
                            className="w-7 h-7 rounded-lg flex items-center justify-center text-accent hover:bg-accent/10 disabled:opacity-40"
                          >
                            {exportingPlanId === plan.id
                              ? <RefreshCw size={13} className="animate-spin" />
                              : <FileDown size={14} />
                            }
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Costs Tab */}
            {activeTab === 'costs' && (
              <CostsTab project={project} currentUser={currentUser} />
            )}

            {/* SAL Tab */}
            {activeTab === 'sal' && (
              <SalTab project={project} currentUser={currentUser} />
            )}

            {/* Info Tab */}
            {activeTab === 'info' && (
              <div className="px-4 pt-4 space-y-4">
                    <div className="bg-white rounded-2xl shadow-card overflow-hidden divide-y divide-brand-100">
                  <div className="px-4 py-3.5">
                    <div className="text-xs text-brand-500 mb-0.5">Titolo</div>
                    <div className="text-sm font-medium text-brand-800">{project.title}</div>
                          </div>
                  {project.client && (
                    <div className="px-4 py-3.5">
                      <div className="text-xs text-brand-500 mb-0.5">Cliente</div>
                      <div className="text-sm font-medium text-brand-800">{project.client}</div>
                            </div>
                          )}
                  {project.address && (
                    <div className="px-4 py-3.5">
                      <div className="text-xs text-brand-500 mb-0.5">Indirizzo</div>
                      <div className="text-sm font-medium text-brand-800">{project.address}</div>
                            </div>
                          )}
                  <div className="px-4 py-3.5">
                    <div className="text-xs text-brand-500 mb-0.5">Piani</div>
                    <div className="text-sm font-medium text-brand-800">
                      {project.floors?.join(', ') || 'Nessuno'}
                        </div>
                  </div>
                  {project.notes && (
                    <div className="px-4 py-3.5">
                      <div className="text-xs text-brand-500 mb-0.5">Note</div>
                      <div className="text-sm text-brand-700 whitespace-pre-wrap">{project.notes}</div>
                    </div>
                )}
                  <div className="px-4 py-3.5">
                    <div className="text-xs text-brand-500 mb-0.5">Creato</div>
                    <div className="text-sm text-brand-700">
                      {new Date(project.createdAt).toLocaleDateString('it-IT', {
                        day: 'numeric', month: 'long', year: 'numeric'
                      })}
              </div>
      </div>
                  <div className="px-4 py-3.5">
                    <div className="text-xs text-brand-500 mb-0.5">Accesso dati</div>
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-success" />
                      <span className="text-sm text-brand-700">
                        Online-first con cache locale e coda offline
                      </span>
                    </div>
                  </div>
                  <div className="px-4 py-3.5">
                    <div className="text-xs text-brand-500 mb-1">Disponibile offline</div>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm text-brand-800 font-medium">
                          {projectCachePref?.offlinePinned ? 'Progetto pinnato offline' : 'Solo cache dinamica'}
                        </div>
                        <div className="text-xs text-brand-500 mt-1">
                          {projectCachePref?.lastHydratedAt
                            ? `Ultima reidratazione: ${new Date(projectCachePref.lastHydratedAt).toLocaleString('it-IT')}`
                            : 'Scarica foto e planimetrie in locale per lavorare meglio anche senza rete.'}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {projectCachePref?.offlinePinned && (
                          <button
                            type="button"
                            onClick={handleDisableOfflinePin}
                            disabled={isUpdatingOfflineCache}
                            className="px-3 py-2 rounded-xl border border-brand-200 text-xs font-semibold text-brand-700 disabled:opacity-60"
                          >
                            Rimuovi pin
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={handleEnableOffline}
                          disabled={isUpdatingOfflineCache}
                          className="px-3 py-2 rounded-xl bg-accent text-white text-xs font-semibold disabled:opacity-60 inline-flex items-center gap-1.5"
                        >
                          {isUpdatingOfflineCache ? (
                            <RefreshCw size={14} className="animate-spin" />
                          ) : (
                            <Download size={14} />
                          )}
                          <span>{projectCachePref?.offlinePinned ? 'Aggiorna cache' : 'Rendi offline'}</span>
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Typologies */}
                {project.typologies && project.typologies.length > 0 && (
                  <div>
                    <h3 className="text-xs font-semibold text-brand-500 uppercase tracking-wider mb-2 px-1">
                      Tipologici ({project.typologies.length})
                    </h3>
                    <div className="bg-white rounded-2xl shadow-card overflow-hidden divide-y divide-brand-100">
                      {project.typologies.sort((a, b) => a.number - b.number).map(tip => (
                        <div key={tip.id} className="px-4 py-3">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-xs font-bold text-accent bg-accent/10 px-2 py-0.5 rounded-full">
                              #{tip.number}
                            </span>
                            <span className="text-xs text-brand-600">
                              {tip.supporto} · {tip.tipoSupporto}
                            </span>
                          </div>
                          <div className="text-xs text-brand-500 mb-1.5">{tip.attraversamento}</div>
                          {tip.marcaProdottoUtilizzato && (
                            <div className="flex items-center gap-1.5 text-xs text-brand-600 mb-0.5">
                              <Tag size={12} className="text-brand-400" />
                              <span className="font-medium">{tip.marcaProdottoUtilizzato}</span>
                            </div>
                          )}
                          {tip.prodottiSelezionati && tip.prodottiSelezionati.length > 0 && (
                            <div className="flex items-start gap-1.5 text-xs text-brand-500">
                              <Package size={12} className="text-brand-400 mt-0.5 flex-shrink-0" />
                              <span>{tip.prodottiSelezionati.join(', ')}</span>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* Photo Preview Modal */}
      {selectedPhoto && (
        <PhotoPreviewModal
          imageUrl={selectedPhoto.url}
          altText={selectedPhoto.alt}
          onClose={() => setSelectedPhoto(null)}
        />
      )}
    </div>
  );
};

/** Sub-component: entry thumbnail from first photo blob */
const EntryThumbnail: React.FC<{ blob: Blob | undefined; remoteUrl?: string }> = ({ blob, remoteUrl }) => {
  const url = useBlobUrl(blob);
  const imageUrl = url || remoteUrl;
  if (!imageUrl) {
    return (
      <div className="w-full h-full flex items-center justify-center">
        <Camera size={16} className="text-brand-300" />
      </div>
    );
  }
  return <img src={imageUrl} alt="" className="w-full h-full object-cover" />;
};

/** Sub-component: single photo in the grid */
const PhotoGridItem: React.FC<{
  blob?: Blob;
  remoteUrl?: string;
  alt: string;
  onSelect: (url: string) => void;
}> = ({ blob, remoteUrl, alt, onSelect }) => {
  const url = useBlobUrl(blob);
  const imageUrl = url || remoteUrl;
  if (!imageUrl) return null;
  return (
    <button
      onClick={() => onSelect(imageUrl)}
      className="aspect-square rounded-lg overflow-hidden bg-brand-50"
    >
      <img src={imageUrl} alt={alt} className="w-full h-full object-cover" />
    </button>
  );
};

/** Sub-component: floor plan thumbnail */
const PlanThumbnail: React.FC<{ blob: Blob | undefined; remoteUrl?: string; alt: string }> = ({ blob, remoteUrl, alt }) => {
  const url = useBlobUrl(blob);
  const imageUrl = url || remoteUrl;
  if (!imageUrl) return <Map size={28} className="text-brand-300" />;
  return <img src={imageUrl} alt={alt} className="w-full h-full object-cover" />;
};

export default ProjectDetail;

