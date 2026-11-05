export class RoutePolylineManager {
  private polyline: google.maps.Polyline | null = null;
  private startMarker: google.maps.Marker | null = null;
  private endMarker: google.maps.Marker | null = null;

  constructor(private map: google.maps.Map) {}

  public drawRoute(coordinates: [number, number][], strokeColor: string = '#3b82f6') {
    this.clear();

    if (!coordinates || coordinates.length === 0) return;

    const path = coordinates.map(([lat, lng]) => ({ lat, lng }));

    this.polyline = new google.maps.Polyline({
      path,
      geodesic: true,
      strokeColor,
      strokeOpacity: 0.9,
      strokeWeight: 4,
      map: this.map,
    });

    // Start marker (green dot)
    const startCoord = path[0];
    this.startMarker = new google.maps.Marker({
      position: startCoord,
      map: this.map,
      icon: {
        path: google.maps.SymbolPath.CIRCLE,
        scale: 6,
        fillColor: '#10b981',
        fillOpacity: 1,
        strokeColor: '#ffffff',
        strokeWeight: 2,
      },
      title: 'Route Origin',
    });

    // End marker (checkered / flag or red dot)
    if (path.length > 1) {
      const endCoord = path[path.length - 1];
      this.endMarker = new google.maps.Marker({
        position: endCoord,
        map: this.map,
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 6,
          fillColor: '#ef4444',
          fillOpacity: 1,
          strokeColor: '#ffffff',
          strokeWeight: 2,
        },
        title: 'Route Destination',
      });
    }

    // Fit bounds to polyline
    const bounds = new google.maps.LatLngBounds();
    path.forEach((pt) => bounds.extend(pt));
    this.map.fitBounds(bounds, { top: 50, right: 50, bottom: 50, left: 50 });
  }

  public clear() {
    if (this.polyline) {
      this.polyline.setMap(null);
      this.polyline = null;
    }
    if (this.startMarker) {
      this.startMarker.setMap(null);
      this.startMarker = null;
    }
    if (this.endMarker) {
      this.endMarker.setMap(null);
      this.endMarker = null;
    }
  }
}
