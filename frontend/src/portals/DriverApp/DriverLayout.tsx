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
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col max-w-md mx-auto border-x border-slate-900 shadow-2xl">
      {/* Mobile Header */}
      <header className="h-16 px-4 bg-slate-900/90 border-b border-slate-800 flex items-center justify-between sticky top-0 z-30 backdrop-blur-md">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-emerald-600 to-teal-400 flex items-center justify-center shadow-md">
            <Radio className="w-4 h-4 text-white animate-pulse" />
          </div>
          <div>
            <h1 className="text-sm font-bold tracking-tight text-white leading-tight">Driver Portal</h1>
            <p className="text-[10px] text-slate-400 truncate max-w-[120px]">{user?.name || 'Driver'}</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <ConnectionStatus isOnline={isOnline} queuedCount={offlineQueueCount} />
          <button
            onClick={handleLogout}
            title="Sign Out"
            className="p-2 text-slate-400 hover:text-rose-400 hover:bg-slate-800 rounded-lg transition-colors"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 p-4 flex flex-col">{children}</main>
    </div>
  );
};
