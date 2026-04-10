import React, { useState, useEffect } from 'react';
import Login from './components/Login';
import PasswordReset from './components/PasswordReset';
import Dashboard from './components/Dashboard';
import ProjectList from './components/ProjectList';
import ProjectForm from './components/ProjectForm';
import ProjectDetail from './components/ProjectDetail';
import MappingWizard from './components/MappingWizard';
import MapsOverview from './components/MapsOverview';
import SettingsPage from './components/SettingsPage';
import StandaloneFloorPlanEditor from './components/StandaloneFloorPlanEditor';
import FloorPlanEditor from './components/FloorPlanEditor';
import UpdateNotification from './components/UpdateNotification';
import ErrorBoundary from './components/ErrorBoundary';
import BottomTabBar, { TabId } from './components/BottomTabBar';
import {
  initializeDatabase, initializeMockUsers, getCurrentUser, deleteProject, logout,
  User, Project, MappingEntry, FloorPlan, db,
  getFloorPlanBlobUrl, updateFloorPlan, createFloorPlanPoint
} from './db';
import { isSupabaseConfigured, supabase } from './lib/supabase';
import {
  startAutoSync, stopAutoSync, processSyncQueue, syncFromSupabase,
  getSyncStats, manualSync, clearAndSync, SyncStats, onSyncComplete, offSyncComplete
} from './sync/syncEngine';
import './App.css';

type View = 'login' | 'passwordReset' | 'tabs' | 'projectForm' | 'projectEdit' | 'mapping' | 'projectDetail' | 'standaloneEditor' | 'floorPlanEditor';

