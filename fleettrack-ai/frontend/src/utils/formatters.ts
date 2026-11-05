import { format, formatDistanceToNow, parseISO } from 'date-fns';
import { VehicleStatus, VehicleType, ProjectStatus } from '../types';

export function formatDateTime(dateStr?: string | null): string {
  if (!dateStr) return 'N/A';
  try {
    const d = typeof dateStr === 'string' ? parseISO(dateStr) : new Date(dateStr);
    return format(d, 'MMM d, yyyy HH:mm');
  } catch {
    return dateStr;
  }
}

export function formatDate(dateStr?: string | null): string {
  if (!dateStr) return 'N/A';
  try {
    const d = typeof dateStr === 'string' ? parseISO(dateStr) : new Date(dateStr);
    return format(d, 'MMM d, yyyy');
  } catch {
    return dateStr;
  }
}

export function formatRelativeTime(dateStr?: string | null): string {
  if (!dateStr) return 'Never';
  try {
    const d = typeof dateStr === 'string' ? parseISO(dateStr) : new Date(dateStr);
    return formatDistanceToNow(d, { addSuffix: true });
  } catch {
    return dateStr;
  }
}

export function formatSpeed(speedKmH?: number | null): string {
  if (speedKmH === undefined || speedKmH === null || isNaN(speedKmH)) return '0 km/h';
  return `${Math.round(speedKmH)} km/h`;
}

export function formatDistance(distanceKm?: number | null): string {
  if (distanceKm === undefined || distanceKm === null || isNaN(distanceKm)) return '0 km';
  if (distanceKm < 1) {
    return `${Math.round(distanceKm * 1000)} m`;
  }
  return `${distanceKm.toFixed(1)} km`;
}

export function formatDurationHours(hours?: number | null): string {
  if (hours === undefined || hours === null || isNaN(hours)) return '0h';
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  if (h === 0) return `${m}m`;
  return `${h}h ${m}m`;
}

export function formatDurationSeconds(seconds?: number | null): string {
  if (seconds === undefined || seconds === null || isNaN(seconds)) return '0s';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${secs}s`;
  return `${secs}s`;
}

export const formatDuration = formatDurationSeconds;

export function formatVehicleType(type?: VehicleType | string): string {
  if (!type) return 'Unknown';
  switch (type) {
    case 'dump_truck': return 'Dump Truck';
    case 'excavator': return 'Excavator';
    case 'concrete_mixer': return 'Concrete Mixer';
    case 'loader': return 'Wheel Loader';
    case 'crane_truck': return 'Crane Truck';
    default:
      return type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  }
}

export function formatVehicleStatus(status?: VehicleStatus | string): string {
  if (!status) return 'Unknown';
  switch (status) {
    case 'active': return 'Active';
    case 'idle': return 'Idle';
    case 'moving': return 'Moving';
    case 'offline': return 'Offline';
    case 'maintenance': return 'Maintenance';
    default:
      return status.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  }
}

export function formatProjectStatus(status?: ProjectStatus | string): string {
  if (!status) return 'Unknown';
  switch (status) {
    case 'planning': return 'Planning';
    case 'active': return 'In Progress';
    case 'completed': return 'Completed';
    case 'on_hold': return 'On Hold';
    default:
      return status.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  }
}

export function getStatusColor(status?: VehicleStatus | string): {
  bg: string;
  text: string;
  border: string;
  hex: string;
} {
  switch (status) {
    case 'moving':
      return {
        bg: 'bg-emerald-950/50',
        text: 'text-emerald-400',
        border: 'border-emerald-600/30',
        hex: '#10b981',
      };
    case 'idle':
      return {
        bg: 'bg-amber-950/50',
        text: 'text-amber-400',
        border: 'border-amber-600/30',
        hex: '#f59e0b',
      };
    case 'offline':
      return {
        bg: 'bg-red-950/50',
        text: 'text-red-400',
        border: 'border-red-600/30',
        hex: '#ef4444',
      };
    case 'maintenance':
      return {
        bg: 'bg-purple-950/50',
        text: 'text-purple-400',
        border: 'border-purple-600/30',
        hex: '#8b5cf6',
      };
    case 'active':
    default:
      return {
        bg: 'bg-blue-950/50',
        text: 'text-blue-400',
        border: 'border-blue-600/30',
        hex: '#3b82f6',
      };
  }
}
