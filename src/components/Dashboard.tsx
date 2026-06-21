import React, { useState, useEffect } from 'react';
import { Camera, FolderOpen, ChevronRight, Plus, RefreshCw, CheckCircle, AlertCircle, Flame, ClipboardList } from 'lucide-react';
import { Project, User, getAllProjects, getProjectsForUser, db } from '../db';
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

  useEffect(() => {
    const loadData = async () => {
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
    };

    loadData();
  }, [currentUser]);

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

  return (
    <div className="flex-1 overflow-auto pb-20 bg-page">
      {/* Sync Progress Bar — sticky so it stays visible while scrolling */}
      {syncProgress && (
        <div className="sticky top-0 z-20 px-4 pt-2 pb-1 bg-page">
          <div className={`bg-surface rounded-2xl px-4 py-3 shadow-card border-l-4 ${
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

      <div className="max-w-6xl mx-auto w-full">
      {/* Header */}
      <div className="px-5 pt-6 pb-4 lg:px-8 lg:pt-8 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl lg:text-3xl font-bold text-brand-800 tracking-tight">
            Ciao, {currentUser.username || currentUser.email.split('@')[0]}
          </h1>
          <p className="text-sm text-brand-500 mt-0.5 capitalize">
            {new Date().toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' })}
          </p>
        </div>
        <span className="hidden lg:inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-flame bg-flame-soft px-3 py-1.5 rounded-full mb-1">
          <Flame size={13} strokeWidth={2.4} />
          Fire Safety
        </span>
      </div>

      {/* Stats Cards */}
      <div className="px-5 lg:px-8 grid grid-cols-3 gap-3 lg:gap-4">
        <div className="bg-surface rounded-2xl p-4 lg:p-5 shadow-card hover:shadow-card-hover transition-shadow text-center lg:text-left lg:flex lg:items-center lg:gap-4">
          <div className="hidden lg:flex w-11 h-11 rounded-xl bg-brand-100 text-brand-600 items-center justify-center flex-shrink-0">
            <ClipboardList size={20} />
          </div>
          <div>
            <div className="text-2xl lg:text-[28px] font-bold text-brand-800 tabular-nums">{totalMappings}</div>
            <div className="text-[11px] lg:text-xs text-brand-500 mt-1 lg:mt-0 leading-tight">Mappature totali</div>
          </div>
        </div>
        <div className="bg-surface rounded-2xl p-4 lg:p-5 shadow-card hover:shadow-card-hover transition-shadow text-center lg:text-left lg:flex lg:items-center lg:gap-4">
          <div className="hidden lg:flex w-11 h-11 rounded-xl bg-accent-soft text-accent items-center justify-center flex-shrink-0">
            <FolderOpen size={20} />
          </div>
          <div>
            <div className="text-2xl lg:text-[28px] font-bold text-accent tabular-nums">{projects.length}</div>
            <div className="text-[11px] lg:text-xs text-brand-500 mt-1 lg:mt-0 leading-tight">Progetti attivi</div>
          </div>
        </div>
        <div className="bg-surface rounded-2xl p-4 lg:p-5 shadow-card hover:shadow-card-hover transition-shadow text-center lg:text-left lg:flex lg:items-center lg:gap-4">
          <div className={`hidden lg:flex w-11 h-11 rounded-xl items-center justify-center flex-shrink-0 ${toCompleteMappings > 0 ? 'bg-warning-soft text-warning' : 'bg-success-soft text-success'}`}>
            {toCompleteMappings > 0 ? <AlertCircle size={20} /> : <CheckCircle size={20} />}
          </div>
          <div>
            <div className={`text-2xl lg:text-[28px] font-bold tabular-nums ${toCompleteMappings > 0 ? 'text-warning' : 'text-success'}`}>
              {toCompleteMappings}
            </div>
            <div className="text-[11px] lg:text-xs text-brand-500 mt-1 lg:mt-0 leading-tight">Da completare</div>
          </div>
        </div>
      </div>

      <div className="lg:grid lg:grid-cols-3 lg:gap-6 lg:items-start lg:px-8 lg:mt-6">
      {/* Data Status */}
      <div className="px-5 mt-4 lg:px-0 lg:mt-0 lg:col-start-3 lg:row-start-1">
        <div className="bg-surface rounded-2xl p-4 shadow-card flex items-center gap-3 lg:flex-col lg:items-stretch lg:gap-4">
          <div className="flex items-center gap-3 flex-1">
            <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${
              syncStats.isSyncing ? 'bg-accent-soft' :
              isOnline ? 'bg-success-soft' : 'bg-warning-soft'
            }`}>
              <RefreshCw
                size={18}
                className={`${
                  syncStats.isSyncing ? 'text-accent animate-spin' :
                  isOnline ? 'text-success' : 'text-warning'
                }`}
              />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-brand-700">
                {syncStats.isSyncing ? 'Aggiornamento dati in corso...' :
                 isOnline ? 'Dati connessi' : 'Modalita offline'}
              </div>
              <div className="text-xs text-brand-500">
                {syncStats.lastSyncTime
                  ? `Ultimo aggiornamento: ${formatTimeAgo(syncStats.lastSyncTime)}`
                  : 'Nessun aggiornamento ancora eseguito'}
                {syncStats.pendingCount > 0 && (
                  <span className="text-warning font-medium"> · {syncStats.pendingCount} modifiche in coda</span>
                )}
              </div>
            </div>
          </div>
          {!isOnline ? (
            <div className="bg-warning-soft text-warning text-xs font-semibold px-2.5 py-1 rounded-full lg:text-center">
              Offline
            </div>
          ) : (
            <button
              onClick={onManualSync}
              disabled={syncStats.isSyncing}
              className="bg-accent/10 text-accent text-xs font-semibold px-3 py-1.5 rounded-full border border-accent/25 active:scale-95 transition-transform disabled:opacity-50 cursor-pointer lg:w-full lg:py-2"
            >
              {syncStats.isSyncing ? 'Aggiorno...' : 'Aggiorna dati'}
            </button>
          )}
        </div>
      </div>

      <div className="lg:col-span-2 lg:col-start-1 lg:row-start-1">
      {/* Quick Actions */}
      <div className="px-5 mt-5 lg:px-0 lg:mt-0">
        <h2 className="text-sm font-semibold text-brand-600 uppercase tracking-wider mb-3">Azioni rapide</h2>
        <div className="grid grid-cols-2 gap-3 lg:gap-4">
          <button
            onClick={onCreateProject}
            className="bg-accent hover:bg-accent-light text-white rounded-2xl p-4 shadow-card hover:shadow-card-hover flex items-center gap-3 active:scale-[0.98] transition-all cursor-pointer"
          >
            <span className="w-9 h-9 rounded-xl bg-white/15 flex items-center justify-center flex-shrink-0">
              <Plus size={18} strokeWidth={2.4} />
            </span>
            <span className="text-sm font-semibold">Nuovo Progetto</span>
          </button>
          {lastProject && (
            <button
              onClick={() => onAddMapping(lastProject)}
              className="bg-surface border border-accent/40 text-accent rounded-2xl p-4 shadow-card hover:shadow-card-hover hover:border-accent flex items-center gap-3 active:scale-[0.98] transition-all cursor-pointer"
            >
              <span className="w-9 h-9 rounded-xl bg-accent-soft flex items-center justify-center flex-shrink-0">
                <Camera size={18} />
              </span>
              <div className="text-left min-w-0">
                <div className="text-sm font-semibold">Continua</div>
                <div className="text-[11px] text-brand-500 truncate">{lastProject.title}</div>
              </div>
            </button>
          )}
        </div>
      </div>

      {/* Recent Activity */}
      <div className="px-5 mt-5 lg:px-0">
        <h2 className="text-sm font-semibold text-brand-600 uppercase tracking-wider mb-3">Attività recente</h2>
        <div className="bg-surface rounded-2xl shadow-card overflow-hidden divide-y divide-brand-200">
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
                  activity.type === 'mapping' ? 'bg-accent-soft text-accent' : 'bg-brand-100 text-brand-600'
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
      </div>
      </div>

      {/* Spacer for bottom tab */}
      <div className="h-4" />
      </div>
    </div>
  );
};

export default Dashboard;
