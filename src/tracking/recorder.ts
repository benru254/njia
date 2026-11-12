/** Starting and stopping a recording. */
import * as Location from 'expo-location';
import { getMeta, setMeta } from '../data/db';
import { rebuildLegs } from '../data/legs';
import { clearActiveTrip, createTrip, deleteTrip, finishTrip, getActiveTripId } from '../data/trips';
import { LOCATION_TASK } from './task';

export const INTERVAL_CHOICES = [
  { seconds: 1, label: 'Every 1 second', hint: 'Most detail. Uses the most battery.' },
  { seconds: 3, label: 'Every 3 seconds', hint: 'Recommended. Smooth path, fair battery use.' },
  { seconds: 5, label: 'Every 5 seconds', hint: 'Good for driving.' },
  { seconds: 10, label: 'Every 10 seconds', hint: 'For very long days. Least battery.' },
];
const DEFAULT_INTERVAL_S = 3;
const INTERVAL_KEY = 'interval_s';

export async function getIntervalS(): Promise<number> {
  const v = Number(await getMeta(INTERVAL_KEY));
  return INTERVAL_CHOICES.some((c) => c.seconds === v) ? v : DEFAULT_INTERVAL_S;
}
export async function setIntervalS(seconds: number): Promise<void> {
  await setMeta(INTERVAL_KEY, String(seconds));
}

async function startUpdates(): Promise<void> {
  const intervalMs = (await getIntervalS()) * 1000;
  await Location.startLocationUpdatesAsync(LOCATION_TASK, {
    accuracy: Location.Accuracy.BestForNavigation,
    timeInterval: intervalMs,
    distanceInterval: 0, // also record while standing still, so stops are measured exactly
    deferredUpdatesInterval: 0,
    deferredUpdatesDistance: 0,
    pausesUpdatesAutomatically: false,
    // The always-visible notification is what allows Android to keep recording
    // with the screen off. Without it Android would stop the app within minutes.
    foregroundService: {
      notificationTitle: 'Njia is recording your trip',
      notificationBody: 'Recording continues with the screen off. Open Njia to stop.',
      notificationColor: '#ffb020',
      killServiceOnDestroy: false,
    },
  });
}

async function isUpdating(): Promise<boolean> {
  try {
    return await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK);
  } catch {
    return false;
  }
}

/** Start a new trip. Throws an Error with a plain-language message if it cannot. */
export async function startRecording(): Promise<number> {
  const perm = await Location.getForegroundPermissionsAsync();
  if (!perm.granted) {
    throw new Error('Location permission is not allowed yet. Open Setup and allow it first.');
  }
  if (!(await Location.hasServicesEnabledAsync())) {
    throw new Error('Location (GPS) is switched off on this phone. Switch it on and try again.');
  }
  const tripId = await createTrip();
  try {
    await startUpdates();
  } catch (err) {
    await clearActiveTrip();
    await deleteTrip(tripId);
    throw new Error('Recording could not start: ' + String((err as Error)?.message || err));
  }
  return tripId;
}

/** Stop and save. Returns the saved trip id, or null if no GPS point was ever received. */
export async function stopRecording(): Promise<number | null> {
  const tripId = await getActiveTripId();
  if (await isUpdating()) {
    try {
      await Location.stopLocationUpdatesAsync(LOCATION_TASK);
    } catch (err) {
      console.warn('[njia] stopLocationUpdates failed:', err);
    }
  }
  await clearActiveTrip();
  if (tripId == null) return null;
  const done = await finishTrip(tripId);
  if (!done) return null;
  try {
    await rebuildLegs(tripId); // cut the recording into separate trips
  } catch (err) {
    console.warn('[njia] could not work out trips:', err);
  }
  return tripId;
}

export type StartupState = 'idle' | 'recording' | 'resumed' | 'interrupted';

/**
 * Run when the app opens. If Android killed the recording behind our back,
 * start it again so the rest of the trip is not lost. The missing part shows
 * up honestly as "No data" on the map.
 */
export async function checkOnStartup(): Promise<StartupState> {
  const tripId = await getActiveTripId();
  const updating = await isUpdating();
  if (tripId == null) {
    if (updating) {
      try {
        await Location.stopLocationUpdatesAsync(LOCATION_TASK);
      } catch {
        /* nothing to stop */
      }
    }
    return 'idle';
  }
  if (updating) return 'recording';
  try {
    await startUpdates();
    return 'resumed';
  } catch {
    return 'interrupted';
  }
}
