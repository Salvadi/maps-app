import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Camera, FolderOpen, ChevronRight, ChevronDown, Plus, RefreshCw, Check, CheckCircle, AlertCircle } from 'lucide-react';
import { Project, User, getAllProjects, getProjectsForUser, updateProject, db } from '../db';
import { SyncStats, SyncProgress } from '../sync/syncEngine';

interface DashboardProps {
  currentUser: User;
  syncStats: SyncStats;
  syncProgress: SyncProgress | null;
  isOnline: boolean;
  onNavigateToProject: (project: Project) => void;
  onAddMapping: (project: Project) => void;
  onCreateProject: () => void;
  onManualSync: () => void;
}

interface RecentActivity {
  type: 'mapping' | 'project';
  title: string;
  subtitle: string;
  timestamp: number;
  project?: Project;
}

const Dashboard: React.FC<DashboardProps> = ({
  currentUser,
  syncStats,
  syncProgress,
  isOnline,
  onNavigateToProject,
  onAddMapping,
  onCreateProject,
  onManualSync,
}) => {
  const [projects, setProjects] = useState<Project[]>([]);
  const [totalMappings, setTotalMappings] = useState(0);
  const [toCompleteMappings, setToCompleteMappings] = useState(0);
  const [recentActivities, setRecentActivities] = useState<RecentActivity[]>([]);
  const [lastProject, setLastProject] = useState<Project | null>(null);
  const [showSyncModal, setShowSyncModal] = useState(false);
  const [modalProjects, setModalProjects] = useState<Project[]>([]);
  const prevIsSyncingRef = useRef(syncStats.isSyncing ?? false);

  const loadData = useCallback(async () => {
      const loadedProjects = currentUser.role === 'admin'
        ? await getAllProjects()
        : await getProjectsForUser(currentUser.id);

      const activeProjects = loadedProjects.filter(p => p.archived === 0);
      setProjects(activeProjects);

      // Single bulk query for ALL mapping entries instead of N+1 per-project queries
      const allEntries = await db.mappingEntries.toArray();
      const projectMap = new Map(activeProjects.map(p => [p.id, p]));

      let total = 0;
      let toComplete = 0;
      const activities: RecentActivity[] = [];
      let mostRecentProject: Project | null = null;
      let mostRecentTime = 0;

      for (const entry of allEntries) {
        const project = projectMap.get(entry.projectId);
        if (!project) continue; // Entry belongs to archived/inaccessible project

        total++;
        if (entry.toComplete) toComplete++;

        if (entry.timestamp > mostRecentTime) {
          mostRecentTime = entry.timestamp;
          mostRecentProject = project;
        }
        activities.push({
          type: 'mapping',
          title: `Mappatura ${entry.floor}${entry.room ? ` / St. ${entry.room}` : ''}${entry.intervention ? ` / Int. ${entry.intervention}` : ''}`,
          subtitle: project.title,
          timestamp: entry.timestamp,
          project,
        });
      }

      // Track project creation activities
      for (const project of activeProjects) {
        activities.push({
          type: 'project',
          title: `Progetto "${project.title}"`,
          subtitle: project.client || project.address || 'Nuovo progetto',
          timestamp: project.createdAt,
          project,
        });
      }

      activities.sort((a, b) => b.timestamp - a.timestamp);
      setRecentActivities(activities.slice(0, 8));
      setTotalMappings(total);
      setToCompleteMappings(toComplete);
      setLastProject(mostRecentProject);
  }, [currentUser]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Reload after sync completes
  useEffect(() => {
    const currentIsSyncing = syncStats.isSyncing ?? false;
    if (prevIsSyncingRef.current === true && currentIsSyncing === false) {
      loadData();
    }
    prevIsSyncingRef.current = currentIsSyncing;
  }, [syncStats.isSyncing, loadData]);

  const formatTimeAgo = (timestamp: number) => {
    const diff = Date.now() - timestamp;
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return 'ora';
    if (minutes < 60) return `${minutes} min fa`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h fa`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}g fa`;
    return new Date(timestamp).toLocaleDateString('it-IT', { day: 'numeric', month: 'short' });
  };

  const openSyncModal = () => {
    setModalProjects(projects.map(p => ({ ...p })));
    setShowSyncModal(true);
  };

  const handleSyncClick = () => {
    onManualSync();
  };

  const handleSyncConfirm = async () => {
    for (const mp of modalProjects) {
      const original = projects.find(p => p.id === mp.id);
      if (original && original.syncEnabled !== mp.syncEnabled) {
        await updateProject(mp.id, { syncEnabled: mp.syncEnabled });
      }
    }
    setProjects(prev => prev.map(p => {
      const mp = modalProjects.find(m => m.id === p.id);
      return mp ? { ...p, syncEnabled: mp.syncEnabled } : p;
    }));
    setShowSyncModal(false);
    onManualSync();
  };

  return (
    <div className="flex-1 overflow-auto pb-20 bg-brand-100">
      {/* Sync Progress Bar — sticky so it stays visible while scrolling */}
      {syncProgress && (
        <div className="sticky top-0 z-20 px-4 pt-2 pb-1 bg-brand-100">
          <div className={`bg-white rounded-2xl px-4 py-3 shadow-card border-l-4 ${
            syncProgress.phase === 'Completato' || syncProgress.phase === 'Sync completato'
              ? 'border-l-success'
              : syncProgress.phase.startsWith('Errore')
              ? 'border-l-danger'
              : 'border-l-accent'
          }`}>
            <div className="flex items-center gap-3 mb-2">
              {syncProgress.phase === 'Completato' || syncProgress.phase === 'Sync completato' ? (
                <CheckCircle size={18} className="text-success flex-shrink-0" />
              ) : syncProgress.phase.startsWith('Errore') ? (
                <AlertCircle size={18} className="text-danger flex-shrink-0" />
              ) : (
                <RefreshCw size={18} className="text-accent animate-spin flex-shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-brand-700">{syncProgress.phase}</div>
                {syncProgress.detail && (
                  <div className="text-xs text-brand-500 mt-0.5">{syncProgress.detail}</div>
                )}
              </div>
              <span className="text-xs text-brand-400 flex-shrink-0">
                {syncProgress.step}/{syncProgress.totalSteps}
              </span>
            </div>
            <div className="w-full h-1.5 bg-brand-100 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ease-out ${
                  syncProgress.phase === 'Completato' || syncProgress.phase === 'Sync completato'
                    ? 'bg-success'
                    : syncProgress.phase.startsWith('Errore')
                    ? 'bg-danger'
                    : 'bg-accent'
                }`}
                style={{ width: `${Math.round((syncProgress.step / syncProgress.totalSteps) * 100)}%` }}
              />
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="px-5 pt-6 pb-4">
        <h1 className="text-2xl font-bold text-brand-800">
          Ciao, {currentUser.username || currentUser.email.split('@')[0]}
        </h1>
        <p className="text-sm text-brand-500 mt-0.5">
          {new Date().toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' })}
        </p>
      </div>

      {/* Stats Cards */}
      <div className="px-5 grid grid-cols-3 gap-3">
        <div className="bg-white rounded-2xl p-4 shadow-card text-center">
          <div className="text-2xl font-bold text-brand-800">{totalMappings}</div>
          <div className="text-[11px] text-brand-500 mt-1 leading-tight">Mappature totali</div>
        </div>
        <div className="bg-white rounded-2xl p-4 shadow-card text-center">
          <div className="text-2xl font-bold text-accent">{projects.length}</div>
          <div className="text-[11px] text-brand-500 mt-1 leading-tight">Progetti attivi</div>
        </div>
        <div className="bg-white rounded-2xl p-4 shadow-card text-center">
          <div className={`text-2xl font-bold ${toCompleteMappings > 0 ? 'text-warning' : 'text-success'}`}>
            {toCompleteMappings}
          </div>
          <div className="text-[11px] text-brand-500 mt-1 leading-tight">Da completare</div>
        </div>
      </div>

      {/* Sync Status */}
      <div className="px-5 mt-4">
        <div className="bg-white rounded-2xl p-4 shadow-card flex items-center gap-3">
          <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
            syncStats.isSyncing ? 'bg-blue-50' :
            isOnline ? 'bg-green-50' : 'bg-orange-50'
          }`}>
            <RefreshCw
              size={18}
              className={`${
                syncStats.isSyncing ? 'text-accent animate-spin' :
                isOnline ? 'text-success' : 'text-warning'
              }`}
            />
          </div>
          <div className="flex-1">
            <div className="text-sm font-semibold text-brand-700">
              {syncStats.isSyncing ? 'Sincronizzazione...' :
               isOnline ? 'Online' : 'Offline'}
            </div>
            <div className="text-xs text-brand-500">
              {syncStats.lastSyncTime
                ? `Modifiche caricate: ${formatTimeAgo(syncStats.lastSyncTime)}`
                : 'Nessuna modifica caricata'}
              {syncStats.pendingCount > 0 && (
                <span className="text-warning font-medium"> · {syncStats.pendingCount} in coda</span>
              )}
            </div>
          </div>
          {!isOnline ? (
            <div className="bg-orange-100 text-warning text-xs font-semibold px-2.5 py-1 rounded-full">
              Offline
            </div>
          ) : (
            <div className="flex items-center rounded-full overflow-hidden border border-accent/25">
              <button
                onClick={handleSyncClick}
                disabled={syncStats.isSyncing}
                className="bg-accent/10 text-accent text-xs font-semibold px-3 py-1.5 active:scale-95 transition-transform disabled:opacity-50"
              >
                {syncStats.isSyncing ? 'Sync...' : 'Sincronizza'}
              </button>
              <div className="w-px h-4 bg-accent/25" />
              <button
                onClick={openSyncModal}
                disabled={syncStats.isSyncing}
                className="bg-accent/10 text-accent px-2 py-1.5 active:scale-95 transition-transform disabled:opacity-50"
                title="Seleziona progetti"
              >
                <ChevronDown size={13} />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Quick Actions */}
      <div className="px-5 mt-5">
        <h2 className="text-sm font-semibold text-brand-600 uppercase tracking-wider mb-3">Azioni rapide</h2>
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={onCreateProject}
            className="bg-accent text-white rounded-2xl p-4 shadow-card flex items-center gap-3 active:scale-[0.98] transition-transform"
          >
            <Plus size={20} />
            <span className="text-sm font-semibold">Nuovo Progetto</span>
          </button>
          {lastProject && (
            <button
              onClick={() => onAddMapping(lastProject)}
              className="bg-white border-2 border-accent text-accent rounded-2xl p-4 shadow-card flex items-center gap-3 active:scale-[0.98] transition-transform"
            >
              <Camera size={20} />
              <div className="text-left">
                <div className="text-sm font-semibold">Continua</div>
                <div className="text-[11px] text-brand-500 truncate max-w-[100px]">{lastProject.title}</div>
              </div>
            </button>
          )}
        </div>
      </div>

      {/* Recent Activity */}
      <div className="px-5 mt-5">
        <h2 className="text-sm font-semibold text-brand-600 uppercase tracking-wider mb-3">Attività recente</h2>
        <div className="bg-white rounded-2xl shadow-card overflow-hidden divide-y divide-brand-200">
          {recentActivities.length === 0 ? (
            <div className="p-6 text-center text-brand-500 text-sm">
              Nessuna attività recente
            </div>
          ) : (
            recentActivities.map((activity, i) => (
              <button
                key={i}
                onClick={() => activity.project && onNavigateToProject(activity.project)}
                className="w-full flex items-center gap-3 p-3.5 hover:bg-brand-50 active:bg-brand-100 transition-colors text-left"
              >
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${
                  activity.type === 'mapping' ? 'bg-blue-50 text-accent' : 'bg-brand-100 text-brand-600'
                }`}>
                  {activity.type === 'mapping' ? <Camera size={16} /> : <FolderOpen size={16} />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-brand-700 truncate">{activity.title}</div>
                  <div className="text-xs text-brand-500 truncate">{activity.subtitle}</div>
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <span className="text-[11px] text-brand-400">{formatTimeAgo(activity.timestamp)}</span>
                  <ChevronRight size={14} className="text-brand-300" />
                </div>
              </button>
            ))
          )}
        </div>
      </div>

      {/* Spacer for bottom tab */}
      <div className="h-4" />

      {/* Sync project selection modal */}
      {showSyncModal && (
        <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-[60] p-4 pb-24 sm:pb-4">
          <div className="bg-white rounded-2xl w-full max-w-sm shadow-card-hover">
            <div className="px-5 py-4 border-b border-brand-200">
              <h3 className="text-base font-bold text-brand-800">Disponibilità offline</h3>
              <p className="text-xs text-brand-500 mt-0.5">
                Scegli quali progetti rendere disponibili offline
              </p>
            </div>
            <div className="overflow-y-auto max-h-64 divide-y divide-brand-100">
              {modalProjects.length === 0 ? (
                <div className="px-5 py-8 text-center text-brand-500 text-sm">
                  Nessun progetto disponibile
                </div>
              ) : (
                modalProjects.map(project => (
                  <button
                    key={project.id}
                    onClick={() => setModalProjects(prev => prev.map(p =>
                      p.id === project.id ? { ...p, syncEnabled: p.syncEnabled === 1 ? 0 : 1 } : p
                    ))}
                    className="w-full flex items-center gap-3 px-5 py-3.5 hover:bg-brand-50 active:bg-brand-100 transition-colors text-left"
                  >
                    <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
                      project.syncEnabled === 1 ? 'bg-accent border-accent' : 'border-brand-300'
                    }`}>
                      {project.syncEnabled === 1 && <Check size={11} className="text-white" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-brand-700 truncate">{project.title}</div>
                      {project.client && (
                        <div className="text-xs text-brand-500 truncate">{project.client}</div>
                      )}
                    </div>
                  </button>
                ))
              )}
            </div>
            <div className="px-5 py-4 border-t border-brand-200 flex gap-3">
              <button
                onClick={() => setShowSyncModal(false)}
                className="flex-1 py-2.5 rounded-xl border border-brand-200 text-brand-700 text-sm font-semibold"
              >
                Annulla
              </button>
              <button
                onClick={handleSyncConfirm}
                disabled={!modalProjects.some(p => p.syncEnabled === 1)}
                className="flex-1 py-2.5 rounded-xl bg-accent text-white text-sm font-semibold disabled:opacity-40"
              >
                Sincronizza
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Dashboard;
