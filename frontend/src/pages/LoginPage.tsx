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
    <div className="min-h-screen bg-slate-950 flex flex-col justify-center py-10 sm:px-6 lg:px-8 relative overflow-hidden">
      {/* Background radial glow */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[550px] h-[550px] bg-emerald-500/10 rounded-full blur-[140px] pointer-events-none" />

      <div className="sm:mx-auto sm:w-full sm:max-w-md relative z-10 px-4">
        <div className="flex justify-center mb-3">
          <div className="w-13 h-13 rounded-2xl bg-gradient-to-tr from-emerald-600 to-teal-400 flex items-center justify-center shadow-xl shadow-emerald-950 border border-emerald-400/20 p-3">
            <Radio className="w-7 h-7 text-white animate-pulse" />
          </div>
        </div>
        <h2 className="text-center text-2xl font-extrabold tracking-tight text-white">
          FleetTrack Live
        </h2>
        <p className="mt-1 text-center text-xs text-slate-400">
          Geospatial Navigation & Real-Time Tracking
        </p>

        {/* Tab Switcher: Login vs Register */}
        <div className="mt-6 flex bg-slate-900/90 p-1 rounded-2xl border border-slate-800 backdrop-blur-md">
          <button
            type="button"
            onClick={() => {
              setIsRegistering(false);
              setError(null);
            }}
            className={`flex-1 py-2 text-xs font-bold rounded-xl flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
              !isRegistering
                ? 'bg-emerald-600 text-white shadow-md'
                : 'text-slate-400 hover:text-slate-200'
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
            className={`flex-1 py-2 text-xs font-bold rounded-xl flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
              isRegistering
                ? 'bg-emerald-600 text-white shadow-md'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <UserPlus className="w-3.5 h-3.5" />
            <span>Create Account</span>
          </button>
        </div>
      </div>

      <div className="mt-4 sm:mx-auto sm:w-full sm:max-w-md relative z-10 px-4">
        <div className="bg-slate-900/95 border border-slate-800 rounded-3xl p-6 sm:p-8 shadow-2xl backdrop-blur-xl space-y-4">
          {/* 1-Click Fast Demo Sign-In Buttons */}
          <div className="p-3 bg-slate-950/80 rounded-2xl border border-slate-800/80 space-y-2">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
              <Zap className="w-3 h-3 text-amber-400 fill-amber-400" />
              <span>1-Click Instant Sign-In</span>
            </span>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => handleQuickLogin('driver1@fleetcorp.com', 'DRIVER')}
                className="p-2 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700/80 text-left transition flex items-center gap-2 group cursor-pointer"
              >
                <div className="w-7 h-7 rounded-lg bg-emerald-950 border border-emerald-800 flex items-center justify-center text-emerald-400 group-hover:scale-105 transition-transform shrink-0">
                  <Truck className="w-3.5 h-3.5" />
                </div>
                <div className="truncate">
                  <span className="text-xs font-bold text-white block truncate">Driver Portal</span>
                  <span className="text-[10px] text-slate-400 font-mono block">driver1</span>
                </div>
              </button>

              <button
                type="button"
                onClick={() => handleQuickLogin('manager@fleetcorp.com', 'FLEET_MANAGER')}
                className="p-2 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700/80 text-left transition flex items-center gap-2 group cursor-pointer"
              >
                <div className="w-7 h-7 rounded-lg bg-blue-950 border border-blue-800 flex items-center justify-center text-blue-400 group-hover:scale-105 transition-transform shrink-0">
                  <UserCheck className="w-3.5 h-3.5" />
                </div>
                <div className="truncate">
                  <span className="text-xs font-bold text-white block truncate">Fleet Manager</span>
                  <span className="text-[10px] text-slate-400 font-mono block">manager</span>
                </div>
              </button>
            </div>
          </div>

          <form className="space-y-4" onSubmit={handleSubmit}>
            {error && (
              <div className="p-3 rounded-xl bg-rose-950/80 border border-rose-800 text-rose-300 text-xs font-semibold leading-relaxed">
                {error}
              </div>
            )}

            {isRegistering && (
              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                  Your Full Name
                </label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. John Doe"
                  className="w-full px-4 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm transition-all"
                />
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                Email Address
              </label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="your.email@example.com"
                className="w-full px-4 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm transition-all"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                Password
              </label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••••••"
                className="w-full px-4 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm transition-all"
              />
            </div>

            {isRegistering && (
              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                  Select Role
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setRole('DRIVER')}
                    className={`py-2 px-3 rounded-xl border text-xs font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                      role === 'DRIVER'
                        ? 'bg-emerald-950/80 border-emerald-500 text-emerald-400 shadow-sm'
                        : 'bg-slate-950 border-slate-800 text-slate-400'
                    }`}
                  >
                    <Truck className="w-3.5 h-3.5" />
                    <span>Driver (Phone)</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setRole('FLEET_MANAGER')}
                    className={`py-2 px-3 rounded-xl border text-xs font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                      role === 'FLEET_MANAGER'
                        ? 'bg-blue-950/80 border-blue-500 text-blue-400 shadow-sm'
                        : 'bg-slate-950 border-slate-800 text-slate-400'
                    }`}
                  >
                    <UserCheck className="w-3.5 h-3.5" />
                    <span>Fleet Manager</span>
                  </button>
                </div>
              </div>
            )}

            <Button type="submit" variant="primary" size="lg" className="w-full mt-2" isLoading={isLoading}>
              <span>{isRegistering ? 'Create Real Account & Start' : 'Authenticate & Sign In'}</span>
              <ArrowRight className="w-4 h-4 ml-1" />
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
};
