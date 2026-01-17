import React from 'react';
import './NavigationBar.css';

interface NavigationBarProps {
  title: string;
  onBack: () => void;
  onSync?: () => void;
  isSyncing?: boolean;
  onCopyPrevious?: () => void;
}

// Back Icon Component
const BackIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M19 12H5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M12 19L5 12L12 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

// Sync Icon Component
const SyncIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M21.5 2V6H17.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M2.5 22V18H6.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M19.13 5.87C18.1164 4.53677 16.7415 3.53498 15.172 2.98818C13.6024 2.44137 11.9084 2.37582 10.3002 2.79936C8.69199 3.22289 7.24076 4.11722 6.13 5.36C5.01924 6.60277 4.29779 8.14213 4.05 9.79M19.95 14.21C19.7022 15.8579 18.9808 17.3972 17.87 18.64C16.7592 19.8828 15.308 20.7771 13.6998 21.2006C12.0916 21.6242 10.3976 21.5586 8.82803 21.0118C7.25849 20.465 5.88364 19.4632 4.87 18.13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

const NavigationBar: React.FC<NavigationBarProps> = ({ title, onBack, onSync, isSyncing, onCopyPrevious }) => {
  return (
    <nav className="navigation-bar">
      <button className="nav-back-btn" onClick={onBack} aria-label="Back">
        <BackIcon className="nav-icon" />
      </button>
      <h1 className="nav-title">{title}</h1>
      {onCopyPrevious && (
        <button
          className="nav-copy-btn"
          onClick={onCopyPrevious}
          aria-label="Copy Previous"
        >
          Copia prec.
        </button>
      )}
      {onSync ? (
        <button
          className={`nav-sync-btn ${isSyncing ? 'syncing' : ''}`}
          onClick={onSync}
          disabled={isSyncing}
          aria-label="Sync"
        >
          <SyncIcon className="nav-icon" />
        </button>
      ) : (
        <div className="nav-spacer" />
      )}
    </nav>
  );
};

export default NavigationBar;
