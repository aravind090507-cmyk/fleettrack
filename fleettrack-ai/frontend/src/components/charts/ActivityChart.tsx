import React from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from 'recharts';
import { FleetSummary } from '../../types';

interface ActivityChartProps {
  summary?: FleetSummary | null;
  title?: string;
}

export function ActivityChart({ summary, title = 'Fleet Status Breakdown' }: ActivityChartProps) {
  if (!summary) {
    return (
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col items-center justify-center h-72 text-slate-500 text-xs">
        Loading activity summary...
      </div>
    );
  }

  const data = [
    { name: 'Moving', value: summary.moving_vehicles, color: '#10b981' },
    { name: 'Idle', value: summary.idle_vehicles, color: '#f59e0b' },
    { name: 'Offline', value: summary.offline_vehicles, color: '#ef4444' },
    { name: 'Maintenance', value: summary.maintenance_vehicles, color: '#8b5cf6' },
  ].filter((d) => d.value > 0);

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-sm flex flex-col">
      <h3 className="text-xs font-bold text-white uppercase tracking-wider mb-2">{title}</h3>
      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              cx="50%"
              cy="50%"
              innerRadius={55}
              outerRadius={80}
              paddingAngle={4}
              dataKey="value"
            >
              {data.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={entry.color} />
              ))}
            </Pie>
            <Tooltip
              contentStyle={{
                backgroundColor: '#0f172a',
                borderColor: '#334155',
                borderRadius: '8px',
                fontSize: '11px',
                color: '#f8fafc',
              }}
              formatter={(value: any, name: any) => [`${value} Vehicles`, name]}
            />
            <Legend
              verticalAlign="bottom"
              height={36}
              formatter={(value) => <span className="text-slate-300 text-xs">{value}</span>}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
export default ActivityChart;
