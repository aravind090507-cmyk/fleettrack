import React, { useEffect, useState, useMemo, useCallback } from 'react';
import {
  Send,
  UserCheck,
  Clock,
  MapPin,
  Search,
  CheckCircle2,
  XCircle,
  Truck,
  AlertCircle,
  ExternalLink,
  RefreshCw,
  X,
  FileText,
  Navigation,
  Info,
} from 'lucide-react';
import { MapContainer, TileLayer, Marker, Popup, useMapEvents, useMap } from 'react-leaflet';
import L from 'leaflet';
import { dispatchApi, locationApi } from '../../../services/api';
import { DeliveryAssignment, DispatchDriverItem } from '../../../types';
import { Card } from '../../../components/ui/Card';
import { Button } from '../../../components/ui/Button';
import { LoadingSpinner } from '../../../components/ui/LoadingSpinner';
import { getMapTileConfig } from '../../../services/mapConfig';
import { useAuthStore } from '../../../store/authStore';

// Custom red destination pin icon matching Apple FleetTrack theme
const destinationPinIcon = L.divIcon({
  html: `
    <div style="width: 36px; height: 36px; background: #FF3B30; border: 3px solid white; border-radius: 50%; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 14px rgba(255,59,48,0.5); transform: translate(-50%, -50%); cursor: grab;">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="white" stroke="none"><polygon points="3 2 19 9 3 16 3 2"/></svg>
    </div>
  `,
  className: 'custom-destination-pin',
  iconSize: [36, 36],
});

// Component to fly map to coordinates
function MapFlyer({ coords }: { coords: [number, number] }) {
  const map = useMap();
  useEffect(() => {
    if (coords && coords[0] && coords[1]) {
      map.flyTo(coords, Math.max(map.getZoom(), 15), { duration: 0.8 });
    }
  }, [coords, map]);
  return null;
}

