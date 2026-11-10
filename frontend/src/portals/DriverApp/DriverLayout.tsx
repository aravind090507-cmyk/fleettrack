import React from 'react';
import { useNavigate } from 'react-router-dom';
import { LogOut, Radio, Shield } from 'lucide-react';
import { useAuthStore } from '../../store/authStore';
import { ConnectionStatus } from '../../components/ui/ConnectionStatus';
import { useDriverStore } from '../../store/driverStore';

interface DriverLayoutProps {
  children: React.ReactNode;
}

export const DriverLayout: React.FC<DriverLayoutProps> = ({ children }) => {
  const { user, logout } = useAuthStore();
  const { isOnline, offlineQueueCount } = useDriverStore();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <div className="min-h-screen bg-bespoke-dark text-bespoke-offwhite flex flex-col max-w-md mx-auto border-x border-bespoke-border shadow-2xl font-sans">
      {/* Mobile Header */}
      <header className="h-16 px-4 bg-bespoke-surface/95 border-b border-bespoke-border flex items-center justify-between sticky top-0 z-30 backdrop-blur-md">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded bg-bespoke-card border border-bespoke-gold/40 flex items-center justify-center shadow-md">
            <Radio className="w-4 h-4 text-bespoke-gold animate-pulse" />
          </div>
          <div>
            <h1 className="text-xs font-light tracking-[0.12em] uppercase text-bespoke-offwhite leading-tight">Driver Telematics</h1>
            <p className="text-[10px] text-bespoke-champagne/70 truncate max-w-[120px] font-mono">{user?.name || 'Driver'}</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <ConnectionStatus isOnline={isOnline} queuedCount={offlineQueueCount} />
          <button
            onClick={handleLogout}
            title="Sign Out"
            className="p-2 text-bespoke-champagne/60 hover:text-bespoke-error hover:bg-bespoke-card rounded transition-colors"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 p-4 flex flex-col bg-bespoke-dark">{children}</main>
    </div>
  );
};
