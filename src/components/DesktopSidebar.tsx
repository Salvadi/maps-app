import React from 'react';
import { Home, FolderOpen, Map, Settings, Wifi, WifiOff, Flame } from 'lucide-react';
import { TabId } from './BottomTabBar';
import './DesktopSidebar.css';

const tabs: { id: TabId; label: string; icon: typeof Home }[] = [
  { id: 'dashboard', label: 'Home', icon: Home },
  { id: 'projects', label: 'Progetti', icon: FolderOpen },
  { id: 'maps', label: 'Mappe', icon: Map },
  { id: 'settings', label: 'Impostazioni', icon: Settings },
];

interface DesktopSidebarProps {
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
  pendingSyncCount?: number;
  isOnline: boolean;
}

const DesktopSidebar: React.FC<DesktopSidebarProps> = ({ activeTab, onTabChange, pendingSyncCount, isOnline }) => {
  return (
    <aside className="desktop-sidebar">
      <div className="desktop-sidebar__logo">
        <span className="desktop-sidebar__logo-mark">
          <Flame size={20} strokeWidth={2.2} />
        </span>
        <span>
          <span className="desktop-sidebar__app-name">OPImaPPA</span>
          <span className="desktop-sidebar__app-sub">Fire Safety</span>
        </span>
      </div>
      <nav className="desktop-sidebar__nav">
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              className={`desktop-sidebar__item${isActive ? ' desktop-sidebar__item--active' : ''}`}
            >
              <div className="desktop-sidebar__icon-wrap">
                <Icon size={20} strokeWidth={isActive ? 2.2 : 1.8} />
                {tab.id === 'settings' && pendingSyncCount && pendingSyncCount > 0 ? (
                  <span className="desktop-sidebar__badge">
                    {pendingSyncCount > 9 ? '9+' : pendingSyncCount}
                  </span>
                ) : null}
              </div>
              <span className="desktop-sidebar__label">{tab.label}</span>
            </button>
          );
        })}
      </nav>
      <div className="desktop-sidebar__footer">
        <span className={`desktop-sidebar__status${isOnline ? ' desktop-sidebar__status--online' : ' desktop-sidebar__status--offline'}`}>
          {isOnline ? <Wifi size={14} /> : <WifiOff size={14} />}
          <span>{isOnline ? 'Online' : 'Offline'}</span>
        </span>
      </div>
    </aside>
  );
};

export default DesktopSidebar;
