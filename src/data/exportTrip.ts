/** Turn a saved recording into a file and hand it to Android's Share sheet. */
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { fileStamp, formatDurationShort, formatTime } from '../core/format';
import { GpxWaypoint, TripMeta, buildGpx, buildTripFile } from '../core/tripFile';
import { RawPoint, TripFile } from '../core/types';
import { loadInputs, segmentInputs } from './legs';
import { TripRow } from './trips';

export function metaOf(trip: TripRow): TripMeta {
  return { id: trip.id, name: trip.name, startedAt: trip.started_at, endedAt: trip.ended_at };
}

/** The recording with everything the viewer needs: places, corrections, settings. */
export async function loadTripFile(
  trip: TripRow,
  view: { focusT?: number | null; cursorT?: number | null } = {}
): Promise<{ file: TripFile; points: RawPoint[] }> {
  const x = await loadInputs(trip.id);
  return {
    file: buildTripFile(metaOf(trip), x.points, {
      places: x.places,
      edits: x.edits,
      modes: x.modes,
      settings: x.settings,
      view,
    }),
    points: x.points,
  };
}

async function shareText(fileName: string, text: string, mimeType: string, title: string): Promise<void> {
  if (!(await Sharing.isAvailableAsync())) {
    throw new Error('Sharing is not available on this phone.');
  }
  const file = new File(Paths.cache, fileName);
  if (file.exists) file.delete();
  file.create();
  await file.write(text);
  await Sharing.shareAsync(file.uri, { mimeType, dialogTitle: title });
}

/** GPX: opens in Organic Maps, OsmAnd, Google Earth and most map tools. Destinations become pins. */
export async function shareGpx(trip: TripRow): Promise<void> {
  const x = await loadInputs(trip.id);
  if (!x.points.length) throw new Error('This recording has no GPS points yet.');
  const seg = segmentInputs(x);
  const waypoints: GpxWaypoint[] = seg.endpoints.map((e) => ({
    lat: e.lat,
    lon: e.lon,
    t: e.arriveT,
    name: `${e.letter} · ${e.label}`,
    desc: e.dwell
      ? `${formatTime(e.arriveT)} – ${formatTime(e.leaveT)}, stayed ${formatDurationShort(e.dwell.stayS)}`
      : formatTime(e.arriveT),
  }));
  const gpx = buildGpx(metaOf(trip), x.points, waypoints);
  await shareText(`njia_${fileStamp(trip.started_at)}.gpx`, gpx, 'application/gpx+xml', 'Share recording (GPX)');
}

/** Njia backup: the full recording with your corrections and named places, for the PC viewer. */
export async function shareBackup(trip: TripRow): Promise<void> {
  const { file, points } = await loadTripFile(trip);
  if (!points.length) throw new Error('This recording has no GPS points yet.');
  await shareText(
    `njia_${fileStamp(trip.started_at)}.json`,
    JSON.stringify(file),
    'application/json',
    'Share recording (Njia file for PC)'
  );
}
