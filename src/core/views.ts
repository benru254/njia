/**
 * Builds what the map viewer draws: one trip on its own, or the whole recording.
 * The result has the same shape as analyze()'s output, so the map, chart and
 * replay work the same way for both.
 */
import { topSpeed } from './analyze';
import { Dwell, Leg, Segmentation } from './segment';
import { Analysis, Gap, Stop, TrackPoint } from './types';

export interface View {
  analysis: Analysis;
  /** dwells[i] is the stop drawn as analysis.stops[i]. */
  dwells: Dwell[];
}

/** One trip: from leaving A to arriving at B, with its pauses and traffic. */
export function legView(a: Analysis, _seg: Segmentation, leg: Leg): View {
  return buildView(a, leg.departIdx, leg.arriveIdx, leg.pauses, (d) => [d.first, d.last]);
}

/** The whole recording, with every destination, pause and traffic hold. */
export function fullView(a: Analysis, seg: Segmentation): View {
  if (!a.points.length) return { analysis: a, dwells: [] };
  return buildView(a, 0, a.points.length - 1, seg.dwells, (d) =>
    d.kind === 'destination' ? [d.outerFirst, d.outerLast] : [d.first, d.last]
  );
}

function buildView(
  a: Analysis,
  from: number,
  to: number,
  dwells: Dwell[],
  span: (d: Dwell) => [number, number]
): View {
  const src = a.points;
  const count = to - from + 1;
  const stopOf = new Int32Array(count).fill(-1);
  const stops: Stop[] = [];
  const used: Dwell[] = [];

  for (const d of dwells) {
    let [f, l] = span(d);
    f = Math.max(f, from);
    l = Math.min(l, to);
    if (l < f) continue;
    const i = stops.length;
    for (let k = f; k <= l; k++) stopOf[k - from] = i;
    stops.push({
      index: i,
      lat: d.lat,
      lon: d.lon,
      start: src[f].t,
      end: src[l].t,
      durationS: (src[l].t - src[f].t) / 1000,
      first: f - from,
      last: l - from,
    });
    used.push(d);
  }

  const d0 = src[from].dist;
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLon = Infinity;
  let maxLon = -Infinity;
  const points: TrackPoint[] = [];
  for (let k = 0; k < count; k++) {
    const p = src[from + k];
    const s = stopOf[k];
    points.push({ ...p, dist: p.dist - d0, stop: s, v: s >= 0 ? 0 : p.v, gapBefore: k > 0 && p.gapBefore });
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lon < minLon) minLon = p.lon;
    if (p.lon > maxLon) maxLon = p.lon;
  }

  const gaps: Gap[] = a.gaps
    .filter((g) => g.from >= from && g.to <= to)
    .map((g) => ({ ...g, from: g.from - from, to: g.to - from }));

  const startTime = points[0].t;
  const endTime = points[count - 1].t;
  const durationS = (endTime - startTime) / 1000;
  const stoppedS = stops.reduce((s, x) => s + x.durationS, 0);
  // A silence inside a stop is already counted as stopped time.
  const gapS = gaps
    .filter((g) => !(stopOf[g.from] >= 0 && stopOf[g.from] === stopOf[g.to]))
    .reduce((s, g) => s + g.durationS, 0);
  const movingS = Math.max(0, durationS - stoppedS - gapS);
  const distance = points[count - 1].dist;

  return {
    analysis: {
      points,
      stops,
      gaps,
      stats: {
        startTime,
        endTime,
        durationS,
        distanceM: distance,
        movingS,
        stoppedS,
        gapS,
        avgMovingSpeed: movingS > 0 ? distance / movingS : 0,
        maxSpeed: topSpeed(points),
        pointCount: count,
        rawCount: count,
        droppedCount: 0,
        bbox: { minLat, maxLat, minLon, maxLon },
      },
    },
    dwells: used,
  };
}
