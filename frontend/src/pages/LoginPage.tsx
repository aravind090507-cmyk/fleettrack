import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Radio, Truck, ArrowRight, UserPlus, LogIn, UserCheck, ShieldCheck, Zap } from 'lucide-react';
import { useAuthStore } from '../store/authStore';
import { Button } from '../components/ui/Button';

export const LoginPage: React.FC = () => {
  const [isRegistering, setIsRegistering] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'DRIVER' | 'FLEET_MANAGER'>('DRIVER');
  const [error, setError] = useState<string | null>(null);

  const { login, register, isLoading } = useAuthStore();
  const navigate = useNavigate();

  const handleQuickLogin = async (demoEmail: string, demoRole: 'DRIVER' | 'FLEET_MANAGER') => {
    setError(null);
    setEmail(demoEmail);
    setPassword('Password123!');
    try {
      const user = await login(demoEmail, 'Password123!');
      if (user.role === 'DRIVER') {
        navigate('/driver');
      } else {
        navigate('/company');
      }
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Demo login failed. Creating account...');
      // Fallback: try registering if not exists
      try {
        const user = await register(
          demoRole === 'DRIVER' ? 'Ramesh Kumar (Driver)' : 'Operations Fleet Manager',
          demoEmail,
          'Password123!',
          demoRole
        );
        if (user.role === 'DRIVER') {
          navigate('/driver');
        } else {
          navigate('/company');
        }
      } catch (regErr: any) {
        setError(regErr.response?.data?.detail || 'Authentication error.');
      }
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      if (isRegistering) {
        const user = await register(name, email, password, role);
        if (user.role === 'DRIVER') {
          navigate('/driver');
        } else {
          navigate('/company');
        }
      } else {
        const user = await login(email, password);
        if (user.role === 'DRIVER') {
          navigate('/driver');
        } else {
          navigate('/company');
        }
      }
    } catch (err: any) {
      const detail = err.response?.data?.detail;
      if (detail) {
        setError(detail);
      } else {
        setError('Authentication failed. If this is a new account, please click "Create Account" above.');
      }
    }
  };

  return (
    <div className="min-h-screen bg-[#F2F2F7] text-[#1C1C1E] flex flex-col justify-center py-12 sm:px-6 lg:px-8 relative overflow-hidden select-none font-sans">
      {/* Apple ambient soft atmospheric gradients */}
      <div className="absolute -top-32 -left-32 w-96 h-96 bg-blue-400/15 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute -bottom-32 -right-32 w-96 h-96 bg-emerald-400/15 rounded-full blur-3xl pointer-events-none" />

      <div className="sm:mx-auto sm:w-full sm:max-w-md relative z-10 px-4">
        <div className="flex justify-center mb-3">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-[#0071E3] to-[#42A5F5] flex items-center justify-center shadow-xl shadow-blue-500/20 text-white p-3">
            <Radio className="w-7 h-7 animate-pulse" />
          </div>
        </div>
        <h2 className="text-center text-2xl font-bold tracking-tight text-[#1D1D1F]">
          FleetTrack
        </h2>
        <p className="mt-1 text-center text-xs font-medium text-zinc-500">
          Geospatial Fleet Mobility & Telematics
        </p>

        {/* Apple Segmented Control: Sign In vs Create Account */}
        <div className="mt-6 flex bg-zinc-200/80 p-1 rounded-2xl border border-black/5 backdrop-blur-md">
          <button
            type="button"
            onClick={() => {
              setIsRegistering(false);
              setError(null);
            }}
            className={`flex-1 py-2 text-xs font-semibold tracking-wide rounded-xl flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
              !isRegistering
                ? 'bg-white text-zinc-900 shadow-sm font-bold'
                : 'text-zinc-600 hover:text-zinc-900'
            }`}
          >
            <LogIn className="w-3.5 h-3.5" />
            <span>Sign In</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setIsRegistering(true);
              setError(null);
            }}
            className={`flex-1 py-2 text-xs font-semibold tracking-wide rounded-xl flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
              isRegistering
                ? 'bg-white text-zinc-900 shadow-sm font-bold'
                : 'text-zinc-600 hover:text-zinc-900'
            }`}
          >
            <UserPlus className="w-3.5 h-3.5" />
            <span>Create Account</span>
          </button>
        </div>
      </div>

      <div className="mt-4 sm:mx-auto sm:w-full sm:max-w-md relative z-10 px-4">
        <div className="bg-white/85 border border-white/80 rounded-3xl p-6 sm:p-8 shadow-2xl backdrop-blur-2xl space-y-4">
          
          {/* Quick 1-Click Access Buttons */}
          <div className="space-y-2 border-b border-zinc-100 pb-4 mb-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400 block text-center">
              Quick 1-Click Test Access
            </span>
            <div className="grid grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={() => handleQuickLogin('driver1@fleetcorp.com', 'DRIVER')}
                disabled={isLoading}
                className="p-3 rounded-2xl bg-zinc-50 hover:bg-zinc-100 border border-zinc-200/70 text-left transition-all cursor-pointer flex items-center gap-2.5 group shadow-sm"
              >
                <div className="w-8 h-8 rounded-xl bg-blue-500/10 text-[#0071E3] flex items-center justify-center group-hover:scale-105 transition-transform shrink-0">
                  <Truck className="w-4 h-4" />
                </div>
                <div className="truncate">
                  <span className="text-xs font-bold text-zinc-900 block truncate">Driver App</span>
                  <span className="text-[10px] text-zinc-500 font-mono block">driver1</span>
                </div>
              </button>

              <button
                type="button"
                onClick={() => handleQuickLogin('manager@fleetcorp.com', 'FLEET_MANAGER')}
                disabled={isLoading}
                className="p-3 rounded-2xl bg-zinc-50 hover:bg-zinc-100 border border-zinc-200/70 text-left transition-all cursor-pointer flex items-center gap-2.5 group shadow-sm"
              >
                <div className="w-8 h-8 rounded-xl bg-emerald-500/10 text-emerald-600 flex items-center justify-center group-hover:scale-105 transition-transform shrink-0">
                  <UserCheck className="w-4 h-4" />
                </div>
                <div className="truncate">
                  <span className="text-xs font-bold text-zinc-900 block truncate">Fleet Ops</span>
                  <span className="text-[10px] text-zinc-500 font-mono block">manager</span>
                </div>
              </button>
            </div>
          </div>

          <form className="space-y-3.5" onSubmit={handleSubmit}>
            {error && (
              <div className="p-3 rounded-2xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-medium leading-relaxed">
                {error}
              </div>
            )}

            {isRegistering && (
              <div>
                <label className="block text-[11px] font-bold text-zinc-600 uppercase tracking-wider mb-1">
                  Full Name
                </label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Alexander Rivera"
                  className="w-full px-4 py-2.5 bg-black/[0.03] border border-black/[0.08] rounded-xl text-zinc-900 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-[#0071E3] focus:bg-white text-sm transition-all"
                />
              </div>
            )}

            <div>
              <label className="block text-[11px] font-bold text-zinc-600 uppercase tracking-wider mb-1">
                Email Address
              </label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="your.email@example.com"
                className="w-full px-4 py-2.5 bg-black/[0.03] border border-black/[0.08] rounded-xl text-zinc-900 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-[#0071E3] focus:bg-white text-sm transition-all"
              />
            </div>

            <div>
              <label className="block text-[11px] font-bold text-zinc-600 uppercase tracking-wider mb-1">
                Password
              </label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••••••"
                className="w-full px-4 py-2.5 bg-black/[0.03] border border-black/[0.08] rounded-xl text-zinc-900 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-[#0071E3] focus:bg-white text-sm transition-all"
              />
            </div>

            {isRegistering && (
              <div>
                <label className="block text-[11px] font-bold text-zinc-600 uppercase tracking-wider mb-1">
                  Assigned Operating Role
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setRole('DRIVER')}
                    className={`py-2 px-3 rounded-xl border text-xs font-semibold tracking-wide flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                      role === 'DRIVER'
                        ? 'bg-blue-50 border-[#0071E3] text-[#0071E3] font-bold shadow-sm'
                        : 'bg-zinc-50 border-zinc-200 text-zinc-600'
                    }`}
                  >
                    <Truck className="w-3.5 h-3.5" />
                    <span>Driver App</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setRole('FLEET_MANAGER')}
                    className={`py-2 px-3 rounded-xl border text-xs font-semibold tracking-wide flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                      role === 'FLEET_MANAGER'
                        ? 'bg-blue-50 border-[#0071E3] text-[#0071E3] font-bold shadow-sm'
                        : 'bg-zinc-50 border-zinc-200 text-zinc-600'
                    }`}
                  >
                    <UserCheck className="w-3.5 h-3.5" />
                    <span>Fleet Manager</span>
                  </button>
                </div>
              </div>
            )}

            <button
              type="submit"
              disabled={isLoading}
              className="w-full mt-3 py-3 rounded-full bg-[#0071E3] hover:bg-[#0077ED] text-white text-sm font-bold shadow-lg shadow-blue-500/25 flex items-center justify-center gap-2 transition-all active:scale-[0.98] cursor-pointer"
            >
              <span>{isLoading ? 'Authenticating...' : isRegistering ? 'Create Account & Access' : 'Sign In'}</span>
              <ArrowRight className="w-4 h-4 ml-1" />
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};
