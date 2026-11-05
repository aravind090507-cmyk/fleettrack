import React from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/Card';
import { formatRelativeTime } from '../../utils/formatters';
import { Activity, AlertTriangle, ArrowRight, CheckCircle, Navigation, ShieldAlert, Wrench } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export interface ActivityEvent {
  id: string;
  type: string;
  message: string;
  vehicle_id?: string;
  registration_number?: string;
  timestamp: string;
  severity?: 'info' | 'warning' | 'critical' | 'success';
}

interface RecentActivityProps {
  events?: ActivityEvent[];
  isLoading?: boolean;
}

export function RecentActivity({ events = [], isLoading = false }: RecentActivityProps) {
  const navigate = useNavigate();

  const getEventIcon = (type: string, severity?: string) => {
    switch (type.toLowerCase()) {
      case 'geofence_enter':
      case 'geofence_exit':
      case 'geofence':
        return <ShieldAlert className="w-4 h-4 text-purple-400" />;
      case 'speeding':
      case 'overspeed':
        return <AlertTriangle className="w-4 h-4 text-amber-400" />;
      case 'maintenance':
        return <Wrench className="w-4 h-4 text-rose-400" />;
      case 'trip_completed':
        return <CheckCircle className="w-4 h-4 text-emerald-400" />;
      default:
        return <Navigation className="w-4 h-4 text-blue-400" />;
    }
  };

  const getSeverityBadgeClass = (severity?: string) => {
    switch (severity) {
      case 'critical':
      case 'warning':
        return 'bg-amber-950/40 border-amber-800/60 text-amber-300';
      case 'success':
        return 'bg-emerald-950/40 border-emerald-800/60 text-emerald-300';
      default:
        return 'bg-slate-800 border-slate-700 text-slate-300';
    }
  };

  return (
    <Card className="h-full flex flex-col">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-blue-400" />
          <CardTitle>Recent Fleet Activity</CardTitle>
        </div>
        <button
          onClick={() => navigate('/analytics')}
          className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1 font-medium"
        >
          <span>View All</span>
          <ArrowRight className="w-3 h-3" />
        </button>
      </CardHeader>

      <CardContent className="flex-1 overflow-y-auto p-0">
        {isLoading ? (
          <div className="p-8 text-center text-slate-500 text-xs">
            Loading activity stream...
          </div>
        ) : events.length === 0 ? (
          <div className="p-8 text-center text-slate-400">
            <Activity className="w-8 h-8 mx-auto mb-2 opacity-40 text-slate-500" />
            <p className="text-sm font-medium">No recent events recorded</p>
            <p className="text-xs text-slate-500 mt-1">Fleet activities and telemetry alerts will appear here in real-time.</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-700/50">
            {events.map((event) => (
              <div
                key={event.id}
                onClick={() => {
                  if (event.vehicle_id) {
                    navigate(`/live-tracking?vehicleId=${event.vehicle_id}`);
                  }
                }}
                className="p-4 hover:bg-slate-750/50 transition-colors cursor-pointer flex items-start gap-3"
              >
                <div className="p-2 rounded-lg bg-slate-800 border border-slate-700 flex-shrink-0 mt-0.5">
                  {getEventIcon(event.type, event.severity)}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-white text-xs truncate">
                      {event.registration_number || 'Fleet Event'}
                    </span>
                    <span className="text-[11px] text-slate-400 whitespace-nowrap">
                      {formatRelativeTime(event.timestamp)}
                    </span>
                  </div>
                  <p className="text-xs text-slate-300 mt-0.5 line-clamp-2 leading-relaxed">
                    {event.message}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default RecentActivity;
