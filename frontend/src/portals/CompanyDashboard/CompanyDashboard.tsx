import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { Sidebar } from '../../components/layout/Sidebar';
import { Header } from '../../components/layout/Header';
import { SocketController } from '../../components/SocketController';
import { EventsDrawer } from '../../components/EventsDrawer';
import { Overview } from './pages/Overview';
import { LiveMap } from './pages/LiveMap';
import { Vehicles } from './pages/Vehicles';
import { ActiveJourneys } from './pages/ActiveJourneys';
import { JourneyHistory } from './pages/JourneyHistory';
import { GeofencesPage } from './pages/GeofencesPage';
import { ReportsPage } from './pages/ReportsPage';
import { ReplayPage } from './pages/ReplayPage';

export const CompanyDashboard: React.FC = () => {
  return (
    <div className="flex h-screen bg-[#F2F2F7] text-[#1D1D1F] overflow-hidden font-sans">
      <SocketController />
      <EventsDrawer />
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden bg-[#F2F2F7]">
        <Header title="Fleet Management Console" subtitle="Real-time asset telemetry, geofence surveillance & dispatch intelligence" />
        <main className="flex-1 overflow-y-auto p-6 md:p-8 bg-[#F2F2F7]">
          <Routes>
            <Route index element={<Overview />} />
            <Route path="live-map" element={<LiveMap />} />
            <Route path="vehicles" element={<Vehicles />} />
            <Route path="journeys" element={<ActiveJourneys />} />
            <Route path="history" element={<JourneyHistory />} />
            <Route path="geofences" element={<GeofencesPage />} />
            <Route path="reports" element={<ReportsPage />} />
            <Route path="replay" element={<ReplayPage />} />
            <Route path="*" element={<Navigate to="/company" replace />} />
          </Routes>
        </main>
      </div>
    </div>
  );
};
