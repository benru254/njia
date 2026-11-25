/**
 * Switching recording on and off.
 *
 * The recording itself is done by the native recorder (modules/njia-tracker),
 * which runs without the app screen and saves every point to its own file.
 * This file tells it when to run and with which settings, and moves its points
 * into recordings (src/data/importer.ts).
 *
 *   Manual    Start -> recorder on, new recording. Stop -> recorder off, recording closed.
 *   Always on recorder on all the time, also after a phone restart. One recording per day.
 */
import * as Location from 'expo-location';
import { tracker, NjiaTracker } from '../../modules/njia-tracker';
import { getMeta, setMeta } from '../data/db';
import { closePastDays, importBuffer } from '../data/importer';
import { rebuildLegs } from '../data/legs';
import { getRecordMode, getStillCheckS, setRecordMode } from '../data/mode';
import { listPlaces } from '../data/places';
import { clearActiveTrip, createTrip, deleteTrip, finishTrip, getActiveTripId, getTrip } from '../data/trips';
import { LOCATION_TASK } from './task';

export const INTERVAL_CHOICES = [
  { seconds: 1, label: 'Every 1 second', hint: 'Most detail. Uses the most battery while moving.' },
  { seconds: 3, label: 'Every 3 seconds', hint: 'Recommended. Smooth path, fair battery use.' },
  { seconds: 5, label: 'Every 5 seconds', hint: 'Good for driving.' },
  { seconds: 10, label: 'Every 10 seconds', hint: 'Least battery while moving.' },
];
const DEFAULT_INTERVAL_S = 3;
const INTERVAL_KEY = 'interval_s';

export async function getIntervalS(): Promise<number> {
  const v = Number(await getMeta(INTERVAL_KEY));
  return INTERVAL_CHOICES.some((c) => c.seconds === v) ? v : DEFAULT_INTERVAL_S;
}
export async function setIntervalS(seconds: number): Promise<void> {
  await setMeta(INTERVAL_KEY, String(seconds));
  await applySettings();
}

/** Send the current settings (and named places) to the recorder. Applies at once if it is running. */
export async function applySettings(): Promise<void> {
  if (!NjiaTracker) return;
  const [intervalS, stillCheckS, places] = await Promise.all([getIntervalS(), getStillCheckS(), listPlaces()]);
  NjiaTracker.configure({
    intervalMs: intervalS * 1000,
    stillCheckMs: stillCheckS * 1000,
    places: places.map((p) => ({ lat: p.lat, lon: p.lon, radiusM: p.radiusM })),
  });
  if (NjiaTracker.getStatus().running) NjiaTracker.start('settings changed');
}

async function checkGpsOn(): Promise<void> {
  const perm = await Location.getForegroundPermissionsAsync();
  if (!perm.granted) {
    throw new Error('Location permission is not allowed yet. Open Setup and allow it first.');
  }
  if (!(await Location.hasServicesEnabledAsync())) {
    throw new Error('Location (GPS) is switched off on this phone. Switch it on and try again.');
  }
}

async function startTracker(why: string): Promise<void> {
  await applySettings();
  try {
    tracker().start(why);
  } catch (err) {
    throw new Error('Recording could not start: ' + String((err as Error)?.message || err));
  }
}

// ---------------------------------------------------------------- manual mode

/** Start a new recording. Throws an Error with a plain-language message if it cannot. */
export async function startRecording(): Promise<number> {
  await checkGpsOn();
  await importBuffer(); // anything left from before belongs to the old recording
  const tripId = await createTrip();
  try {
    await startTracker('Start recording tapped');
  } catch (err) {
    await clearActiveTrip();
    await deleteTrip(tripId);
    throw err;
  }
  return tripId;
}

/** Stop and save. Returns the saved recording id, or null if no GPS point was ever received. */
export async function stopRecording(): Promise<number | null> {
  NjiaTracker?.stop();
  await importBuffer(); // the last points, before closing the recording
  const tripId = await getActiveTripId();
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

// ---------------------------------------------------------------- always on

export async function hasBackgroundPermission(): Promise<boolean> {
  try {
    return (await Location.getBackgroundPermissionsAsync()).granted;
  } catch {
    return false;
  }
}

/**
 * Switch Always on. Needs location "Allow all the time": without it Android
 * will not let the recorder start again by itself after a phone restart.
 */
export async function enableAlwaysOn(): Promise<void> {
  await checkGpsOn();
  if (!(await hasBackgroundPermission())) {
    throw new Error('Always on needs location set to "Allow all the time". Tap "Allow all the time" in Setup first.');
  }
  if ((await getRecordMode()) === 'manual' && (await getActiveTripId()) != null) {
    await stopRecording(); // close the manual recording that was running
  }
  await setRecordMode('always');
  await startTracker('Always on switched on');
}

/** Switch Always on off: the recorder stops and today's recording is closed. */
export async function disableAlwaysOn(): Promise<void> {
  NjiaTracker?.stop();
  await importBuffer();
  const id = await getActiveTripId();
  await setRecordMode('manual');
  await clearActiveTrip();
  if (id != null) {
    const trip = await getTrip(id);
    if (trip && trip.ended_at == null) {
      const done = await finishTrip(id);
      if (done) await rebuildLegs(id);
    }
  }
}

// ---------------------------------------------------------------- app start

export type StartupState = 'idle' | 'recording' | 'resumed' | 'interrupted' | 'missing';

/** Version 1.0.2 and older recorded with Expo's location task. Switch it off for good. */
async function stopOldRecorder(): Promise<void> {
  try {
    if (await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK)) {
      await Location.stopLocationUpdatesAsync(LOCATION_TASK);
    }
  } catch {
    // never started
  }
}

/**
 * Run when the app opens: import what the recorder saved while the app was closed,
 * and start the recorder again if it should be running but is not.
 */
export async function checkOnStartup(onProgress?: (done: number) => void): Promise<StartupState> {
  if (!NjiaTracker) return 'missing';
  const mode = await getRecordMode();
  const activeBefore = await getActiveTripId();
  await stopOldRecorder();
  await importBuffer(onProgress);
  if (mode === 'always') await closePastDays();

  const shouldRun = mode === 'always' || activeBefore != null;
  if (!shouldRun) {
    if (NjiaTracker.getStatus().running) NjiaTracker.stop();
    return 'idle';
  }
  if (NjiaTracker.getStatus().running) {
    await applySettings();
    return 'recording';
  }
  try {
    await startTracker(mode === 'always' ? 'app opened, recorder was not running' : 'app opened, recording resumed');
    return 'resumed';
  } catch {
    return 'interrupted';
  }
}
