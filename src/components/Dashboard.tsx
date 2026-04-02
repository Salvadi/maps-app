import React, { useState, useEffect } from 'react';
import { Camera, FolderOpen, ChevronRight, Plus, RefreshCw } from 'lucide-react';
import { Project, User, getAllProjects, getProjectsForUser, getMappingEntriesForProject } from '../db';
import { SyncStats } from '../sync/syncEngine';

interface DashboardProps {
  currentUser: User;
  syncStats: SyncStats;
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

      let total = 0;
      let toComplete = 0;
      const activities: RecentActivity[] = [];
      let mostRecentProject: Project | null = null;
      let mostRecentTime = 0;

      for (const project of activeProjects) {
        const entries = await getMappingEntriesForProject(project.id);
        total += entries.length;
        toComplete += entries.filter(e => e.toComplete).length;

        // Track recent mapping activities
        for (const entry of entries) {
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

        // Track project creation
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
    <div className="flex-1 overflow-auto pb-20 bg-brand-100">
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
                ? `Ultima sync: ${formatTimeAgo(syncStats.lastSyncTime)}`
                : 'Mai sincronizzato'}
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
            <button
              onClick={onManualSync}
              disabled={syncStats.isSyncing}
              className="bg-accent/10 text-accent text-xs font-semibold px-3 py-1.5 rounded-full active:scale-95 transition-transform disabled:opacity-50"
            >
              {syncStats.isSyncing ? 'Sync...' : 'Sincronizza'}
            </button>
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
    </div>
  );
};

export default Dashboard;
