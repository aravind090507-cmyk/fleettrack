import React, { useEffect, useState } from 'react';
import { useDriverStore } from '../../store/driverStore';
import { journeysApi } from '../../services/api';
import { DriverLayout } from './DriverLayout';
import { JourneySetup } from './pages/JourneySetup';
import { ActiveJourney } from './pages/ActiveJourney';
import { JourneyCompleted } from './pages/JourneyCompleted';
import { LoadingSpinner } from '../../components/ui/LoadingSpinner';

export const DriverApp: React.FC = () => {
  const { currentJourney, setJourney } = useDriverStore();
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    // Check if driver has an existing active journey on load
    journeysApi
      .getActive()
      .then((activeList) => {
        if (activeList.length > 0) {
          const active = activeList[0];
          // Restore active journey into store
          setJourney(active);
        }
      })
      .catch((err) => {
        console.warn('Failed to fetch active journeys:', err);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [setJourney]);

  if (loading) {
    return (
      <DriverLayout>
        <LoadingSpinner label="Restoring driver session..." fullScreen />
      </DriverLayout>
    );
  }

  return (
    <DriverLayout>
      {currentJourney ? (
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
