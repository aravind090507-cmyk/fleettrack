import React from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { VehicleActivity } from '../../types';

interface SpeedChartProps {
  data: VehicleActivity[];
  title?: string;
}

export function SpeedChart({ data = [], title = 'Vehicle Speed Distribution (km/h)' }: SpeedChartProps) {
  if (data.length === 0) {
    return (
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col items-center justify-center h-72 text-slate-500 text-xs">
        No speed activity data available.
      </div>
    );
  }

  const chartData = data.slice(0, 8).map((d) => ({
    name: d.registration_number,
    avg_speed: d.avg_speed,
    max_speed: d.max_speed,
  }));

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-sm flex flex-col">
      <h3 className="text-xs font-bold text-white uppercase tracking-wider mb-4">{title}</h3>
      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.4} />
            <XAxis dataKey="name" stroke="#64748b" fontSize={10} tickLine={false} />
            <YAxis stroke="#64748b" fontSize={10} tickLine={false} />
            <Tooltip
              contentStyle={{
                backgroundColor: '#0f172a',
                borderColor: '#334155',
                borderRadius: '8px',
                fontSize: '11px',
                color: '#f8fafc',
              }}
              formatter={(value: any, name: any) => [
                `${value} km/h`,
                name === 'avg_speed' ? 'Avg Speed' : 'Max Speed',
              ]}
            />
            <Bar dataKey="avg_speed" name="avg_speed" fill="#3b82f6" radius={[4, 4, 0, 0]} />
            <Bar dataKey="max_speed" name="max_speed" fill="#06b6d4" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
export default SpeedChart;
