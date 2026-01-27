import React, { useState, useEffect, useMemo } from 'react';
import { Project, User, getAllProjects, getProjectsForUser, updateProject, db } from '../db';
import './Home.css';

interface HomeProps {
  currentUser: User;
  onCreateProject: () => void;
  onEditProject: (project: Project) => void;
  onDeleteProject: (projectId: string) => void;
  onViewProject: (project: Project) => void;
  onEnterMapping: (project: Project) => void;
  onOpenStandaloneEditor: () => void;
  onOpenFireSealSearch: () => void;
  onLogout: () => void;
  onManualSync: () => void;
  onClearAndSync: () => void;
  isSyncing: boolean;
}

// SVG Icon Components
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const DocumentIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M14 2H6C5.46957 2 4.96086 2.21071 4.58579 2.58579C4.21071 2.96086 4 3.46957 4 4V20C4 20.5304 4.21071 21.0391 4.58579 21.4142C4.96086 21.7893 5.46957 22 6 22H18C18.5304 22 19.0391 21.7893 19.4142 21.4142C19.7893 21.0391 20 20.5304 20 20V8L14 2Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M14 2V8H20" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M12 18V12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

const FolderIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M22 19C22 19.5304 21.7893 20.0391 21.4142 20.4142C21.0391 20.7893 20.5304 21 20 21H4C3.46957 21 2.96086 20.7893 2.58579 20.4142C2.21071 20.0391 2 19.5304 2 19V5C2 4.46957 2.21071 3.96086 2.58579 3.58579C2.96086 3.21071 3.46957 3 4 3H9L11 6H20C20.5304 6 21.0391 6.21071 21.4142 6.58579C21.7893 6.96086 22 7.46957 22 8V19Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const CalendarIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M19 4H5C3.89543 4 3 4.89543 3 6V20C3 21.1046 3.89543 22 5 22H19C20.1046 22 21 21.1046 21 20V6C21 4.89543 20.1046 4 19 4Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M16 2V6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M8 2V6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M3 10H21" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

const EyeIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M1 12C1 12 5 4 12 4C19 4 23 12 23 12C23 12 19 20 12 20C5 20 1 12 1 12Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M12 15C13.6569 15 15 13.6569 15 12C15 10.3431 13.6569 9 12 9C10.3431 9 9 10.3431 9 12C9 13.6569 10.3431 15 12 15Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

const TrashIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M3 6H5H21" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M8 6V4C8 3.46957 8.21071 2.96086 8.58579 2.58579C8.96086 2.21071 9.46957 2 10 2H14C14.5304 2 15.0391 2.21071 15.4142 2.58579C15.7893 2.96086 16 3.46957 16 4V6M19 6V20C19 20.5304 18.7893 21.0391 18.4142 21.4142C18.0391 21.7893 17.5304 22 17 22H7C6.46957 22 5.96086 21.7893 5.58579 21.4142C5.21071 21.0391 5 20.5304 5 20V6H19Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

const PencilIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M17 3C17.2626 2.73735 17.5744 2.52901 17.9176 2.38687C18.2608 2.24473 18.6286 2.17157 19 2.17157C19.3714 2.17157 19.7392 2.24473 20.0824 2.38687C20.4256 2.52901 20.7374 2.73735 21 3C21.2626 3.26264 21.471 3.57444 21.6131 3.9176C21.7553 4.26077 21.8284 4.62856 21.8284 5C21.8284 5.37143 21.7553 5.73923 21.6131 6.08239C21.471 6.42555 21.2626 6.73735 21 7L7.5 20.5L2 22L3.5 16.5L17 3Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

const MapIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M1 6V22L8 18L16 22L23 18V2L16 6L8 2L1 6Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M8 2V18" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M16 6V22" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

const PlusIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M12 5V19" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M5 12H19" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

const LogoutIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M9 21H5C4.46957 21 3.96086 20.7893 3.58579 20.4142C3.21071 20.0391 3 19.5304 3 19V5C3 4.46957 3.21071 3.96086 3.58579 3.58579C3.96086 3.21071 4.46957 3 5 3H9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M16 17L21 12L16 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M21 12H9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

const SyncIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M21.5 2V6H17.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M2.5 22V18H6.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M19.13 5.87C18.1164 4.53677 16.7415 3.53498 15.172 2.98818C13.6024 2.44137 11.9084 2.37582 10.3002 2.79936C8.69199 3.22289 7.24076 4.11722 6.13 5.36C5.01924 6.60277 4.29779 8.14213 4.05 9.79M19.95 14.21C19.7022 15.8579 18.9808 17.3972 17.87 18.64C16.7592 19.8828 15.308 20.7771 13.6998 21.2006C12.0916 21.6242 10.3976 21.5586 8.82803 21.0118C7.25849 20.465 5.88364 19.4632 4.87 18.13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

const SearchIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M11 19C15.4183 19 19 15.4183 19 11C19 6.58172 15.4183 3 11 3C6.58172 3 3 6.58172 3 11C3 15.4183 6.58172 19 11 19Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M21 21L16.65 16.65" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

const FilterIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M22 3H2L10 12.46V19L14 21V12.46L22 3Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

const BlueprintIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect x="3" y="3" width="18" height="18" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M3 9H21" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M9 21V9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    <circle cx="6" cy="6" r="0.5" fill="currentColor"/>
    <circle cx="12" cy="6" r="0.5" fill="currentColor"/>
    <circle cx="18" cy="6" r="0.5" fill="currentColor"/>
    <circle cx="6" cy="15" r="0.5" fill="currentColor"/>
    <circle cx="15" cy="15" r="0.5" fill="currentColor"/>
  </svg>
);

const FireSealIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M12 22C12 22 20 18 20 12V5L12 2L4 5V12C4 18 12 22 12 22Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M12 16C12 16 9 14 9 11.5C9 10 10.5 9 12 10.5C13.5 9 15 10 15 11.5C15 14 12 16 12 16Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

const getProjectIcon = () => {
  // Usa sempre l'icona a forma di cartella per tutti i progetti
  return FolderIcon;
};

type SortOption = 'alphabetical' | 'alphabetical-reverse' | 'date-created' | 'date-updated';

