/** Turn a saved trip into a file and hand it to Android's Share sheet. */
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { analyze } from '../core/analyze';
import { fileStamp } from '../core/format';
import { TripMeta, buildGpx, buildTripFile } from '../core/tripFile';
import { RawPoint, TripFile } from '../core/types';
import { TripRow, getPoints } from './trips';

export function metaOf(trip: TripRow): TripMeta {
  return { id: trip.id, name: trip.name, startedAt: trip.started_at, endedAt: trip.ended_at };
}

export async function loadTripFile(trip: TripRow): Promise<{ file: TripFile; points: RawPoint[] }> {
  const points = await getPoints(trip.id);
  return { file: buildTripFile(metaOf(trip), points), points };
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

/** GPX: opens in Organic Maps, OsmAnd, Google Earth and most map tools. */
export async function shareGpx(trip: TripRow): Promise<void> {
  const points = await getPoints(trip.id);
  if (!points.length) throw new Error('This trip has no GPS points yet.');
  const stops = analyze(points).stops;
  const gpx = buildGpx(metaOf(trip), points, stops);
  await shareText(`njia_${fileStamp(trip.started_at)}.gpx`, gpx, 'application/gpx+xml', 'Share trip (GPX)');
}

/** Njia backup: the full recording, for the Njia viewer on your PC. */
export async function shareBackup(trip: TripRow): Promise<void> {
  const { file, points } = await loadTripFile(trip);
  if (!points.length) throw new Error('This trip has no GPS points yet.');
  await shareText(
    `njia_${fileStamp(trip.started_at)}.json`,
    JSON.stringify(file),
    'application/json',
    'Share trip (Njia file for PC)'
  );
}
