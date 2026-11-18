import React, { useEffect, useState, useMemo } from 'react';
import {
  Shield,
  Plus,
  Trash2,
  RefreshCw,
  X,
  Search,
  Crosshair,
  MapPin,
  Check,
  RotateCcw,
  Sliders,
  Layers,
  ChevronRight,
  Info,
} from 'lucide-react';
import { MapContainer, TileLayer, Polygon, Circle, Marker, Popup, Polyline, useMapEvents, useMap } from 'react-leaflet';
import L from 'leaflet';
import { geofencesApi, locationApi } from '../../../services/api';
import { Geofence } from '../../../types';
import { Card } from '../../../components/ui/Card';
import { Button } from '../../../components/ui/Button';
import { LoadingSpinner } from '../../../components/ui/LoadingSpinner';
import { getMapTileConfig } from '../../../services/mapConfig';

// Custom DivIcons for interactive pinning and polygon vertices
const centerPinIcon = L.divIcon({
  html: `
    <div style="width: 32px; height: 32px; background: #0071E3; border: 3px solid white; border-radius: 50%; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 12px rgba(0,113,227,0.45); transform: translate(-50%, -50%); cursor: grab;">
      <div style="width: 10px; height: 10px; background: white; border-radius: 50%;"></div>
    </div>
  `,
  className: 'custom-geofence-center-pin',
  iconSize: [32, 32],
});

const makeVertexPinIcon = (idx: number) =>
  L.divIcon({
    html: `
      <div style="width: 24px; height: 24px; background: #0071E3; color: white; border: 2px solid white; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: bold; box-shadow: 0 3px 8px rgba(0,0,0,0.35); transform: translate(-50%, -50%); cursor: pointer;">
        ${idx + 1}
      </div>
    `,
    className: 'custom-vertex-pin',
    iconSize: [24, 24],
  });

interface PlaceSearchResult {
  display_name: string;
  lat: number;
  lon: number;
  type: string;
}

// Map Component: Fly to coordinates when updated
function MapCenterer({ coords, zoom }: { coords: [number, number]; zoom?: number }) {
  const map = useMap();
  useEffect(() => {
    map.flyTo(coords, zoom ?? Math.max(map.getZoom(), 15), { duration: 0.8 });
  }, [coords, zoom, map]);
  return null;
}

