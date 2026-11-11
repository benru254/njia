/**
 * Shared data shapes. Used by the phone app, the map viewer and the tests.
 * Keep this file free of any React Native or browser imports.
 */

/** One GPS reading exactly as the phone gave it to us. */
export interface RawPoint {
  /** Time in milliseconds since 1970 (UTC). */
  t: number;
  lat: number;
  lon: number;
  /** Horizontal accuracy in metres (smaller is better). null if unknown. */
  acc: number | null;
  /** Altitude in metres. null if unknown. */
  alt: number | null;
  /** Speed in metres per second, measured by the GPS chip. null if unknown. */
  spd: number | null;
  /** Direction of travel in degrees (0 = north, 90 = east). null if unknown. */
  hdg: number | null;
}

/** A reading that passed the quality filters, with extra worked-out values. */
export interface TrackPoint {
  t: number;
  lat: number;
  lon: number;
  acc: number | null;
  alt: number | null;
  /** Speed in m/s. Always a number: GPS speed if we have it, else worked out. 0 inside a stop. */
  v: number;
  /** Direction in degrees. null only if it cannot be known yet. */
  dir: number | null;
  /** Distance travelled from the start of the trip up to this point, in metres. */
  dist: number;
  /** Index into Analysis.stops if this point is part of a stop, else -1. */
  stop: number;
  /** True if there is a recording gap (no data) between the previous point and this one. */
  gapBefore: boolean;
}

/** A place where you stayed put for a while. */
export interface Stop {
  index: number;
  lat: number;
  lon: number;
  /** Arrival time (ms). */
  start: number;
  /** Departure time (ms). */
  end: number;
  durationS: number;
  /** Index of the first and last TrackPoint in this stop. */
  first: number;
  last: number;
}

/** A period with no GPS data (phone killed the app, no signal, etc.). */
export interface Gap {
  /** Index of the TrackPoint just before the gap and just after it. */
  from: number;
  to: number;
  start: number;
  end: number;
  durationS: number;
  distanceM: number;
}

export interface TripStats {
  startTime: number;
  endTime: number;
  durationS: number;
  distanceM: number;
  movingS: number;
  stoppedS: number;
  gapS: number;
  /** Average speed while moving, m/s. */
  avgMovingSpeed: number;
  /** Top speed, m/s. */
  maxSpeed: number;
  /** Readings kept after filtering. */
  pointCount: number;
  /** Readings recorded in total. */
  rawCount: number;
  /** Readings thrown away as inaccurate or impossible. */
  droppedCount: number;
  bbox: { minLat: number; maxLat: number; minLon: number; maxLon: number } | null;
}

export interface Analysis {
  points: TrackPoint[];
  stops: Stop[];
  gaps: Gap[];
  stats: TripStats;
}

export interface AnalyzeOptions {
  /** Throw away readings less accurate than this (metres). */
  maxAccuracyM: number;
  /** Throw away readings that would need a faster speed than this to reach (m/s). */
  maxPlausibleSpeed: number;
  /** How close together readings must stay to count as "not moving" (metres). */
  stopRadiusM: number;
  /** How long you must stay put before it counts as a stop (seconds). */
  minStopS: number;
  /** A silence longer than this between readings is a recording gap (seconds). */
  gapS: number;
}

export const DEFAULT_OPTIONS: AnalyzeOptions = {
  maxAccuracyM: 50,
  maxPlausibleSpeed: 70, // 252 km/h
  stopRadiusM: 35,
  minStopS: 120,
  gapS: 60,
};

/** The file format used for backup and for sending a trip to the viewer. */
export interface TripFile {
  format: 'njia-trip';
  version: 1;
  trip: {
    id: number | string;
    name: string | null;
    startedAt: number;
    endedAt: number | null;
  };
  /** Each row: [t, lat, lon, acc, alt, spd, hdg] */
  points: Array<[number, number, number, number | null, number | null, number | null, number | null]>;
}
