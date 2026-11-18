import React, { useEffect, useState } from 'react';
import { useDriverStore } from '../../store/driverStore';
import { journeysApi, driverDispatchApi } from '../../services/api';
import { DriverLayout } from './DriverLayout';
import { JourneySetup } from './pages/JourneySetup';
import { ActiveJourney } from './pages/ActiveJourney';
import { JourneyCompleted } from './pages/JourneyCompleted';
import { AvailabilityDeliveries } from './pages/AvailabilityDeliveries';
import { LoadingSpinner } from '../../components/ui/LoadingSpinner';
import { Navigation, ShieldCheck, Bell } from 'lucide-react';

export const DriverApp: React.FC = () => {
  const { currentJourney, setJourney } = useDriverStore();
  const [loading, setLoading] = useState<boolean>(true);
  const [activeTab, setActiveTab] = useState<'trip' | 'deliveries'>('trip');
  const [hasPendingAssignment, setHasPendingAssignment] = useState<boolean>(false);

  useEffect(() => {
    // Check if driver has an existing active journey on load
    journeysApi
      .getActive()
      .then((activeList) => {
        if (activeList.length > 0) {
          const active = activeList[0];
          const token = (active as any).tracking_token || localStorage.getItem('fleet_active_token') || undefined;
          const trackingUrl = token ? `${window.location.origin}/track/${token}` : undefined;
          // Restore active journey into store with resolved public tracking link
          setJourney(active, trackingUrl, token);
        }
      })
      .catch((err) => {
        console.warn('Failed to fetch active journeys:', err);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [setJourney]);

  // Periodic check for pending delivery assignments to badge the tab
  useEffect(() => {
    const checkPending = async () => {
      try {
        const asg = await driverDispatchApi.getActiveAssignment();
        if (asg && asg.status === 'PENDING') {
          setHasPendingAssignment(true);
        } else {
          setHasPendingAssignment(false);
        }
      } catch {
        // quiet ignore
      }
    };
    checkPending();
    const interval = setInterval(checkPending, 5000);
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <DriverLayout>
        <LoadingSpinner label="Restoring driver session..." fullScreen />
      </DriverLayout>
    );
  }

  return (
    <DriverLayout>
      {/* Top Segmented Navigation Tabs */}
      <div className="mb-4 bg-zinc-200/70 p-1 rounded-2xl flex items-center gap-1 border border-black/[0.04]">
        <button
          type="button"
          onClick={() => setActiveTab('trip')}
          className={`flex-1 py-2 px-3 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
            activeTab === 'trip'
              ? 'bg-white text-zinc-900 shadow-sm'
              : 'text-zinc-600 hover:text-zinc-900 hover:bg-white/40'
          }`}
        >
          <Navigation className="w-3.5 h-3.5" />
          <span>Trip & GPS</span>
          {currentJourney && currentJourney.status !== 'COMPLETED' && (
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse ml-0.5" />
          )}
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('deliveries')}
          className={`flex-1 py-2 px-3 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer relative ${
            activeTab === 'deliveries'
              ? 'bg-white text-zinc-900 shadow-sm'
              : 'text-zinc-600 hover:text-zinc-900 hover:bg-white/40'
          }`}
        >
          <ShieldCheck className="w-3.5 h-3.5" />
          <span>Availability & Deliveries</span>
          {hasPendingAssignment && (
            <span className="flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-amber-500 text-white text-[9px] font-black animate-bounce ml-0.5">
              <Bell className="w-2.5 h-2.5" /> 1
            </span>
          )}
        </button>
      </div>

      {/* Tab Views */}
      {activeTab === 'deliveries' ? (
        <AvailabilityDeliveries onNavigateToTrip={() => setActiveTab('trip')} />
      ) : currentJourney ? (
        currentJourney.status === 'COMPLETED' ? (
          <JourneyCompleted />
        ) : (
          <ActiveJourney />
        )
      ) : (
        <JourneySetup />
      )}
    </DriverLayout>
  );
};
