/**
 * KML: the file format of Google Earth and Google My Maps.
 *
 *   - Google Earth (phone or PC): opens the file directly.
 *   - Google My Maps (mymaps.google.com, on a PC browser): "Import" the file;
 *     the map then also shows in the Google Maps app under Saved › Maps.
 *
 * One file holds a whole recording: every trip as its own coloured line,
 * and every destination as a named pin with arrival, departure and time stayed.
 */
import { formatDate, formatDistance, formatDuration, formatDurationShort, formatSpeed, formatTime } from './format';
import { Segmentation, resolveMode } from './segment';
import { simplifyIndexes } from './simplify';
import { Analysis, MODE_LABEL, ModeOverride, TravelMode } from './types';

/** Trip line colours, as KML wants them: aabbggrr. */
const COLORS = ['ff2080ff', 'ff30b030', 'ff1fb0ff', 'ffd060c0', 'ff3040e0', 'ffc0a020', 'ff8060ff', 'ff60c0c0'];

const xml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const coord = (lat: number, lon: number) => `${lon.toFixed(6)},${lat.toFixed(6)},0`;

export interface KmlOptions {
  title: string;
  modes?: ModeOverride[];
  vehicle?: TravelMode;
  /** Drop path points closer than this to the line between their neighbours (metres). */
  toleranceM?: number;
}

/** @param a  analyze(points, HOLD_ANALYZE) of the recording; @param seg  segment(a, ...) */
export function buildKml(a: Analysis, seg: Segmentation, o: KmlOptions): string {
  const tol = o.toleranceM ?? 6;
  const vehicle = o.vehicle ?? 'motorbike';
  const pts = a.points;
  const out: string[] = [];
  out.push('<?xml version="1.0" encoding="UTF-8"?>');
  out.push('<kml xmlns="http://www.opengis.net/kml/2.2">');
  out.push(`<Document><name>${xml(o.title)}</name>`);
  if (pts.length) {
    out.push(
      `<description>${xml(
        `${formatDate(pts[0].t)}, ${formatTime(pts[0].t)} – ${formatTime(pts[pts.length - 1].t)}. ` +
          `${seg.legs.length} trips, ${formatDistance(a.stats.distanceM)}. Recorded with Njia.`
      )}</description>`
    );
  }
  COLORS.forEach((c, i) => {
    out.push(`<Style id="trip${i}"><LineStyle><color>${c}</color><width>5</width></LineStyle></Style>`);
  });
  out.push(
    '<Style id="stop"><IconStyle><scale>1.1</scale><Icon><href>http://maps.google.com/mapfiles/kml/paddle/ylw-circle.png</href></Icon></IconStyle></Style>' +
      '<Style id="start"><IconStyle><scale>1.1</scale><Icon><href>http://maps.google.com/mapfiles/kml/paddle/grn-circle.png</href></Icon></IconStyle></Style>' +
      '<Style id="end"><IconStyle><scale>1.1</scale><Icon><href>http://maps.google.com/mapfiles/kml/paddle/red-circle.png</href></Icon></IconStyle></Style>'
  );

  // Trips: one line each.
  out.push('<Folder><name>Trips</name>');
  if (seg.legs.length === 0 && pts.length > 1) {
    out.push(lineKml('Recording', '', 0, pts.map((p) => [p.lat, p.lon] as [number, number]), tol));
  }
  seg.legs.forEach((l, i) => {
    const mode = resolveMode(l, o.modes ?? [], vehicle);
    const name = `Trip ${i + 1}: ${l.from.letter} ${l.from.label} → ${l.to.letter} ${l.to.label}`;
    const desc =
      `${formatTime(l.departT)} – ${formatTime(l.arriveT)} (${formatDuration(l.durationS)})\n` +
      `${formatDistance(l.distanceM)} · ${MODE_LABEL[mode]}\n` +
      `Moving ${formatDuration(l.movingS)} · average ${formatSpeed(l.avgMovingSpeed)} · top ${formatSpeed(l.maxSpeed)}` +
      (l.pauseCount + l.trafficCount ? `\nPauses and traffic: ${formatDuration(l.pauseS + l.trafficS)}` : '');
    const path: Array<[number, number]> = [];
    for (let k = l.departIdx; k <= l.arriveIdx; k++) {
      // Inside a stop the GPS wobbles: draw the whole stop at its centre.
      const p = pts[k];
      const s = p.stop >= 0 ? a.stops[p.stop] : null;
      path.push(s ? [s.lat, s.lon] : [p.lat, p.lon]);
    }
    out.push(lineKml(name, desc, i % COLORS.length, path, tol));
  });
  out.push('</Folder>');

  // Places where you stopped.
  out.push('<Folder><name>Stops</name>');
  for (const e of seg.endpoints) {
    const style = e.kind === 'start' ? 'start' : e.kind === 'end' ? 'end' : 'stop';
    let when: string;
    if (e.kind === 'start') when = `Left at ${formatTime(e.leaveT)}`;
    else if (e.kind === 'end') when = `Arrived at ${formatTime(e.arriveT)}`;
    else when = `Arrived ${formatTime(e.arriveT)}, left ${formatTime(e.leaveT)}`;
    if (e.dwell) when += `, stayed ${formatDurationShort(e.dwell.stayS)}`;
    out.push(
      `<Placemark><name>${xml(`${e.letter} · ${e.label}`)}</name><description>${xml(when)}</description>` +
        `<styleUrl>#${style}</styleUrl><Point><coordinates>${coord(e.lat, e.lon)}</coordinates></Point></Placemark>`
    );
  }
  out.push('</Folder>');
  out.push('</Document></kml>');
  return out.join('\n');
}

function lineKml(name: string, desc: string, color: number, path: Array<[number, number]>, tol: number): string {
  const keep = simplifyIndexes(
    path.map(([lat, lon]) => ({ lat, lon })),
    tol
  );
  const coords = keep.map((i) => coord(path[i][0], path[i][1])).join(' ');
  return (
    `<Placemark><name>${xml(name)}</name>` +
    (desc ? `<description>${xml(desc)}</description>` : '') +
    `<styleUrl>#trip${color}</styleUrl><LineString><tessellate>1</tessellate><coordinates>${coords}</coordinates></LineString></Placemark>`
  );
}