const Home: React.FC<HomeProps> = ({
  currentUser,
  onCreateProject,
  onEditProject,
  onDeleteProject,
  onViewProject,
  onEnterMapping,
  onOpenStandaloneEditor,
  onOpenFireSealSearch,
  onLogout,
  onManualSync,
  onClearAndSync,
  isSyncing,
}) => {
  const [activeProject, setActiveProject] = useState<string | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortOption, setSortOption] = useState<SortOption>('date-updated');
  const [showArchived, setShowArchived] = useState(false);
  const [showSyncMenu, setShowSyncMenu] = useState(false);
  const [showFabMenu, setShowFabMenu] = useState(false);

  // Load projects from IndexedDB
  useEffect(() => {
    const loadProjects = async () => {
      try {
        setIsLoading(true);
        let loadedProjects: Project[];

        if (currentUser.role === 'admin') {
          // Admin can see all projects
          loadedProjects = await getAllProjects();
        } else {
          // Regular users see only their projects
          loadedProjects = await getProjectsForUser(currentUser.id);
        }

        setProjects(loadedProjects);
      } catch (error) {
        console.error('Failed to load projects:', error);
      } finally {
        setIsLoading(false);
      }
    };

    loadProjects();
  }, [currentUser]);

  // Filter and sort projects
  const filteredAndSortedProjects = useMemo(() => {
    let filtered = projects;

    // Filter by archived status
    if (!showArchived) {
      filtered = filtered.filter(p => p.archived === 0);
    }

    // Filter by search query
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(p =>
        p.title.toLowerCase().includes(query) ||
        p.client.toLowerCase().includes(query) ||
        p.address.toLowerCase().includes(query)
      );
    }

    // Sort
    const sorted = [...filtered];
    switch (sortOption) {
      case 'alphabetical':
        sorted.sort((a, b) => a.title.localeCompare(b.title));
        break;
      case 'alphabetical-reverse':
        sorted.sort((a, b) => b.title.localeCompare(a.title));
        break;
      case 'date-created':
        sorted.sort((a, b) => b.createdAt - a.createdAt);
        break;
      case 'date-updated':
        sorted.sort((a, b) => b.updatedAt - a.updatedAt);
        break;
    }

    return sorted;
  }, [projects, searchQuery, sortOption, showArchived]);

  const handleProjectClick = (projectId: string) => {
    if (activeProject === projectId) {
      setActiveProject(null);
    } else {
      setActiveProject(projectId);
    }
  };

  const handleAction = (action: () => void) => {
    action();
    setActiveProject(null);
  };

  const handleEnterMappingWithCheck = (project: Project) => {
    if (project.syncEnabled === 0) {
      // Show warning if sync is disabled
      alert('⚠️ Impossibile aggiungere mappatura, prima sincronizza il progetto.\n\nAttiva la sincronizzazione completa cliccando sull\'icona di sync nell\'angolo della card del progetto.');
      setActiveProject(null);
      return;
    }

    // Proceed normally if sync is enabled
    onEnterMapping(project);
    setActiveProject(null);
  };

  const handleToggleProjectSync = async (project: Project, enabled: boolean, event: React.MouseEvent) => {
    event.stopPropagation(); // Prevent card selection
    try {
      // Update only the syncEnabled field
      await updateProject(project.id, {
        syncEnabled: enabled ? 1 : 0
      });

      // Refresh projects list
      setProjects(prevProjects =>
        prevProjects.map(p => p.id === project.id ? { ...p, syncEnabled: enabled ? 1 : 0 } : p)
      );

      console.log(`✅ Project ${project.title} sync ${enabled ? 'enabled' : 'disabled'}`);
    } catch (error) {
      console.error('Failed to toggle project sync:', error);
    }
  };

  const handleSyncButtonClick = () => {
    setShowSyncMenu(!showSyncMenu);
  };

  const handleSyncOptionClick = (action: () => void) => {
    setShowSyncMenu(false);
    action();
  };

  const handleResetSyncLock = async () => {
    try {
      await db.metadata.put({ key: 'isSyncing', value: false });
      setShowSyncMenu(false);
      // Force refresh of the page to update UI
      window.location.reload();
    } catch (error) {
      console.error('Failed to reset sync lock:', error);
      alert('❌ Errore durante il reset del lock di sincronizzazione');
    }
  };

  // Close sync menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (showSyncMenu && !target.closest('.sync-menu-container')) {
        setShowSyncMenu(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showSyncMenu]);

  if (isLoading) {
    return (
      <div className="home-page">
        <div className="home-container">
          <div className="home-header">
            <h1 className="home-title">Home</h1>
            <div className="header-buttons">
              <div className="sync-menu-container">
                <button
                  className={`sync-button ${isSyncing ? 'syncing' : ''}`}
                  onClick={handleSyncButtonClick}
                  aria-label="Sync"
                  title={isSyncing ? "Sincronizzazione in corso..." : "Sync with Supabase"}
                >
                  <SyncIcon className="sync-icon" />
                </button>
                {showSyncMenu && (
                  <div className="sync-menu">
                    {!isSyncing ? (
                      <>
                        <button
                          className="sync-menu-item"
                          onClick={() => handleSyncOptionClick(onManualSync)}
                        >
                          <SyncIcon className="sync-menu-icon" />
                          <span>Sync normale</span>
                        </button>
                        <button
                          className="sync-menu-item sync-menu-item-danger"
                          onClick={() => handleSyncOptionClick(onClearAndSync)}
                        >
                          <TrashIcon className="sync-menu-icon" />
                          <span>Clear and sync</span>
                        </button>
                      </>
                    ) : (
                      <button
                        className="sync-menu-item sync-menu-item-warning"
                        onClick={handleResetSyncLock}
                      >
                        <TrashIcon className="sync-menu-icon" />
                        <span>🚨 Reset Sync Lock</span>
                      </button>
                    )}
                  </div>
                )}
              </div>
              <button
                className="logout-button"
                onClick={onLogout}
                aria-label="Logout"
                title="Logout"
              >
                <LogoutIcon className="logout-icon" />
              </button>
            </div>
          </div>
          <div style={{
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            minHeight: '200px',
            color: 'var(--color-text-secondary)'
          }}>
            Caricamento progetti...
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="home-page">
      <div className="home-container">
        <div className="home-header">
          <h1 className="home-title">Home</h1>
          <div className="header-buttons">
            <div className="sync-menu-container">
              <button
                className={`sync-button ${isSyncing ? 'syncing' : ''}`}
                onClick={handleSyncButtonClick}
                aria-label="Sync"
                title={isSyncing ? "Sincronizzazione in corso..." : "Sync with Supabase"}
              >
                <SyncIcon className="sync-icon" />
              </button>
              {showSyncMenu && (
                <div className="sync-menu">
                  {!isSyncing ? (
                    <>
                      <button
                        className="sync-menu-item"
                        onClick={() => handleSyncOptionClick(onManualSync)}
                      >
                        <SyncIcon className="sync-menu-icon" />
                        <span>Sync normale</span>
                      </button>
                      <button
                        className="sync-menu-item sync-menu-item-danger"
                        onClick={() => handleSyncOptionClick(onClearAndSync)}
                      >
                        <TrashIcon className="sync-menu-icon" />
                        <span>Clear and sync</span>
                      </button>
                    </>
                  ) : (
                    <button
                      className="sync-menu-item sync-menu-item-warning"
                      onClick={handleResetSyncLock}
                    >
                      <TrashIcon className="sync-menu-icon" />
                      <span>🚨 Reset Sync Lock</span>
                    </button>
                  )}
                </div>
              )}
            </div>
            <button
              className="logout-button"
              onClick={onLogout}
              aria-label="Logout"
              title="Logout"
            >
              <LogoutIcon className="logout-icon" />
            </button>
          </div>
        </div>

        {/* Search and Filter Section */}
        <div className="search-filter-section">
          <div className="search-bar">
            <SearchIcon className="search-icon" />
            <input
              type="text"
              placeholder="Cerca per nome, cliente o indirizzo..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="search-input"
            />
          </div>

          <div className="filter-controls">
            <div className="filter-group">
              <FilterIcon className="filter-icon-small" />
              <select
                value={sortOption}
                onChange={(e) => setSortOption(e.target.value as SortOption)}
                className="filter-select"
              >
                <option value="date-updated">Più recenti</option>
                <option value="date-created">Data di creazione</option>
                <option value="alphabetical">A-Z</option>
                <option value="alphabetical-reverse">Z-A</option>
              </select>
            </div>

            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={showArchived}
                onChange={(e) => setShowArchived(e.target.checked)}
                className="checkbox-input"
              />
              <span>{showArchived ? 'Nascondi archiviati' : 'Mostra archiviati'}</span>
            </label>
          </div>
        </div>

        {filteredAndSortedProjects.length === 0 ? (
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            alignItems: 'center',
            minHeight: '200px',
            gap: '16px',
            color: 'var(--color-text-secondary)'
          }}>
            <p>Nessun progetto trovato</p>
            {projects.length === 0 ? (
              <p style={{ fontSize: '0.875rem' }}>Premi il pulsante + per creare un nuovo progetto</p>
            ) : (
              <p style={{ fontSize: '0.875rem' }}>Prova a modificare i filtri di ricerca</p>
            )}
          </div>
        ) : (
          <div className="projects-grid">
          {filteredAndSortedProjects.map((project, index) => {
            const IconComponent = getProjectIcon();
            const isActive = activeProject === project.id;

            return (
              <div key={project.id} className="project-card-wrapper">
                <div
                  className={`project-card ${isActive ? 'active' : ''}`}
                  onClick={() => handleProjectClick(project.id)}
                >
                  {/* Sync toggle checkbox in top-right corner */}
                  <div
                    className="project-sync-toggle"
                    onClick={(e) => e.stopPropagation()}
                    title={project.syncEnabled === 1 ? "Sincronizzazione completa attiva" : "Solo metadati (click per attivare sync completa)"}
                  >
                    <input
                      type="checkbox"
                      checked={project.syncEnabled === 1}
                      onChange={(e) => handleToggleProjectSync(project, e.target.checked, e as any)}
                      className="sync-checkbox"
                      id={`sync-${project.id}`}
                    />
                    <label htmlFor={`sync-${project.id}`} className="sync-checkbox-label">
                      <SyncIcon className={`sync-checkbox-icon ${project.syncEnabled === 1 ? 'enabled' : ''}`} />
                    </label>
                  </div>

                  <div className="project-icon">
                    <IconComponent className="icon" />
                  </div>
                  <div className="project-name">{project.title}</div>
                </div>

                {isActive && (
                  <div className="action-toolbar" onClick={(e) => e.stopPropagation()}>
                    <button
                      className="action-btn action-trash"
                      onClick={() => handleAction(() => {
                        if (window.confirm(`Delete ${project.title}?`)) {
                          onDeleteProject(project.id);
                        }
                      })}
                      aria-label="Delete project"
                    >
                      <TrashIcon className="action-icon" />
                    </button>
                    <button
                      className="action-btn action-view"
                      onClick={() => handleAction(() => onViewProject(project))}
                      aria-label="View project"
                    >
                      <EyeIcon className="action-icon" />
                    </button>
                    <button
                      className="action-btn action-edit"
                      onClick={() => handleAction(() => onEditProject(project))}
                      aria-label="Edit project"
                    >
                      <PencilIcon className="action-icon" />
                    </button>
                    <button
                      className={`action-btn action-map ${project.syncEnabled === 0 ? 'disabled' : ''}`}
                      onClick={() => handleEnterMappingWithCheck(project)}
                      aria-label="Enter mapping"
                      title={project.syncEnabled === 0 ? "Attiva prima la sincronizzazione completa" : "Aggiungi mappatura"}
                    >
                      <MapIcon className="action-icon" />
                    </button>
                  </div>
                )}
              </div>
            );
          })}
          </div>
        )}

        {/* FAB with dropdown menu */}
        {showFabMenu && (
          <>
            <div className="fab-overlay" onClick={() => setShowFabMenu(false)} />
            <div className="fab-menu">
              <button
                className="fab-menu-item"
                onClick={() => {
                  setShowFabMenu(false);
                  onCreateProject();
                }}
              >
                <FolderIcon className="fab-menu-icon" />
                <span>Nuovo Progetto</span>
              </button>
              <button
                className="fab-menu-item"
                onClick={() => {
                  setShowFabMenu(false);
                  onOpenStandaloneEditor();
                }}
              >
                <BlueprintIcon className="fab-menu-icon" />
                <span>Editor Planimetrie</span>
              </button>
              <button
                className="fab-menu-item"
                onClick={() => {
                  setShowFabMenu(false);
                  onOpenFireSealSearch();
                }}
              >
                <FireSealIcon className="fab-menu-icon" />
                <span>Ricerca Sigillatura</span>
              </button>
            </div>
          </>
        )}
        <button
          className="fab-button"
          onClick={() => setShowFabMenu(!showFabMenu)}
          aria-label="Menu azioni"
          title="Apri menu"
        >
          <PlusIcon className="fab-icon" />
        </button>
      </div>
    </div>
  );
};

export default Home;
