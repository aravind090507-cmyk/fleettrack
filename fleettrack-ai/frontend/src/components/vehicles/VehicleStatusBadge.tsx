import React from 'react';
import { VehicleStatus } from '../../types';
import { getStatusColor, formatVehicleStatus } from '../../utils/formatters';
import { clsx } from 'clsx';

interface VehicleStatusBadgeProps {
  status: VehicleStatus | string;
  size?: 'sm' | 'md';
  showDot?: boolean;
  className?: string;
}

export function VehicleStatusBadge({
  status,
  size = 'md',
  showDot = true,
  className = '',
}: VehicleStatusBadgeProps) {
  const color = getStatusColor(status);
  const isMoving = status === 'moving';

  const sizeClasses = {
    sm: 'text-[10px] px-2 py-0.5',
    md: 'text-xs px-2.5 py-1',
  };

  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1.5 font-medium rounded-full border uppercase tracking-wider',
        color.bg,
        color.text,
        color.border,
        sizeClasses[size],
        className
      )}
    >
      {showDot && (
        <span className="relative flex h-2 w-2">
          {isMoving && (
            <span
              className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75"
              style={{ backgroundColor: color.hex }}
            />
          )}
          <span
            className="relative inline-flex rounded-full h-2 w-2"
            style={{ backgroundColor: color.hex }}
          />
        </span>
      )}
      <span>{formatVehicleStatus(status)}</span>
    </span>
  );
}

export default VehicleStatusBadge;
