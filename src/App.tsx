import React, { useState, useEffect, Suspense } from 'react';
import Login from './components/Login';
import PasswordReset from './components/PasswordReset';
import Dashboard from './components/Dashboard';
import ProjectList from './components/ProjectList';
import UpdateNotification from './components/UpdateNotification';
import ErrorBoundary from './components/ErrorBoundary';
import BottomTabBar, { TabId } from './components/BottomTabBar';
import {
  db, initializeDatabase, initializeMockUsers, getCurrentUser, deleteProject, logout,
  User, Project, MappingEntry, FloorPlan, StructureEntry,
  getFloorPlanBlobUrl, ensureFloorPlanAsset, updateFloorPlan, createFloorPlanPoint, updateFloorPlanPoint, getFloorPlanPoints, deleteFloorPlanPoint,
  getMappingEntriesForProject, getPhotosForMappings, getMappingEntry, getStructureEntry,
} from './db';
import { isSupabaseConfigured, supabase } from './lib/supabase';
import { enforceForcedMigrationIfNeeded } from './lib/forcedMigration';
import type { UnmappedEntry } from './components/FloorPlanEditor';
import {
  startAutoSync, stopAutoSync, lockedSync,
  getSyncStats, manualSync, clearAndSync, SyncStats, SyncProgress, onSyncComplete, offSyncComplete
} from './sync/syncEngine';
import { eventStream } from './realtime/eventStream';
import { handleProjectDeleteLocal } from './realtime/projectCascade';
import './App.css';

// Lazy-loaded components: these pull in heavy libraries (jsPDF, pdf-lib, pdfjs-dist, xlsx)
// and are only needed when the user navigates to specific views
const ProjectForm = React.lazy(() => import('./components/ProjectForm'));
const ProjectDetail = React.lazy(() => import('./components/ProjectDetail'));
const MappingWizard = React.lazy(() => import('./components/MappingWizard'));
const StructureWizard = React.lazy(() => import('./components/StructureWizard'));
const MapsOverview = React.lazy(() => import('./components/MapsOverview'));
const SettingsPage = React.lazy(() => import('./components/SettingsPage'));
const StandaloneFloorPlanEditor = React.lazy(() => import('./components/StandaloneFloorPlanEditor'));
const FloorPlanEditor = React.lazy(() => import('./components/FloorPlanEditor'));

type View = 'login' | 'passwordReset' | 'tabs' | 'projectForm' | 'projectEdit' | 'mapping' | 'structure' | 'projectDetail' | 'standaloneEditor' | 'floorPlanEditor';

