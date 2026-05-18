/**
 * Pure great-circle distance and ETA helpers.
 *
 * No I/O, no time source, no randomness. Safe to call from anywhere.
 */

export interface LatLng {
  lat: number;
  lng: number;
}

const EARTH_RADIUS_KM = 6371;

function toRadians(deg: number): number {
  return (deg * Math.PI) / 180;
}

/**
 * Great-circle distance between two points in kilometers.
 */
export function haversineKm(a: LatLng, b: LatLng): number {
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);

  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);

  const h = sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLng * sinDLng;
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  return EARTH_RADIUS_KM * c;
}

export interface EtaOptions {
  /** Minutes of preparation added on top of travel time. Default 10. */
  prepBufferMin?: number;
  /** Assumed average speed in km/h. Default 25. */
  avgKmh?: number;
}

/**
 * Estimated delivery minutes from a restaurant/store to a delivery address.
 *
 * eta = (haversine_km / avgKmh) * 60 + prepBufferMin
 */
export function etaMinutes(restaurant: LatLng, address: LatLng, opts: EtaOptions = {}): number {
  const avgKmh = opts.avgKmh ?? 25;
  const prepBufferMin = opts.prepBufferMin ?? 10;
  const km = haversineKm(restaurant, address);
  return (km / avgKmh) * 60 + prepBufferMin;
}
