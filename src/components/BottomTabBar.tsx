import React from 'react';
import { Home, FolderOpen, Map, Settings, Search } from 'lucide-react';

export type TabId = 'dashboard' | 'projects' | 'maps' | 'settings' | 'certSearch';

interface BottomTabBarProps {
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
  pendingSyncCount?: number;
}

const tabs: { id: TabId; label: string; icon: typeof Home }[] = [
  { id: 'dashboard', label: 'Home', icon: Home },
  { id: 'projects', label: 'Progetti', icon: FolderOpen },
  { id: 'maps', label: 'Mappe', icon: Map },
  { id: 'certSearch', label: 'Certificati', icon: Search },
  { id: 'settings', label: 'Impostazioni', icon: Settings },
];

const BottomTabBar: React.FC<BottomTabBarProps> = ({ activeTab, onTabChange, pendingSyncCount }) => {
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 bg-white border-t border-brand-200 shadow-nav pb-safe-bottom">
      <div className="flex items-center justify-around h-16 max-w-lg mx-auto">
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              className={`relative flex flex-col items-center justify-center flex-1 h-full gap-0.5 transition-colors duration-200 ${
                isActive
                  ? 'text-accent'
                  : 'text-brand-500 active:text-brand-700'
              }`}
            >
              <div className="relative">
                <Icon size={22} strokeWidth={isActive ? 2.2 : 1.8} />
                {tab.id === 'settings' && pendingSyncCount && pendingSyncCount > 0 ? (
                  <span className="absolute -top-1 -right-2 bg-danger text-white text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center">
                    {pendingSyncCount > 9 ? '9+' : pendingSyncCount}
                  </span>
                ) : null}
              </div>
              <span className={`text-[11px] leading-tight ${isActive ? 'font-semibold' : 'font-medium'}`}>
                {tab.label}
              </span>
              {isActive && (
                <div className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 bg-accent rounded-full" />
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
};

export default BottomTabBar;