const App: React.FC = () => {
  const [isInitialized, setIsInitialized] = useState(false);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [currentView, setCurrentView] = useState<View>('login');
  const [activeTab, setActiveTab] = useState<TabId>('dashboard');
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [currentMappingProject, setCurrentMappingProject] = useState<Project | null>(null);
  const [currentStructureProject, setCurrentStructureProject] = useState<Project | null>(null);
  const [viewingProject, setViewingProject] = useState<Project | null>(null);
  const [editingMappingEntry, setEditingMappingEntry] = useState<MappingEntry | undefined>(undefined);
  const [editingStructureEntry, setEditingStructureEntry] = useState<StructureEntry | undefined>(undefined);
  const [mappingWizardKey, setMappingWizardKey] = useState(0);
  const [structureWizardKey, setStructureWizardKey] = useState(0);
  const [editingMappingEntryInitialStep, setEditingMappingEntryInitialStep] = useState(0);
  const [editingStructureEntryInitialStep, setEditingStructureEntryInitialStep] = useState(0);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [swRegistration, setSwRegistration] = useState<ServiceWorkerRegistration | null>(null);
  const [syncStats, setSyncStats] = useState<SyncStats>({
    pendingCount: 0,
    lastSyncTime: null,
    isSyncing: false
  });
  const [syncProgress, setSyncProgress] = useState<SyncProgress | null>(null);

  // Floor plan editor state for maps tab
  const [editorFloorPlan, setEditorFloorPlan] = useState<FloorPlan | null>(null);
  const [editorImageUrl, setEditorImageUrl] = useState<string | null>(null);
  const [editorProject, setEditorProject] = useState<Project | null>(null);
  const [editorInitialPoints, setEditorInitialPoints] = useState<import('./components/FloorPlanCanvas').CanvasPoint[]>([]);
  const [editorUnmappedEntries, setEditorUnmappedEntries] = useState<UnmappedEntry[]>([]);

  // Handle browser back button
  useEffect(() => {
    const handlePopState = (event: PopStateEvent) => {
      const state = event.state as { view?: View; tab?: TabId } | null;
      if (state?.view) {
        setCurrentView(state.view);
        if (state.tab) setActiveTab(state.tab);
        if (state.view === 'tabs') {
          setSelectedProject(null);
          setCurrentMappingProject(null);
          setCurrentStructureProject(null);
          setViewingProject(null);
          setEditingMappingEntry(undefined);
          setEditingStructureEntry(undefined);
        }
      } else {
        window.history.pushState({ view: currentView, tab: activeTab }, '', window.location.href);
      }
    };

    window.addEventListener('popstate', handlePopState);
    if (!window.history.state) {
      window.history.replaceState({ view: currentView, tab: activeTab }, '', window.location.href);
    }
    return () => window.removeEventListener('popstate', handlePopState);
  }, [currentView, activeTab]);

  // Push history on view change
  useEffect(() => {
    if (window.history.state?.view === currentView && window.history.state?.tab === activeTab) return;
    window.history.pushState({ view: currentView, tab: activeTab }, '', window.location.href);
  }, [currentView, activeTab]);

  // Initialize database
  useEffect(() => {
    const initialize = async () => {
      try {
        if (await enforceForcedMigrationIfNeeded()) {
          return;
        }

        await initializeDatabase();
        await initializeMockUsers();

        const locationHash = window.location?.hash ?? '';
        const pathname = window.location?.pathname ?? '/';
        const hashParams = new URLSearchParams(locationHash.substring(1));
        const type = hashParams.get('type');
        const accessToken = hashParams.get('access_token');

        if (type === 'recovery' || pathname === '/reset-password') {
          setCurrentView('passwordReset');
          setIsInitialized(true);
          return;
        }

        if (type === 'signup' && accessToken) {
          await new Promise(resolve => setTimeout(resolve, 1000));
          window.history.replaceState(null, '', pathname);
        }

        const user = await getCurrentUser();
        if (user) {
          setCurrentUser(user);
          setCurrentView('tabs');
          if (type === 'signup' && accessToken) {
            alert('Email confirmed! Welcome to OPImaPPA.');
          }
        }

        if (isSupabaseConfigured()) {
          startAutoSync(60000);
        }

        updateSyncStats();
        setIsInitialized(true);
      } catch (error) {
        console.error('Failed to initialize app:', error);
        alert('Failed to initialize app. Please refresh the page.');
      }
    };

    initialize();
    return () => { stopAutoSync(); };
  }, []);

  const updateSyncStats = async () => {
    const stats = await getSyncStats();
    setSyncStats(stats);
  };

  // Online/offline monitoring
  useEffect(() => {
    const handleOnline = async () => {
      setIsOnline(true);
      if (isSupabaseConfigured()) {
        try {
          await lockedSync();
          await updateSyncStats();
        } catch (err) {
          console.error('Sync after reconnection failed:', err);
        }
      }
    };
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Sync stats event listener
  useEffect(() => {
    const handler = (stats: SyncStats) => setSyncStats(stats);
    onSyncComplete(handler);
    updateSyncStats();
    return () => offSyncComplete(handler);
  }, []);

  // EventStream: connessione SSE realtime (solo se autenticato e inizializzato)
  useEffect(() => {
    if (!isInitialized || !currentUser) return;
    let active = true;
    const run = async () => {
      await eventStream.init();
      if (!active) return;
      eventStream.subscribe(handleProjectDeleteLocal);
      eventStream.start();
    };
    run();
    return () => {
      active = false;
      eventStream.unsubscribe(handleProjectDeleteLocal);
      eventStream.stop();
    };
  }, [isInitialized, currentUser]);

  // Service Worker message handler
  useEffect(() => {
    const handleMessage = async (event: MessageEvent) => {
      if (event.data?.type === 'BACKGROUND_SYNC') {
        try {
          await lockedSync();
          await updateSyncStats();
        } catch {}
      }
    };
    navigator.serviceWorker?.addEventListener('message', handleMessage);
    return () => navigator.serviceWorker?.removeEventListener('message', handleMessage);
  }, []);

  // Background sync registration
  useEffect(() => {
    if (isOnline && isSupabaseConfigured() && syncStats.pendingCount > 0) {
      (async () => {
        if ('serviceWorker' in navigator && 'SyncManager' in window) {
          try {
            const reg = await navigator.serviceWorker.ready;
            await (reg as any).sync.register('sync-queue');
          } catch {}
        }
      })();
    }
  }, [isOnline, syncStats.pendingCount]);

  // SW update listener
  useEffect(() => {
    const handler = (event: Event) => {
      setSwRegistration((event as CustomEvent).detail as ServiceWorkerRegistration);
    };
    window.addEventListener('swUpdate', handler);
    return () => window.removeEventListener('swUpdate', handler);
  }, []);

  // Handlers
  const handleLogin = (user: User) => {
    setCurrentUser(user);
    setCurrentView('tabs');
    setActiveTab('dashboard');
  };

  const handleLogout = async () => {
    try {
      await logout();
      setCurrentUser(null);
      setCurrentView('login');
    } catch {
      alert('Logout failed. Please try again.');
    }
  };

  const handleManualSync = async () => {
    if (!isSupabaseConfigured()) { alert('Supabase not configured.'); return; }
    try {
      setSyncStats(prev => ({ ...prev, isSyncing: true }));
      setSyncProgress({ step: 0, totalSteps: 6, phase: 'Avvio sincronizzazione...' });
      const result = await manualSync({
        onPhotoDecisionNeeded: () => Promise.resolve(
          window.confirm('Sincronizzare anche le foto?')
        ),
        onProgress: setSyncProgress,
      });
      await updateSyncStats();
      const d = result.downloadResult;
      const u = result.uploadResult;
      setSyncProgress({
        step: 6, totalSteps: 6,
        phase: 'Sync completato',
        detail: `${u.processedCount} caricati, ${d.projectsCount} prog., ${d.entriesCount} map., ${d.floorPlansCount} plan.${d.photosCount > 0 ? `, ${d.photosCount} foto` : ''}`
      });
      // Auto-dismiss after 4 seconds
      setTimeout(() => setSyncProgress(null), 4000);
    } catch {
      setSyncProgress({ step: 0, totalSteps: 6, phase: 'Errore sincronizzazione', detail: 'Riprova più tardi' });
      setSyncStats(prev => ({ ...prev, isSyncing: false }));
      setTimeout(() => setSyncProgress(null), 4000);
    }
  };

  const handleClearAndSync = async () => {
    if (!isSupabaseConfigured()) { alert('Supabase not configured.'); return; }
    if (!window.confirm('Reimpostare la cache locale e reidratare i metadati dal server?')) return;
    try {
      setSyncStats(prev => ({ ...prev, isSyncing: true }));
      await clearAndSync();
      window.location.reload();
    } catch {
      alert('Clear and sync failed.');
      setSyncStats(prev => ({ ...prev, isSyncing: false }));
    }
  };

  const handleCreateProject = () => {
    setSelectedProject(null);
    setCurrentView('projectForm');
  };

  const handleEditProject = (project: Project) => {
    setSelectedProject(project);
    setCurrentView('projectEdit');
  };

  const handleViewProject = (project: Project) => {
    setViewingProject(project);
    setCurrentView('projectDetail');
  };

  const handleEnterMapping = (project: Project) => {
    setCurrentMappingProject(project);
    setEditingMappingEntry(undefined);
    setCurrentView('mapping');
  };

  const handleDeleteProject = async (projectId: string) => {
    try {
      await deleteProject(projectId);
    } catch {
      alert('Failed to delete project.');
    }
  };

  const handleProjectSaved = () => {
    setCurrentView('tabs');
    setActiveTab('projects');
    setSelectedProject(null);
  };

  const handleBackFromMapping = () => {
    if (viewingProject) {
      setCurrentView('projectDetail');
    } else {
      setCurrentView('tabs');
    }
    setCurrentMappingProject(null);
    setEditingMappingEntry(undefined);
    setEditingMappingEntryInitialStep(0);
  };

  const handleMappingSaved = () => {
    setEditingMappingEntry(undefined);
    setMappingWizardKey(k => k + 1);
    setEditingMappingEntryInitialStep(0);
  };

  const handleEnterStructure = (project: Project) => {
    setCurrentStructureProject(project);
    setEditingStructureEntry(undefined);
    setCurrentView('structure');
  };

  const handleBackFromStructure = () => {
    if (viewingProject) {
      setCurrentView('projectDetail');
    } else {
      setCurrentView('tabs');
    }
    setCurrentStructureProject(null);
    setEditingStructureEntry(undefined);
    setEditingStructureEntryInitialStep(0);
  };

  const handleStructureSaved = () => {
    setEditingStructureEntry(undefined);
    setStructureWizardKey(k => k + 1);
    setEditingStructureEntryInitialStep(0);
  };

  const handleAddMappingFromDetail = () => {
    if (viewingProject) {
      handleEnterMapping(viewingProject);
    }
  };

  const handleEditMappingFromDetail = (entry: MappingEntry) => {
    if (viewingProject) {
      setCurrentMappingProject(viewingProject);
      setEditingMappingEntry(entry);
      setCurrentView('mapping');
    }
  };

  const handleAddStructureFromDetail = () => {
    if (viewingProject) {
      handleEnterStructure(viewingProject);
    }
  };

  const handleEditStructureFromDetail = (entry: StructureEntry) => {
    if (viewingProject) {
      setCurrentStructureProject(viewingProject);
      setEditingStructureEntry(entry);
      setCurrentView('structure');
    }
  };

  const handleOpenFloorPlanEditor = async (project: Project, floorPlan: FloorPlan) => {
    // Check remote version before opening to warn about concurrent edits
    if (isOnline && isSupabaseConfigured() && supabase) {
      try {
        const { data } = await supabase
          .from('floor_plans')
          .select('updated_at')
          .eq('id', floorPlan.id)
          .single() as { data: { updated_at: string } | null; error: any };

        if (data) {
          const remoteUpdatedAt = new Date(data.updated_at).getTime();
          // Leggi da Dexie per avere remoteUpdatedAt aggiornato dopo upload (evita falsi conflitti)
          const freshLocal = await db.floorPlans.get(floorPlan.id);
          const localBase = (freshLocal ?? floorPlan).remoteUpdatedAt ?? (freshLocal ?? floorPlan).updatedAt;
          // Warn if remote is more than 5s newer than our base version (tolerance for clock skew)
          if (remoteUpdatedAt > localBase + 5000) {
            const localDate = new Date(localBase).toLocaleString('it-IT');
            const remoteDate = new Date(remoteUpdatedAt).toLocaleString('it-IT');
            const proceed = window.confirm(
              `⚠️ Attenzione: questa planimetria è stata modificata da un altro utente.\n\n` +
              `Versione remota: ${remoteDate}\n` +
              `Versione locale:  ${localDate}\n\n` +
              `Si consiglia di sincronizzare prima di modificare per non perdere le modifiche altrui.\n\n` +
              `Continuare comunque?`
            );
            if (!proceed) return;
          }
        }
      } catch {
        // Network error or plan not yet on remote → open normally
      }
    }

    setEditorProject(project);
    const hydratedPlan = await ensureFloorPlanAsset(floorPlan.id, 'full') || floorPlan;
    setEditorFloorPlan(hydratedPlan);
    if (editorImageUrl?.startsWith('blob:')) {
      URL.revokeObjectURL(editorImageUrl);
    }
    const hydratedImageUrl = getFloorPlanBlobUrl(hydratedPlan.imageBlob, hydratedPlan.imageUrl);
    if (!hydratedImageUrl) {
      alert('Immagine planimetria non disponibile. Verifica la connessione e riprova.');
      return;
    }
    setEditorImageUrl(hydratedImageUrl);
    try {
      const dbPoints = await getFloorPlanPoints(hydratedPlan.id);
      const mappings = await getMappingEntriesForProject(project.id);
      const photosByMapping = await getPhotosForMappings(mappings.map((m) => m.id));
      const placedMappingIds = new Set(dbPoints.map((p) => p.mappingEntryId).filter(Boolean));

      const buildMappingLabel = (m: MappingEntry, photoCount: number): string[] => {
        const parts: string[] = [];
        if (project.floors && project.floors.length > 1) parts.push(`P${m.floor}`);
        if (project.useRoomNumbering && m.room) parts.push(`S${m.room}`);
        if (project.useInterventionNumbering && m.intervention) parts.push(`Int${m.intervention}`);
        let firstLine = parts.join('_') || 'Punto';
        if (photoCount > 1) firstLine += `_01-${photoCount.toString().padStart(2, '0')}`;
        const tipNums = m.crossings
          .map(c => c.tipologicoId ? project.typologies?.find(t => t.id === c.tipologicoId)?.number : null)
          .filter((n): n is number => n !== null)
          .filter((v, i, a) => a.indexOf(v) === i)
          .sort((a, b) => a - b);
        return [firstLine, tipNums.length > 0 ? `Tip. ${tipNums.join(' - ')}` : ''].filter(Boolean);
      };

      const canvasPoints = dbPoints.map(p => {
        const mappingEntry = mappings.find(m => m.id === p.mappingEntryId);
        const labelText = mappingEntry
          ? buildMappingLabel(mappingEntry, (photosByMapping[mappingEntry.id] || []).length)
          : (p.metadata?.labelText || ['Punto']);
        return {
          id: p.id,
          type: p.pointType as import('./components/FloorPlanCanvas').CanvasPoint['type'],
          pointX: p.pointX,
          pointY: p.pointY,
          labelX: p.labelX,
          labelY: p.labelY,
          labelText,
          perimeterPoints: p.perimeterPoints,
          mappingEntryId: p.mappingEntryId,
          labelBackgroundColor: p.metadata?.labelBackgroundColor,
          labelTextColor: p.metadata?.labelTextColor,
          eiRating: p.eiRating,
        };
      });
      setEditorInitialPoints(canvasPoints);
      const unmappedEntries: UnmappedEntry[] = mappings
        .filter((m) => m.floor === hydratedPlan.floor && !placedMappingIds.has(m.id))
        .map((m) => {
          const photoCount = (photosByMapping[m.id] || []).length;
          const supporto = m.crossings?.[0]?.supporto?.toLowerCase() || '';
          return {
            id: m.id,
            labelText: buildMappingLabel(m, photoCount),
            type: (supporto === 'solaio' ? 'solaio' : 'parete') as 'parete' | 'solaio',
          };
        });
      setEditorUnmappedEntries(unmappedEntries);
    } catch (err) {
      console.warn('Could not load floor plan points:', err);
      setEditorInitialPoints([]);
      setEditorUnmappedEntries([]);
    }
    setCurrentView('floorPlanEditor');
  };

  const handleBackFromFloorPlanEditor = () => {
    if (viewingProject) {
      setCurrentView('projectDetail');
    } else {
      setCurrentView('tabs');
      setActiveTab('maps');
    }
    // Revoke blob URL to prevent memory leak
    if (editorImageUrl?.startsWith('blob:')) {
      URL.revokeObjectURL(editorImageUrl);
    }
    setEditorFloorPlan(null);
    setEditorImageUrl(null);
    setEditorProject(null);
    setEditorInitialPoints([]);
    setEditorUnmappedEntries([]);
  };

  const handleOpenStandaloneEditor = () => {
    setCurrentView('standaloneEditor');
  };

  const handleTabChange = (tab: TabId) => {
    setActiveTab(tab);
    // Reset sub-views when changing tabs
    if (currentView !== 'tabs') {
      setCurrentView('tabs');
    }
  };

  // Loading state
  if (!isInitialized) {
    return (
      <div className="flex items-center justify-center h-screen bg-brand-100">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-accent border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-brand-500 text-sm">Caricamento...</p>
        </div>
      </div>
    );
  }

  // Non-authenticated views
  if (currentView === 'passwordReset') {
    return <PasswordReset onSuccess={() => {
      setCurrentView('login');
      window.history.replaceState(null, '', window.location.pathname);
    }} />;
  }

  if (!currentUser) {
    return <Login onLogin={handleLogin} />;
  }

  // Main app content
  const renderContent = () => {
    switch (currentView) {
      case 'projectForm':
      case 'projectEdit':
        return (
          <ProjectForm
            project={selectedProject}
            currentUser={currentUser}
            onSave={handleProjectSaved}
            onCancel={() => { setCurrentView('tabs'); setSelectedProject(null); }}
            onSync={handleManualSync}
            isSyncing={syncStats.isSyncing}
          />
        );

      case 'mapping':
        return (
          <MappingWizard
            key={mappingWizardKey}
            project={currentMappingProject}
            currentUser={currentUser}
            onBack={handleBackFromMapping}
            onSaved={handleMappingSaved}
            editingEntry={editingMappingEntry}
            onSync={handleManualSync}
            isSyncing={syncStats.isSyncing}
            initialStep={editingMappingEntryInitialStep as 0 | 1 | 2}
          />
        );

      case 'structure':
        return (
          <StructureWizard
            key={structureWizardKey}
            project={currentStructureProject}
            currentUser={currentUser}
            onBack={handleBackFromStructure}
            onSaved={handleStructureSaved}
            editingEntry={editingStructureEntry}
            onSync={handleManualSync}
            isSyncing={syncStats.isSyncing}
            initialStep={editingStructureEntryInitialStep as 0 | 1 | 2}
          />
        );

      case 'projectDetail':
        return viewingProject ? (
          <ProjectDetail
            project={viewingProject}
            currentUser={currentUser}
            onBack={() => { setViewingProject(null); setCurrentView('tabs'); setActiveTab('projects'); }}
            onAddMapping={handleAddMappingFromDetail}
            onEditMapping={handleEditMappingFromDetail}
            onAddStructure={handleAddStructureFromDetail}
            onEditStructure={handleEditStructureFromDetail}
            onOpenFloorPlanEditor={handleOpenFloorPlanEditor}
            onSync={handleManualSync}
            isSyncing={syncStats.isSyncing}
          />
        ) : null;

      case 'standaloneEditor':
        return (
          <StandaloneFloorPlanEditor
            currentUser={currentUser}
            onBack={() => { setCurrentView('tabs'); setActiveTab('maps'); }}
          />
        );

      case 'floorPlanEditor':
        if (editorFloorPlan && editorImageUrl && editorProject) {
          return (
            <FloorPlanEditor
              imageUrl={editorImageUrl}
              initialPoints={editorInitialPoints}
              mode="view-edit"
              unmappedEntries={editorUnmappedEntries}
              initialGridConfig={editorFloorPlan.gridEnabled ? {
                enabled: editorFloorPlan.gridEnabled,
                rows: editorFloorPlan.gridConfig?.rows || 10,
                cols: editorFloorPlan.gridConfig?.cols || 10,
                offsetX: editorFloorPlan.gridConfig?.offsetX || 0,
                offsetY: editorFloorPlan.gridConfig?.offsetY || 0,
              } : undefined}
              initialCartiglio={editorFloorPlan.metadata?.cartiglio}
              defaultTavola={editorFloorPlan.floor}
              defaultCommittente={[editorProject.client.trim() || editorProject.title.trim(), editorProject.address.trim()].filter(Boolean).join(' - ')}
              typologyNumbers={[...(editorProject.typologies || [])].map(t => t.number).sort((a, b) => a - b)}
              onSave={async (points, gridConfig, cartiglio) => {
                try {
                  const initialIds = new Set(editorInitialPoints.map(p => p.id));
                  const currentPointIdSet = new Set(points.map(p => p.id));

                  // Elimina i punti rimossi
                  const deletedIds = editorInitialPoints.map(p => p.id).filter(id => !currentPointIdSet.has(id));
                  for (const id of deletedIds) {
                    await deleteFloorPlanPoint(id);
                  }

                  // Crea o aggiorna i punti correnti
                  for (const point of points) {
                    if (!initialIds.has(point.id)) {
                      await createFloorPlanPoint(
                        editorFloorPlan.id, point.mappingEntryId || '',
                        point.type, point.pointX, point.pointY,
                        point.labelX, point.labelY, currentUser.id,
                        {
                          perimeterPoints: point.perimeterPoints,
                          customText: point.customText,
                          eiRating: point.eiRating,
                          metadata: {
                            labelText: point.labelText,
                            labelBackgroundColor: point.labelBackgroundColor,
                            labelTextColor: point.labelTextColor,
                          },
                        }
                      );
                    } else {
                      await updateFloorPlanPoint(point.id, {
                        pointX: point.pointX,
                        pointY: point.pointY,
                        labelX: point.labelX,
                        labelY: point.labelY,
                        perimeterPoints: point.perimeterPoints,
                        customText: point.customText,
                        eiRating: point.eiRating,
                        metadata: {
                          labelText: point.labelText,
                          labelBackgroundColor: point.labelBackgroundColor,
                          labelTextColor: point.labelTextColor,
                        },
                      });
                    }
                  }
                  await updateFloorPlan(editorFloorPlan.id, {
                    gridEnabled: gridConfig.enabled,
                    gridConfig: { rows: gridConfig.rows, cols: gridConfig.cols, offsetX: gridConfig.offsetX, offsetY: gridConfig.offsetY },
                    metadata: {
                      ...(editorFloorPlan.metadata || {}),
                      cartiglio,
                    },
                  });
                  setEditorFloorPlan(prev => prev ? {
                    ...prev,
                    gridEnabled: gridConfig.enabled,
                    gridConfig: { rows: gridConfig.rows, cols: gridConfig.cols, offsetX: gridConfig.offsetX, offsetY: gridConfig.offsetY },
                    metadata: {
                      ...(prev.metadata || {}),
                      cartiglio,
                    },
                  } : prev);

                  // Riconcilia gli ID ricariando i punti da Dexie
                  const saved = await getFloorPlanPoints(editorFloorPlan.id);
                  const reconciledPoints = saved.map(p => ({
                    id: p.id,
                    type: p.pointType as import('./components/FloorPlanCanvas').CanvasPoint['type'],
                    pointX: p.pointX,
                    pointY: p.pointY,
                    labelX: p.labelX,
                    labelY: p.labelY,
                    labelText: p.metadata?.labelText || ['Punto'],
                    perimeterPoints: p.perimeterPoints,
                    mappingEntryId: p.mappingEntryId,
                    labelBackgroundColor: p.metadata?.labelBackgroundColor,
                    labelTextColor: p.metadata?.labelTextColor,
                    eiRating: p.eiRating,
                  }));
                  setEditorInitialPoints(reconciledPoints);

                  alert('Planimetria salvata!');
                } catch (err) {
                  console.error('Error saving floor plan:', err);
                  alert('Errore nel salvataggio');
                }
              }}
              onClose={handleBackFromFloorPlanEditor}
              onOpenMappingEntry={async (entryId) => {
                const project = editorProject;
                if (editorImageUrl?.startsWith('blob:')) URL.revokeObjectURL(editorImageUrl);
                setEditorFloorPlan(null);
                setEditorImageUrl(null);
                setEditorProject(null);
                setEditorInitialPoints([]);
                setEditorUnmappedEntries([]);
                const mappingEntry = await getMappingEntry(entryId);
                if (mappingEntry && project) {
                  setCurrentMappingProject(project);
                  setEditingMappingEntry(mappingEntry);
                  setEditingMappingEntryInitialStep(1);
                  setCurrentView('mapping');
                  return;
                }
                const structureEntry = await getStructureEntry(entryId);
                if (structureEntry && project) {
                  setCurrentStructureProject(project);
                  setEditingStructureEntry(structureEntry);
                  setEditingStructureEntryInitialStep(1);
                  setCurrentView('structure');
                }
              }}
            />
          );
        }
        return null;

      case 'tabs':
      default:
        return (
          <>
            {/* Tab content */}
            <div className="flex-1 flex flex-col overflow-hidden">
              {activeTab === 'dashboard' && (
                <Dashboard
                  currentUser={currentUser}
                  syncStats={syncStats}
                  syncProgress={syncProgress}
                  isOnline={isOnline}
                  onNavigateToProject={handleViewProject}
                  onAddMapping={handleEnterMapping}
                  onCreateProject={handleCreateProject}
                  onManualSync={handleManualSync}
                />
              )}
              {activeTab === 'projects' && (
                <ProjectList
                  currentUser={currentUser}
                  onEditProject={handleEditProject}
                  onDeleteProject={handleDeleteProject}
                  onViewProject={handleViewProject}
                  onEnterMapping={handleEnterMapping}
                />
              )}
              {activeTab === 'maps' && (
                <MapsOverview
                  currentUser={currentUser}
                  onOpenFloorPlan={handleOpenFloorPlanEditor}
                  onOpenStandaloneEditor={handleOpenStandaloneEditor}
                  onNavigateToProject={handleViewProject}
                />
              )}
              {activeTab === 'settings' && (
                <SettingsPage
                  currentUser={currentUser}
                  syncStats={syncStats}
                  isOnline={isOnline}
                  onLogout={handleLogout}
                  onManualSync={handleManualSync}
                  onClearAndSync={handleClearAndSync}
                />
              )}
            </div>

            {/* Bottom tab bar */}
            <BottomTabBar
              activeTab={activeTab}
              onTabChange={handleTabChange}
              pendingSyncCount={syncStats.pendingCount}
            />
          </>
        );
    }
  };

  return (
    <div className="App">
      {/* Offline indicator */}
      {!isOnline && currentView === 'tabs' && (
        <div className="bg-warning text-white text-xs font-medium text-center py-2 px-4">
          Sei offline. Le modifiche verranno sincronizzate al ritorno della connessione.
        </div>
      )}

      <ErrorBoundary>
        <Suspense fallback={
          <div className="flex items-center justify-center h-64">
            <div className="w-8 h-8 border-3 border-accent border-t-transparent rounded-full animate-spin" />
          </div>
        }>
          {renderContent()}
        </Suspense>
      </ErrorBoundary>

      <UpdateNotification registration={swRegistration} />
    </div>
  );
};

export default App;
