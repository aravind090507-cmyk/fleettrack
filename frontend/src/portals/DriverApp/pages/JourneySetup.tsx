import React, { useState, useEffect, useMemo } from 'react';
import {
  Truck,
  MapPin,
  Navigation,
  Play,
  AlertCircle,
  Plus,
  Crosshair,
  Search,
  SlidersHorizontal,
  Compass,
  Check,
  Building,
  ChevronDown,
  Layers,
} from 'lucide-react';
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMapEvents, useMap } from 'react-leaflet';
import L from 'leaflet';
import { Vehicle } from '../../../types';
import { vehiclesApi, journeysApi, locationApi } from '../../../services/api';
import { useDriverStore } from '../../../store/driverStore';
import { useAuthStore } from '../../../store/authStore';
import { Button } from '../../../components/ui/Button';
import { Card } from '../../../components/ui/Card';
import { getMapTileConfig } from '../../../services/mapConfig';

// Marker Icons for Start and End Pins
const startPinIcon = L.divIcon({
  html: `
    <div style="width: 32px; height: 32px; background: #10b981; border: 3px solid white; border-radius: 50%; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 10px rgba(0,0,0,0.6); transform: translate(-50%, -50%);">
      <div style="width: 10px; height: 10px; background: white; border-radius: 50%;"></div>
    </div>
  `,
  className: 'custom-start-pin',
  iconSize: [32, 32],
});

const destPinIcon = L.divIcon({
  html: `
    <div style="width: 32px; height: 32px; background: #ef4444; border: 3px solid white; border-radius: 50%; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 10px rgba(0,0,0,0.6); transform: translate(-50%, -50%);">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="white" stroke="none"><polygon points="3 2 19 9 3 16 3 2"/></svg>
    </div>
  `,
  className: 'custom-dest-pin',
  iconSize: [32, 32],
});