// Map click listener for Direct Map Selection (Method B)
function MapClickListener({ onMapClick }: { onMapClick: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(e) {
      onMapClick(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

export const DriverDispatchPage: React.FC = () => {
  const [drivers, setDrivers] = useState<DispatchDriverItem[]>([]);
  const [assignments, setAssignments] = useState<DeliveryAssignment[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<'dispatch' | 'monitoring'>('dispatch');

  // Assignment Modal State
  const [selectedDriver, setSelectedDriver] = useState<DispatchDriverItem | null>(null);
  const [destinationAddress, setDestinationAddress] = useState<string>('');
  const [destinationCoords, setDestinationCoords] = useState<[number, number]>([13.0827, 80.2707]);
  const [instructions, setInstructions] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [addressLookupLoading, setAddressLookupLoading] = useState<boolean>(false);
  const [unresolvedAddressNotice, setUnresolvedAddressNotice] = useState<string | null>(null);

  // Method A: Search State
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [searchResults, setSearchResults] = useState<{ display_name: string; lat: number; lon: number }[]>([]);
  const [isSearching, setIsSearching] = useState<boolean>(false);

  const mapTile = useMemo(() => getMapTileConfig('apple'), []);

  // Fetch Drivers and Assignments
  const fetchData = useCallback(async () => {
    try {
      setRefreshing(true);
      const [driversData, asgData] = await Promise.all([
        dispatchApi.getDrivers().catch(() => []),
        dispatchApi.getAssignments().catch(() => []),
      ]);
      setDrivers(driversData);
      setAssignments(asgData);
    } catch (err) {
      console.error('Failed to load dispatch data:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 8000); // 8s auto-refresh polling fallback
    return () => clearInterval(interval);
  }, [fetchData]);

  // Open Assignment Modal
  const handleOpenAssignModal = (driver: DispatchDriverItem) => {
    setSelectedDriver(driver);
    setInstructions('');
    setSearchQuery('');
    setSearchResults([]);
    setUnresolvedAddressNotice(null);

    // Default to city center or current default coordinates
    setDestinationCoords([13.0827, 80.2707]);
    setDestinationAddress('Chennai City Center');
  };

  const handleCloseAssignModal = () => {
    setSelectedDriver(null);
    setIsSubmitting(false);
    setSearchResults([]);
    setSearchQuery('');
  };

  // Method A: Search Location
  const handleAddressSearch = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!searchQuery.trim()) return;

    setIsSearching(true);
    setSearchResults([]);
    setUnresolvedAddressNotice(null);

    try {
      const results = await locationApi.searchPlaces(searchQuery.trim());
      setSearchResults(results);
      if (results.length === 0) {
        setUnresolvedAddressNotice(`No locations found for "${searchQuery}". You can click the map directly.`);
      }
    } catch (err) {
      setUnresolvedAddressNotice('Search service temporarily unavailable. You can click on the map directly.');
    } finally {
      setIsSearching(false);
    }
  };

  // Method A: Select place suggestion
  const handleSelectPlace = (place: { display_name: string; lat: number; lon: number }) => {
    const lat = parseFloat(place.lat.toFixed(6));
    const lon = parseFloat(place.lon.toFixed(6));
    setDestinationCoords([lat, lon]);
    setDestinationAddress(place.display_name);
    setSearchResults([]);
    setSearchQuery('');
    setUnresolvedAddressNotice(null);
  };

  // Method B: Direct Map Click & Marker Drag with Reverse Geocoding
  const handleMapDirectSelection = async (lat: number, lng: number) => {
    const roundLat = parseFloat(lat.toFixed(6));
    const roundLng = parseFloat(lng.toFixed(6));
    setDestinationCoords([roundLat, roundLng]);
    setAddressLookupLoading(true);
    setUnresolvedAddressNotice(null);

    try {
      const res = await locationApi.reverseGeocode(roundLat, roundLng);
      if (res && res.display_name) {
        setDestinationAddress(res.display_name);
      } else {
        setDestinationAddress(`Pinpoint (${roundLat.toFixed(5)}, ${roundLng.toFixed(5)})`);
      }
    } catch (err) {
      console.warn('Reverse geocode lookup warning:', err);
      // Coordinate remains usable even if reverse geocoding lookup fails
      setDestinationAddress(`Coordinates: ${roundLat.toFixed(5)}, ${roundLng.toFixed(5)}`);
      setUnresolvedAddressNotice('Address lookup timed out, but coordinates have been safely locked.');
    } finally {
      setAddressLookupLoading(false);
    }
  };

  // Submit Assignment
  const handleAssignDelivery = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedDriver) return;

    if (!destinationAddress.trim()) {
      alert('Please enter or select a destination address.');
      return;
    }

    try {
      setIsSubmitting(true);
      await dispatchApi.createAssignment({
        driver_id: selectedDriver.id,
        destination_name: destinationAddress.trim(),
        destination_lat: destinationCoords[0],
        destination_lng: destinationCoords[1],
        instructions: instructions.trim() || undefined,
      });

      handleCloseAssignModal();
      await fetchData();
      setActiveTab('monitoring'); // Switch to monitoring tab to view dispatched delivery
    } catch (err: any) {
      console.error('Failed to dispatch delivery:', err);
      const detail = err.response?.data?.detail;
      const msg = typeof detail === 'string' ? detail : JSON.stringify(detail || err.message);
      alert(`Dispatch failed: ${msg}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Cancel Assignment
  const handleCancelAssignment = async (id: string) => {
    if (!window.confirm('Are you sure you want to cancel this delivery assignment?')) return;
    try {
      await dispatchApi.cancelAssignment(id);
      await fetchData();
    } catch (err: any) {
      alert('Failed to cancel assignment: ' + (err.response?.data?.detail || err.message));
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'AVAILABLE':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            AVAILABLE
          </span>
        );
      case 'BUSY':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-amber-50 text-amber-700 border border-amber-200">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
            BUSY
          </span>
        );
      case 'UNAVAILABLE':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-zinc-100 text-zinc-600 border border-zinc-200">
            <span className="w-1.5 h-1.5 rounded-full bg-zinc-400" />
            UNAVAILABLE
          </span>
        );
      case 'PENDING':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-blue-50 text-blue-700 border border-blue-200">
            <Clock className="w-3 h-3 text-blue-500" />
            PENDING
          </span>
        );
      case 'ACCEPTED':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200">
            <CheckCircle2 className="w-3 h-3 text-indigo-500" />
            ACCEPTED
          </span>
        );
      case 'IN_PROGRESS':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-purple-50 text-purple-700 border border-purple-200">
            <Truck className="w-3 h-3 text-purple-500 animate-bounce" />
            IN TRANSIT
          </span>
        );
      case 'COMPLETED':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
            <CheckCircle2 className="w-3 h-3 text-emerald-500" />
            COMPLETED
          </span>
        );
      case 'CANCELLED':
      case 'REJECTED':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-rose-50 text-rose-700 border border-rose-200">
            <XCircle className="w-3 h-3 text-rose-500" />
            {status}
          </span>
        );
      default:
        return (
          <span className="px-2 py-0.5 rounded-md text-[11px] font-semibold bg-zinc-100 text-zinc-700">
            {status}
          </span>
        );
    }
  };

  if (loading) return <LoadingSpinner label="Loading company dispatch console..." />;

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-zinc-900 tracking-tight flex items-center gap-2">
            <Send className="w-5 h-5 text-[#0071E3]" />
            Driver Dispatch & Delivery Management
          </h2>
          <p className="text-xs text-zinc-600 mt-0.5 font-medium">
            Monitor real-time driver availability, dispatch delivery tasks on the interactive map, and supervise execution
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* Tab Selector */}
          <div className="flex bg-black/[0.04] p-1 rounded-xl border border-black/[0.06]">
            <button
              onClick={() => setActiveTab('dispatch')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${
                activeTab === 'dispatch'
                  ? 'bg-white text-zinc-900 shadow-sm'
                  : 'text-zinc-600 hover:text-zinc-900'
              }`}
            >
              Dispatch Drivers
            </button>
            <button
              onClick={() => setActiveTab('monitoring')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 ${
                activeTab === 'monitoring'
                  ? 'bg-white text-zinc-900 shadow-sm'
                  : 'text-zinc-600 hover:text-zinc-900'
              }`}
            >
              <span>Delivery Monitoring</span>
              {assignments.filter((a) => a.status === 'PENDING' || a.status === 'IN_PROGRESS').length > 0 && (
                <span className="w-2 h-2 rounded-full bg-[#0071E3]" />
              )}
            </button>
          </div>

          <Button variant="secondary" size="sm" onClick={fetchData} disabled={refreshing}>
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </Button>
        </div>
      </div>

      {/* TAB 1: DRIVER DISPATCH TABLE */}
      {activeTab === 'dispatch' && (
        <Card title={`Company Fleet Drivers (${drivers.length})`}>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-black/[0.06] text-zinc-500 font-bold uppercase tracking-wider text-[10px]">
                  <th className="pb-3 px-3">Driver Name</th>
                  <th className="pb-3 px-3">Availability</th>
                  <th className="pb-3 px-3">Assigned Vehicle</th>
                  <th className="pb-3 px-3">Current Assignment</th>
                  <th className="pb-3 px-3">Last Updated</th>
                  <th className="pb-3 px-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/[0.04]">
                {drivers.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-zinc-500 font-medium">
                      No drivers registered in your company. Invite drivers using your company invite code.
                    </td>
                  </tr>
                ) : (
                  drivers.map((drv) => (
                    <tr key={drv.id} className="hover:bg-black/[0.015] transition">
                      <td className="py-3.5 px-3">
                        <div className="font-bold text-zinc-900">{drv.name}</div>
                        <div className="text-[11px] text-zinc-500 font-mono">{drv.email}</div>
                      </td>
                      <td className="py-3.5 px-3">{getStatusBadge(drv.availability)}</td>
                      <td className="py-3.5 px-3">
                        {drv.assigned_vehicle_reg ? (
                          <div>
                            <span className="font-mono font-bold text-zinc-900">{drv.assigned_vehicle_reg}</span>
                            <div className="text-[10px] text-zinc-500">{drv.assigned_vehicle_model}</div>
                          </div>
                        ) : (
                          <span className="text-zinc-400 text-[11px] italic">Dynamic pool asset</span>
                        )}
                      </td>
                      <td className="py-3.5 px-3">
                        {drv.current_assignment ? (
                          <div className="max-w-[200px]">
                            <div className="font-semibold text-zinc-900 truncate">
                              {drv.current_assignment.destination_name}
                            </div>
                            <div className="text-[10px] text-zinc-500 flex items-center gap-1">
                              <span>Status:</span>
                              <span className="font-bold uppercase text-[#0071E3]">
                                {drv.current_assignment.status}
                              </span>
                            </div>
                          </div>
                        ) : (
                          <span className="text-zinc-400 text-[11px]">Idle / Standby</span>
                        )}
                      </td>
                      <td className="py-3.5 px-3 text-zinc-500 text-[11px] font-mono">
                        {drv.availability_updated_at
                          ? new Date(drv.availability_updated_at).toLocaleTimeString()
                          : 'Recent'}
                      </td>
                      <td className="py-3.5 px-3 text-right">
                        <Button
                          variant="primary"
                          size="sm"
                          onClick={() => handleOpenAssignModal(drv)}
                          disabled={!drv.can_assign}
                          className="font-bold text-xs"
                        >
                          <Send className="w-3 h-3" />
                          <span>Assign Delivery</span>
                        </Button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* TAB 2: DELIVERY MONITORING TABLE */}
      {activeTab === 'monitoring' && (
        <Card title={`Delivery Assignments Monitor (${assignments.length})`}>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-black/[0.06] text-zinc-500 font-bold uppercase tracking-wider text-[10px]">
                  <th className="pb-3 px-3">Destination</th>
                  <th className="pb-3 px-3">Assigned Driver</th>
                  <th className="pb-3 px-3">Status</th>
                  <th className="pb-3 px-3">Assigned Time</th>
                  <th className="pb-3 px-3">Instructions</th>
                  <th className="pb-3 px-3">Public Tracking</th>
                  <th className="pb-3 px-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/[0.04]">
                {assignments.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-zinc-500 font-medium">
                      No delivery assignments dispatched yet. Click &quot;Dispatch Drivers&quot; to assign a delivery.
                    </td>
                  </tr>
                ) : (
                  assignments.map((asg) => (
                    <tr key={asg.id} className="hover:bg-black/[0.015] transition">
                      <td className="py-3.5 px-3 max-w-[220px]">
                        <div className="font-bold text-zinc-900 truncate" title={asg.destination_name}>
                          {asg.destination_name}
                        </div>
                        <div className="text-[10px] text-zinc-500 font-mono">
                          {asg.destination_lat.toFixed(5)}, {asg.destination_lng.toFixed(5)}
                        </div>
                      </td>
                      <td className="py-3.5 px-3">
                        <div className="font-bold text-zinc-900">{asg.driver_name || 'Driver'}</div>
                        <div className="text-[10px] text-zinc-500">By {asg.manager_name || 'Manager'}</div>
                      </td>
                      <td className="py-3.5 px-3">{getStatusBadge(asg.status)}</td>
                      <td className="py-3.5 px-3 text-zinc-500 text-[11px] font-mono">
                        {new Date(asg.created_at).toLocaleString([], {
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </td>
                      <td className="py-3.5 px-3 max-w-[180px]">
                        <span className="text-zinc-600 line-clamp-1 italic text-[11px]">
                          {asg.instructions || 'Standard delivery'}
                        </span>
                      </td>
                      <td className="py-3.5 px-3">
                        {asg.tracking_url ? (
                          <a
                            href={asg.tracking_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-[11px] font-bold text-[#0071E3] hover:underline"
                          >
                            <span>Live Track</span>
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        ) : asg.status === 'IN_PROGRESS' ? (
                          <span className="text-[11px] text-purple-700 font-semibold">Active Trip</span>
                        ) : (
                          <span className="text-[11px] text-zinc-400">Available on start</span>
                        )}
                      </td>
                      <td className="py-3.5 px-3 text-right">
                        {(asg.status === 'PENDING' || asg.status === 'ACCEPTED') && (
                          <button
                            type="button"
                            onClick={() => handleCancelAssignment(asg.id)}
                            className="px-2.5 py-1 text-xs font-bold text-rose-600 hover:text-rose-700 hover:bg-rose-50 rounded-lg transition"
                          >
                            Cancel
                          </button>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* ==================================================================== */}
      {/* MAP-BASED DELIVERY DESTINATION ASSIGNMENT MODAL                     */}
      {/* ==================================================================== */}
      {selectedDriver && (
        <div className="fixed inset-0 bg-black/45 backdrop-blur-md flex items-center justify-center p-4 z-50 overflow-y-auto">
          <div className="bg-white border border-black/10 rounded-3xl w-full max-w-4xl p-6 sm:p-7 shadow-2xl space-y-5 my-8">
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-black/[0.06] pb-3.5">
              <div>
                <h3 className="text-base font-bold text-zinc-900 flex items-center gap-2">
                  <MapPin className="w-5 h-5 text-[#FF3B30]" />
                  <span>Map-Based Delivery Destination Assignment</span>
                </h3>
                <p className="text-xs text-zinc-500 font-medium mt-0.5">
                  Pinpoint target destination via address search or direct map selection for{' '}
                  <strong className="text-zinc-900">{selectedDriver.name}</strong>
                </p>
              </div>
              <button
                type="button"
                onClick={handleCloseAssignModal}
                className="text-zinc-500 hover:text-zinc-900 p-1 rounded-full hover:bg-black/[0.05] transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleAssignDelivery} className="space-y-4">
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
                {/* Left Form Controls (5 cols) */}
                <div className="lg:col-span-5 space-y-3.5 text-xs">
                  {/* Selected Driver Banner */}
                  <div className="p-3 bg-zinc-50 border border-black/[0.06] rounded-2xl flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-blue-50 text-[#0071E3] flex items-center justify-center font-bold">
                      <UserCheck className="w-4 h-4" />
                    </div>
                    <div>
                      <div className="font-bold text-zinc-900">{selectedDriver.name}</div>
                      <div className="text-[10px] text-zinc-500">
                        {selectedDriver.assigned_vehicle_reg || 'Standard Fleet Pool'} • Ready for Dispatch
                      </div>
                    </div>
                  </div>

                  {/* METHOD A: Address Search Form */}
                  <div className="space-y-1.5">
                    <label className="block text-zinc-800 font-bold uppercase tracking-wider text-[10px]">
                      Method A: Search Destination Address
                    </label>
                    <div className="relative">
                      <input
                        type="text"
                        placeholder="Search street, building, city, hospital..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            handleAddressSearch();
                          }
                        }}
                        className="w-full pl-3 pr-16 py-2 bg-black/[0.03] border border-black/10 rounded-xl text-xs font-semibold text-zinc-900 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-[#0071E3] focus:bg-white"
                      />
                      <button
                        type="button"
                        onClick={() => handleAddressSearch()}
                        disabled={isSearching || !searchQuery.trim()}
                        className="absolute right-1 top-1 bottom-1 px-3 bg-[#0071E3] text-white rounded-lg text-[10px] font-bold hover:bg-blue-600 disabled:opacity-50 transition"
                      >
                        {isSearching ? '...' : 'Search'}
                      </button>
                    </div>

                    {/* Search Suggestions Dropdown */}
                    {searchResults.length > 0 && (
                      <div className="border border-black/10 rounded-xl bg-white shadow-xl overflow-hidden max-h-40 overflow-y-auto divide-y divide-black/[0.04]">
                        {searchResults.map((place, idx) => (
                          <button
                            key={idx}
                            type="button"
                            onClick={() => handleSelectPlace(place)}
                            className="w-full text-left px-3 py-2 hover:bg-black/[0.04] transition text-xs flex items-start gap-2"
                          >
                            <MapPin className="w-3.5 h-3.5 text-[#FF3B30] mt-0.5 flex-shrink-0" />
                            <div className="min-w-0">
                              <div className="font-bold text-zinc-900 truncate">
                                {place.display_name.split(',')[0]}
                              </div>
                              <div className="text-[10px] text-zinc-500 truncate">{place.display_name}</div>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Confirmed Address Field (Synchronized) */}
                  <div className="space-y-1">
                    <label className="block text-zinc-800 font-bold uppercase tracking-wider text-[10px]">
                      Confirmed Destination Address *
                    </label>
                    <textarea
                      rows={2}
                      required
                      value={destinationAddress}
                      onChange={(e) => setDestinationAddress(e.target.value)}
                      placeholder="Selected destination address will appear here..."
                      className="w-full px-3 py-2 bg-black/[0.03] border border-black/10 rounded-xl text-xs font-semibold text-zinc-900 focus:outline-none focus:ring-2 focus:ring-[#0071E3] focus:bg-white resize-none"
                    />
                    {addressLookupLoading && (
                      <p className="text-[10px] text-[#0071E3] font-medium flex items-center gap-1">
                        <RefreshCw className="w-2.5 h-2.5 animate-spin" />
                        Resolving street address from coordinates...
                      </p>
                    )}
                    {unresolvedAddressNotice && (
                      <p className="text-[10px] text-amber-600 font-medium flex items-center gap-1">
                        <AlertCircle className="w-3 h-3 flex-shrink-0" />
                        <span>{unresolvedAddressNotice}</span>
                      </p>
                    )}
                  </div>

                  {/* Synchronized Latitude / Longitude */}
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-zinc-700 font-bold uppercase tracking-wider text-[9px] mb-0.5">
                        Latitude
                      </label>
                      <input
                        type="number"
                        step="any"
                        required
                        value={destinationCoords[0]}
                        onChange={(e) => {
                          const val = parseFloat(e.target.value);
                          if (!isNaN(val)) setDestinationCoords([val, destinationCoords[1]]);
                        }}
                        className="w-full px-2.5 py-1.5 bg-black/[0.03] border border-black/10 rounded-xl text-zinc-900 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-[#0071E3] focus:bg-white"
                      />
                    </div>
                    <div>
                      <label className="block text-zinc-700 font-bold uppercase tracking-wider text-[9px] mb-0.5">
                        Longitude
                      </label>
                      <input
                        type="number"
                        step="any"
                        required
                        value={destinationCoords[1]}
                        onChange={(e) => {
                          const val = parseFloat(e.target.value);
                          if (!isNaN(val)) setDestinationCoords([destinationCoords[0], val]);
                        }}
                        className="w-full px-2.5 py-1.5 bg-black/[0.03] border border-black/10 rounded-xl text-zinc-900 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-[#0071E3] focus:bg-white"
                      />
                    </div>
                  </div>

                  {/* Delivery Instructions */}
                  <div>
                    <label className="block text-zinc-800 font-bold uppercase tracking-wider text-[10px] mb-1">
                      Delivery Instructions (Optional)
                    </label>
                    <textarea
                      rows={2}
                      placeholder="e.g. Ring loading bay buzzer; leave invoice at Gate 2..."
                      value={instructions}
                      onChange={(e) => setInstructions(e.target.value)}
                      className="w-full px-3 py-2 bg-black/[0.03] border border-black/10 rounded-xl text-zinc-900 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-[#0071E3] focus:bg-white resize-none"
                    />
                  </div>
                </div>

                {/* Right Interactive Map (7 cols) */}
                <div className="lg:col-span-7 flex flex-col">
                  <div className="flex items-center justify-between pb-1.5 text-xs font-bold text-zinc-800">
                    <span className="flex items-center gap-1.5">
                      <Navigation className="w-3.5 h-3.5 text-[#0071E3]" />
                      <span>Method B: Click map or drag red pin to set location</span>
                    </span>
                    <span className="text-[10px] text-zinc-500 font-mono">
                      {destinationCoords[0].toFixed(5)}, {destinationCoords[1].toFixed(5)}
                    </span>
                  </div>

                  <div className="h-[380px] w-full rounded-2xl overflow-hidden border border-black/10 relative shadow-inner">
                    <MapContainer center={destinationCoords} zoom={14} className="w-full h-full">
                      <TileLayer
                        attribution={mapTile.attribution}
                        url={mapTile.url}
                        maxZoom={mapTile.maxZoom}
                        tileSize={mapTile.tileSize}
                        className={mapTile.className}
                      />

                      <MapFlyer coords={destinationCoords} />

                      {/* Click anywhere on map to position pin */}
                      <MapClickListener onMapClick={handleMapDirectSelection} />

                      {/* Draggable Destination Marker */}
                      <Marker
                        position={destinationCoords}
                        draggable={true}
                        icon={destinationPinIcon}
                        eventHandlers={{
                          dragend: (e) => {
                            const marker = e.target;
                            const pos = marker.getLatLng();
                            handleMapDirectSelection(pos.lat, pos.lng);
                          },
                        }}
                      >
                        <Popup>
                          <div className="p-1 text-xs">
                            <strong className="text-zinc-900">Destination Point</strong>
                            <p className="text-[11px] text-zinc-600 line-clamp-2 mt-0.5">
                              {destinationAddress || 'Custom coordinate'}
                            </p>
                            <p className="text-[10px] text-rose-600 font-semibold mt-1">
                              Drag pin or click map to move
                            </p>
                          </div>
                        </Popup>
                      </Marker>
                    </MapContainer>
                  </div>
                </div>
              </div>

              {/* Modal Action Buttons */}
              <div className="flex justify-end gap-2.5 pt-3 border-t border-black/[0.06]">
                <Button type="button" variant="secondary" size="sm" onClick={handleCloseAssignModal}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  size="sm"
                  disabled={isSubmitting || !destinationAddress.trim()}
                  className="font-bold px-5"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>{isSubmitting ? 'Dispatching...' : 'Assign Delivery to Driver'}</span>
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