const App: React.FC = () => {
  const [isInitialized, setIsInitialized] = useState(false);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [currentView, setCurrentView] = useState<View>('login');
  const [activeTab, setActiveTab] = useState<TabId>('dashboard');
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [currentMappingProject, setCurrentMappingProject] = useState<Project | null>(null);
  const [viewingProject, setViewingProject] = useState<Project | null>(null);
  const [editingMappingEntry, setEditingMappingEntry] = useState<MappingEntry | undefined>(undefined);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [swRegistration, setSwRegistration] = useState<ServiceWorkerRegistration | null>(null);
  const [syncStats, setSyncStats] = useState<SyncStats>({
    pendingCount: 0,
    lastSyncTime: null,
    isSyncing: false
  });

  // Floor plan editor state for maps tab
  const [editorFloorPlan, setEditorFloorPlan] = useState<FloorPlan | null>(null);
  const [editorImageUrl, setEditorImageUrl] = useState<string | null>(null);
  const [editorProject, setEditorProject] = useState<Project | null>(null);

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
          setViewingProject(null);
          setEditingMappingEntry(undefined);
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
        await initializeDatabase();
        await initializeMockUsers();

        const hashParams = new URLSearchParams(window.location.hash.substring(1));
        const type = hashParams.get('type');
        const accessToken = hashParams.get('access_token');

        if (type === 'recovery' || window.location.pathname === '/reset-password') {
          setCurrentView('passwordReset');
          setIsInitialized(true);
          return;
        }

        if (type === 'signup' && accessToken) {
          await new Promise(resolve => setTimeout(resolve, 1000));
          window.history.replaceState(null, '', window.location.pathname);
        }

        const user = await getCurrentUser();
        if (user) {
          setCurrentUser(user);
          setCurrentView('tabs');
          if (type === 'signup' && accessToken) {
            alert('Email confirmed! Welcome to OPImaPPA.');
          }
        }

        await db.metadata.put({ key: 'isSyncing', value: false });

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
          await processSyncQueue();
          await syncFromSupabase();
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

  // Service Worker message handler
  useEffect(() => {
    const handleMessage = async (event: MessageEvent) => {
      if (event.data?.type === 'BACKGROUND_SYNC') {
        try {
          await processSyncQueue();
          await syncFromSupabase();
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
      const result = await manualSync({
        onPhotoDecisionNeeded: () => Promise.resolve(
          window.confirm('Sincronizzare anche le foto?')
        ),
      });
      await updateSyncStats();
      const photosInfo = result.downloadResult.photosCount > 0
        ? `, ${result.downloadResult.photosCount} foto` : '';
      alert(`Sync completato!\nCaricati: ${result.uploadResult.processedCount}\nScaricati: ${result.downloadResult.projectsCount} prog., ${result.downloadResult.entriesCount} map., ${result.downloadResult.floorPlansCount} plan.${photosInfo}`);
    } catch {
      alert('Sync failed.');
      setSyncStats(prev => ({ ...prev, isSyncing: false }));
    }
  };

  const handleClearAndSync = async () => {
    if (!isSupabaseConfigured()) { alert('Supabase not configured.'); return; }
    if (!window.confirm('Cancellare tutti i dati locali e risincronizzare?')) return;
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
    if (project.syncEnabled === 0) {
      alert('Impossibile aggiungere mappatura. Attiva la sincronizzazione completa.');
      return;
    }
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

  const handleOpenFloorPlanEditor = async (project: Project, floorPlan: FloorPlan) => {
    // Check remote version before opening to warn about concurrent edits
    if (isOnline && isSupabaseConfigured() && supabase) {
      try {
        const { data } = await supabase
          .from('floor_plans')
          .select('updated_at')
          .eq('id', floorPlan.id)
          .single();

        if (data) {
          const remoteUpdatedAt = new Date(data.updated_at).getTime();
          // Compare against remoteUpdatedAt (last synced base version) if available, otherwise updatedAt
          const localBase = floorPlan.remoteUpdatedAt ?? floorPlan.updatedAt;
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
    setEditorFloorPlan(floorPlan);
    if (floorPlan.imageBlob) {
      setEditorImageUrl(getFloorPlanBlobUrl(floorPlan.imageBlob));
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
    setEditorFloorPlan(null);
    setEditorImageUrl(null);
    setEditorProject(null);
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
            project={currentMappingProject}
            currentUser={currentUser}
            onBack={handleBackFromMapping}
            editingEntry={editingMappingEntry}
            onSync={handleManualSync}
            isSyncing={syncStats.isSyncing}
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
              mode="view-edit"
              initialGridConfig={editorFloorPlan.gridEnabled ? {
                enabled: editorFloorPlan.gridEnabled,
                rows: editorFloorPlan.gridConfig?.rows || 10,
                cols: editorFloorPlan.gridConfig?.cols || 10,
                offsetX: editorFloorPlan.gridConfig?.offsetX || 0,
                offsetY: editorFloorPlan.gridConfig?.offsetY || 0,
              } : undefined}
              onSave={async (points, gridConfig) => {
                try {
                  for (const point of points) {
                    if (point.id && point.id.startsWith('temp-')) {
                      await createFloorPlanPoint(
                        editorFloorPlan.id, point.mappingEntryId || '',
                        point.type, point.pointX, point.pointY,
                        point.labelX, point.labelY, currentUser.id,
                        { perimeterPoints: point.perimeterPoints, customText: point.customText }
                      );
                    }
                  }
                  await updateFloorPlan(editorFloorPlan.id, {
                    gridEnabled: gridConfig.enabled,
                    gridConfig: { rows: gridConfig.rows, cols: gridConfig.cols, offsetX: gridConfig.offsetX, offsetY: gridConfig.offsetY }
                  });
                  alert('Planimetria salvata!');
                } catch (err) {
                  console.error('Error saving floor plan:', err);
                  alert('Errore nel salvataggio');
                }
              }}
              onClose={handleBackFromFloorPlanEditor}
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
                  onCreateProject={handleCreateProject}
                  onEditProject={handleEditProject}
                  onDeleteProject={handleDeleteProject}
                  onViewProject={handleViewProject}
                  onEnterMapping={handleEnterMapping}
                  onManualSync={handleManualSync}
                  isSyncing={syncStats.isSyncing}
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
        {renderContent()}
      </ErrorBoundary>

      <UpdateNotification registration={swRegistration} />
    </div>
  );
};

export default App;
