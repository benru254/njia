/**
 * Export formats.
 *   - GPX: the standard format that Organic Maps, OsmAnd, Google Earth and
 *     most map tools can open.
 *   - Njia JSON: a compact full backup that the Njia viewer opens directly.
 */
import { formatDuration, formatTime } from './format';
import { RawPoint, Stop, TripFile } from './types';

export interface TripMeta {
  id: number | string;
  name: string | null;
  startedAt: number;
  endedAt: number | null;
}

function xml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const num = (n: number, digits: number) => n.toFixed(digits);

/** Build a GPX 1.1 file. Speed and direction go in the widely-read Garmin extension. */
export function buildGpx(trip: TripMeta, points: RawPoint[], stops: Stop[] = []): string {
  const name = xml(trip.name || `Njia trip ${new Date(trip.startedAt).toISOString().slice(0, 16).replace('T', ' ')}`);
  const out: string[] = [];
  out.push('<?xml version="1.0" encoding="UTF-8"?>');
  out.push(
    '<gpx version="1.1" creator="Njia" xmlns="http://www.topografix.com/GPX/1/1" ' +
      'xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v2" ' +
      'xmlns:njia="https://github.com/benru254/njia/gpx/1">'
  );
  out.push(`<metadata><name>${name}</name><time>${new Date(trip.startedAt).toISOString()}</time></metadata>`);

  stops.forEach((s, i) => {
    out.push(
      `<wpt lat="${num(s.lat, 6)}" lon="${num(s.lon, 6)}"><time>${new Date(s.start).toISOString()}</time>` +
        `<name>Stop ${i + 1} (${xml(formatDuration(s.durationS))})</name>` +
        `<desc>${xml(`${formatTime(s.start)} to ${formatTime(s.end)}`)}</desc></wpt>`
    );
  });

  out.push(`<trk><name>${name}</name><trkseg>`);
  for (const p of points) {
    let line = `<trkpt lat="${num(p.lat, 6)}" lon="${num(p.lon, 6)}">`;
    if (p.alt != null) line += `<ele>${num(p.alt, 1)}</ele>`;
    line += `<time>${new Date(p.t).toISOString()}</time>`;
    const ext: string[] = [];
    if (p.spd != null || p.hdg != null) {
      let tpx = '<gpxtpx:TrackPointExtension>';
      if (p.spd != null) tpx += `<gpxtpx:speed>${num(p.spd, 2)}</gpxtpx:speed>`;
      if (p.hdg != null) tpx += `<gpxtpx:course>${num(p.hdg, 1)}</gpxtpx:course>`;
      ext.push(tpx + '</gpxtpx:TrackPointExtension>');
    }
    if (p.acc != null) ext.push(`<njia:accuracy>${num(p.acc, 1)}</njia:accuracy>`);
    if (ext.length) line += `<extensions>${ext.join('')}</extensions>`;
    out.push(line + '</trkpt>');
  }
  out.push('</trkseg></trk></gpx>');
  return out.join('\n');
}

const r = (n: number | null, digits: number): number | null =>
  n == null || !Number.isFinite(n) ? null : Number(n.toFixed(digits));

/** Build the compact Njia backup object. */
export function buildTripFile(trip: TripMeta, points: RawPoint[]): TripFile {
  return {
    format: 'njia-trip',
    version: 1,
    trip: { id: trip.id, name: trip.name, startedAt: trip.startedAt, endedAt: trip.endedAt },
    points: points.map((p) => [
      p.t,
      Number(p.lat.toFixed(6)),
      Number(p.lon.toFixed(6)),
      r(p.acc, 1),
      r(p.alt, 1),
      r(p.spd, 2),
      r(p.hdg, 1),
    ]),
  };
}

/** Read a Njia backup object back into readings. Throws a plain-language error if it is not one. */
export function readTripFile(data: unknown): { trip: TripMeta; points: RawPoint[] } {
  const f = data as TripFile;
  if (!f || f.format !== 'njia-trip' || !Array.isArray(f.points)) {
    throw new Error('This is not a Njia trip file.');
  }
  const points: RawPoint[] = f.points.map((row) => ({
    t: row[0],
    lat: row[1],
    lon: row[2],
    acc: row[3] ?? null,
    alt: row[4] ?? null,
    spd: row[5] ?? null,
    hdg: row[6] ?? null,
  }));
  return {
    trip: {
      id: f.trip?.id ?? 0,
      name: f.trip?.name ?? null,
      startedAt: f.trip?.startedAt ?? (points[0]?.t || 0),
      endedAt: f.trip?.endedAt ?? null,
    },
    points,
  };
}
