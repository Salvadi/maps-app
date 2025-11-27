import React, { useState, useEffect } from 'react';
import { Project, User, getAllProjects, getProjectsForUser } from '../db';
import './Home.css';

interface HomeProps {
  currentUser: User;
  onCreateProject: () => void;
  onEditProject: (project: Project) => void;
  onDeleteProject: (projectId: string) => void;
  onViewProject: (project: Project) => void;
  onEnterMapping: (project: Project) => void;
}

// SVG Icon Components
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

const LockIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M19 11H5C3.89543 11 3 11.8954 3 13V20C3 21.1046 3.89543 22 5 22H19C20.1046 22 21 21.1046 21 20V13C21 11.8954 20.1046 11 19 11Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M7 11V7C7 5.67392 7.52678 4.40215 8.46447 3.46447C9.40215 2.52678 10.6739 2 12 2C13.3261 2 14.5979 2.52678 15.5355 3.46447C16.4732 4.40215 17 5.67392 17 7V11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
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

const DoorIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M18 3H6C4.89543 3 4 3.89543 4 5V21H20V5C20 3.89543 19.1046 3 18 3Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M15 13H15.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M4 21H20" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

const PlusIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M12 5V19" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M5 12H19" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

const getProjectIcon = (index: number, status: string) => {
  if (status === 'closed') return LockIcon;
  const icons = [DocumentIcon, FolderIcon, CalendarIcon, EyeIcon];
  return icons[index % icons.length];
};

const Home: React.FC<HomeProps> = ({
  currentUser,
  onCreateProject,
  onEditProject,
  onDeleteProject,
  onViewProject,
  onEnterMapping,
}) => {
  const [activeProject, setActiveProject] = useState<string | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [isLoading, setIsLoading] = useState(true);

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

  if (isLoading) {
    return (
      <div className="home-page">
        <div className="home-container">
          <h1 className="home-title">Home</h1>
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
        <h1 className="home-title">Home</h1>

        {projects.length === 0 ? (
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
            <p style={{ fontSize: '0.875rem' }}>Premi il pulsante + per creare un nuovo progetto</p>
          </div>
        ) : (
          <div className="projects-grid">
          {projects.map((project, index) => {
            const IconComponent = getProjectIcon(index, project.status);
            const isActive = activeProject === project.id;
            const isClosed = project.status === 'closed';

            return (
              <div key={project.id} className="project-card-wrapper">
                <div
                  className={`project-card ${isClosed ? 'closed' : ''}`}
                  onClick={() => handleProjectClick(project.id)}
                >
                  <div className="project-icon">
                    <IconComponent className="icon" />
                  </div>
                  <div className="project-name">{project.title}</div>

                  {isActive && (
                    <div className="overlay-actions" onClick={(e) => e.stopPropagation()}>
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
                        className="action-btn action-door"
                        onClick={() => handleAction(() => onEnterMapping(project))}
                        aria-label="Enter mapping"
                      >
                        <DoorIcon className="action-icon" />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          </div>
        )}

        <button className="fab-button" onClick={onCreateProject} aria-label="Create project">
          <PlusIcon className="fab-icon" />
        </button>
      </div>
    </div>
  );
};

export default Home;
