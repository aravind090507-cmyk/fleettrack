import React from 'react';
import { AlertTriangle, Clock, Activity, ShieldCheck, Cpu } from 'lucide-react';
import { AIInsight } from '../../types';
import { formatRelativeTime } from '../../utils/formatters';

interface InsightCardProps {
  insight: AIInsight;
  onInspect?: (vehicleId?: string | null) => void;
}

export function InsightCard({ insight, onInspect }: InsightCardProps) {
  const getIcon = () => {
    switch (insight.insight_type) {
      case 'idle_time_warning':
        return <Clock className="w-4 h-4 text-amber-400" />;
      case 'connectivity_alert':
        return <AlertTriangle className="w-4 h-4 text-red-400" />;
      case 'fleet_utilization':
        return <Activity className="w-4 h-4 text-blue-400" />;
      case 'geofence_activity':
        return <ShieldCheck className="w-4 h-4 text-purple-400" />;
      default:
        return <Cpu className="w-4 h-4 text-cyan-400" />;
    }
  };

  const getBadgeStyle = () => {
    switch (insight.insight_type) {
      case 'idle_time_warning':
        return 'bg-amber-500/10 text-amber-300 border-amber-500/30';
      case 'connectivity_alert':
        return 'bg-red-500/10 text-red-300 border-red-500/30';
      case 'fleet_utilization':
        return 'bg-blue-500/10 text-blue-300 border-blue-500/30';
      case 'geofence_activity':
        return 'bg-purple-500/10 text-purple-300 border-purple-500/30';
      default:
        return 'bg-slate-700 text-slate-300 border-slate-600';
    }
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-sm hover:border-slate-700 transition-colors space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {getIcon()}
          <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded border ${getBadgeStyle()}`}>
            {insight.insight_type.replace(/_/g, ' ')}
          </span>
        </div>
        <span className="text-[10px] text-slate-500 font-mono">
          {formatRelativeTime(insight.created_at)}
        </span>
      </div>

      {/* Description */}
      <p className="text-xs text-slate-200 leading-relaxed">{insight.description}</p>

      {/* Evidence Summary if available */}
      {insight.evidence && (
        <div className="p-2.5 bg-slate-800/60 border border-slate-800 rounded-lg text-[11px] text-slate-400 font-mono">
          <span className="text-slate-500 block text-[10px] uppercase font-semibold mb-0.5">Telemetry Evidence:</span>
          <pre className="text-slate-300 overflow-x-auto whitespace-pre-wrap">
            {typeof insight.evidence === 'string' ? insight.evidence : JSON.stringify(insight.evidence, null, 2)}
          </pre>
        </div>
      )}

      {/* Footer Info */}
      <div className="flex items-center justify-between pt-1 border-t border-slate-800/80 text-[10px] text-slate-500">
        <span className="capitalize flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-cyan-400" />
          {insight.insight_source.replace(/_/g, ' ')}
        </span>
        {insight.vehicle_id && onInspect && (
          <button
            onClick={() => onInspect(insight.vehicle_id)}
            className="text-blue-400 hover:text-blue-300 font-medium"
          >
            Track Vehicle →
          </button>
        )}
      </div>
    </div>
  );
}
export default InsightCard;
