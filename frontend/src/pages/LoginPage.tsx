import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Radio, Truck, ArrowRight, UserPlus, LogIn, UserCheck, ShieldCheck, Zap, CheckCircle2 } from 'lucide-react';
import { useAuthStore } from '../store/authStore';
import { authApi } from '../services/api';
import { Button } from '../components/ui/Button';

export const LoginPage: React.FC = () => {
  const [isRegistering, setIsRegistering] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'DRIVER' | 'FLEET_MANAGER'>('DRIVER');
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { login, register, isLoading } = useAuthStore();
  const navigate = useNavigate();

  const extractErrorMessage = (err: any): string => {
    const detail = err?.response?.data?.detail;
    if (!detail) {
      return err?.message || 'Authentication error. Please check your details and try again.';
    }
    if (typeof detail === 'string') {
      return detail;
    }
    if (Array.isArray(detail)) {
      return detail
        .map((d: any) => {
          const loc = Array.isArray(d.loc) ? d.loc[d.loc.length - 1] : '';
          const msg = d.msg || d.message || 'Invalid value';
          return loc ? `${loc}: ${msg}` : msg;
        })
        .join('. ');
    }
    if (typeof detail === 'object') {
      return detail.msg || detail.message || JSON.stringify(detail);
    }
    return String(detail);
  };

  const handleQuickLogin = async (demoEmail: string, demoRole: 'DRIVER' | 'FLEET_MANAGER') => {
    setError(null);
    setSuccessMessage(null);
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
      setError(extractErrorMessage(err) || 'Demo login failed. Creating account...');
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
        setError(extractErrorMessage(regErr) || 'Authentication error.');
      }
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting || isLoading) return;

    setError(null);
    setSuccessMessage(null);

    const cleanEmail = email.trim();

    try {
      setIsSubmitting(true);

      if (isRegistering) {
        // 1. Mandatory field validation
        const cleanName = name.trim();
        if (!cleanName || cleanName.length < 2) {
          setError('Please provide a full name with at least 2 characters.');
          setIsSubmitting(false);
          return;
        }

        // 2. Email format validation
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!cleanEmail || !emailRegex.test(cleanEmail)) {
          setError('Please provide a valid email address (e.g. name@company.com).');
          setIsSubmitting(false);
          return;
        }

        // 3. Password length validation
        if (!password || password.length < 6) {
          setError('Password must be at least 6 characters long.');
          setIsSubmitting(false);
          return;
        }

        // 4. Role validation
        if (role !== 'DRIVER' && role !== 'FLEET_MANAGER') {
          setError('Please select a valid role (Driver or Fleet Manager).');
          setIsSubmitting(false);
          return;
        }

        // 5. Submit user creation request
        const res = await authApi.register(cleanName, cleanEmail, password, role);
        const roleLabel = res.user.role === 'FLEET_MANAGER' ? 'Fleet Manager' : 'Driver';

        // 6. Confirmation message and form reset
        setSuccessMessage(`User "${res.user.name}" (${roleLabel}) created successfully! Enter password to sign in.`);
        setName('');
        setPassword('');
        setIsRegistering(false); // Switch to Sign In tab so user can log in with new credentials
      } else {
        // Sign In Flow
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!cleanEmail || !emailRegex.test(cleanEmail)) {
          setError('Please enter a valid email address.');
          setIsSubmitting(false);
          return;
        }
        if (!password) {
          setError('Please enter your password.');
          setIsSubmitting(false);
          return;
        }

        const user = await login(cleanEmail, password);
        if (user.role === 'DRIVER') {
          navigate('/driver');
        } else {
          navigate('/company');
        }
      }
    } catch (err: any) {
      setError(extractErrorMessage(err));
    } finally {
      setIsSubmitting(false);
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
            id="create-new-user-tab"
            onClick={() => {
              setIsRegistering(true);
              setError(null);
              setSuccessMessage(null);
            }}
            className={`flex-1 py-2 text-xs font-semibold tracking-wide rounded-xl flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
              isRegistering
                ? 'bg-white text-zinc-900 shadow-sm font-bold'
                : 'text-zinc-600 hover:text-zinc-900'
            }`}
          >
            <UserPlus className="w-3.5 h-3.5" />
            <span>Create New User</span>
          </button>
        </div>
      </div>

      <div className="mt-4 sm:mx-auto sm:w-full sm:max-w-md relative z-10 px-4">
        <div className="bg-white/85 border border-white/80 rounded-3xl p-6 sm:p-8 shadow-2xl backdrop-blur-2xl space-y-4">
          
          {/* Quick 1-Click Access Buttons */}
          <div className="space-y-2 border-b border-zinc-100 pb-4 mb-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-700 block text-center">
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
                  <span className="text-[10px] text-zinc-700 font-mono font-medium block">driver1</span>
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
                  <span className="text-[10px] text-zinc-700 font-mono font-medium block">manager</span>
                </div>
              </button>
            </div>
          </div>

          <form className="space-y-3.5" onSubmit={handleSubmit}>
            {successMessage && (
              <div className="p-3.5 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs leading-relaxed space-y-1.5 shadow-sm">
                <div className="flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                  <div className="flex-1 font-semibold">
                    {successMessage}
                  </div>
                </div>
              </div>
            )}

            {error && (
              <div className="p-3 rounded-2xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-medium leading-relaxed">
                {error}
              </div>
            )}

            {isRegistering && (
              <div>
                <label className="block text-[11px] font-bold text-zinc-800 uppercase tracking-wider mb-1">
                  Full Name
                </label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Alexander Rivera"
                  className="w-full px-4 py-2.5 bg-black/[0.03] border border-black/[0.08] rounded-xl text-zinc-900 placeholder-zinc-500 font-semibold focus:outline-none focus:ring-2 focus:ring-[#0071E3] focus:bg-white text-sm transition-all"
                />
              </div>
            )}

            <div>
              <label className="block text-[11px] font-bold text-zinc-800 uppercase tracking-wider mb-1">
                Email Address
              </label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="your.email@example.com"
                className="w-full px-4 py-2.5 bg-black/[0.03] border border-black/[0.08] rounded-xl text-zinc-900 placeholder-zinc-500 font-semibold focus:outline-none focus:ring-2 focus:ring-[#0071E3] focus:bg-white text-sm transition-all"
              />
            </div>

            <div>
              <label className="block text-[11px] font-bold text-zinc-800 uppercase tracking-wider mb-1">
                Password
              </label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••••••"
                className="w-full px-4 py-2.5 bg-black/[0.03] border border-black/[0.08] rounded-xl text-zinc-900 placeholder-zinc-500 font-semibold focus:outline-none focus:ring-2 focus:ring-[#0071E3] focus:bg-white text-sm transition-all"
              />
            </div>

            {isRegistering && (
              <div>
                <label className="block text-[11px] font-bold text-zinc-800 uppercase tracking-wider mb-1">
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
              disabled={isLoading || isSubmitting}
              className="w-full mt-3 py-3 rounded-full bg-[#0071E3] hover:bg-[#0077ED] disabled:opacity-60 text-white text-sm font-bold shadow-lg shadow-blue-500/25 flex items-center justify-center gap-2 transition-all active:scale-[0.98] cursor-pointer"
            >
              <span>
                {isLoading || isSubmitting
                  ? (isRegistering ? 'Creating User Account...' : 'Signing In...')
                  : isRegistering
                  ? 'Create New User'
                  : 'Sign In'}
              </span>
              <ArrowRight className="w-4 h-4 ml-1" />
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};
