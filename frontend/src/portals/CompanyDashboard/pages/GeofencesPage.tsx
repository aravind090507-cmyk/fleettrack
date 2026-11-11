import React, { useEffect, useState, useMemo } from 'react';
import {
  Shield,
  Plus,
  Trash2,
  RefreshCw,
  X,
} from 'lucide-react';
import { MapContainer, TileLayer, Polygon, Circle, Marker, Popup } from 'react-leaflet';
import L from 'leaflet';
import { geofencesApi } from '../../../services/api';
import { Geofence } from '../../../types';
import { Card } from '../../../components/ui/Card';
import { Button } from '../../../components/ui/Button';
import { LoadingSpinner } from '../../../components/ui/LoadingSpinner';
import { getMapTileConfig } from '../../../services/mapConfig';

export const GeofencesPage: React.FC = () => {
  const [geofences, setGeofences] = useState<Geofence[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [selectedGeofence, setSelectedGeofence] = useState<Geofence | null>(null);

  // Modal states
  const [showCreateModal, setShowCreateModal] = useState<boolean>(false);
  const [creating, setCreating] = useState<boolean>(false);

  // Form states
  const [name, setName] = useState<string>('');
  const [description, setDescription] = useState<string>('');
  const [geoType, setGeoType] = useState<'circle' | 'polygon'>('circle');
  const [centerLat, setCenterLat] = useState<string>('12.9716');
  const [centerLng, setCenterLng] = useState<string>('77.5946');
  const [radiusM, setRadiusM] = useState<string>('500');
  const [polygonCoords, setPolygonCoords] = useState<string>(
    '12.9700 77.5900, 12.9750 77.5900, 12.9750 77.5980, 12.9700 77.5980, 12.9700 77.5900'
  );

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
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setCreating(true);
      let areaStr = '';
      if (geoType === 'circle') {
        areaStr = `CIRCLE (${centerLat.trim()} ${centerLng.trim()}, ${radiusM.trim()})`;
      } else {
        areaStr = `POLYGON ((${polygonCoords.trim()}))`;
      }

      await geofencesApi.create({
        name: name.trim(),
        description: description.trim() || undefined,
        area: areaStr,
      });

      setShowCreateModal(false);
      setName('');
      setDescription('');
      await loadData();
    } catch (err: any) {
      alert('Failed to create geofence: ' + (err.response?.data?.detail || err.message));
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

  // Parse geofence area for map visualization
  const parsedGeofence = useMemo(() => {
    if (!selectedGeofence || !selectedGeofence.area) return null;
    const area = selectedGeofence.area.trim();

    if (area.startsWith('CIRCLE')) {
      const match = area.match(/CIRCLE\s*\(\s*([-\d.]+)\s+([-\d.]+)\s*,\s*([-\d.]+)\s*\)/i);
      if (match) {
        return {
          type: 'circle' as const,
          lat: parseFloat(match[1]),
          lng: parseFloat(match[2]),
          radius: parseFloat(match[3]),
        };
      }
    } else if (area.startsWith('POLYGON')) {
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
    return null;
  }, [selectedGeofence]);

  const mapCenter: [number, number] = useMemo(() => {
    if (parsedGeofence?.type === 'circle') {
      return [parsedGeofence.lat, parsedGeofence.lng];
    }
    if (parsedGeofence?.type === 'polygon' && parsedGeofence.positions.length > 0) {
      return parsedGeofence.positions[0];
    }
    return [12.9716, 77.5946];
  }, [parsedGeofence]);

  const mapTile = useMemo(() => getMapTileConfig('apple'), []);

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
            Define virtual boundaries, corridors, and trigger automated enter/exit events
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={loadData}>
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Refresh</span>
          </Button>
          <Button variant="primary" size="sm" onClick={() => setShowCreateModal(true)}>
            <Plus className="w-3.5 h-3.5" />
            <span>Create Geofence</span>
          </Button>
        </div>
      </div>

      {/* Main Split: List + Leaflet Map */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Geofence List */}
        <div className="space-y-3">
          <Card title={`Perimeters (${geofences.length})`}>
            <div className="divide-y divide-black/[0.06] max-h-[500px] overflow-y-auto">
              {geofences.length === 0 ? (
                <p className="py-6 text-center text-xs text-zinc-600 font-semibold">
                  No geofences created yet. Click &quot;Create Geofence&quot; to define a perimeter.
                </p>
              ) : (
                geofences.map((gf) => {
                  const isSelected = selectedGeofence?.id === gf.id;
                  const isCircle = gf.area?.startsWith('CIRCLE');
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
                        <span className="text-emerald-700 font-semibold">Active Fleet Zone</span>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDelete(gf.id);
                            }}
                            className="text-rose-600 hover:text-rose-700 p-1 rounded-lg hover:bg-rose-50 transition"
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
        </div>

        {/* Map Preview */}
        <div className="lg:col-span-2">
          <Card title={selectedGeofence ? `Boundary: ${selectedGeofence.name}` : 'Geofence Visualization'}>
            <div className="h-[480px] w-full rounded-2xl overflow-hidden border border-black/10 relative">
              <MapContainer center={mapCenter} zoom={13} className="w-full h-full">
                <TileLayer
                  attribution={mapTile.attribution}
                  url={mapTile.url}
                  maxZoom={mapTile.maxZoom}
                  tileSize={mapTile.tileSize}
                  className={mapTile.className}
                />

                {parsedGeofence?.type === 'circle' && (
                  <Circle
                    center={[parsedGeofence.lat, parsedGeofence.lng]}
                    radius={parsedGeofence.radius}
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
                        <p className="text-zinc-600 font-medium text-[11px]">Radius: {parsedGeofence.radius}m</p>
                      </div>
                    </Popup>
                  </Circle>
                )}

                {parsedGeofence?.type === 'polygon' && (
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

      {/* Create Geofence Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-md flex items-center justify-center p-4 z-50">
          <form
            onSubmit={handleCreate}
            className="bg-white border border-black/10 rounded-3xl w-full max-w-lg p-6 sm:p-7 shadow-2xl space-y-4"
          >
            <div className="flex items-center justify-between border-b border-black/[0.06] pb-3.5">
              <h3 className="text-base font-bold text-zinc-900">Create Virtual Geofence Perimeter</h3>
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="text-zinc-500 hover:text-zinc-900 p-1 rounded-full hover:bg-black/[0.05] transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3.5 text-xs">
              <div>
                <label className="block text-zinc-800 font-bold uppercase tracking-wider text-[11px] mb-1">Perimeter Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Warehouse Central Depot"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-black/[0.03] border border-black/10 rounded-2xl text-zinc-900 placeholder-zinc-500 font-semibold focus:outline-none focus:ring-2 focus:ring-[#0071E3] focus:bg-white text-xs"
                />
              </div>

              <div>
                <label className="block text-zinc-800 font-bold uppercase tracking-wider text-[11px] mb-1">Description (Optional)</label>
                <input
                  type="text"
                  placeholder="e.g. Inbound logistics yard & loading docks"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-black/[0.03] border border-black/10 rounded-2xl text-zinc-900 placeholder-zinc-500 font-medium focus:outline-none focus:ring-2 focus:ring-[#0071E3] focus:bg-white text-xs"
                />
              </div>

              <div className="flex items-center gap-4 pt-1">
                <label className="flex items-center gap-2 cursor-pointer text-zinc-800 font-semibold">
                  <input
                    type="radio"
                    name="geotype"
                    checked={geoType === 'circle'}
                    onChange={() => setGeoType('circle')}
                    className="text-[#0071E3]"
                  />
                  <span>Circle (Radius)</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer text-zinc-800 font-semibold">
                  <input
                    type="radio"
                    name="geotype"
                    checked={geoType === 'polygon'}
                    onChange={() => setGeoType('polygon')}
                    className="text-[#0071E3]"
                  />
                  <span>Polygon (Coordinates)</span>
                </label>
              </div>

              {geoType === 'circle' ? (
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="block text-zinc-800 font-bold uppercase tracking-wider text-[10px] mb-1">Center Lat</label>
                    <input
                      type="text"
                      required
                      value={centerLat}
                      onChange={(e) => setCenterLat(e.target.value)}
                      className="w-full px-3 py-2 bg-black/[0.03] border border-black/10 rounded-xl text-zinc-900 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-[#0071E3] focus:bg-white"
                    />
                  </div>
                  <div>
                    <label className="block text-zinc-800 font-bold uppercase tracking-wider text-[10px] mb-1">Center Lng</label>
                    <input
                      type="text"
                      required
                      value={centerLng}
                      onChange={(e) => setCenterLng(e.target.value)}
                      className="w-full px-3 py-2 bg-black/[0.03] border border-black/10 rounded-xl text-zinc-900 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-[#0071E3] focus:bg-white"
                    />
                  </div>
                  <div>
                    <label className="block text-zinc-800 font-bold uppercase tracking-wider text-[10px] mb-1">Radius (meters)</label>
                    <input
                      type="number"
                      required
                      value={radiusM}
                      onChange={(e) => setRadiusM(e.target.value)}
                      className="w-full px-3 py-2 bg-black/[0.03] border border-black/10 rounded-xl text-zinc-900 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-[#0071E3] focus:bg-white"
                    />
                  </div>
                </div>
              ) : (
                <div>
                  <label className="block text-zinc-800 font-bold uppercase tracking-wider text-[11px] mb-1">
                    Polygon Coordinates (lat lng, lat lng, ...)
                  </label>
                  <textarea
                    rows={3}
                    required
                    value={polygonCoords}
                    onChange={(e) => setPolygonCoords(e.target.value)}
                    className="w-full px-3 py-2 bg-black/[0.03] border border-black/10 rounded-xl text-zinc-900 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-[#0071E3] focus:bg-white"
                  />
                  <p className="text-[10px] text-zinc-600 mt-1 font-medium">
                    Enter pairs of `lat lng` separated by commas. The polygon must close (first and last match).
                  </p>
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2.5 pt-3 border-t border-black/[0.06]">
              <Button type="button" variant="secondary" size="sm" onClick={() => setShowCreateModal(false)}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" size="sm" disabled={creating}>
                {creating ? 'Saving...' : 'Save Geofence'}
              </Button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
