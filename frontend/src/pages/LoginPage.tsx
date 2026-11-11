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
    <div className="min-h-screen bg-[#0d0d0d] flex flex-col justify-center py-12 sm:px-6 lg:px-8 relative overflow-hidden select-none">
      {/* Bespoke ambient subtle warm gold illumination */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[650px] h-[650px] bg-[#cb886c]/08 rounded-full blur-[180px] pointer-events-none" />

      <div className="sm:mx-auto sm:w-full sm:max-w-md relative z-10 px-4">
        <div className="flex justify-center mb-4">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-[#cb886c] to-[#ebcfbc] flex items-center justify-center shadow-2xl shadow-black border border-[#cb886c]/30 p-3">
            <Radio className="w-7 h-7 text-[#0d0d0d] font-bold animate-pulse" />
          </div>
        </div>
        <h2 className="text-center text-2xl font-bold tracking-[0.08em] text-[#f4f5f2] uppercase">
          FleetTrack
        </h2>
        <p className="mt-1.5 text-center text-[11px] tracking-[0.14em] text-[#dac9be] uppercase">
          Private Asset Mobility & Telematics Advisory
        </p>

        {/* Tab Switcher: Login vs Register */}
        <div className="mt-7 flex bg-[#151619] p-1 rounded-2xl border border-[#26272b] backdrop-blur-md">
          <button
            type="button"
            onClick={() => {
              setIsRegistering(false);
              setError(null);
            }}
            className={`flex-1 py-2 text-xs font-semibold tracking-wide rounded-xl flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
              !isRegistering
                ? 'bg-[#cb886c] text-[#0d0d0d] shadow-lg shadow-[#cb886c]/20'
                : 'text-[#9c9c9c] hover:text-[#f4f5f2]'
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
                ? 'bg-[#cb886c] text-[#0d0d0d] shadow-lg shadow-[#cb886c]/20'
                : 'text-[#9c9c9c] hover:text-[#f4f5f2]'
            }`}
          >
            <UserPlus className="w-3.5 h-3.5" />
            <span>Create Account</span>
          </button>
        </div>
      </div>

      <div className="mt-4 sm:mx-auto sm:w-full sm:max-w-md relative z-10 px-4">
        <div className="bg-[#151619] border border-[#26272b] rounded-3xl p-6 sm:p-8 shadow-2xl backdrop-blur-xl space-y-4">
          <form className="space-y-4" onSubmit={handleSubmit}>
            {error && (
              <div className="p-3 rounded-xl bg-[#1c0d11] border border-[#b63b51]/40 text-[#fda4af] text-xs font-medium leading-relaxed">
                {error}
              </div>
            )}

            {isRegistering && (
              <div>
                <label className="block text-[11px] font-semibold text-[#dac9be] uppercase tracking-[0.1em] mb-1.5">
                  Full Name
                </label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Alexander Rivera"
                  className="w-full px-4 py-2.5 bg-[#0d0d0d] border border-[#26272b] rounded-xl text-[#f4f5f2] placeholder-[#636363] focus:outline-none focus:border-[#cb886c] text-sm transition-all"
                />
              </div>
            )}

            <div>
              <label className="block text-[11px] font-semibold text-[#dac9be] uppercase tracking-[0.1em] mb-1.5">
                Email Address
              </label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="your.email@example.com"
                className="w-full px-4 py-2.5 bg-[#0d0d0d] border border-[#26272b] rounded-xl text-[#f4f5f2] placeholder-[#636363] focus:outline-none focus:border-[#cb886c] text-sm transition-all"
              />
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-[#dac9be] uppercase tracking-[0.1em] mb-1.5">
                Password
              </label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••••••"
                className="w-full px-4 py-2.5 bg-[#0d0d0d] border border-[#26272b] rounded-xl text-[#f4f5f2] placeholder-[#636363] focus:outline-none focus:border-[#cb886c] text-sm transition-all"
              />
            </div>

            {isRegistering && (
              <div>
                <label className="block text-[11px] font-semibold text-[#dac9be] uppercase tracking-[0.1em] mb-1.5">
                  Assigned Operating Role
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setRole('DRIVER')}
                    className={`py-2 px-3 rounded-xl border text-xs font-semibold tracking-wide flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                      role === 'DRIVER'
                        ? 'bg-[#cb886c]/20 border-[#cb886c] text-[#ebcfbc] shadow-sm'
                        : 'bg-[#0d0d0d] border-[#26272b] text-[#9c9c9c]'
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
                        ? 'bg-[#cb886c]/20 border-[#cb886c] text-[#ebcfbc] shadow-sm'
                        : 'bg-[#0d0d0d] border-[#26272b] text-[#9c9c9c]'
                    }`}
                  >
                    <UserCheck className="w-3.5 h-3.5" />
                    <span>Fleet Manager</span>
                  </button>
                </div>
              </div>
            )}

            <Button type="submit" variant="primary" size="lg" className="w-full mt-2 font-semibold tracking-wider" isLoading={isLoading}>
              <span>{isRegistering ? 'Create Account & Access' : 'Authorize & Sign In'}</span>
              <ArrowRight className="w-4 h-4 ml-1" />
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
};
