import React from 'react';
import './Home.css';

interface Project {
  id: number;
  name: string;
  color: string;
}

interface HomeProps {
  projects: Project[];
  onAddProject: () => void;
  onProjectClick: (id: number) => void;
  onMappingClick: () => void;
}

// SVG Icons
const PlusIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg 
    className={className} 
    viewBox="0 0 24 24" 
    fill="none" 
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
  >
    <path 
      d="M12 5V19M5 12H19" 
      stroke="currentColor" 
      strokeWidth="2" 
      strokeLinecap="round" 
      strokeLinejoin="round"
    />
  </svg>
);

const MapIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg 
    className={className} 
    viewBox="0 0 24 24" 
    fill="none" 
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
  >
    <path 
      d="M9 18L3 15V6L9 9M9 18V9M9 18L15 15M9 9L15 6M15 6V15M15 6L21 3V12L15 15" 
      stroke="currentColor" 
      strokeWidth="2" 
      strokeLinecap="round" 
      strokeLinejoin="round"
    />
  </svg>
);

const Home: React.FC<HomeProps> = ({ projects, onAddProject, onProjectClick, onMappingClick }) => {
  return (
    <div className="home-container">
      <header className="home-header">
        <h1>My Maps</h1>
      </header>
      <main className="projects-grid">
        {projects.map((project) => (
          <div
            key={project.id}
            className="project-card"
            onClick={() => onProjectClick(project.id)}
            style={{ backgroundColor: project.color }}
          >
            <div className="project-name">{project.name}</div>
          </div>
        ))}
        <div className="project-card add-project-card" onClick={onAddProject}>
          <PlusIcon className="plus-icon" />
          <div className="add-text">Add Project</div>
        </div>
        <div className="project-card mapping-card" onClick={onMappingClick}>
          <MapIcon className="mapping-icon" />
          <div className="mapping-text">Mapping</div>
        </div>
      </main>
    </div>
  );
};

export default Home;