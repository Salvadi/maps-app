import React, { useState, useEffect, useMemo } from 'react';
import {
  Search, SlidersHorizontal, Plus, FolderOpen, Eye, Pencil, Trash2,
  Camera, RefreshCw, MapPin, User as UserIcon, Archive
} from 'lucide-react';
import { Project, User, getAllProjects, getProjectsForUser, updateProject, db } from '../db';

interface ProjectListProps {
  currentUser: User;
  onCreateProject: () => void;
  onEditProject: (project: Project) => void;
  onDeleteProject: (projectId: string) => void;
  onViewProject: (project: Project) => void;
  onEnterMapping: (project: Project) => void;
  onManualSync?: () => void;
  isSyncing?: boolean;
}

type SortOption = 'date-updated' | 'date-created' | 'alphabetical' | 'alphabetical-reverse';
type FilterTab = 'all' | 'recent' | 'archived';

const ProjectList: React.FC<ProjectListProps> = ({
  currentUser,
  onCreateProject,
  onEditProject,
  onDeleteProject,
  onViewProject,
  onEnterMapping,
  onManualSync,
  isSyncing,
}) => {
  const [projects, setProjects] = useState<Project[]>([]);
  const [mappingCounts, setMappingCounts] = useState<Record<string, number>>({});
  const [toCompleteCounts, setToCompleteCounts] = useState<Record<string, number>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortOption, setSortOption] = useState<SortOption>('date-updated');
  const [filterTab, setFilterTab] = useState<FilterTab>('all');
  const [showSortMenu, setShowSortMenu] = useState(false);

  useEffect(() => {
    const loadProjects = async () => {
      setIsLoading(true);
      const loaded = currentUser.role === 'admin'
        ? await getAllProjects()
        : await getProjectsForUser(currentUser.id);
      setProjects(loaded);

      // Load mapping counts in a single bulk query instead of N+1 per-project queries
      const allEntries = await db.mappingEntries.toArray();
      const counts: Record<string, number> = {};
      const tcCounts: Record<string, number> = {};
      for (const entry of allEntries) {
        counts[entry.projectId] = (counts[entry.projectId] || 0) + 1;
        if (entry.toComplete) {
          tcCounts[entry.projectId] = (tcCounts[entry.projectId] || 0) + 1;
        }
      }
      setMappingCounts(counts);
      setToCompleteCounts(tcCounts);
      setIsLoading(false);
    };
    loadProjects();
  }, [currentUser]);

  const filteredProjects = useMemo(() => {
    let filtered = projects;

    // Filter tab
    if (filterTab === 'archived') {
      filtered = filtered.filter(p => p.archived === 1);
    } else if (filterTab === 'recent') {
      const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
      filtered = filtered.filter(p => p.archived === 0 && p.updatedAt > weekAgo);
    } else {
      filtered = filtered.filter(p => p.archived === 0);
    }

    // Search
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(p =>
        p.title.toLowerCase().includes(q) ||
        p.client.toLowerCase().includes(q) ||
        p.address.toLowerCase().includes(q)
      );
    }

    // Sort
    const sorted = [...filtered];
    switch (sortOption) {
      case 'alphabetical': sorted.sort((a, b) => a.title.localeCompare(b.title)); break;
      case 'alphabetical-reverse': sorted.sort((a, b) => b.title.localeCompare(a.title)); break;
      case 'date-created': sorted.sort((a, b) => b.createdAt - a.createdAt); break;
      default: sorted.sort((a, b) => b.updatedAt - a.updatedAt);
    }
    return sorted;
  }, [projects, searchQuery, sortOption, filterTab]);

  const handleToggleSync = async (project: Project, enabled: boolean) => {
    await updateProject(project.id, { syncEnabled: enabled ? 1 : 0 });
    setProjects(prev => prev.map(p => p.id === project.id ? { ...p, syncEnabled: enabled ? 1 : 0 } : p));
  };

  const handleDelete = (project: Project) => {
    if (window.confirm(`Eliminare "${project.title}"?`)) {
      onDeleteProject(project.id);
      setProjects(prev => prev.filter(p => p.id !== project.id));
    }
  };

  const formatDate = (ts: number) => {
    return new Date(ts).toLocaleDateString('it-IT', { day: 'numeric', month: 'short', year: '2-digit' });
  };

  const filterTabs: { id: FilterTab; label: string }[] = [
    { id: 'all', label: 'Tutti' },
    { id: 'recent', label: 'Recenti' },
    { id: 'archived', label: 'Archiviati' },
  ];

  const sortLabels: Record<SortOption, string> = {
    'date-updated': 'Più recenti',
    'date-created': 'Data creazione',
    'alphabetical': 'A → Z',
    'alphabetical-reverse': 'Z → A',
  };

  return (
    <div className="flex-1 overflow-auto pb-20 bg-brand-100">
      {/* Header */}
      <div className="px-5 pt-6 pb-3 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-brand-800">Progetti</h1>
        <button
          onClick={() => setShowSortMenu(!showSortMenu)}
          className="relative w-10 h-10 rounded-xl bg-white shadow-card flex items-center justify-center text-brand-600 active:scale-95 transition-transform"
        >
          <SlidersHorizontal size={18} />
        </button>
      </div>

      {/* Sort dropdown */}
      {showSortMenu && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setShowSortMenu(false)} />
          <div className="absolute right-5 top-[72px] z-50 bg-white rounded-xl shadow-card-hover border border-brand-200 overflow-hidden min-w-[180px]">
            {(Object.entries(sortLabels) as [SortOption, string][]).map(([key, label]) => (
              <button
                key={key}
                onClick={() => { setSortOption(key); setShowSortMenu(false); }}
                className={`w-full text-left px-4 py-3 text-sm transition-colors ${
                  sortOption === key ? 'bg-blue-50 text-accent font-semibold' : 'text-brand-700 hover:bg-brand-50'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </>
      )}

      {/* Search bar */}
      <div className="px-5 mb-3">
        <div className="relative">
          <Search size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-brand-400" />
          <input
            type="text"
            placeholder="Cerca per nome, cliente o indirizzo..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-3 bg-white rounded-xl text-sm text-brand-700 placeholder:text-brand-400 shadow-card focus:ring-2 focus:ring-accent/30 outline-none"
          />
        </div>
      </div>

      {/* Filter tabs */}
      <div className="px-5 mb-4 flex gap-2">
        {filterTabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setFilterTab(tab.id)}
            className={`px-4 py-2 rounded-full text-sm font-medium transition-all ${
              filterTab === tab.id
                ? 'bg-accent text-white shadow-sm'
                : 'bg-white text-brand-600 shadow-card active:scale-95'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Project list */}
      <div className="px-5 space-y-3">
        {isLoading ? (
          <div className="text-center py-12 text-brand-500 text-sm">
            Caricamento progetti...
          </div>
        ) : filteredProjects.length === 0 ? (
          <div className="text-center py-12">
            <FolderOpen size={40} className="mx-auto text-brand-300 mb-3" />
            <p className="text-brand-500 text-sm">Nessun progetto trovato</p>
            <p className="text-brand-400 text-xs mt-1">
              {projects.length === 0
                ? 'Premi + per creare il primo progetto'
                : 'Prova a modificare i filtri'}
            </p>
          </div>
        ) : (
          filteredProjects.map((project) => (
            <div
              key={project.id}
              className="bg-white rounded-2xl shadow-card overflow-hidden"
            >
              {/* Card header - tap to view */}
              <button
                onClick={() => onViewProject(project)}
                className="w-full text-left p-4 pb-3 active:bg-brand-50 transition-colors"
              >
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <FolderOpen size={18} className="text-accent" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="text-[15px] font-semibold text-brand-800 truncate">{project.title}</h3>
                      {project.archived === 1 && (
                        <Archive size={14} className="text-brand-400 flex-shrink-0" />
                      )}
                    </div>
                    {project.client && (
                      <div className="flex items-center gap-1.5 mt-1">
                        <UserIcon size={12} className="text-brand-400" />
                        <span className="text-xs text-brand-500 truncate">{project.client}</span>
                      </div>
                    )}
                    {project.address && (
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <MapPin size={12} className="text-brand-400" />
                        <span className="text-xs text-brand-500 truncate">{project.address}</span>
                      </div>
                    )}
                  </div>
                </div>
              </button>

              {/* Stats row */}
              <div className="px-4 pb-3 flex items-center gap-2">
                <div className="flex items-center gap-1 bg-brand-50 rounded-lg px-2.5 py-1.5">
                  <Camera size={13} className="text-brand-500" />
                  <span className="text-xs font-semibold text-brand-600">{mappingCounts[project.id] || 0}</span>
                  <span className="text-[11px] text-brand-500">map.</span>
                </div>
                <div className="flex items-center gap-1 bg-brand-50 rounded-lg px-2.5 py-1.5">
                  <span className="text-xs font-semibold text-brand-600">{project.floors?.length || 0}</span>
                  <span className="text-[11px] text-brand-500">piani</span>
                </div>
                {(toCompleteCounts[project.id] || 0) > 0 && (
                  <div className="flex items-center gap-1 bg-orange-50 rounded-lg px-2.5 py-1.5">
                    <span className="text-xs font-semibold text-warning">{toCompleteCounts[project.id]}</span>
                    <span className="text-[11px] text-warning">da compl.</span>
                  </div>
                )}
                <div className="flex-1" />
                {/* Sync toggle */}
                <button
                  onClick={(e) => { e.stopPropagation(); handleToggleSync(project, project.syncEnabled !== 1); }}
                  className={`flex items-center gap-1.5 rounded-lg px-2 py-1.5 transition-colors ${
                    project.syncEnabled === 1
                      ? 'bg-green-50 text-success'
                      : 'bg-brand-50 text-brand-400'
                  }`}
                  title={project.syncEnabled === 1 ? 'Disponibile offline' : 'Non disponibile offline - tap per attivare'}
                >
                  <RefreshCw size={12} />
                  <span className="text-[11px] font-medium">
                    {project.syncEnabled === 1 ? 'Offline' : 'Online'}
                  </span>
                </button>
                <span className="text-[11px] text-brand-400">{formatDate(project.updatedAt)}</span>
              </div>

              {/* Action buttons - always visible */}
              <div className="border-t border-brand-100 flex">
                <button
                  onClick={() => onEnterMapping(project)}
                  className="flex-1 flex items-center justify-center gap-1.5 py-3 font-medium text-sm transition-colors text-accent hover:bg-blue-50 active:bg-blue-100"
                >
                  <Camera size={15} />
                  <span>Mappatura</span>
                </button>
                <div className="w-px bg-brand-100" />
                <button
                  onClick={() => onViewProject(project)}
                  className="flex-1 flex items-center justify-center gap-1.5 py-3 text-brand-600 font-medium text-sm hover:bg-brand-50 active:bg-brand-100 transition-colors"
                >
                  <Eye size={15} />
                  <span>Vedi</span>
                </button>
                <div className="w-px bg-brand-100" />
                <button
                  onClick={() => onEditProject(project)}
                  className="flex items-center justify-center w-12 py-3 text-brand-500 hover:bg-brand-50 active:bg-brand-100 transition-colors"
                >
                  <Pencil size={15} />
                </button>
                <div className="w-px bg-brand-100" />
                <button
                  onClick={() => handleDelete(project)}
                  className="flex items-center justify-center w-12 py-3 text-danger/70 hover:bg-red-50 active:bg-red-100 transition-colors"
                >
                  <Trash2 size={15} />
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* FAB */}
      <button
        onClick={onCreateProject}
        className="fixed bottom-[88px] right-5 z-40 w-14 h-14 bg-accent text-white rounded-full shadow-lg flex items-center justify-center active:scale-90 transition-transform hover:shadow-xl"
      >
        <Plus size={24} />
      </button>

      <div className="h-4" />
    </div>
  );
};

export default ProjectList;
