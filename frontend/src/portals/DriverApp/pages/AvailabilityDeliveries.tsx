import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  CheckCircle2,
  Clock,
  MapPin,
  User,
  AlertCircle,
  Play,
  Check,
  X,
  ShieldCheck,
  Navigation,
  FileText,
  RefreshCw,
  Bell,
  ArrowRight,
} from 'lucide-react';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import L from 'leaflet';
import { DeliveryAssignment } from '../../../types';
import { driverDispatchApi, journeysApi } from '../../../services/api';
import { useDriverStore } from '../../../store/driverStore';
import { Button } from '../../../components/ui/Button';
import { Card } from '../../../components/ui/Card';
import { getMapTileConfig } from '../../../services/mapConfig';

// Custom Marker for Destination Preview
const destPinIcon = L.divIcon({
  html: `
    <div style="width: 32px; height: 32px; background: #E11D48; border: 3px solid white; border-radius: 50%; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 12px rgba(225,29,72,0.4); transform: translate(-50%, -50%);">
      <div style="width: 10px; height: 10px; background: white; border-radius: 50%;"></div>
    </div>
  `,
  className: 'dest-preview-pin',
  iconSize: [32, 32],
});

interface AvailabilityDeliveriesProps {
  onNavigateToTrip?: () => void;
}

