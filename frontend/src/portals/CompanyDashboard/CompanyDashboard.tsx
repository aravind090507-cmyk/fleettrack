import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { Sidebar } from '../../components/layout/Sidebar';
import { Header } from '../../components/layout/Header';
import { Overview } from './pages/Overview';
import { LiveMap } from './pages/LiveMap';
import { Vehicles } from './pages/Vehicles';
import { ActiveJourneys } from './pages/ActiveJourneys';
import { JourneyHistory } from './pages/JourneyHistory';

export const CompanyDashboard: React.FC = () => {
  return (
    <div className="flex h-screen bg-slate-950 text-slate-100 overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <Header title="Fleet Management Console" subtitle="Real-time vehicular navigation and dispatch monitoring" />
        <main className="flex-1 overflow-y-auto p-8">
          <Routes>
            <Route index element={<Overview />} />
            <Route path="live-map" element={<LiveMap />} />
            <Route path="vehicles" element={<Vehicles />} />
            <Route path="journeys" element={<ActiveJourneys />} />
            <Route path="history" element={<JourneyHistory />} />
            <Route path="*" element={<Navigate to="/company" replace />} />
          </Routes>
        </main>
      </div>
    </div>
  );
};
