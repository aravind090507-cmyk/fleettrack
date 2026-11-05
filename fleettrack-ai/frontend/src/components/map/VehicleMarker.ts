import { Vehicle, VehicleLocation } from '../../types';
import { getStatusColor, formatVehicleType, formatSpeed, formatRelativeTime } from '../../utils/formatters';
import { createVehicleMarkerIcon, interpolatePosition, interpolateHeading } from '../../utils/mapUtils';

export class VehicleMarkerManager {
  private marker: google.maps.Marker;
  private infoWindow: google.maps.InfoWindow | null = null;
  private currentLat: number;
  private currentLng: number;
  private currentHeading: number;
  private animationFrameId: number | null = null;

  constructor(
    private map: google.maps.Map,
    public vehicle: Vehicle,
    location: VehicleLocation,
    private isSelected: boolean,
    private onSelect: (vehicleId: string) => void
  ) {
    this.currentLat = location.latitude;
    this.currentLng = location.longitude;
    this.currentHeading = location.heading || 0;

    const color = getStatusColor(vehicle.status).hex;
    const icon = createVehicleMarkerIcon(color, this.currentHeading, isSelected);

    this.marker = new google.maps.Marker({
      position: { lat: this.currentLat, lng: this.currentLng },
      map: this.map,
      icon,
      title: `${vehicle.registration_number} (${formatVehicleType(vehicle.vehicle_type)})`,
      zIndex: isSelected ? 999 : 100,
    });

    this.setupListeners();
  }

  private setupListeners() {
    this.marker.addListener('click', () => {
      this.onSelect(this.vehicle.id);
      this.showInfoWindow();
    });
  }

  public updateVehicle(vehicle: Vehicle) {
    this.vehicle = vehicle;
  }

  public setSelected(selected: boolean) {
    this.isSelected = selected;
    const color = getStatusColor(this.vehicle.status).hex;
    this.marker.setIcon(createVehicleMarkerIcon(color, this.currentHeading, selected));
    this.marker.setZIndex(selected ? 999 : 100);
  }

  public animateTo(newLocation: VehicleLocation, durationMs: number = 4000) {
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
    }

    const startPos = { lat: this.currentLat, lng: this.currentLng };
    const endPos = { lat: newLocation.latitude, lng: newLocation.longitude };
    const startHeading = this.currentHeading;
    const targetHeading = newLocation.heading || 0;
    const startTime = performance.now();

    const animate = (currentTime: number) => {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / durationMs, 1);

      // Ease out quad
      const ease = 1 - (1 - progress) * (1 - progress);

      const nextPos = interpolatePosition(startPos, endPos, ease);
      const nextHeading = interpolateHeading(startHeading, targetHeading, ease);

      this.currentLat = nextPos.lat;
      this.currentLng = nextPos.lng;
      this.currentHeading = nextHeading;

      this.marker.setPosition(nextPos);

      const color = getStatusColor(this.vehicle.status).hex;
      this.marker.setIcon(createVehicleMarkerIcon(color, nextHeading, this.isSelected));

      if (progress < 1) {
        this.animationFrameId = requestAnimationFrame(animate);
      } else {
        this.animationFrameId = null;
      }
    };

    this.animationFrameId = requestAnimationFrame(animate);
  }

  public showInfoWindow() {
    const loc = this.vehicle.latest_location;
    const color = getStatusColor(this.vehicle.status);

    const contentString = `
      <div style="font-family: inherit; font-size: 13px; color: #f8fafc; min-width: 190px;">
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; border-bottom: 1px solid #334155; padding-bottom: 4px;">
          <span style="font-weight: 700; font-size: 14px; color: #ffffff;">${this.vehicle.registration_number}</span>
          <span style="display: inline-block; padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: 700; text-transform: uppercase; background: ${color.hex}22; color: ${color.hex}; border: 1px solid ${color.hex}66;">
            ${this.vehicle.status}
          </span>
        </div>
        <div style="display: grid; gap: 4px; color: #cbd5e1;">
          <div><strong style="color: #94a3b8;">Type:</strong> ${formatVehicleType(this.vehicle.vehicle_type)}</div>
          <div><strong style="color: #94a3b8;">Speed:</strong> ${formatSpeed(loc?.speed)}</div>
          <div><strong style="color: #94a3b8;">Updated:</strong> ${formatRelativeTime(loc?.recorded_at)}</div>
        </div>
      </div>
    `;

    if (!this.infoWindow) {
      this.infoWindow = new google.maps.InfoWindow();
    }
    this.infoWindow.setContent(contentString);
    this.infoWindow.open(this.map, this.marker);
  }

  public closeInfoWindow() {
    if (this.infoWindow) {
      this.infoWindow.close();
    }
  }

  public getPosition(): google.maps.LatLngLiteral {
    return { lat: this.currentLat, lng: this.currentLng };
  }

  public destroy() {
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
    }
    this.closeInfoWindow();
    this.marker.setMap(null);
  }
}