export const AvailabilityDeliveries: React.FC<AvailabilityDeliveriesProps> = ({ onNavigateToTrip }) => {
  const { setJourney } = useDriverStore();

  const [availability, setAvailability] = useState<'AVAILABLE' | 'UNAVAILABLE' | 'BUSY'>('AVAILABLE');
  const [pref, setPref] = useState<'AVAILABLE' | 'UNAVAILABLE'>('AVAILABLE');
  const [activeAssignment, setActiveAssignment] = useState<DeliveryAssignment | null>(null);
  const [pastAssignments, setPastAssignments] = useState<DeliveryAssignment[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const tileConfig = getMapTileConfig();
  const pollTimerRef = useRef<any>(null);

  const fetchStatusAndAssignments = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    setErrorMsg(null);
    try {
      const [availRes, activeAsgRes, pastList] = await Promise.all([
        driverDispatchApi.getAvailability(),
        driverDispatchApi.getActiveAssignment(),
        driverDispatchApi.getAssignments(),
      ]);

      setAvailability(availRes.availability);
      setPref((availRes.availability_preference as 'AVAILABLE' | 'UNAVAILABLE') || 'AVAILABLE');
      setActiveAssignment(activeAsgRes);
      // Filter out current active from past list
      const past = pastList.filter(
        (a: DeliveryAssignment) => a.id !== activeAsgRes?.id && ['COMPLETED', 'REJECTED', 'CANCELLED'].includes(a.status)
      );
      setPastAssignments(past);
    } catch (err: any) {
      console.warn('Failed to fetch driver availability/assignments:', err);
      if (!quiet) {
        setErrorMsg(err.response?.data?.detail || 'Unable to load delivery status');
      }
    } finally {
      if (!quiet) setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatusAndAssignments(false);

    // Polling interval for incoming assignments and status changes
    pollTimerRef.current = setInterval(() => {
      fetchStatusAndAssignments(true);
    }, 4000);

    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    };
  }, [fetchStatusAndAssignments]);

  const handleToggleAvailability = async (target: 'AVAILABLE' | 'UNAVAILABLE') => {
    if (availability === 'BUSY') {
      setErrorMsg('Cannot change availability while an active delivery is assigned or in progress.');
      return;
    }
    setActionLoading('toggle');
    setErrorMsg(null);
    try {
      const updated = await driverDispatchApi.updateAvailability(target);
      setAvailability(updated.availability);
      setPref((updated.availability_preference as 'AVAILABLE' | 'UNAVAILABLE') || target);
      setSuccessMsg(`Availability updated to ${target}`);
      setTimeout(() => setSuccessMsg(null), 3000);
    } catch (err: any) {
      setErrorMsg(err.response?.data?.detail || 'Failed to update availability');
    } finally {
      setActionLoading(null);
    }
  };

  const handleAccept = async (assignmentId: string) => {
    setActionLoading('accept');
    setErrorMsg(null);
    try {
      const res = await driverDispatchApi.acceptAssignment(assignmentId);
      setActiveAssignment(res);
      setAvailability('BUSY');
      setSuccessMsg('Delivery assignment accepted! Click START DELIVERY when ready to drive.');
      setTimeout(() => setSuccessMsg(null), 4000);
    } catch (err: any) {
      setErrorMsg(err.response?.data?.detail || 'Failed to accept delivery assignment');
    } finally {
      setActionLoading(null);
    }
  };

  const handleReject = async (assignmentId: string) => {
    if (!window.confirm('Are you sure you want to decline this delivery assignment?')) {
      return;
    }
    setActionLoading('reject');
    setErrorMsg(null);
    try {
      await driverDispatchApi.rejectAssignment(assignmentId);
      setActiveAssignment(null);
      setAvailability(pref);
      setSuccessMsg('Delivery assignment declined. Manager will be notified.');
      setTimeout(() => setSuccessMsg(null), 4000);
      fetchStatusAndAssignments(true);
    } catch (err: any) {
      setErrorMsg(err.response?.data?.detail || 'Failed to reject delivery assignment');
    } finally {
      setActionLoading(null);
    }
  };

  const handleStartDelivery = async (assignmentId: string) => {
    setActionLoading('start');
    setErrorMsg(null);
    try {
      const res = await driverDispatchApi.startDelivery(assignmentId);
      setSuccessMsg('Delivery trip started! Switching to live navigation...');

      // Fetch the newly created/linked Journey
      if (res.journey_id) {
        try {
          const journeyData = await journeysApi.get(res.journey_id);
          const trackingUrl = res.tracking_url || undefined;
          const trackingToken = res.tracking_token || undefined;

          // Hydrate the driver store so GPS tracker starts immediately
          setJourney(journeyData, trackingUrl, trackingToken);
        } catch (fetchErr) {
          console.warn('Could not fetch journey details after start:', fetchErr);
        }
      }

      // Transition to active navigation view
      if (onNavigateToTrip) {
        setTimeout(() => {
          onNavigateToTrip();
        }, 600);
      }
    } catch (err: any) {
      setErrorMsg(err.response?.data?.detail || 'Failed to start delivery trip');
    } finally {
      setActionLoading(null);
    }
  };

  const handleCompleteDelivery = async (assignmentId: string) => {
    if (!window.confirm('Confirm delivery completion at destination?')) {
      return;
    }
    setActionLoading('complete');
    setErrorMsg(null);
    try {
      const res = await driverDispatchApi.completeDelivery(assignmentId);
      setActiveAssignment(res);
      setAvailability(pref);
      setSuccessMsg('Delivery successfully completed! Good job.');
      setTimeout(() => setSuccessMsg(null), 4000);
      fetchStatusAndAssignments(true);
    } catch (err: any) {
      setErrorMsg(err.response?.data?.detail || 'Failed to complete delivery');
    } finally {
      setActionLoading(null);
    }
  };

  return (
    <div className="space-y-4 pb-12 select-none">
      {/* Messages */}
      {errorMsg && (
        <div className="p-3.5 bg-rose-50 border border-rose-200/80 rounded-2xl flex items-center gap-2.5 text-xs text-rose-700 font-medium animate-fadeIn">
          <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}
      {successMsg && (
        <div className="p-3.5 bg-emerald-50 border border-emerald-200/80 rounded-2xl flex items-center gap-2.5 text-xs text-emerald-800 font-medium animate-fadeIn">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>{successMsg}</span>
        </div>
      )}

      {/* Driver Availability Card */}
      <Card className="p-4 border-black/[0.06] shadow-sm bg-white rounded-2xl">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-blue-50 text-[#0071E3] flex items-center justify-center font-bold">
              <ShieldCheck className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-xs font-bold uppercase tracking-wider text-zinc-900">Driver Availability</h2>
              <p className="text-[11px] text-zinc-500 font-medium">Control whether manager can dispatch to you</p>
            </div>
          </div>
          <button
            onClick={() => fetchStatusAndAssignments(false)}
            title="Refresh availability"
            className="p-1.5 text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100 rounded-lg transition-colors cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {/* Current State Pill */}
        <div className="p-3 rounded-xl bg-zinc-50 border border-black/[0.04] flex items-center justify-between mb-3">
          <span className="text-xs font-semibold text-zinc-600">Current Status:</span>
          {availability === 'AVAILABLE' && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-emerald-500/10 text-emerald-700 border border-emerald-500/20">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              AVAILABLE FOR DISPATCH
            </span>
          )}
          {availability === 'UNAVAILABLE' && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-zinc-200 text-zinc-700 border border-zinc-300">
              <span className="w-2 h-2 rounded-full bg-zinc-500" />
              UNAVAILABLE (OFFLINE)
            </span>
          )}
          {availability === 'BUSY' && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-blue-500/10 text-blue-700 border border-blue-500/20">
              <span className="w-2 h-2 rounded-full bg-blue-600 animate-ping" />
              BUSY (ACTIVE DELIVERY)
            </span>
          )}
        </div>

        {/* Action Toggle Buttons */}
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            disabled={availability === 'BUSY' || actionLoading === 'toggle'}
            onClick={() => handleToggleAvailability('AVAILABLE')}
            className={`py-2 px-3 rounded-xl text-xs font-semibold transition-all flex items-center justify-center gap-1.5 border cursor-pointer ${
              availability === 'AVAILABLE'
                ? 'bg-emerald-600 text-white border-emerald-700 shadow-sm'
                : 'bg-white text-zinc-700 border-zinc-200 hover:bg-emerald-50 hover:text-emerald-700 hover:border-emerald-300 disabled:opacity-50 disabled:cursor-not-allowed'
            }`}
          >
            <Check className="w-3.5 h-3.5" />
            Set Available
          </button>
          <button
            type="button"
            disabled={availability === 'BUSY' || actionLoading === 'toggle'}
            onClick={() => handleToggleAvailability('UNAVAILABLE')}
            className={`py-2 px-3 rounded-xl text-xs font-semibold transition-all flex items-center justify-center gap-1.5 border cursor-pointer ${
              availability === 'UNAVAILABLE'
                ? 'bg-zinc-800 text-white border-zinc-900 shadow-sm'
                : 'bg-white text-zinc-700 border-zinc-200 hover:bg-zinc-100 hover:border-zinc-300 disabled:opacity-50 disabled:cursor-not-allowed'
            }`}
          >
            <X className="w-3.5 h-3.5" />
            Set Unavailable
          </button>
        </div>

        {availability === 'BUSY' && (
          <p className="mt-2.5 text-[11px] text-amber-700 bg-amber-50 p-2 rounded-lg border border-amber-200">
            Availability is locked to <strong>BUSY</strong> while handling an active delivery. Completing or rejecting the assignment will restore your status.
          </p>
        )}
      </Card>

      {/* Pending Incoming Assignment Banner / Alert */}
      {activeAssignment && activeAssignment.status === 'PENDING' && (
        <Card className="p-4 border-amber-300 bg-amber-50/70 rounded-2xl shadow-md ring-2 ring-amber-400/40 animate-pulse">
          <div className="flex items-center gap-2 mb-2 text-amber-900 font-bold text-xs uppercase tracking-wider">
            <Bell className="w-4 h-4 text-amber-600 animate-bounce" />
            New Incoming Delivery Assignment!
          </div>
          <p className="text-xs text-amber-800 mb-3 font-medium">
            A manager has dispatched a new delivery. Please review the destination and instructions below.
          </p>
        </Card>
      )}

      {/* Active Assignment Card (PENDING, ACCEPTED, or IN_PROGRESS) */}
      {activeAssignment && ['PENDING', 'ACCEPTED', 'IN_PROGRESS'].includes(activeAssignment.status) ? (
        <Card className="p-4 border-black/[0.06] shadow-sm bg-white rounded-2xl space-y-3.5">
          {/* Header */}
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md bg-zinc-100 text-zinc-600 border border-zinc-200">
                  REF: {activeAssignment.assignment_reference || activeAssignment.id.slice(0, 8)}
                </span>
                <span
                  className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border ${
                    activeAssignment.status === 'PENDING'
                      ? 'bg-amber-50 text-amber-700 border-amber-200'
                      : activeAssignment.status === 'ACCEPTED'
                      ? 'bg-blue-50 text-blue-700 border-blue-200'
                      : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                  }`}
                >
                  {activeAssignment.status.replace('_', ' ')}
                </span>
              </div>
              <h3 className="text-sm font-bold text-zinc-900 mt-1">Delivery Destination</h3>
            </div>
          </div>

          {/* Destination Details */}
          <div className="p-3 rounded-xl bg-zinc-50 border border-black/[0.04] space-y-2 text-xs">
            <div className="flex items-start gap-2 text-zinc-800 font-medium">
              <MapPin className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-zinc-900">{activeAssignment.destination_name || activeAssignment.destination_address}</p>
                <p className="text-[10px] text-zinc-400 font-mono mt-0.5">
                  {activeAssignment.destination_lat.toFixed(5)}, {activeAssignment.destination_lng.toFixed(5)}
                </p>
              </div>
            </div>

            {activeAssignment.manager_name && (
              <div className="flex items-center gap-2 text-zinc-600 text-[11px] pt-1 border-t border-zinc-200/60">
                <User className="w-3.5 h-3.5 text-zinc-400" />
                <span>Dispatched by: <strong className="text-zinc-800">{activeAssignment.manager_name}</strong></span>
              </div>
            )}

            {(activeAssignment.instructions || activeAssignment.delivery_instructions) && (
              <div className="p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-900 text-[11px]">
                <span className="font-bold mb-0.5 flex items-center gap-1">
                  <FileText className="w-3 h-3 text-amber-600" /> Instructions:
                </span>
                {activeAssignment.instructions || activeAssignment.delivery_instructions}
              </div>
            )}

            <div className="flex items-center gap-2 text-[10px] text-zinc-400">
              <Clock className="w-3 h-3" />
              <span>Assigned: {new Date(activeAssignment.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
            </div>
          </div>

          {/* Map Preview of Destination */}
          <div className="h-44 w-full rounded-xl overflow-hidden border border-black/[0.08] relative z-0">
            <MapContainer
              center={[activeAssignment.destination_lat, activeAssignment.destination_lng]}
              zoom={14}
              scrollWheelZoom={false}
              zoomControl={false}
              className="h-full w-full"
            >
              <TileLayer url={tileConfig.url} attribution={tileConfig.attribution} />
              <Marker position={[activeAssignment.destination_lat, activeAssignment.destination_lng]} icon={destPinIcon}>
                <Popup>
                  <div className="p-1 text-xs">
                    <p className="font-bold text-zinc-900">Destination</p>
                    <p className="text-[11px] text-zinc-600">{activeAssignment.destination_name || activeAssignment.destination_address}</p>
                  </div>
                </Popup>
              </Marker>
            </MapContainer>
          </div>

          {/* Contextual Actions Based on Status */}
          {activeAssignment.status === 'PENDING' && (
            <div className="grid grid-cols-2 gap-2 pt-1">
              <Button
                variant="primary"
                onClick={() => handleAccept(activeAssignment.id)}
                isLoading={actionLoading === 'accept'}
                className="w-full bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs py-2.5 font-bold shadow-md shadow-emerald-600/20"
              >
                <Check className="w-4 h-4 mr-1.5" /> Accept Delivery
              </Button>
              <Button
                variant="secondary"
                onClick={() => handleReject(activeAssignment.id)}
                isLoading={actionLoading === 'reject'}
                className="w-full bg-white hover:bg-rose-50 text-rose-600 border border-rose-200 rounded-xl text-xs py-2.5 font-bold"
              >
                <X className="w-4 h-4 mr-1.5" /> Reject Delivery
              </Button>
            </div>
          )}

          {activeAssignment.status === 'ACCEPTED' && (
            <div className="space-y-2 pt-1">
              <Button
                variant="primary"
                onClick={() => handleStartDelivery(activeAssignment.id)}
                isLoading={actionLoading === 'start'}
                className="w-full bg-[#0071E3] hover:bg-blue-600 text-white rounded-xl text-xs py-3 font-bold shadow-md shadow-blue-500/25 flex items-center justify-center gap-1.5"
              >
                <Play className="w-4 h-4 fill-white" /> Start Delivery & Navigation
              </Button>
              <p className="text-[10px] text-center text-zinc-400 font-medium">
                Starting creates your active trip and begins transmitting real-time GPS telemetry.
              </p>
            </div>
          )}

          {activeAssignment.status === 'IN_PROGRESS' && (
            <div className="space-y-2.5 pt-1">
              {onNavigateToTrip && (
                <button
                  type="button"
                  onClick={onNavigateToTrip}
                  className="w-full py-2.5 px-3 rounded-xl bg-blue-50 hover:bg-blue-100/80 text-[#0071E3] border border-blue-200/60 text-xs font-bold transition-all flex items-center justify-center gap-2 cursor-pointer"
                >
                  <Navigation className="w-4 h-4" /> Switch to Live Map & Telemetry <ArrowRight className="w-3.5 h-3.5" />
                </button>
              )}
              <Button
                variant="primary"
                onClick={() => handleCompleteDelivery(activeAssignment.id)}
                isLoading={actionLoading === 'complete'}
                className="w-full bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs py-3 font-bold shadow-md shadow-emerald-600/20 flex items-center justify-center gap-1.5"
              >
                <CheckCircle2 className="w-4 h-4" /> Complete Delivery
              </Button>
            </div>
          )}
        </Card>
      ) : (
        /* Empty State */
        <Card className="p-6 border-black/[0.06] shadow-sm bg-white rounded-2xl text-center space-y-2">
          <div className="w-12 h-12 rounded-full bg-zinc-100 text-zinc-400 flex items-center justify-center mx-auto mb-1">
            <Navigation className="w-6 h-6" />
          </div>
          <h3 className="text-sm font-bold text-zinc-900">No Active Delivery Assignment</h3>
          <p className="text-xs text-zinc-500 max-w-xs mx-auto">
            {availability === 'AVAILABLE'
              ? 'You are online and ready to receive delivery dispatches from your fleet manager.'
              : 'You are currently marked unavailable. Switch to Available to receive dispatches.'}
          </p>
        </Card>
      )}

      {/* Recent Delivery History Accordion / List */}
      {pastAssignments.length > 0 && (
        <Card className="p-4 border-black/[0.06] shadow-sm bg-white rounded-2xl space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-900 flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-zinc-400" /> Recent Assignments
            </h3>
            <span className="text-[10px] text-zinc-400 font-bold">{pastAssignments.length} total</span>
          </div>

          <div className="space-y-2">
            {pastAssignments.slice(0, 5).map((asg) => (
              <div
                key={asg.id}
                className="p-2.5 rounded-xl bg-zinc-50 border border-black/[0.04] flex items-center justify-between text-xs"
              >
                <div className="min-w-0 pr-2">
                  <p className="font-semibold text-zinc-900 truncate text-[11px]">{asg.destination_name || asg.destination_address}</p>
                  <p className="text-[10px] text-zinc-400">
                    REF: {asg.assignment_reference || asg.id.slice(0, 8)} •{' '}
                    {new Date(asg.created_at).toLocaleDateString()}
                  </p>
                </div>
                <span
                  className={`text-[9px] font-bold uppercase px-2 py-0.5 rounded-full shrink-0 ${
                    asg.status === 'COMPLETED'
                      ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                      : asg.status === 'REJECTED'
                      ? 'bg-rose-50 text-rose-700 border border-rose-200'
                      : 'bg-zinc-100 text-zinc-600 border border-zinc-200'
                  }`}
                >
                  {asg.status}
                </span>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
};
