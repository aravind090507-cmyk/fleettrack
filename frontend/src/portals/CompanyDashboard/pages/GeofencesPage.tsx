import React, { useEffect, useState, useMemo } from 'react';
import {
  Shield,
  Plus,
  Trash2,
  RefreshCw,
  Link as LinkIcon,
  MapPin,
  X,
  Check,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';
import { MapContainer, TileLayer, Polygon, Circle, Marker, Popup } from 'react-leaflet';
import L from 'leaflet';
import { geofencesApi, devicesApi } from '../../../services/api';
import { Device, Geofence } from '../../../types';
import { Card } from '../../../components/ui/Card';
import { Button } from '../../../components/ui/Button';
import { LoadingSpinner } from '../../../components/ui/LoadingSpinner';

export const GeofencesPage: React.FC = () => {
  const [geofences, setGeofences] = useState<Geofence[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [selectedGeofence, setSelectedGeofence] = useState<Geofence | null>(null);

  // Modal states
  const [showCreateModal, setShowCreateModal] = useState<boolean>(false);
  const [showLinkModal, setShowLinkModal] = useState<boolean>(false);
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

  // Link devices state
  const [selectedDeviceIds, setSelectedDeviceIds] = useState<string[]>([]);
  const [linking, setLinking] = useState<boolean>(false);

  const loadData = async () => {
    try {
      setLoading(true);
      const [gList, dList] = await Promise.all([
        geofencesApi.list().catch(() => []),
        devicesApi.list().catch(() => []),
      ]);
      setGeofences(gList);
      setDevices(dList);
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

  const openLinkModal = (gf: Geofence) => {
    setSelectedGeofence(gf);
    setSelectedDeviceIds(gf.device_ids || []);
    setShowLinkModal(true);
  };

  const handleSaveLinks = async () => {
    if (!selectedGeofence) return;
    try {
      setLinking(true);
      await geofencesApi.linkDevices(selectedGeofence.id, selectedDeviceIds);
      setShowLinkModal(false);
      await loadData();
    } catch (err: any) {
      alert('Failed to link devices: ' + (err.response?.data?.detail || err.message));
    } finally {
      setLinking(false);
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

  if (loading) return <LoadingSpinner label="Loading geofences..." />;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
            <Shield className="w-5 h-5 text-emerald-400" />
            Geofencing & Spatial Perimeters
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
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
            <div className="divide-y divide-slate-800/80 max-h-[500px] overflow-y-auto">
              {geofences.length === 0 ? (
                <p className="py-6 text-center text-xs text-slate-500">
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
                      className={`p-3 rounded-xl transition cursor-pointer flex flex-col gap-1.5 ${
                        isSelected
                          ? 'bg-emerald-950/40 border border-emerald-800/80 shadow-md'
                          : 'hover:bg-slate-800/40'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-sm text-white">{gf.name}</span>
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700 uppercase">
                          {isCircle ? 'Circle' : 'Polygon'}
                        </span>
                      </div>
                      {gf.description && (
                        <p className="text-xs text-slate-400 line-clamp-1">{gf.description}</p>
                      )}
                      <div className="flex items-center justify-between text-[11px] text-slate-500 pt-1">
                        <span>{gf.device_ids?.length || 0} devices linked</span>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              openLinkModal(gf);
                            }}
                            className="text-emerald-400 hover:text-emerald-300 font-semibold"
                          >
                            Link Devices
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDelete(gf.id);
                            }}
                            className="text-rose-400 hover:text-rose-300"
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
            <div className="h-[480px] w-full rounded-xl overflow-hidden border border-slate-800 relative">
              <MapContainer center={mapCenter} zoom={13} className="w-full h-full">
                <TileLayer
                  attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                  className="dark-tiles"
                />

                {parsedGeofence?.type === 'circle' && (
                  <Circle
                    center={[parsedGeofence.lat, parsedGeofence.lng]}
                    radius={parsedGeofence.radius}
                    pathOptions={{
                      color: '#10b981',
                      fillColor: '#10b981',
                      fillOpacity: 0.25,
                      weight: 2,
                    }}
                  />
                )}

                {parsedGeofence?.type === 'polygon' && (
                  <Polygon
                    positions={parsedGeofence.positions}
                    pathOptions={{
                      color: '#10b981',
                      fillColor: '#10b981',
                      fillOpacity: 0.25,
                      weight: 2,
                    }}
                  />
                )}
              </MapContainer>
            </div>
          </Card>
        </div>
      </div>

      {/* Create Geofence Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <form
            onSubmit={handleCreate}
            className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-lg p-6 shadow-2xl space-y-4"
          >
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-base font-bold text-white">Create Virtual Geofence Perimeter</h3>
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-400 font-semibold mb-1">Perimeter Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Warehouse Central Depot"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-white focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="block text-slate-400 font-semibold mb-1">Description (Optional)</label>
                <input
                  type="text"
                  placeholder="e.g. Inbound logistics yard & loading docks"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-white focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div className="flex items-center gap-4 pt-1">
                <label className="flex items-center gap-2 cursor-pointer text-slate-300">
                  <input
                    type="radio"
                    name="geotype"
                    checked={geoType === 'circle'}
                    onChange={() => setGeoType('circle')}
                    className="text-emerald-500"
                  />
                  <span>Circle (Radius)</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer text-slate-300">
                  <input
                    type="radio"
                    name="geotype"
                    checked={geoType === 'polygon'}
                    onChange={() => setGeoType('polygon')}
                    className="text-emerald-500"
                  />
                  <span>Polygon (Coordinates)</span>
                </label>
              </div>

              {geoType === 'circle' ? (
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="block text-slate-400 font-semibold mb-1">Center Lat</label>
                    <input
                      type="text"
                      required
                      value={centerLat}
                      onChange={(e) => setCenterLat(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-white font-mono focus:outline-none focus:border-emerald-500"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-400 font-semibold mb-1">Center Lng</label>
                    <input
                      type="text"
                      required
                      value={centerLng}
                      onChange={(e) => setCenterLng(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-white font-mono focus:outline-none focus:border-emerald-500"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-400 font-semibold mb-1">Radius (meters)</label>
                    <input
                      type="number"
                      required
                      value={radiusM}
                      onChange={(e) => setRadiusM(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-white font-mono focus:outline-none focus:border-emerald-500"
                    />
                  </div>
                </div>
              ) : (
                <div>
                  <label className="block text-slate-400 font-semibold mb-1">
                    Polygon Coordinates (lat lng, lat lng, ...)
                  </label>
                  <textarea
                    rows={3}
                    required
                    value={polygonCoords}
                    onChange={(e) => setPolygonCoords(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-white font-mono text-xs focus:outline-none focus:border-emerald-500"
                  />
                  <p className="text-[10px] text-slate-500 mt-1">
                    Enter pairs of `lat lng` separated by commas. The polygon must close (first and last match).
                  </p>
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
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

      {/* Link Devices Modal */}
      {showLinkModal && selectedGeofence && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-md p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-base font-bold text-white">Link Devices to {selectedGeofence.name}</h3>
              <button type="button" onClick={() => setShowLinkModal(false)} className="text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-slate-400">
              Select which fleet devices trigger entry/exit alert events for this boundary:
            </p>

            <div className="max-h-60 overflow-y-auto space-y-2 pr-1">
              {devices.length === 0 ? (
                <p className="text-xs text-slate-500">No devices available to link.</p>
              ) : (
                devices.map((d) => {
                  const checked = selectedDeviceIds.includes(d.id);
                  return (
                    <label
                      key={d.id}
                      className="flex items-center gap-3 p-2.5 rounded-xl bg-slate-950 border border-slate-800 cursor-pointer hover:bg-slate-800/40 text-xs"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => {
                          if (checked) {
                            setSelectedDeviceIds((ids) => ids.filter((id) => id !== d.id));
                          } else {
                            setSelectedDeviceIds((ids) => [...ids, d.id]);
                          }
                        }}
                        className="rounded border-slate-700 text-emerald-500 focus:ring-0"
                      />
                      <div className="flex-1">
                        <span className="font-bold text-white block">{d.name}</span>
                        <span className="text-[10px] text-slate-400 font-mono">{d.unique_id}</span>
                      </div>
                    </label>
                  );
                })
              )}
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
              <Button type="button" variant="secondary" size="sm" onClick={() => setShowLinkModal(false)}>
                Cancel
              </Button>
              <Button type="button" variant="primary" size="sm" onClick={handleSaveLinks} disabled={linking}>
                {linking ? 'Linking...' : 'Save Links'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