// Component to handle map clicks and drop pins
function MapClickHandler({
  pinningMode,
  onPinPlaced,
}: {
  pinningMode: 'origin' | 'destination';
  onPinPlaced: (mode: 'origin' | 'destination', lat: number, lng: number) => void;
}) {
  useMapEvents({
    click(e) {
      onPinPlaced(pinningMode, e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

// Center map to coords with smooth fly animation
function MapCenterer({ coords }: { coords: [number, number] }) {
  const map = useMap();
  useEffect(() => {
    map.flyTo(coords, Math.max(map.getZoom(), 17), { duration: 0.8 });
  }, [coords, map]);
  return null;
}

// Haversine distance in meters
function computeMeters(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371000; // meters
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c * 10) / 10;
}

interface PlaceSearchResult {
  display_name: string;
  lat: number;
  lon: number;
  type: string;
}

export const JourneySetup: React.FC = () => {
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [selectedVehicleId, setSelectedVehicleId] = useState<string>('');

  // Pin Placement Method Dropdown State: 'tap' | 'search' | 'coords'
  const [placementMode, setPlacementMode] = useState<'tap' | 'search' | 'coords'>('tap');

  // Vehicle Selection Mode: 'picker' | 'custom'
  const [vehicleInputMode, setVehicleInputMode] = useState<'picker' | 'custom'>('picker');
  const [customPlate, setCustomPlate] = useState<string>('');
  const [customModel, setCustomModel] = useState<string>('');
  const [customType, setCustomType] = useState<string>('VAN');

  // Interactive Pinning Coordinates
  const [originCoords, setOriginCoords] = useState<[number, number]>([12.9716, 77.5946]);
  const [destCoords, setDestCoords] = useState<[number, number]>([12.9717, 77.5947]);
  const [originName, setOriginName] = useState<string>('My Starting Location');
  const [destinationName, setDestinationName] = useState<string>('Destination Point');
  const [pinningMode, setPinningMode] = useState<'origin' | 'destination'>('destination');
  const [description, setDescription] = useState<string>('');

  // Map view target
  const [mapTarget, setMapTarget] = useState<[number, number]>([12.9716, 77.5946]);

  // Location Search State
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [searchTarget, setSearchTarget] = useState<'origin' | 'destination'>('destination');
  const [searchResults, setSearchResults] = useState<PlaceSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState<boolean>(false);
  const [searchSuccessMessage, setSearchSuccessMessage] = useState<string | null>(null);

  // Manual Coordinates Input State
  const [startLatInput, setStartLatInput] = useState<string>('12.971600');
  const [startLngInput, setStartLngInput] = useState<string>('77.594600');
  const [destLatInput, setDestLatInput] = useState<string>('12.971700');
  const [destLngInput, setDestLngInput] = useState<string>('77.594700');

  // Quick Add Vehicle Modal state
  const [showAddVehicle, setShowAddVehicle] = useState(false);
  const [newPlate, setNewPlate] = useState('');
  const [newModel, setNewModel] = useState('');
  const [newType, setNewType] = useState('CAR');

  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const { setJourney } = useDriverStore();
  const { user } = useAuthStore();
  const [driverName, setDriverName] = useState<string>(user?.name || '');
  const [driverPhone, setDriverPhone] = useState<string>('');

  useEffect(() => {
    if (user?.name && !driverName) {
      setDriverName(user.name);
    }
  }, [user]);

  const loadVehicles = () => {
    vehiclesApi
      .list('AVAILABLE')
      .then((res) => {
        setVehicles(res.items);
        if (res.items.length > 0 && !selectedVehicleId) {
          setSelectedVehicleId(res.items[0].id);
        }
      })
      .catch((err) => console.error('Failed to load vehicles:', err));
  };

  useEffect(() => {
    loadVehicles();

    // Acquire current GPS to center the start pin immediately
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const lat = parseFloat(pos.coords.latitude.toFixed(6));
          const lng = parseFloat(pos.coords.longitude.toFixed(6));
          setOriginCoords([lat, lng]);
          setStartLatInput(lat.toString());
          setStartLngInput(lng.toString());

          // Default destination ~10 meters east
          const destLat = lat;
          const destLng = parseFloat((lng + 0.0001).toFixed(6));
          setDestCoords([destLat, destLng]);
          setDestLatInput(destLat.toString());
          setDestLngInput(destLng.toString());

          setMapTarget([lat, lng]);
          setOriginName((prev) => (prev === 'My Starting Location' ? 'Current Office Location' : prev));
          setDestinationName((prev) => (prev === 'Destination Point' ? '10m Walk Endpoint' : prev));
        },
        (err) => console.warn('Could not auto-acquire GPS on setup:', err)
      );
    }
  }, []);

  const distanceMeters = useMemo(() => {
    return computeMeters(originCoords[0], originCoords[1], destCoords[0], destCoords[1]);
  }, [originCoords, destCoords]);

  // Sync manual inputs when map coords change
  const syncManualInputs = (orig: [number, number], dest: [number, number]) => {
    setStartLatInput(orig[0].toFixed(6));
    setStartLngInput(orig[1].toFixed(6));
    setDestLatInput(dest[0].toFixed(6));
    setDestLngInput(dest[1].toFixed(6));
  };

  const handleUseCurrentLocation = () => {
    if (!navigator.geolocation) {
      setError('Geolocation is not supported by your browser.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = parseFloat(pos.coords.latitude.toFixed(6));
        const lng = parseFloat(pos.coords.longitude.toFixed(6));
        setOriginCoords([lat, lng]);
        setStartLatInput(lat.toString());
        setStartLngInput(lng.toString());
        setMapTarget([lat, lng]);
        setOriginName('Current GPS Location');
        setPinningMode('destination'); // Switch to let user tap destination next
      },
      (err) => {
        setError('Location error: ' + err.message);
      },
      { enableHighAccuracy: true }
    );
  };

  const handlePinPlaced = (mode: 'origin' | 'destination', lat: number, lng: number) => {
    const roundLat = parseFloat(lat.toFixed(6));
    const roundLng = parseFloat(lng.toFixed(6));

    if (mode === 'origin') {
      const newOrigin: [number, number] = [roundLat, roundLng];
      setOriginCoords(newOrigin);
      setStartLatInput(roundLat.toString());
      setStartLngInput(roundLng.toString());
      setOriginName(`Start (${roundLat.toFixed(5)}, ${roundLng.toFixed(5)})`);
      setPinningMode('destination');
    } else {
      const newDest: [number, number] = [roundLat, roundLng];
      setDestCoords(newDest);
      setDestLatInput(roundLat.toString());
      setDestLngInput(roundLng.toString());
      setDestinationName(`Goal (${roundLat.toFixed(5)}, ${roundLng.toFixed(5)})`);
    }
  };

  // Perform Location Search via Nominatim Geocoder
  const handleLocationSearch = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!searchQuery.trim()) return;

    setIsSearching(true);
    setError(null);
    setSearchSuccessMessage(null);

    try {
      const results = await locationApi.searchPlaces(searchQuery.trim());
      setSearchResults(results);
      if (results.length === 0) {
        setError('No locations found matching "' + searchQuery + '". Try another place name or coordinates.');
      }
    } catch (err: any) {
      console.warn('Location search error:', err);
      setError('Search lookup failed. You can also drop a pin on the map or enter coordinates.');
    } finally {
      setIsSearching(false);
    }
  };

  // Select place from search suggestions
  const handleSelectPlace = (place: PlaceSearchResult) => {
    const lat = parseFloat(place.lat.toFixed(6));
    const lon = parseFloat(place.lon.toFixed(6));

    if (searchTarget === 'origin') {
      setOriginCoords([lat, lon]);
      setStartLatInput(lat.toString());
      setStartLngInput(lon.toString());
      setOriginName(place.display_name.split(',')[0] || place.display_name);
      setSearchSuccessMessage(`✓ Start Pin placed at: ${place.display_name.split(',')[0]}`);
    } else {
      setDestCoords([lat, lon]);
      setDestLatInput(lat.toString());
      setDestLngInput(lon.toString());
      setDestinationName(place.display_name.split(',')[0] || place.display_name);
      setSearchSuccessMessage(`✓ Goal Pin placed at: ${place.display_name.split(',')[0]}`);
    }

    setMapTarget([lat, lon]);
    setSearchResults([]);
    setSearchQuery('');
  };

  // Apply manual coordinates to Start Pin
  const handleApplyStartCoords = () => {
    const lat = parseFloat(startLatInput);
    const lng = parseFloat(startLngInput);
    if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      setError('Please enter valid Start coordinates (Lat: -90 to 90, Lng: -180 to 180)');
      return;
    }
    setError(null);
    setOriginCoords([lat, lng]);
    setMapTarget([lat, lng]);
    setOriginName(`Start (${lat.toFixed(5)}, ${lng.toFixed(5)})`);
  };

  // Apply manual coordinates to Goal Pin
  const handleApplyDestCoords = () => {
    const lat = parseFloat(destLatInput);
    const lng = parseFloat(destLngInput);
    if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      setError('Please enter valid Goal coordinates (Lat: -90 to 90, Lng: -180 to 180)');
      return;
    }
    setError(null);
    setDestCoords([lat, lng]);
    setMapTarget([lat, lng]);
    setDestinationName(`Goal (${lat.toFixed(5)}, ${lng.toFixed(5)})`);
  };

  const handleCreateNewVehicle = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPlate || !newModel) return;
    try {
      const v = await vehiclesApi.create({
        registration_number: newPlate,
        model: newModel,
        vehicle_type: newType as any,
      });
      setShowAddVehicle(false);
      setNewPlate('');
      setNewModel('');
      loadVehicles();
      setSelectedVehicleId(v.id);
    } catch (err: any) {
      alert('Failed to add vehicle: ' + (err.response?.data?.detail || err.message));
    }
  };

  const handleStartJourney = async (e: React.FormEvent) => {
    e.preventDefault();
    if (vehicleInputMode === 'picker' && !selectedVehicleId && vehicles.length > 0) {
      setSelectedVehicleId(vehicles[0].id);
    }
    setError(null);
    setIsLoading(true);

    try {
      let finalOriginLat = originCoords[0];
      let finalOriginLng = originCoords[1];
      let finalDestLat = destCoords[0];
      let finalDestLng = destCoords[1];

      // If user typed coordinates in manual coords mode, respect inputs directly
      if (placementMode === 'coords') {
        const parsedStartLat = parseFloat(startLatInput);
        const parsedStartLng = parseFloat(startLngInput);
        const parsedDestLat = parseFloat(destLatInput);
        const parsedDestLng = parseFloat(destLngInput);
        if (!isNaN(parsedStartLat) && !isNaN(parsedStartLng)) {
          finalOriginLat = parsedStartLat;
          finalOriginLng = parsedStartLng;
        }
        if (!isNaN(parsedDestLat) && !isNaN(parsedDestLng)) {
          finalDestLat = parsedDestLat;
          finalDestLng = parsedDestLng;
        }
      }

      const payload: any = {
        driver_name: driverName.trim() || user?.name || 'Assigned Driver',
        driver_phone: driverPhone.trim(),
        origin_name: originName,
        origin_lat: finalOriginLat,
        origin_lng: finalOriginLng,
        destination_name: destinationName,
        destination_lat: finalDestLat,
        destination_lng: finalDestLng,
        description,
      };

      if (vehicleInputMode === 'custom' || selectedVehicleId === 'custom' || !selectedVehicleId || vehicles.length === 0) {
        if (!customPlate.trim()) {
          setError('Please enter a vehicle registration number');
          setIsLoading(false);
          return;
        }
        payload.vehicle_registration = customPlate.trim().toUpperCase();
        payload.vehicle_model = customModel.trim() || 'Fleet Vehicle';
        payload.vehicle_type = customType;
      } else {
        payload.vehicle_id = selectedVehicleId;
      }

      const res = await journeysApi.start(payload);

      const newJourney = {
        id: res.journey_id,
        vehicle_id: res.vehicle_id || payload.vehicle_id || '',
        driver_id: res.driver_id || '',
        origin_name: res.origin_name || originName,
        origin_lat: res.origin_lat ?? finalOriginLat,
        origin_lng: res.origin_lng ?? finalOriginLng,
        destination_name: res.destination_name || destinationName,
        destination_lat: res.destination_lat ?? finalDestLat,
        destination_lng: res.destination_lng ?? finalDestLng,
        status: 'IN_PROGRESS' as const,
        description: res.description ?? description,
        total_distance_km: 0,
        duration_seconds: 0,
        started_at: res.started_at,
        created_at: res.started_at,
        vehicle_registration: res.vehicle_registration,
        driver_name: res.driver_name,
      };

      const trackingUrl = `${window.location.origin}/track/${res.tracking_token}`;
      setJourney(newJourney, trackingUrl, res.tracking_token);
    } catch (err: any) {
      if (err.response?.status === 409) {
        // Automatically restore active journey if one was already running
        try {
          const activeList = await journeysApi.getActive();
          if (activeList && activeList.length > 0) {
            const active = activeList[0];
            const token = (active as any).tracking_token || active.id;
            const trackingUrl = `${window.location.origin}/track/${token}`;
            setJourney(active, trackingUrl, token);
            return;
          }
        } catch {}
      }
      setError(err.response?.data?.detail || 'Failed to start journey. Check network.');
    } finally {
      setIsLoading(false);
    }
  };

  const mapTile = useMemo(() => getMapTileConfig('apple'), []);

  return (
    <div className="space-y-4">
      {/* Header Banner */}
      <div className="bg-white/85 p-5 rounded-3xl border border-black/[0.06] shadow-sm">
        <h2 className="text-base font-bold text-zinc-900 tracking-tight flex items-center gap-2">
          <Navigation className="w-5 h-5 text-[#0071E3]" />
          <span>Interactive Dispatch Setup</span>
        </h2>
        <p className="text-xs text-zinc-600 mt-1 font-medium">
          Select your Start and Goal pins using Map Tap, Location Search, or Coordinates (calibrated to 5–10m).
        </p>
      </div>

      {error && (
        <div className="p-3.5 rounded-2xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center gap-2 font-medium">
          <AlertCircle className="w-4 h-4 flex-shrink-0 text-rose-600" />
          <span>{error}</span>
        </div>
      )}

      {/* Driver Identity & Details Input */}
      <Card title="Driver Profile & Identification">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
          <div>
            <label className="block text-[11px] font-bold text-zinc-800 uppercase tracking-wider mb-1">
              Driver Full Name *
            </label>
            <input
              type="text"
              required
              placeholder="e.g. Alex Rivera"
              value={driverName}
              onChange={(e) => setDriverName(e.target.value)}
              className="w-full px-3.5 py-2.5 bg-black/[0.03] border border-black/10 rounded-2xl text-xs text-zinc-900 font-semibold focus:outline-none focus:ring-2 focus:ring-[#0071E3] focus:bg-white"
            />
          </div>
          <div>
            <label className="block text-[11px] font-bold text-zinc-800 uppercase tracking-wider mb-1">
              Driver Phone / Radio (Optional)
            </label>
            <input
              type="tel"
              placeholder="e.g. +91 98765 43210"
              value={driverPhone}
              onChange={(e) => setDriverPhone(e.target.value)}
              className="w-full px-3.5 py-2.5 bg-black/[0.03] border border-black/10 rounded-2xl text-xs text-zinc-900 font-semibold focus:outline-none focus:ring-2 focus:ring-[#0071E3] focus:bg-white"
            />
          </div>
        </div>
      </Card>

      {/* Vehicle Asset Picker & Direct Input */}
      <Card
        title="Vehicle Unit"
        action={
          <div className="flex items-center gap-1 bg-black/[0.04] p-1 rounded-2xl border border-black/5 text-xs font-semibold">
            <button
              type="button"
              onClick={() => setVehicleInputMode('custom')}
              className={`px-3 py-1 rounded-xl transition cursor-pointer uppercase tracking-wider ${
                vehicleInputMode === 'custom'
                  ? 'bg-white text-zinc-900 shadow-sm font-bold'
                  : 'text-zinc-600 hover:text-zinc-900'
              }`}
            >
              ✏️ Enter Details
            </button>
            <button
              type="button"
              onClick={() => setVehicleInputMode('picker')}
              className={`px-3 py-1 rounded-xl transition cursor-pointer uppercase tracking-wider ${
                vehicleInputMode === 'picker'
                  ? 'bg-white text-zinc-900 shadow-sm font-bold'
                  : 'text-zinc-600 hover:text-zinc-900'
              }`}
            >
              📋 Fleet List
            </button>
          </div>
        }
      >
        {vehicleInputMode === 'picker' && vehicles.length > 0 ? (
          <div className="space-y-2">
            <select
              value={selectedVehicleId}
              onChange={(e) => {
                if (e.target.value === 'custom') {
                  setVehicleInputMode('custom');
                } else {
                  setSelectedVehicleId(e.target.value);
                }
              }}
              className="w-full px-3.5 py-2.5 bg-black/[0.03] border border-black/10 rounded-2xl text-zinc-900 text-xs focus:outline-none focus:ring-2 focus:ring-[#0071E3] focus:bg-white font-semibold cursor-pointer"
            >
              <option value="custom">✏️ + Enter Custom Vehicle (Plate No & Model)...</option>
              {vehicles.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.registration_number} — {v.model} ({v.vehicle_type})
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => setVehicleInputMode('custom')}
              className="text-xs text-[#0071E3] hover:underline block font-semibold cursor-pointer"
            >
              ✏️ Need custom plate or personal vehicle? Click here to type details &rarr;
            </button>
          </div>
        ) : (
          <div className="space-y-3 pt-1">
            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label className="block text-[11px] font-bold text-zinc-800 uppercase tracking-wider mb-1">
                  Plate / Registration *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. KA-01-AB-1234"
                  value={customPlate}
                  onChange={(e) => setCustomPlate(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-black/[0.03] border border-black/10 rounded-2xl text-xs text-zinc-900 uppercase font-mono font-bold focus:outline-none focus:ring-2 focus:ring-[#0071E3] focus:bg-white"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-zinc-800 uppercase tracking-wider mb-1">
                  Vehicle Type
                </label>
                <select
                  value={customType}
                  onChange={(e) => setCustomType(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-black/[0.03] border border-black/10 rounded-2xl text-xs text-zinc-900 font-semibold focus:outline-none focus:ring-2 focus:ring-[#0071E3] focus:bg-white cursor-pointer"
                >
                  <option value="VAN">Van</option>
                  <option value="TRUCK">Truck</option>
                  <option value="CAR">Car</option>
                  <option value="MOTORCYCLE">Motorcycle / Bike</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-bold text-zinc-800 uppercase tracking-wider mb-1">
                Model / Vehicle Name
              </label>
              <input
                type="text"
                placeholder="e.g. Delivery Van or Mercedes Sprinter"
                value={customModel}
                onChange={(e) => setCustomModel(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-black/[0.03] border border-black/10 rounded-2xl text-xs text-zinc-900 font-semibold focus:outline-none focus:ring-2 focus:ring-[#0071E3] focus:bg-white"
              />
            </div>

            {vehicles.length > 0 && (
              <button
                type="button"
                onClick={() => setVehicleInputMode('picker')}
                className="text-xs text-zinc-600 hover:text-zinc-900 hover:underline block font-semibold cursor-pointer"
              >
                &larr; Switch back to fleet vehicle list
              </button>
            )}
          </div>
        )}
      </Card>

      {/* Pin Selection Mode Dropdown Card */}
      <Card title="Pin Placement Method">
        <div className="space-y-3.5">
          {/* The Dropdown Menu */}
          <div className="relative">
            <label className="block text-[11px] font-bold text-zinc-800 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5 text-[#0071E3]" />
              <span>Choose Pin Placement Tool</span>
            </label>
            <div className="relative">
              <select
                value={placementMode}
                onChange={(e) => setPlacementMode(e.target.value as any)}
                className="w-full px-3.5 py-2.5 bg-white border border-black/10 rounded-2xl text-zinc-900 text-xs font-bold focus:outline-none focus:ring-2 focus:ring-[#0071E3] appearance-none pr-9 cursor-pointer shadow-sm"
              >
                <option value="tap">📍 Mode 1: Interactive Map Tap (Drop Pins on Screen)</option>
                <option value="search">🔍 Mode 2: Search Location by Name (Places & Addresses)</option>
                <option value="coords">🔢 Mode 3: Manual GPS Coordinates (Type Lat & Long)</option>
              </select>
              <ChevronDown className="w-4 h-4 text-zinc-500 absolute right-3 top-3 pointer-events-none" />
            </div>
          </div>

          {/* MODE 1: Interactive Map Tap Controls */}
          {placementMode === 'tap' && (
            <div className="space-y-2.5 p-3.5 bg-zinc-50 border border-black/[0.06] rounded-2xl">
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setPinningMode('origin')}
                  className={`flex-1 py-2 px-3 rounded-xl border text-xs font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                    pinningMode === 'origin'
                      ? 'bg-emerald-50 border-emerald-500 text-emerald-800 shadow-sm ring-1 ring-emerald-500'
                      : 'bg-white border-black/10 text-zinc-700'
                  }`}
                >
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
                  <span>Tap Start Pin</span>
                </button>

                <button
                  type="button"
                  onClick={() => setPinningMode('destination')}
                  className={`flex-1 py-2 px-3 rounded-xl border text-xs font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                    pinningMode === 'destination'
                      ? 'bg-rose-50 border-rose-500 text-rose-800 shadow-sm ring-1 ring-rose-500'
                      : 'bg-white border-black/10 text-zinc-700'
                  }`}
                >
                  <span className="w-2.5 h-2.5 rounded-full bg-rose-500" />
                  <span>Tap Goal Pin</span>
                </button>
              </div>

              <button
                type="button"
                onClick={handleUseCurrentLocation}
                className="w-full py-2 px-3 bg-white hover:bg-zinc-100 border border-black/10 text-zinc-800 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all shadow-sm cursor-pointer"
              >
                <Crosshair className="w-4 h-4 text-[#0071E3]" />
                <span>Use My Exact GPS for Start</span>
              </button>
            </div>
          )}

          {/* MODE 2: Search Location by Name Controls */}
          {placementMode === 'search' && (
            <div className="space-y-3 p-3.5 bg-zinc-50 border border-black/[0.06] rounded-2xl">
              {/* Target Pin Toggle */}
              <div className="flex items-center justify-between text-xs">
                <span className="text-[11px] font-bold text-zinc-800 uppercase tracking-wide">Target Pin:</span>
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    onClick={() => setSearchTarget('origin')}
                    className={`px-3 py-1 rounded-xl text-xs font-bold flex items-center gap-1.5 border transition cursor-pointer ${
                      searchTarget === 'origin'
                        ? 'bg-emerald-50 text-emerald-800 border-emerald-400'
                        : 'bg-white text-zinc-700 border-black/10'
                    }`}
                  >
                    <span className="w-2 h-2 rounded-full bg-emerald-500" />
                    <span>Start Pin</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setSearchTarget('destination')}
                    className={`px-3 py-1 rounded-xl text-xs font-bold flex items-center gap-1.5 border transition cursor-pointer ${
                      searchTarget === 'destination'
                        ? 'bg-rose-50 text-rose-800 border-rose-400'
                        : 'bg-white text-zinc-700 border-black/10'
                    }`}
                  >
                    <span className="w-2 h-2 rounded-full bg-rose-500" />
                    <span>Goal Pin</span>
                  </button>
                </div>
              </div>

              {/* Search Bar Form */}
              <form onSubmit={handleLocationSearch} className="flex gap-2">
                <div className="relative flex-1">
                  <Search className="w-4 h-4 text-zinc-500 absolute left-3 top-2.5" />
                  <input
                    type="text"
                    placeholder="Search address, landmark, building, city..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-9 pr-3 py-2 bg-white border border-black/10 rounded-xl text-xs text-zinc-900 placeholder-zinc-500 font-semibold focus:outline-none focus:ring-2 focus:ring-[#0071E3]"
                  />
                </div>
                <Button
                  type="submit"
                  variant="primary"
                  size="sm"
                  isLoading={isSearching}
                  disabled={!searchQuery.trim()}
                >
                  <span>Search</span>
                </Button>
              </form>

              {searchSuccessMessage && (
                <div className="p-2 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-800 font-semibold flex items-center gap-1.5">
                  <Check className="w-3.5 h-3.5 text-emerald-600" />
                  <span>{searchSuccessMessage}</span>
                </div>
              )}

              {/* Search Results List */}
              {searchResults.length > 0 && (
                <div className="space-y-1 max-h-48 overflow-y-auto divide-y divide-black/[0.06] bg-white border border-black/10 rounded-2xl p-1 shadow-sm">
                  {searchResults.map((res, idx) => (
                    <div
                      key={idx}
                      onClick={() => handleSelectPlace(res)}
                      className="p-2 hover:bg-zinc-50 rounded-xl cursor-pointer transition flex items-start gap-2 text-xs"
                    >
                      <Building className="w-3.5 h-3.5 text-[#0071E3] mt-0.5 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-zinc-900 font-bold truncate">{res.display_name}</p>
                        <p className="text-[10px] text-zinc-600 font-mono font-medium">
                          {res.lat.toFixed(5)}, {res.lon.toFixed(5)} ({res.type})
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* MODE 3: Manual GPS Coordinates Entry */}
          {placementMode === 'coords' && (
            <div className="space-y-3 p-3.5 bg-zinc-50 border border-black/[0.06] rounded-2xl">
              {/* Start Coordinates Box */}
              <div className="p-3 bg-white border border-emerald-200 rounded-2xl space-y-2 shadow-sm">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-emerald-800 flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-emerald-500" />
                    Start Pin Coordinates
                  </span>
                  <button
                    type="button"
                    onClick={handleUseCurrentLocation}
                    className="text-xs text-emerald-700 hover:text-emerald-800 flex items-center gap-1 font-bold"
                  >
                    <Crosshair className="w-3 h-3" />
                    <span>Auto-Fill GPS</span>
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] text-zinc-700 block mb-0.5 font-bold uppercase tracking-wider">Latitude</label>
                    <input
                      type="text"
                      value={startLatInput}
                      onChange={(e) => setStartLatInput(e.target.value)}
                      placeholder="e.g. 12.9716"
                      className="w-full px-2.5 py-1.5 bg-zinc-50 border border-black/10 rounded-xl text-xs font-mono font-bold text-zinc-900 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-zinc-700 block mb-0.5 font-bold uppercase tracking-wider">Longitude</label>
                    <input
                      type="text"
                      value={startLngInput}
                      onChange={(e) => setStartLngInput(e.target.value)}
                      placeholder="e.g. 77.5946"
                      className="w-full px-2.5 py-1.5 bg-zinc-50 border border-black/10 rounded-xl text-xs font-mono font-bold text-zinc-900 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                    />
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleApplyStartCoords}
                  className="w-full py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition flex items-center justify-center gap-1 shadow-sm"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>Apply Start Pin</span>
                </button>
              </div>

              {/* Goal Coordinates Box */}
              <div className="p-3 bg-white border border-rose-200 rounded-2xl space-y-2 shadow-sm">
                <span className="text-xs font-bold text-rose-800 flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-rose-500" />
                  Goal Pin Coordinates
                </span>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] text-zinc-700 block mb-0.5 font-bold uppercase tracking-wider">Latitude</label>
                    <input
                      type="text"
                      value={destLatInput}
                      onChange={(e) => setDestLatInput(e.target.value)}
                      placeholder="e.g. 12.9720"
                      className="w-full px-2.5 py-1.5 bg-zinc-50 border border-black/10 rounded-xl text-xs font-mono font-bold text-zinc-900 focus:outline-none focus:ring-1 focus:ring-rose-500"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-zinc-700 block mb-0.5 font-bold uppercase tracking-wider">Longitude</label>
                    <input
                      type="text"
                      value={destLngInput}
                      onChange={(e) => setDestLngInput(e.target.value)}
                      placeholder="e.g. 77.5950"
                      className="w-full px-2.5 py-1.5 bg-zinc-50 border border-black/10 rounded-xl text-xs font-mono font-bold text-zinc-900 focus:outline-none focus:ring-1 focus:ring-rose-500"
                    />
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleApplyDestCoords}
                  className="w-full py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-bold transition flex items-center justify-center gap-1 shadow-sm"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>Apply Goal Pin</span>
                </button>
              </div>
            </div>
          )}

          {/* Interactive Leaflet Map Preview (Always Rendered) */}
          <div className="h-60 w-full rounded-2xl overflow-hidden border border-black/10 relative shadow-sm">
            <MapContainer
              center={mapTarget}
              zoom={18}
              scrollWheelZoom={true}
              className="w-full h-full"
            >
              <TileLayer
                attribution={mapTile.attribution}
                url={mapTile.url}
                maxZoom={mapTile.maxZoom}
                tileSize={mapTile.tileSize}
                className={mapTile.className}
              />

              <MapCenterer coords={mapTarget} />

              <MapClickHandler pinningMode={pinningMode} onPinPlaced={handlePinPlaced} />

              {/* Start Marker */}
              <Marker position={originCoords} icon={startPinIcon}>
                <Popup>
                  <div className="p-1 text-zinc-900 text-xs">
                    <strong className="text-emerald-700 block">Start Point</strong>
                    <span>{originName}</span>
                    <p className="font-mono text-[10px] text-zinc-600 mt-0.5">
                      {originCoords[0].toFixed(5)}, {originCoords[1].toFixed(5)}
                    </p>
                  </div>
                </Popup>
              </Marker>

              {/* Destination Marker */}
              <Marker position={destCoords} icon={destPinIcon}>
                <Popup>
                  <div className="p-1 text-zinc-900 text-xs">
                    <strong className="text-rose-700 block">Goal Point</strong>
                    <span>{destinationName}</span>
                    <p className="font-mono text-[10px] text-zinc-600 mt-0.5">
                      {destCoords[0].toFixed(5)}, {destCoords[1].toFixed(5)}
                    </p>
                  </div>
                </Popup>
              </Marker>

              {/* Planned Route Line */}
              <Polyline
                positions={[originCoords, destCoords]}
                pathOptions={{ color: '#0071E3', weight: 4, dashArray: '6, 8' }}
              />
            </MapContainer>

            {/* Floating Distance Badge */}
            <div className="absolute bottom-2 right-2 z-[400] bg-white/95 backdrop-blur-md border border-black/10 px-3 py-1 rounded-full text-xs font-mono font-bold text-zinc-900 shadow-md flex items-center gap-1.5">
              <Compass className="w-3.5 h-3.5 text-[#0071E3]" />
              <span>
                {distanceMeters < 1000 ? `${distanceMeters} meters` : `${(distanceMeters / 1000).toFixed(2)} km`}
              </span>
            </div>
          </div>
        </div>
      </Card>

      {/* Explicit Route Endpoints Card */}
      <Card title="Journey Source & Destination Details">
        <div className="space-y-3.5 pt-1">
          {/* Starting Location (Source) */}
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <label className="block text-[11px] font-bold text-emerald-800 uppercase tracking-wider flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-500" />
                <span>Source / Starting Location Name *</span>
              </label>
              <span className="text-[11px] text-zinc-600 font-mono font-medium">
                {originCoords[0].toFixed(5)}, {originCoords[1].toFixed(5)}
              </span>
            </div>
            <input
              type="text"
              required
              value={originName}
              onChange={(e) => setOriginName(e.target.value)}
              placeholder="e.g. Mumbai Port Terminal, Warehouse A, Central Office..."
              className="w-full px-3.5 py-2.5 bg-black/[0.03] border border-black/10 rounded-2xl text-xs text-zinc-900 font-semibold placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-[#0071E3] focus:bg-white"
            />
          </div>

          {/* Destination (Target) */}
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <label className="block text-[11px] font-bold text-rose-800 uppercase tracking-wider flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-rose-500" />
                <span>Destination / Ending Location Name *</span>
              </label>
              <span className="text-[11px] text-zinc-600 font-mono font-medium">
                {destCoords[0].toFixed(5)}, {destCoords[1].toFixed(5)}
              </span>
            </div>
            <input
              type="text"
              required
              value={destinationName}
              onChange={(e) => setDestinationName(e.target.value)}
              placeholder="e.g. Pune Distribution Depot, Client Hub, Delivery Point..."
              className="w-full px-3.5 py-2.5 bg-black/[0.03] border border-black/10 rounded-2xl text-xs text-zinc-900 font-semibold placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-[#0071E3] focus:bg-white"
            />
          </div>

          {/* Consignment Notes */}
          <div className="space-y-1">
            <label className="block text-[11px] font-bold text-zinc-800 uppercase tracking-wider">
              Consignment Description / Trip Notes (Optional)
            </label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. High Priority Medical Cargo, Temperature Controlled..."
              className="w-full px-3.5 py-2.5 bg-black/[0.03] border border-black/10 rounded-2xl text-xs text-zinc-900 font-semibold placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-[#0071E3] focus:bg-white"
            />
          </div>
        </div>
      </Card>

      {/* Start Button */}
      <form onSubmit={handleStartJourney}>
        <Button
          type="submit"
          variant="primary"
          size="lg"
          className="w-full text-base font-bold"
          isLoading={isLoading}
        >
          <Play className="w-5 h-5 fill-current" />
          <span>START JOURNEY</span>
        </Button>
      </form>

      {/* Quick Add Vehicle Modal */}
      {showAddVehicle && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-md">
          <div className="bg-white border border-black/10 rounded-3xl p-6 max-w-sm w-full space-y-4 shadow-2xl">
            <h3 className="text-base font-bold text-zinc-900">Add Vehicle / Unit</h3>
            <form onSubmit={handleCreateNewVehicle} className="space-y-3.5">
              <div>
                <label className="block text-[11px] font-bold text-zinc-800 uppercase tracking-wider mb-1">Registration / Unit ID</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. PHONE-01 or KA-01-AB-1234"
                  value={newPlate}
                  onChange={(e) => setNewPlate(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-black/[0.03] border border-black/10 rounded-2xl text-xs text-zinc-900 font-semibold"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-zinc-800 uppercase tracking-wider mb-1">Vehicle Model</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Samsung Galaxy / Sprinter Van"
                  value={newModel}
                  onChange={(e) => setNewModel(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-black/[0.03] border border-black/10 rounded-2xl text-xs text-zinc-900 font-semibold"
                />
              </div>

              <div className="grid grid-cols-2 gap-2 pt-2">
                <Button type="button" variant="secondary" size="sm" onClick={() => setShowAddVehicle(false)}>
                  Cancel
                </Button>
                <Button type="submit" variant="primary" size="sm">
                  Save Unit
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
