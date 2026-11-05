import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Sparkles, RefreshCw, Cpu, ShieldAlert, Activity } from 'lucide-react';
import { aiService } from '../services/aiService';
import { useVehicles } from '../hooks/useVehicles';
import { ChatInterface } from '../components/ai/ChatInterface';
import { InsightCard } from '../components/ai/InsightCard';
import { AIInsight } from '../types';

export function AIInsightsPage() {
  const navigate = useNavigate();
  const { setSelectedVehicleIds } = useVehicles();
  const [insights, setInsights] = useState<AIInsight[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchInsights = async () => {
    setLoading(true);
    try {
      const res = await aiService.getInsights();
      setInsights(res);
    } catch (err) {
      console.error('Failed to load fleet AI insights:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchInsights();
  }, []);

  const handleInspectVehicle = (vehicleId?: string | null) => {
    if (vehicleId) {
      setSelectedVehicleIds([vehicleId]);
      navigate('/tracking');
    }
  };

  return (
    <div className="space-y-4 h-[calc(100vh-6.5rem)] flex flex-col">
      {/* Top Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-blue-400" />
            <span>AI Fleet Assistant & Operational Insights</span>
          </h1>
          <p className="text-xs text-slate-400">
            Natural language operations assistant backed by strictly scoped telemetry tools and deterministic anomaly detection.
          </p>
        </div>

        <button
          onClick={fetchInsights}
          disabled={loading}
          className="px-3.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-lg text-xs font-semibold flex items-center gap-2 transition-colors disabled:opacity-50 self-start sm:self-auto"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>Refresh Insights</span>
        </button>
      </div>

      {/* Main Split Layout: Chat on Left, Insights Feed on Right */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-4 min-h-0">
        {/* Left: Chat Assistant (7 Cols) */}
        <div className="lg:col-span-7 h-full min-h-[400px]">
          <ChatInterface />
        </div>

        {/* Right: Automated Insights Cards (5 Cols) */}
        <div className="lg:col-span-5 h-full min-h-0 flex flex-col bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-xl">
          <div className="p-4 border-b border-slate-800 bg-slate-900/90 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Cpu className="w-4 h-4 text-cyan-400" />
              <h2 className="text-xs font-bold text-white uppercase tracking-wider">
                Automated Fleet Intelligence
              </h2>
            </div>
            <span className="text-[10px] text-slate-400 font-mono">
              {insights.length} Signals
            </span>
          </div>

          <div className="flex-1 p-4 overflow-y-auto space-y-3">
            {loading ? (
              <div className="py-20 text-center text-xs text-slate-500 space-y-2">
                <RefreshCw className="w-5 h-5 animate-spin mx-auto text-blue-400" />
                <p>Computing deterministic operational alerts & telemetry proofs...</p>
              </div>
            ) : insights.length === 0 ? (
              <div className="py-20 text-center text-xs text-slate-500">
                No active operational anomalies or warnings detected across your fleet.
              </div>
            ) : (
              insights.map((ins) => (
                <InsightCard
                  key={ins.id}
                  insight={ins}
                  onInspect={handleInspectVehicle}
                />
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
export default AIInsightsPage;
