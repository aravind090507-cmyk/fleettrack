import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { vehicleService, VehicleFilterParams } from '../services/vehicleService';
import { locationService } from '../services/locationService';
import { useVehicleStore } from '../store/vehicleStore';
import { useEffect } from 'react';

export function useVehicles(params?: VehicleFilterParams) {
  const queryClient = useQueryClient();
  const setVehicles = useVehicleStore((state) => state.setVehicles);
  const setLatestLocations = useVehicleStore((state) => state.setLatestLocations);

  const queryKey = ['vehicles', params];

  const vehiclesQuery = useQuery({
    queryKey,
    queryFn: async () => {
      const data = await vehicleService.getVehicles(params);
      return data;
    },
    staleTime: 10000,
  });

  // Also fetch latest locations on load to populate store
  const locationsQuery = useQuery({
    queryKey: ['locations', 'latest'],
    queryFn: async () => {
      const locs = await locationService.getLatestLocations();
      return locs;
    },
    staleTime: 5000,
  });

  useEffect(() => {
    if (vehiclesQuery.data) {
      setVehicles(vehiclesQuery.data);
    }
  }, [vehiclesQuery.data, setVehicles]);

  useEffect(() => {
    if (locationsQuery.data) {
      const map: Record<string, any> = {};
      locationsQuery.data.forEach((loc) => {
        map[loc.vehicle_id] = loc;
      });
      setLatestLocations(map);
    }
  }, [locationsQuery.data, setLatestLocations]);

  const createVehicleMutation = useMutation({
    mutationFn: vehicleService.createVehicle,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vehicles'] });
      queryClient.invalidateQueries({ queryKey: ['fleet-summary'] });
    },
  });

  const updateVehicleMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) =>
      vehicleService.updateVehicle(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vehicles'] });
      queryClient.invalidateQueries({ queryKey: ['fleet-summary'] });
    },
  });

  const deleteVehicleMutation = useMutation({
    mutationFn: vehicleService.deleteVehicle,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vehicles'] });
      queryClient.invalidateQueries({ queryKey: ['fleet-summary'] });
    },
  });

  return {
    vehicles: vehiclesQuery.data || [],
    latestLocations: useVehicleStore((state) => state.latestLocations),
    selectedVehicleIds: useVehicleStore((state) => state.selectedVehicleIds),
    setSelectedVehicleIds: (ids: string[]) => {
      useVehicleStore.setState({ selectedVehicleIds: ids });
    },
    toggleVehicleSelection: useVehicleStore((state) => state.toggleVehicleSelection),
    selectAllVehicles: useVehicleStore((state) => state.selectAll),
    clearVehicleSelection: useVehicleStore((state) => state.clearSelection),
    isLoading: vehiclesQuery.isLoading,
    isError: vehiclesQuery.isError,
    error: vehiclesQuery.error,
    refetch: vehiclesQuery.refetch,
    createVehicle: createVehicleMutation.mutateAsync,
    isCreating: createVehicleMutation.isPending,
    updateVehicle: updateVehicleMutation.mutateAsync,
    isUpdating: updateVehicleMutation.isPending,
    deleteVehicle: deleteVehicleMutation.mutateAsync,
    isDeleting: deleteVehicleMutation.isPending,
  };
}

export default useVehicles;
