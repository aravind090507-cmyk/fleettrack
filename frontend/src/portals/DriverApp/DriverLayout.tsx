import React from 'react';
import { useNavigate } from 'react-router-dom';
import { LogOut, Radio } from 'lucide-react';
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
    <div className="min-h-screen bg-[#F2F2F7] text-[#1D1D1F] flex flex-col max-w-md mx-auto border-x border-black/[0.06] shadow-2xl font-sans select-none">
      {/* Mobile Apple Header */}
      <header className="h-16 px-4 bg-white/85 border-b border-black/[0.06] flex items-center justify-between sticky top-0 z-30 backdrop-blur-2xl">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-[#0071E3] to-[#42A5F5] text-white flex items-center justify-center shadow-md shadow-blue-500/25">
            <Radio className="w-4 h-4 animate-pulse" />
          </div>
          <div>
            <h1 className="text-xs font-bold uppercase tracking-wider text-zinc-900 leading-tight">Driver Console</h1>
            <p className="text-[11px] text-zinc-500 font-medium truncate max-w-[120px]">{user?.name || 'Driver'}</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <ConnectionStatus isOnline={isOnline} queuedCount={offlineQueueCount} />
          <button
            onClick={handleLogout}
            title="Sign Out"
            className="p-2 text-zinc-400 hover:text-rose-600 hover:bg-zinc-100 rounded-full transition-colors cursor-pointer"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 p-4 flex flex-col bg-[#F2F2F7]">{children}</main>
    </div>
  );
};
