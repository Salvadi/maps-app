import React, { useState } from 'react';
import Login from './components/Login';
import Home from './components/Home';
import ProjectForm from './components/ProjectForm';
import MappingPage from './components/MappingPage';
import './App.css';

interface Project {
  id: number;
  name: string;
  color: string;
}

const App: React.FC = () => {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [projects, setProjects] = useState<Project[]>([
    { id: 1, name: 'Project A', color: '#FF6B6B' },
    { id: 2, name: 'Project B', color: '#4ECDC4' },
    { id: 3, name: 'Project C', color: '#45B7D1' },
    { id: 4, name: 'Project D', color: '#96CEB4' },
  ]);
  const [currentView, setCurrentView] = useState<'home' | 'projectForm' | 'mapping'>('home');
  const [selectedProject, setSelectedProject] = useState<any>(null);

  const handleLogin = (username: string, password: string) => {
    // In a real app, you would verify credentials here
    setIsLoggedIn(true);
  };

  const handleAddProject = () => {
    setSelectedProject(null);
    setCurrentView('projectForm');
  };
  const handleMappingClick = () => {
    setCurrentView('mapping');
  };

  const handleProjectClick = (id: number) => {
    console.log(`Project ${id} clicked`);
    // In a real app, you would load the project data here
    setSelectedProject({ id, name: `Project ${String.fromCharCode(64 + id)}` });
    setCurrentView('projectForm');
  };

  const handleSaveProject = (projectData: any) => {
    if (selectedProject) {
      // Update existing project
      console.log('Updating project:', projectData);
    } else {
      // Create new project
      const newProject: Project = {
        id: projects.length + 1,
        name: projectData.title || `Project ${String.fromCharCode(65 + projects.length)}`,
        color: `hsl(${Math.floor(Math.random() * 360)}, 70%, 80%)`,
      };
      setProjects([...projects, newProject]);
    }
    setCurrentView('home');
  };

  const handleCancelProject = () => {
    setCurrentView('home');
  };

  return (
    <div className="App">
      {isLoggedIn ? (
        <>
          {currentView === 'home' ? (
            <Home
              projects={projects}
              onAddProject={handleAddProject}
              onProjectClick={handleProjectClick}
              onMappingClick={handleMappingClick}
            />
          ) : currentView === 'mapping' ? (
            <MappingPage />
          ) : (
            <ProjectForm
              project={selectedProject}
              onSave={handleSaveProject}
              onCancel={handleCancelProject}
            />
          )}
        </>
      ) : (
        <Login onLogin={handleLogin} />
      )}
    </div>
  );
};

export default App;