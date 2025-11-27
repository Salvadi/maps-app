import React, { useState } from 'react';
import Login from './components/Login';
import Home from './components/Home';
import ProjectForm from './components/ProjectForm';
import MappingPage from './components/MappingPage';
import './App.css';

export interface Typology {
  id: string;
  number: number;
  supporto: string;
  materiali: string;
  attraversamento: string;
}

export interface Project {
  id: string;
  title: string;
  client: string;
  address: string;
  notes: string;
  floors: string[];
  plans: string[];
  interventionMode: 'room' | 'intervento';
  typologies: Typology[];
  status: 'active' | 'closed';
  createdAt: string;
}

export interface Crossing {
  id: string;
  supporto: string;
  attraversamento: string;
  tipologicoId?: string;
}

export interface MappingEntry {
  id: string;
  projectId: string;
  floor: string;
  roomOrIntervention: string;
  photoURL: string;
  crossings: Crossing[];
  timestamp: string;
}

type View = 'login' | 'home' | 'projectForm' | 'projectEdit' | 'mapping';

const App: React.FC = () => {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [currentView, setCurrentView] = useState<View>('login');
  const [projects, setProjects] = useState<Project[]>([
    {
      id: '1',
      title: 'Project A',
      client: '',
      address: '',
      notes: '',
      floors: [],
      plans: [],
      interventionMode: 'room',
      typologies: [],
      status: 'active',
      createdAt: new Date().toISOString()
    },
    {
      id: '2',
      title: 'Project B',
      client: '',
      address: '',
      notes: '',
      floors: [],
      plans: [],
      interventionMode: 'room',
      typologies: [],
      status: 'active',
      createdAt: new Date().toISOString()
    },
    {
      id: '3',
      title: 'Project D',
      client: '',
      address: '',
      notes: '',
      floors: [],
      plans: [],
      interventionMode: 'room',
      typologies: [],
      status: 'active',
      createdAt: new Date().toISOString()
    },
    {
      id: '4',
      title: 'Project E',
      client: '',
      address: '',
      notes: '',
      floors: [],
      plans: [],
      interventionMode: 'room',
      typologies: [],
      status: 'active',
      createdAt: new Date().toISOString()
    },
    {
      id: '5',
      title: 'Project F',
      client: '',
      address: '',
      notes: '',
      floors: [],
      plans: [],
      interventionMode: 'room',
      typologies: [],
      status: 'closed',
      createdAt: new Date().toISOString()
    }
  ]);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [mappingEntries, setMappingEntries] = useState<MappingEntry[]>([]);
  const [currentMappingProject, setCurrentMappingProject] = useState<Project | null>(null);

  const handleLogin = (username: string, password: string) => {
    setIsLoggedIn(true);
    setCurrentView('home');
  };

  const handleCreateProject = () => {
    setSelectedProject(null);
    setCurrentView('projectForm');
  };

  const handleEditProject = (project: Project) => {
    setSelectedProject(project);
    setCurrentView('projectEdit');
  };

  const handleDeleteProject = (projectId: string) => {
    setProjects(projects.filter(p => p.id !== projectId));
  };

  const handleViewProject = (project: Project) => {
    setSelectedProject(project);
    setCurrentView('projectEdit');
  };

  const handleEnterMapping = (project: Project) => {
    setCurrentMappingProject(project);
    setCurrentView('mapping');
  };

  const handleSaveProject = (projectData: Omit<Project, 'id' | 'createdAt'>) => {
    if (selectedProject) {
      setProjects(projects.map(p =>
        p.id === selectedProject.id
          ? { ...projectData, id: p.id, createdAt: p.createdAt }
          : p
      ));
    } else {
      const newProject: Project = {
        ...projectData,
        id: Date.now().toString(),
        createdAt: new Date().toISOString()
      };
      setProjects([...projects, newProject]);
    }
    setCurrentView('home');
    setSelectedProject(null);
  };

  const handleCancelProject = () => {
    setCurrentView('home');
    setSelectedProject(null);
  };

  const handleSaveMapping = (mappingData: Omit<MappingEntry, 'id' | 'timestamp'>) => {
    const newEntry: MappingEntry = {
      ...mappingData,
      id: Date.now().toString(),
      timestamp: new Date().toISOString()
    };
    setMappingEntries([...mappingEntries, newEntry]);
  };

  const handleBackToHome = () => {
    setCurrentView('home');
    setCurrentMappingProject(null);
  };

  const renderView = () => {
    if (!isLoggedIn) {
      return <Login onLogin={handleLogin} />;
    }

    switch (currentView) {
      case 'home':
        return (
          <Home
            projects={projects}
            onCreateProject={handleCreateProject}
            onEditProject={handleEditProject}
            onDeleteProject={handleDeleteProject}
            onViewProject={handleViewProject}
            onEnterMapping={handleEnterMapping}
          />
        );
      case 'projectForm':
      case 'projectEdit':
        return (
          <ProjectForm
            project={selectedProject}
            onSave={handleSaveProject}
            onCancel={handleCancelProject}
          />
        );
      case 'mapping':
        return (
          <MappingPage
            project={currentMappingProject}
            onSave={handleSaveMapping}
            onBack={handleBackToHome}
          />
        );
      default:
        return <Home
          projects={projects}
          onCreateProject={handleCreateProject}
          onEditProject={handleEditProject}
          onDeleteProject={handleDeleteProject}
          onViewProject={handleViewProject}
          onEnterMapping={handleEnterMapping}
        />;
    }
  };

  return (
    <div className="App">
      {renderView()}
    </div>
  );
};

export default App;
