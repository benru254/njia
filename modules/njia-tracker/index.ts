/**
 * The native recorder (Kotlin, in ./android). It records on its own, without the
 * app screen, and keeps the points in its own small database until the app
 * imports them (see src/data/importer.ts).
 */
import { requireOptionalNativeModule } from 'expo';

export type TrackerMode = 'moving' | 'still';

export interface TrackerStatus {
  enabled: boolean;
  running: boolean;
  mode: TrackerMode;
  modeSince: number;
  lastFixT: number;
  lastFixAcc: number;
  motionSensor: boolean;
}

export interface TrackerConfig {
  intervalMs?: number;
  stillAfterMs?: number;
  stillAfterPlaceMs?: number;
  stillCheckMs?: number;
  places?: Array<{ lat: number; lon: number; radiusM: number }>;
}

export interface TrackerEvent {
  t: number;
  kind: 'start' | 'stop' | 'still' | 'moving' | 'settings' | 'info' | 'error' | string;
  detail: string | null;
}

/** [id, t, lat, lon, acc, alt, spd, hdg, src] — src: 0 GPS, 1 "still here" check, 2 wake-up reading */
export type BufferRow = [number, number, number, number, number | null, number | null, number | null, number | null, number];

interface NjiaTrackerNative {
  configure(config: TrackerConfig): void;
  start(why: string): void;
  stop(): void;
  getStatus(): TrackerStatus;
  readPoints(afterId: number, limit: number): Promise<BufferRow[]>;
  deletePointsUpTo(id: number): Promise<number>;
  pendingCount(): Promise<number>;
  getEvents(limit: number): Promise<TrackerEvent[]>;
}

const native = requireOptionalNativeModule<NjiaTrackerNative>('NjiaTracker');

/** null when the app was not built with the recorder (e.g. Expo Go). */
export const NjiaTracker: NjiaTrackerNative | null = native;

export function tracker(): NjiaTrackerNative {
  if (!native) {
    throw new Error('The Njia recorder is missing from this build. Install the APK from GitHub Releases.');
  }
  return native;
}
