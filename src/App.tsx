import React, { useState, useEffect } from 'react';
import Login from './components/Login';
import PasswordReset from './components/PasswordReset';
import Home from './components/Home';
import ProjectForm from './components/ProjectForm';
import MappingPage from './components/MappingPage';
import MappingView from './components/MappingView';
import UpdateNotification from './components/UpdateNotification';
import { initializeDatabase, initializeMockUsers, getCurrentUser, deleteProject, logout, User, Project, MappingEntry } from './db';
import { isSupabaseConfigured } from './lib/supabase';
import { startAutoSync, stopAutoSync, processSyncQueue, syncFromSupabase, getSyncStats, manualSync, SyncStats } from './sync/syncEngine';
import './App.css';

type View = 'login' | 'passwordReset' | 'home' | 'projectForm' | 'projectEdit' | 'mapping' | 'mappingView';

const App: React.FC = () => {
  const [isInitialized, setIsInitialized] = useState(false);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [currentView, setCurrentView] = useState<View>('login');
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

  // Initialize database on mount
  useEffect(() => {
    const initialize = async () => {
      try {
        await initializeDatabase();
        await initializeMockUsers();

        // Check if we're on password reset or email confirmation page
        const hashParams = new URLSearchParams(window.location.hash.substring(1));
        const type = hashParams.get('type');
        const accessToken = hashParams.get('access_token');

        if (type === 'recovery' || window.location.pathname === '/reset-password') {
          setCurrentView('passwordReset');
          setIsInitialized(true);
          return;
        }

        // Handle email confirmation callback
        if (type === 'signup' && accessToken) {
          console.log('📧 Email confirmed! Logging you in...');
          // Supabase will automatically set the session
          // Wait a moment for session to be established
          await new Promise(resolve => setTimeout(resolve, 1000));

          // Clear the hash
          window.history.replaceState(null, '', window.location.pathname);
        }

        // Check if user is already logged in
        const user = await getCurrentUser();
        if (user) {
          setCurrentUser(user);
          setCurrentView('home');

          // Show success message if they just confirmed email
          if (type === 'signup' && accessToken) {
            alert('✅ Email confirmed! Welcome to OPImaPPA.');
          }
        }

        // Start auto-sync if Supabase is configured
        if (isSupabaseConfigured()) {
          startAutoSync(60000); // Sync every 60 seconds
          console.log('🔄 Auto-sync enabled');
        } else {
          console.log('📦 Running in offline-only mode');
        }

        // Update sync stats
        updateSyncStats();

        setIsInitialized(true);
        console.log('App initialized successfully');
      } catch (error) {
        console.error('Failed to initialize app:', error);
        alert('Failed to initialize app. Please refresh the page.');
      }
    };

    initialize();

    // Cleanup on unmount
    return () => {
      stopAutoSync();
    };
  }, []);

  // Update sync stats helper
  const updateSyncStats = async () => {
    const stats = await getSyncStats();
    setSyncStats(stats);
  };

  // Monitor online/offline status
  useEffect(() => {
    const handleOnline = async () => {
      setIsOnline(true);
      console.log('🌐 App is online');

      // Trigger immediate bidirectional sync when connection returns
      if (isSupabaseConfigured()) {
        console.log('🔄 Triggering bidirectional sync after reconnection...');
        try {
          await processSyncQueue(); // Upload local changes
          await syncFromSupabase(); // Download remote changes
          await updateSyncStats();
        } catch (err) {
          console.error('❌ Sync after reconnection failed:', err);
        }
      }
    };

    const handleOffline = () => {
      setIsOnline(false);
      console.log('📴 App is offline');
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Periodically update sync stats
  useEffect(() => {
    const interval = setInterval(updateSyncStats, 10000); // Update every 10 seconds
    return () => clearInterval(interval);
  }, []);

  // Listen for background sync messages from Service Worker
  useEffect(() => {
    const handleMessage = async (event: MessageEvent) => {
      if (event.data && event.data.type === 'BACKGROUND_SYNC') {
        console.log('📬 Received background sync message from Service Worker');

        try {
          await processSyncQueue(); // Upload
          await syncFromSupabase(); // Download
          await updateSyncStats();
          console.log('✅ Background sync completed');
        } catch (err) {
          console.error('❌ Background sync failed:', err);
        }
      }
    };

    navigator.serviceWorker?.addEventListener('message', handleMessage);

    return () => {
      navigator.serviceWorker?.removeEventListener('message', handleMessage);
    };
  }, []);

  // Register background sync when changes are made
  useEffect(() => {
    const registerBackgroundSync = async () => {
      if ('serviceWorker' in navigator && 'SyncManager' in window) {
        try {
          const registration = await navigator.serviceWorker.ready;
          await (registration as any).sync.register('sync-queue');
          console.log('🔄 Background sync registered');
        } catch (err) {
          console.warn('⚠️  Background sync registration failed:', err);
        }
      }
    };

    // Register background sync when coming online
    if (isOnline && isSupabaseConfigured() && syncStats.pendingCount > 0) {
      registerBackgroundSync();
    }
  }, [isOnline, syncStats.pendingCount]);

  // Listen for service worker updates
  useEffect(() => {
    const handleSwUpdate = (event: Event) => {
      const customEvent = event as CustomEvent;
      const registration = customEvent.detail as ServiceWorkerRegistration;
      console.log('📦 Service Worker update detected in App');
      setSwRegistration(registration);
    };

    window.addEventListener('swUpdate', handleSwUpdate);

    return () => {
      window.removeEventListener('swUpdate', handleSwUpdate);
    };
  }, []);

  const handleLogin = (user: User) => {
    setCurrentUser(user);
    setCurrentView('home');
  };

  const handleLogout = async () => {
    try {
      await logout();
      setCurrentUser(null);
      setCurrentView('login');
      console.log('✅ Logout successful');
    } catch (error) {
      console.error('❌ Logout failed:', error);
      alert('Logout failed. Please try again.');
    }
  };

  const handleManualSync = async () => {
    if (!isSupabaseConfigured()) {
      alert('Supabase not configured. Cannot sync.');
      return;
    }

    try {
      setSyncStats(prev => ({ ...prev, isSyncing: true }));
      const result = await manualSync();
      await updateSyncStats();

      const message = `Sync complete!\nUploaded: ${result.uploadResult.processedCount} items\nDownloaded: ${result.downloadResult.projectsCount} projects, ${result.downloadResult.entriesCount} entries, ${result.downloadResult.photosCount} photos`;
      alert(message);

      // Reload the current view to reflect changes
      window.location.reload();
    } catch (error) {
      console.error('❌ Manual sync failed:', error);
      alert('Sync failed. Please try again.');
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
    setCurrentView('mappingView');
  };

  const handleEnterMapping = (project: Project) => {
    setCurrentMappingProject(project);
    setCurrentView('mapping');
  };

  const handleBackFromMappingView = () => {
    setViewingProject(null);
    setCurrentView('home');
  };

  const handleAddMappingFromView = () => {
    if (viewingProject) {
      setCurrentMappingProject(viewingProject);
      setEditingMappingEntry(undefined);
      setCurrentView('mapping');
    }
  };

  const handleEditMappingFromView = (mappingEntry: MappingEntry) => {
    if (viewingProject) {
      setCurrentMappingProject(viewingProject);
      setEditingMappingEntry(mappingEntry);
      setCurrentView('mapping');
    }
  };

  const handleDeleteProject = async (projectId: string) => {
    try {
      await deleteProject(projectId);
      console.log('Project deleted:', projectId);
    } catch (error) {
      console.error('Failed to delete project:', error);
      alert('Failed to delete project. Please try again.');
    }
  };

  const handleProjectSaved = () => {
    setCurrentView('home');
    setSelectedProject(null);
  };

  const handleCancelProject = () => {
    setCurrentView('home');
    setSelectedProject(null);
  };

  const handleBackToHome = () => {
    // If we have a viewing project, go back to mapping view instead of home
    if (viewingProject && currentMappingProject?.id === viewingProject.id) {
      setCurrentView('mappingView');
    } else {
      setCurrentView('home');
    }
    setCurrentMappingProject(null);
    setEditingMappingEntry(undefined);
  };

  // Show loading state while initializing
  if (!isInitialized) {
    return (
      <div className="flex items-center justify-center h-screen bg-background">
        <div className="text-center">
          <div className="w-16 h-16 mx-auto mb-4 spinner"></div>
          <p className="text-text-secondary">Initializing app...</p>
        </div>
      </div>
    );
  }

  const renderView = () => {
    // Handle password reset view (doesn't require authentication)
    if (currentView === 'passwordReset') {
      return <PasswordReset onSuccess={() => {
        setCurrentView('login');
        // Clear URL hash
        window.history.replaceState(null, '', window.location.pathname);
      }} />;
    }

    if (!currentUser) {
      return <Login onLogin={handleLogin} />;
    }

    switch (currentView) {
      case 'home':
        return (
          <Home
            currentUser={currentUser}
            onCreateProject={handleCreateProject}
            onEditProject={handleEditProject}
            onDeleteProject={handleDeleteProject}
            onViewProject={handleViewProject}
            onEnterMapping={handleEnterMapping}
            onLogout={handleLogout}
            onManualSync={handleManualSync}
            isSyncing={syncStats.isSyncing}
          />
        );
      case 'projectForm':
      case 'projectEdit':
        return (
          <ProjectForm
            project={selectedProject}
            currentUser={currentUser}
            onSave={handleProjectSaved}
            onCancel={handleCancelProject}
            onSync={handleManualSync}
            isSyncing={syncStats.isSyncing}
          />
        );
      case 'mapping':
        return (
          <MappingPage
            project={currentMappingProject}
            currentUser={currentUser}
            onBack={handleBackToHome}
            editingEntry={editingMappingEntry}
            onSync={handleManualSync}
            isSyncing={syncStats.isSyncing}
          />
        );
      case 'mappingView':
        return (
          <MappingView
            project={viewingProject!}
            currentUser={currentUser}
            onBack={handleBackFromMappingView}
            onAddMapping={handleAddMappingFromView}
            onEditMapping={handleEditMappingFromView}
            onSync={handleManualSync}
            isSyncing={syncStats.isSyncing}
          />
        );
      default:
        return (
          <Home
            currentUser={currentUser}
            onCreateProject={handleCreateProject}
            onEditProject={handleEditProject}
            onDeleteProject={handleDeleteProject}
            onViewProject={handleViewProject}
            onEnterMapping={handleEnterMapping}
            onLogout={handleLogout}
            onManualSync={handleManualSync}
            isSyncing={syncStats.isSyncing}
          />
        );
    }
  };

  return (
    <div className="App">
      {/* Offline indicator */}
      {!isOnline && (
        <div className="offline-indicator">
          ⚠️ You are offline. Changes will be synced when connection returns.
        </div>
      )}

      {renderView()}

      {/* Update notification banner */}
      <UpdateNotification registration={swRegistration} />
    </div>
  );
};

export default App;
