import React from 'react';
import { Home, FolderOpen, Map, Settings } from 'lucide-react';

export type TabId = 'dashboard' | 'projects' | 'maps' | 'settings';

interface BottomTabBarProps {
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
  pendingSyncCount?: number;
}

const tabs: { id: TabId; label: string; icon: typeof Home }[] = [
  { id: 'dashboard', label: 'Home', icon: Home },
  { id: 'projects', label: 'Progetti', icon: FolderOpen },
  { id: 'maps', label: 'Mappe', icon: Map },
  { id: 'settings', label: 'Impostazioni', icon: Settings },
];

const BottomTabBar: React.FC<BottomTabBarProps> = ({ activeTab, onTabChange, pendingSyncCount }) => {
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 bg-surface/95 backdrop-blur-md border-t border-line shadow-nav pb-safe-bottom">
      <div className="flex items-center justify-around h-16 max-w-lg mx-auto">
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              aria-current={isActive ? 'page' : undefined}
              className={`relative flex flex-col items-center justify-center flex-1 h-full gap-0.5 transition-colors duration-200 cursor-pointer ${
                isActive
                  ? 'text-accent'
                  : 'text-brand-500 active:text-brand-700'
              }`}
            >
              <div className={`relative flex items-center justify-center px-4 py-1 rounded-full transition-colors duration-200 ${
                isActive ? 'bg-accent-soft' : ''
              }`}>
                <Icon size={21} strokeWidth={isActive ? 2.2 : 1.8} />
                {tab.id === 'settings' && pendingSyncCount && pendingSyncCount > 0 ? (
                  <span className="absolute -top-1 right-1 bg-danger text-white text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center">
                    {pendingSyncCount > 9 ? '9+' : pendingSyncCount}
                  </span>
                ) : null}
              </div>
              <span className={`text-[11px] leading-tight ${isActive ? 'font-semibold' : 'font-medium'}`}>
                {tab.label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
};

export default BottomTabBar;