// Map Component: Click listener for interactive drawing
function MapClickHandler({
  isDrawing,
  geoType,
  onMapClick,
}: {
  isDrawing: boolean;
  geoType: 'circle' | 'polygon';
  onMapClick: (lat: number, lng: number) => void;
}) {
  useMapEvents({
    click(e) {
      if (!isDrawing) return;
      onMapClick(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

export const GeofencesPage: React.FC = () => {
  const [geofences, setGeofences] = useState<Geofence[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [selectedGeofence, setSelectedGeofence] = useState<Geofence | null>(null);

  // Drawing / Creation Mode State
  const [isDrawing, setIsDrawing] = useState<boolean>(false);
  const [creating, setCreating] = useState<boolean>(false);

  // Form & Drawing Attributes
  const [name, setName] = useState<string>('');
  const [description, setDescription] = useState<string>('');
  const [geoType, setGeoType] = useState<'circle' | 'polygon'>('circle');

  // Circle State
  const [circleCenter, setCircleCenter] = useState<[number, number]>([12.9716, 77.5946]);
  const [centerLat, setCenterLat] = useState<string>('12.971600');
  const [centerLng, setCenterLng] = useState<string>('77.594600');
  const [radiusM, setRadiusM] = useState<string>('500');

  // Polygon State: Array of [lat, lng]
  const [polygonPoints, setPolygonPoints] = useState<[number, number][]>([]);

  // Search Location State (mimics Driver Dashboard location pinning)
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [searchResults, setSearchResults] = useState<PlaceSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState<boolean>(false);
  const [searchSuccessMessage, setSearchSuccessMessage] = useState<string | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);

  // Map view navigation target
  const [mapTarget, setMapTarget] = useState<[number, number]>([12.9716, 77.5946]);

  const mapTile = useMemo(() => getMapTileConfig('apple'), []);

  const loadData = async () => {
    try {
      setLoading(true);
      const gList = await geofencesApi.list().catch(() => []);
      setGeofences(gList);
      if (gList.length > 0 && !selectedGeofence) {
        setSelectedGeofence(gList[0]);
      }
    } catch (e) {
      console.error('Failed to load geofences data:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();

    // Auto-acquire current GPS location to center map by default
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const lat = parseFloat(pos.coords.latitude.toFixed(6));
          const lng = parseFloat(pos.coords.longitude.toFixed(6));
          setCircleCenter([lat, lng]);
          setCenterLat(lat.toString());
          setCenterLng(lng.toString());
          setMapTarget([lat, lng]);
        },
        (err) => console.warn('Could not auto-acquire GPS on load:', err)
      );
    }
  }, []);

  // Enter Drawing Mode
  const handleStartDrawing = () => {
    setIsDrawing(true);
    setName('');
    setDescription('');
    setSearchQuery('');
    setSearchResults([]);
    setSearchSuccessMessage(null);
    setSearchError(null);

    // If a geofence was selected, center drawing near it or near current location
    if (selectedGeofence) {
      const parsed = parseGeofenceData(selectedGeofence);
      if (parsed?.type === 'circle') {
        setCircleCenter([parsed.lat, parsed.lng]);
        setCenterLat(parsed.lat.toFixed(6));
        setCenterLng(parsed.lng.toFixed(6));
        setRadiusM(parsed.radius.toString());
        setMapTarget([parsed.lat, parsed.lng]);
      } else if (parsed?.type === 'polygon' && parsed.positions.length > 0) {
        setMapTarget(parsed.positions[0]);
      }
    }
  };

  const handleCancelDrawing = () => {
    setIsDrawing(false);
    setPolygonPoints([]);
    setSearchSuccessMessage(null);
    setSearchError(null);
  };

  // Map Click Handler during drawing
  const handleMapClick = (lat: number, lng: number) => {
    const roundLat = parseFloat(lat.toFixed(6));
    const roundLng = parseFloat(lng.toFixed(6));

    if (geoType === 'circle') {
      setCircleCenter([roundLat, roundLng]);
      setCenterLat(roundLat.toString());
      setCenterLng(roundLng.toString());
      setSearchSuccessMessage(`✓ Circle center moved to (${roundLat.toFixed(5)}, ${roundLng.toFixed(5)})`);
    } else {
      // Polygon mode: append point
      setPolygonPoints((prev) => [...prev, [roundLat, roundLng]]);
      setSearchSuccessMessage(`✓ Vertex #${polygonPoints.length + 1} added at (${roundLat.toFixed(5)}, ${roundLng.toFixed(5)})`);
    }
  };

  // Undo last polygon point
  const handleUndoPoint = () => {
    setPolygonPoints((prev) => prev.slice(0, -1));
  };

  // Clear all polygon points
  const handleClearPoints = () => {
    setPolygonPoints([]);
  };

  // Location Search Handler (same concept as driver dashboard location pinning)
  const handleLocationSearch = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!searchQuery.trim()) return;

    setIsSearching(true);
    setSearchError(null);
    setSearchSuccessMessage(null);

    try {
      const results = await locationApi.searchPlaces(searchQuery.trim());
      setSearchResults(results);
      if (results.length === 0) {
        setSearchError(`No locations found for "${searchQuery}". Try a landmark, city, or coordinates.`);
      }
    } catch (err: any) {
      console.warn('Location search error:', err);
      setSearchError('Search lookup failed. You can click on the map to pin a location directly.');
    } finally {
      setIsSearching(false);
    }
  };

  // Selecting a place from search suggestions
  const handleSelectPlace = (place: PlaceSearchResult) => {
    const lat = parseFloat(place.lat.toFixed(6));
    const lon = parseFloat(place.lon.toFixed(6));

    setMapTarget([lat, lon]);
    setCircleCenter([lat, lon]);
    setCenterLat(lat.toString());
    setCenterLng(lon.toString());

    if (!name) {
      const simpleName = place.display_name.split(',')[0]?.trim();
      if (simpleName) {
        setName(`${simpleName} Zone`);
      }
    }

    setSearchSuccessMessage(`✓ Centered map & placed pin on: ${place.display_name.split(',')[0]}`);
    setSearchResults([]);
    setSearchQuery('');
  };

  // Use current GPS location button
  const handleUseCurrentLocation = () => {
    if (!navigator.geolocation) {
      setSearchError('Geolocation is not supported by your browser.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = parseFloat(pos.coords.latitude.toFixed(6));
        const lng = parseFloat(pos.coords.longitude.toFixed(6));
        setCircleCenter([lat, lng]);
        setCenterLat(lat.toString());
        setCenterLng(lng.toString());
        setMapTarget([lat, lng]);
        setSearchSuccessMessage(`✓ Acquired current GPS location (${lat.toFixed(5)}, ${lng.toFixed(5)})`);
      },
      (err) => {
        setSearchError('Location error: ' + err.message);
      },
      { enableHighAccuracy: true }
    );
  };

  // Create & Save Geofence Handler
  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!name.trim()) {
      alert('Please provide a name for this geofence perimeter.');
      return;
    }

    try {
      setCreating(true);

      if (geoType === 'circle') {
        const lat = parseFloat(centerLat);
        const lng = parseFloat(centerLng);
        const rad = parseFloat(radiusM);

        if (isNaN(lat) || isNaN(lng) || isNaN(rad) || rad <= 0) {
          alert('Please enter valid numeric latitude, longitude, and positive radius.');
          return;
        }

        const areaStr = `CIRCLE (${lat} ${lng}, ${rad})`;
        const geometry = {
          type: 'circle',
          center: [lat, lng],
          radius: rad,
        };

        const created = await geofencesApi.create({
          name: name.trim(),
          description: description.trim() || undefined,
          kind: 'circle',
          geometry,
          area: areaStr,
        });

        setIsDrawing(false);
        await loadData();
        setSelectedGeofence(created);
      } else {
        // Polygon Mode
        if (polygonPoints.length < 3) {
          alert('A polygon perimeter requires at least 3 points on the map. Click on the map to define the perimeter.');
          return;
        }

        const closedPoints = [...polygonPoints];
        if (
          closedPoints[0][0] !== closedPoints[closedPoints.length - 1][0] ||
          closedPoints[0][1] !== closedPoints[closedPoints.length - 1][1]
        ) {
          closedPoints.push(closedPoints[0]);
        }

        // GeoJSON coordinates are [lon, lat]
        const geojsonCoordinates = closedPoints.map(([ptLat, ptLon]) => [ptLon, ptLat]);
        const areaStr = `POLYGON ((${closedPoints.map(([ptLat, ptLon]) => `${ptLat} ${ptLon}`).join(', ')}))`;
        const geometry = {
          type: 'Polygon',
          coordinates: [geojsonCoordinates],
        };

        const created = await geofencesApi.create({
          name: name.trim(),
          description: description.trim() || undefined,
          kind: 'polygon',
          geometry,
          area: areaStr,
        });

        setIsDrawing(false);
        setPolygonPoints([]);
        await loadData();
        setSelectedGeofence(created);
      }
    } catch (err: any) {
      console.error('Failed to create geofence:', err);
      const detail = err.response?.data?.detail;
      let msg = 'Failed to create geofence';
      if (typeof detail === 'string') {
        msg += `: ${detail}`;
      } else if (Array.isArray(detail)) {
        msg += `: ${detail.map((d: any) => d.msg || JSON.stringify(d)).join(', ')}`;
      } else if (detail && typeof detail === 'object') {
        msg += `: ${detail.message || JSON.stringify(detail)}`;
      } else if (err.message) {
        msg += `: ${err.message}`;
      }
      alert(msg);
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Are you sure you want to delete this geofence?')) return;
    try {
      await geofencesApi.delete(id);
      if (selectedGeofence?.id === id) {
        setSelectedGeofence(null);
      }
      await loadData();
    } catch (err: any) {
      alert('Failed to delete geofence: ' + (err.response?.data?.detail || err.message));
    }
  };

  // Parse geofence area or geometry for map visualization
  const parseGeofenceData = (gf: Geofence | null) => {
    if (!gf) return null;

    // 1. Check geometry object first
    if (gf.geometry) {
      const g = gf.geometry;
      const gType = (g.type || gf.kind || '').toLowerCase();
      if (gType === 'circle') {
        const center = g.center || [0, 0];
        const radius = Number(g.radius) || 100;
        return {
          type: 'circle' as const,
          lat: Number(center[0]),
          lng: Number(center[1]),
          radius,
        };
      } else if (gType === 'polygon') {
        const ring = g.coordinates?.[0] || [];
        // GeoJSON coordinates are [lon, lat]
        const positions: [number, number][] = ring.map((pt: any) => [Number(pt[1]), Number(pt[0])]);
        return {
          type: 'polygon' as const,
          positions,
        };
      }
    }

    // 2. Fallback to WKT area string if present
    if (gf.area) {
      const area = gf.area.trim();
      if (area.toUpperCase().startsWith('CIRCLE')) {
        const match = area.match(/CIRCLE\s*\(\s*([-\d.]+)\s+([-\d.]+)\s*,\s*([-\d.]+)\s*\)/i);
        if (match) {
          return {
            type: 'circle' as const,
            lat: parseFloat(match[1]),
            lng: parseFloat(match[2]),
            radius: parseFloat(match[3]),
          };
        }
      } else if (area.toUpperCase().startsWith('POLYGON')) {
        const match = area.match(/POLYGON\s*\(\(\s*([^)]+)\s*\)\)/i);
        if (match) {
          const pairs = match[1].split(',').map((p) => p.trim());
          const latLngs: [number, number][] = [];
          for (const pair of pairs) {
            const parts = pair.split(/\s+/);
            if (parts.length >= 2) {
              latLngs.push([parseFloat(parts[0]), parseFloat(parts[1])]);
            }
          }
          return {
            type: 'polygon' as const,
            positions: latLngs,
          };
        }
      }
    }

    return null;
  };

  const parsedGeofence = useMemo(() => {
    return parseGeofenceData(selectedGeofence);
  }, [selectedGeofence]);

  // Center coordinates for map view
  const mapCenter: [number, number] = useMemo(() => {
    if (isDrawing) {
      if (geoType === 'circle' && circleCenter) {
        return circleCenter;
      }
      if (geoType === 'polygon' && polygonPoints.length > 0) {
        return polygonPoints[polygonPoints.length - 1];
      }
      return mapTarget;
    }
    if (parsedGeofence?.type === 'circle') {
      return [parsedGeofence.lat, parsedGeofence.lng];
    }
    if (parsedGeofence?.type === 'polygon' && parsedGeofence.positions.length > 0) {
      return parsedGeofence.positions[0];
    }
    return mapTarget;
  }, [isDrawing, geoType, circleCenter, polygonPoints, mapTarget, parsedGeofence]);

  if (loading) return <LoadingSpinner label="Loading geofences..." />;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-zinc-900 tracking-tight flex items-center gap-2">
            <Shield className="w-5 h-5 text-[#0071E3]" />
            Geofencing & Spatial Perimeters
          </h2>
          <p className="text-xs text-zinc-600 mt-0.5 font-medium">
            Define virtual boundaries, corridors, and automated enter/exit telematics events
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={loadData}>
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Refresh</span>
          </Button>
          {!isDrawing ? (
            <Button variant="primary" size="sm" onClick={handleStartDrawing}>
              <Plus className="w-3.5 h-3.5" />
              <span>Create Geofence</span>
            </Button>
          ) : (
            <Button variant="secondary" size="sm" onClick={handleCancelDrawing}>
              <X className="w-3.5 h-3.5" />
              <span>Cancel Drawing</span>
            </Button>
          )}
        </div>
      </div>

      {/* Main Split: List/Drawing Form + Interactive Map */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: List or Draw Form */}
        <div className="space-y-4">
          {!isDrawing ? (
            /* Perimeters List Mode */
            <Card title={`Perimeters (${geofences.length})`}>
              <div className="divide-y divide-black/[0.06] max-h-[560px] overflow-y-auto">
                {geofences.length === 0 ? (
                  <div className="py-8 text-center px-4 space-y-3">
                    <p className="text-xs text-zinc-600 font-semibold">
                      No geofences created yet. Click &quot;Create Geofence&quot; to draw a perimeter directly on the map.
                    </p>
                    <Button variant="primary" size="sm" onClick={handleStartDrawing} className="mx-auto">
                      <Plus className="w-3.5 h-3.5" />
                      <span>Draw Geofence Now</span>
                    </Button>
                  </div>
                ) : (
                  geofences.map((gf) => {
                    const isSelected = selectedGeofence?.id === gf.id;
                    const parsed = parseGeofenceData(gf);
                    const isCircle = gf.kind?.toLowerCase() === 'circle' || gf.area?.toUpperCase().startsWith('CIRCLE') || parsed?.type === 'circle';
                    return (
                      <div
                        key={gf.id}
                        onClick={() => setSelectedGeofence(gf)}
                        className={`p-3.5 rounded-2xl transition cursor-pointer flex flex-col gap-1.5 ${
                          isSelected
                            ? 'bg-blue-50/80 border border-blue-200/90 shadow-sm'
                            : 'hover:bg-black/[0.03]'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-sm text-zinc-900">{gf.name}</span>
                          <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-zinc-100 text-zinc-800 border border-zinc-200 font-bold uppercase">
                            {isCircle ? 'Circle' : 'Polygon'}
                          </span>
                        </div>
                        {gf.description && (
                          <p className="text-xs text-zinc-700 line-clamp-1 font-medium">{gf.description}</p>
                        )}
                        <div className="flex items-center justify-between text-[11px] text-zinc-600 pt-1 font-semibold">
                          <span className="text-emerald-700 font-semibold">
                            {parsed?.type === 'circle' ? `Radius: ${parsed.radius}m` : 'Polygon Perimeter'}
                          </span>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDelete(gf.id);
                              }}
                              className="text-rose-600 hover:text-rose-700 p-1 rounded-lg hover:bg-rose-50 transition"
                              title="Delete geofence"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </Card>
          ) : (
            /* Drawing / Creation Control Panel */
            <Card title="Draw Geofence on Map">
              <form onSubmit={handleCreate} className="space-y-4">
                {/* 1. Location Search (mimicking Driver Dashboard location pinning) */}
                <div className="space-y-2 p-3 bg-zinc-50 border border-black/[0.06] rounded-2xl">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold text-zinc-800 uppercase tracking-wide flex items-center gap-1.5">
                      <Search className="w-3.5 h-3.5 text-[#0071E3]" />
                      <span>Search & Jump to Place</span>
                    </span>
                    <button
                      type="button"
                      onClick={handleUseCurrentLocation}
                      className="text-[11px] text-[#0071E3] font-bold hover:underline flex items-center gap-1 cursor-pointer"
                    >
                      <Crosshair className="w-3 h-3" />
                      <span>My GPS</span>
                    </button>
                  </div>

                  {/* Search Bar Input */}
                  <div className="relative">
                    <input
                      type="text"
                      placeholder="Search city, address, landmark, or lat,lng..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleLocationSearch();
                        }
                      }}
                      className="w-full pl-3 pr-20 py-2 bg-white border border-black/10 rounded-xl text-xs text-zinc-900 placeholder-zinc-500 font-semibold focus:outline-none focus:ring-2 focus:ring-[#0071E3]"
                    />
                    <Button
                      type="button"
                      variant="primary"
                      size="sm"
                      onClick={() => handleLocationSearch()}
                      disabled={isSearching || !searchQuery.trim()}
                      className="absolute right-1 top-1 bottom-1 px-3 py-1 text-[11px] font-bold rounded-lg"
                    >
                      {isSearching ? '...' : 'Search'}
                    </Button>
                  </div>

                  {/* Search Feedback */}
                  {searchSuccessMessage && (
                    <div className="p-2 bg-emerald-50 border border-emerald-200 rounded-xl text-[11px] text-emerald-800 font-semibold flex items-center gap-1.5">
                      <Check className="w-3.5 h-3.5 text-emerald-600 flex-shrink-0" />
                      <span className="line-clamp-1">{searchSuccessMessage}</span>
                    </div>
                  )}

                  {searchError && (
                    <p className="text-[11px] text-rose-600 font-medium">{searchError}</p>
                  )}

                  {/* Search Results Dropdown List */}
                  {searchResults.length > 0 && (
                    <div className="border border-black/10 rounded-xl bg-white shadow-lg overflow-hidden max-h-48 overflow-y-auto divide-y divide-black/[0.04]">
                      {searchResults.map((place, idx) => (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => handleSelectPlace(place)}
                          className="w-full text-left px-3 py-2 hover:bg-black/[0.04] flex items-start gap-2 transition text-xs"
                        >
                          <MapPin className="w-3.5 h-3.5 text-[#0071E3] mt-0.5 flex-shrink-0" />
                          <div className="min-w-0 flex-1">
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

                {/* 2. Shape Selector */}
                <div>
                  <label className="block text-zinc-800 font-bold uppercase tracking-wider text-[11px] mb-1.5">
                    Perimeter Shape
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setGeoType('circle')}
                      className={`py-2 px-3 rounded-xl border text-xs font-bold flex items-center justify-center gap-2 transition ${
                        geoType === 'circle'
                          ? 'bg-blue-50 border-[#0071E3] text-[#0071E3] shadow-sm ring-1 ring-[#0071E3]'
                          : 'bg-white border-black/10 text-zinc-700 hover:bg-black/[0.02]'
                      }`}
                    >
                      <span className="w-2.5 h-2.5 rounded-full border-2 border-current" />
                      <span>Circle (Radius)</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setGeoType('polygon')}
                      className={`py-2 px-3 rounded-xl border text-xs font-bold flex items-center justify-center gap-2 transition ${
                        geoType === 'polygon'
                          ? 'bg-blue-50 border-[#0071E3] text-[#0071E3] shadow-sm ring-1 ring-[#0071E3]'
                          : 'bg-white border-black/10 text-zinc-700 hover:bg-black/[0.02]'
                      }`}
                    >
                      <Layers className="w-3.5 h-3.5" />
                      <span>Polygon (Draw)</span>
                    </button>
                  </div>
                </div>

                {/* 3. Shape Specific Controls */}
                {geoType === 'circle' ? (
                  <div className="space-y-3 p-3 bg-zinc-50 border border-black/[0.06] rounded-2xl">
                    <div className="flex items-center justify-between text-xs font-bold text-zinc-800">
                      <span>Circle Radius</span>
                      <span className="text-[#0071E3] font-mono">{radiusM} meters</span>
                    </div>

                    <input
                      type="range"
                      min="50"
                      max="5000"
                      step="25"
                      value={radiusM}
                      onChange={(e) => setRadiusM(e.target.value)}
                      className="w-full accent-[#0071E3] cursor-pointer"
                    />

                    {/* Quick Radius Presets */}
                    <div className="flex gap-1.5">
                      {['100', '250', '500', '1000', '2500'].map((preset) => (
                        <button
                          key={preset}
                          type="button"
                          onClick={() => setRadiusM(preset)}
                          className={`flex-1 py-1 rounded-lg text-[10px] font-bold border transition ${
                            radiusM === preset
                              ? 'bg-[#0071E3] text-white border-[#0071E3]'
                              : 'bg-white border-black/10 text-zinc-700 hover:bg-black/[0.04]'
                          }`}
                        >
                          {parseInt(preset) >= 1000 ? `${parseInt(preset) / 1000}km` : `${preset}m`}
                        </button>
                      ))}
                    </div>

                    {/* Lat / Lng inputs */}
                    <div className="grid grid-cols-2 gap-2 pt-1">
                      <div>
                        <label className="block text-zinc-700 font-bold uppercase tracking-wider text-[10px] mb-1">
                          Center Lat
                        </label>
                        <input
                          type="text"
                          required
                          value={centerLat}
                          onChange={(e) => {
                            setCenterLat(e.target.value);
                            const val = parseFloat(e.target.value);
                            if (!isNaN(val)) setCircleCenter((prev) => [val, prev[1]]);
                          }}
                          className="w-full px-2.5 py-1.5 bg-white border border-black/10 rounded-xl text-zinc-900 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-[#0071E3]"
                        />
                      </div>
                      <div>
                        <label className="block text-zinc-700 font-bold uppercase tracking-wider text-[10px] mb-1">
                          Center Lng
                        </label>
                        <input
                          type="text"
                          required
                          value={centerLng}
                          onChange={(e) => {
                            setCenterLng(e.target.value);
                            const val = parseFloat(e.target.value);
                            if (!isNaN(val)) setCircleCenter((prev) => [prev[0], val]);
                          }}
                          className="w-full px-2.5 py-1.5 bg-white border border-black/10 rounded-xl text-zinc-900 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-[#0071E3]"
                        />
                      </div>
                    </div>
                    <p className="text-[10px] text-zinc-500 font-medium flex items-center gap-1">
                      <Info className="w-3 h-3 text-[#0071E3]" />
                      Click on the map or drag the blue pin to reposition center.
                    </p>
                  </div>
                ) : (
                  /* Polygon Point Controls */
                  <div className="space-y-3 p-3 bg-zinc-50 border border-black/[0.06] rounded-2xl">
                    <div className="flex items-center justify-between text-xs font-bold text-zinc-800">
                      <span>Perimeter Boundary Points</span>
                      <span className="text-[#0071E3] font-mono">
                        {polygonPoints.length} {polygonPoints.length === 1 ? 'point' : 'points'}
                      </span>
                    </div>

                    <div className="flex gap-2">
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={handleUndoPoint}
                        disabled={polygonPoints.length === 0}
                        className="flex-1 text-[11px]"
                      >
                        <RotateCcw className="w-3 h-3" />
                        <span>Undo Point</span>
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={handleClearPoints}
                        disabled={polygonPoints.length === 0}
                        className="flex-1 text-[11px] text-rose-600 hover:text-rose-700"
                      >
                        <Trash2 className="w-3 h-3" />
                        <span>Clear All</span>
                      </Button>
                    </div>

                    {polygonPoints.length === 0 ? (
                      <p className="text-[11px] text-zinc-600 font-medium bg-white p-2.5 rounded-xl border border-dashed border-black/15 text-center">
                        👉 Click on the map to place vertices (at least 3 points needed).
                      </p>
                    ) : (
                      <div className="bg-white rounded-xl border border-black/10 p-2 max-h-32 overflow-y-auto divide-y divide-black/[0.04] text-[10px] font-mono">
                        {polygonPoints.map((pt, i) => (
                          <div key={i} className="py-1 flex items-center justify-between text-zinc-700">
                            <span className="font-bold text-[#0071E3]">P{i + 1}</span>
                            <span>{pt[0].toFixed(5)}, {pt[1].toFixed(5)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* 4. Name & Description */}
                <div>
                  <label className="block text-zinc-800 font-bold uppercase tracking-wider text-[11px] mb-1">
                    Perimeter Name *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Central Logistics Terminal"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full px-3.5 py-2 bg-black/[0.03] border border-black/10 rounded-2xl text-zinc-900 placeholder-zinc-400 font-semibold focus:outline-none focus:ring-2 focus:ring-[#0071E3] focus:bg-white text-xs"
                  />
                </div>

                <div>
                  <label className="block text-zinc-800 font-bold uppercase tracking-wider text-[11px] mb-1">
                    Description (Optional)
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Inbound docks, fuel station & gate"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    className="w-full px-3.5 py-2 bg-black/[0.03] border border-black/10 rounded-2xl text-zinc-900 placeholder-zinc-400 font-medium focus:outline-none focus:ring-2 focus:ring-[#0071E3] focus:bg-white text-xs"
                  />
                </div>

                {/* Submit & Cancel Buttons */}
                <div className="flex items-center gap-2 pt-2 border-t border-black/[0.06]">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={handleCancelDrawing}
                    className="flex-1"
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    variant="primary"
                    size="sm"
                    disabled={creating || (geoType === 'polygon' && polygonPoints.length < 3)}
                    className="flex-1 font-bold"
                  >
                    {creating ? 'Saving...' : 'Save Geofence'}
                  </Button>
                </div>
              </form>
            </Card>
          )}
        </div>

        {/* Right Column: Live Interactive Map */}
        <div className="lg:col-span-2">
          <Card
            title={
              isDrawing
                ? `Drawing ${geoType === 'circle' ? 'Circle' : 'Polygon'} Perimeter`
                : selectedGeofence
                ? `Boundary: ${selectedGeofence.name}`
                : 'Geofence Visualization'
            }
          >
            <div className="h-[560px] w-full rounded-2xl overflow-hidden border border-black/10 relative">
              {/* Map Drawing Instructions Banner when drawing */}
              {isDrawing && (
                <div className="absolute top-3 left-3 right-3 z-[1000] bg-white/95 backdrop-blur-md border border-black/10 px-3.5 py-2 rounded-2xl shadow-lg flex items-center justify-between pointer-events-auto">
                  <div className="flex items-center gap-2 text-xs font-bold text-zinc-900">
                    <span className="w-2.5 h-2.5 rounded-full bg-[#0071E3] animate-pulse" />
                    <span>
                      {geoType === 'circle'
                        ? '👉 Click map or drag center marker to set geofence center'
                        : `👉 Click map to drop perimeter points (${polygonPoints.length} placed, min 3)`}
                    </span>
                  </div>
                  {geoType === 'polygon' && polygonPoints.length >= 3 && (
                    <span className="text-[11px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                      ✓ Closed Perimeter Ready
                    </span>
                  )}
                </div>
              )}

              <MapContainer center={mapCenter} zoom={14} className="w-full h-full">
                <TileLayer
                  attribution={mapTile.attribution}
                  url={mapTile.url}
                  maxZoom={mapTile.maxZoom}
                  tileSize={mapTile.tileSize}
                  className={mapTile.className}
                />

                {/* Smooth centering when target changes */}
                <MapCenterer coords={mapCenter} />

                {/* Map click listener when in drawing mode */}
                <MapClickHandler
                  isDrawing={isDrawing}
                  geoType={geoType}
                  onMapClick={handleMapClick}
                />

                {/* DRAWING MODE VISUALIZATION */}
                {isDrawing && geoType === 'circle' && (
                  <>
                    <Marker
                      position={circleCenter}
                      draggable={true}
                      eventHandlers={{
                        dragend: (e) => {
                          const marker = e.target;
                          const pos = marker.getLatLng();
                          const lat = parseFloat(pos.lat.toFixed(6));
                          const lng = parseFloat(pos.lng.toFixed(6));
                          setCircleCenter([lat, lng]);
                          setCenterLat(lat.toString());
                          setCenterLng(lng.toString());
                          setSearchSuccessMessage(`✓ Center pin dragged to (${lat.toFixed(5)}, ${lng.toFixed(5)})`);
                        },
                      }}
                      icon={centerPinIcon}
                    >
                      <Popup>
                        <div className="p-1 text-xs">
                          <strong className="text-zinc-900">Perimeter Center</strong>
                          <p className="text-[11px] text-zinc-600 font-mono">
                            {circleCenter[0].toFixed(5)}, {circleCenter[1].toFixed(5)}
                          </p>
                          <p className="text-[10px] text-blue-600 font-semibold mt-0.5">Drag to move center</p>
                        </div>
                      </Popup>
                    </Marker>

                    <Circle
                      center={circleCenter}
                      radius={parseFloat(radiusM) || 500}
                      pathOptions={{
                        color: '#0071E3',
                        fillColor: '#0071E3',
                        fillOpacity: 0.25,
                        weight: 2,
                      }}
                    />
                  </>
                )}

                {isDrawing && geoType === 'polygon' && (
                  <>
                    {/* Vertices Pins */}
                    {polygonPoints.map((pt, idx) => (
                      <Marker key={idx} position={pt} icon={makeVertexPinIcon(idx)}>
                        <Popup>
                          <div className="p-1 text-xs font-semibold">
                            Vertex #{idx + 1}: {pt[0].toFixed(5)}, {pt[1].toFixed(5)}
                          </div>
                        </Popup>
                      </Marker>
                    ))}

                    {/* Connecting Line between points */}
                    {polygonPoints.length >= 2 && (
                      <Polyline
                        positions={polygonPoints}
                        pathOptions={{ color: '#0071E3', weight: 2, dashArray: '4 4' }}
                      />
                    )}

                    {/* Shaded closed polygon preview if >= 3 points */}
                    {polygonPoints.length >= 3 && (
                      <Polygon
                        positions={polygonPoints}
                        pathOptions={{
                          color: '#0071E3',
                          fillColor: '#0071E3',
                          fillOpacity: 0.25,
                          weight: 2,
                        }}
                      />
                    )}
                  </>
                )}

                {/* VIEW MODE VISUALIZATION (Existing selected geofence) */}
                {!isDrawing && parsedGeofence?.type === 'circle' && (
                  <>
                    <Marker position={[parsedGeofence.lat, parsedGeofence.lng]} icon={centerPinIcon}>
                      <Popup>
                        <div className="p-1 text-zinc-900 font-bold text-xs">
                          <strong>{selectedGeofence?.name}</strong>
                          <p className="text-zinc-600 font-medium text-[11px]">Radius: {parsedGeofence.radius}m</p>
                        </div>
                      </Popup>
                    </Marker>
                    <Circle
                      center={[parsedGeofence.lat, parsedGeofence.lng]}
                      radius={parsedGeofence.radius}
                      pathOptions={{
                        color: '#0071E3',
                        fillColor: '#0071E3',
                        fillOpacity: 0.25,
                        weight: 2,
                      }}
                    />
                  </>
                )}

                {!isDrawing && parsedGeofence?.type === 'polygon' && (
                  <Polygon
                    positions={parsedGeofence.positions}
                    pathOptions={{
                      color: '#0071E3',
                      fillColor: '#0071E3',
                      fillOpacity: 0.25,
                      weight: 2,
                    }}
                  >
                    <Popup>
                      <div className="p-1 text-zinc-900 font-bold text-xs">
                        <strong>{selectedGeofence?.name}</strong>
                        <p className="text-zinc-600 font-medium text-[11px]">Polygon Perimeter</p>
                      </div>
                    </Popup>
                  </Polygon>
                )}
              </MapContainer>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
};
