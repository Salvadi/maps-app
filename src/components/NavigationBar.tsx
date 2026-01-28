import React from 'react';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import './NavigationBar.css';

interface NavigationBarProps {
  title: string;
  onBack: () => void;
  onSync?: () => void;
  isSyncing?: boolean;
  onCopyPrevious?: () => void;
  rightButton?: React.ReactNode;
}

const NavigationBar: React.FC<NavigationBarProps> = ({ title, onBack, onSync, isSyncing, onCopyPrevious, rightButton }) => {
  return (
    <nav className="navigation-bar">
      <button className="nav-back-btn" onClick={onBack} aria-label="Back">
        <ArrowLeft className="nav-icon" size={20} />
      </button>
      <h1 className="nav-title">{title}</h1>
      <div className="nav-right-buttons">
        {onCopyPrevious && (
          <button
            className="nav-copy-btn"
            onClick={onCopyPrevious}
            aria-label="Copy Previous"
          >
            Copia prec.
          </button>
        )}
        {rightButton}
        {onSync ? (
          <button
            className={`nav-sync-btn ${isSyncing ? 'syncing' : ''}`}
            onClick={onSync}
            disabled={isSyncing}
            aria-label="Sync"
          >
            <RefreshCw className="nav-icon" size={20} />
          </button>
        ) : (
          <div className="nav-spacer" />
        )}
      </div>
    </nav>
  );
};

export default NavigationBar;
