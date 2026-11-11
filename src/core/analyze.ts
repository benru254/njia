/**
 * Turns raw GPS readings into a clean trip:
 *   1. throws away bad readings (inaccurate, impossible jumps)
 *   2. finds stops (where you stayed put, and for how long)
 *   3. finds gaps (periods with no data)
 *   4. works out speed, direction, distance and totals
 *
 * Pure TypeScript: the phone app and the PC viewer both run this same code,
 * so they always agree.
 */
import { bearingDeg, distanceM } from './geo';
import {
  Analysis,
  AnalyzeOptions,
  DEFAULT_OPTIONS,
  Gap,
  RawPoint,
  Stop,
  TrackPoint,
  TripStats,
} from './types';

function isValid(p: RawPoint): boolean {
  return (
    Number.isFinite(p.t) &&
    Number.isFinite(p.lat) &&
    Number.isFinite(p.lon) &&
    Math.abs(p.lat) <= 90 &&
    Math.abs(p.lon) <= 180 &&
    !(p.lat === 0 && p.lon === 0)
  );
}

/** Step 1: sort by time and drop readings we cannot trust. */
export function cleanPoints(raw: RawPoint[], opts: AnalyzeOptions): RawPoint[] {
  const sorted = raw.filter(isValid).sort((a, b) => a.t - b.t);
  const kept: RawPoint[] = [];
  let rejectedInARow = 0;

  for (const p of sorted) {
    if (p.acc != null && p.acc > opts.maxAccuracyM) continue;

    const prev = kept[kept.length - 1];
    if (!prev) {
      kept.push(p);
      continue;
    }
    if (p.t === prev.t) continue; // duplicate timestamp

    const dt = (p.t - prev.t) / 1000;
    const d = distanceM(prev.lat, prev.lon, p.lat, p.lon);
    // Allow for the stated inaccuracy of both readings before calling it impossible.
    const slack = (p.acc ?? 0) + (prev.acc ?? 0);
    const impliedSpeed = Math.max(0, d - slack) / dt;

    if (impliedSpeed > opts.maxPlausibleSpeed && rejectedInARow < 3) {
      // A sudden impossible jump. If it happens 3 times in a row, the point
      // we are comparing against was the bad one, so we accept and move on.
      rejectedInARow++;
      continue;
    }
    rejectedInARow = 0;
    kept.push(p);
  }
  return kept;
}

interface StopRange {
  first: number;
  last: number;
  lat: number;
  lon: number;
}

/** Step 2: find runs of readings that stay within a small circle for long enough. */
export function findStopRanges(pts: RawPoint[], opts: AnalyzeOptions): StopRange[] {
  const out: StopRange[] = [];
  const n = pts.length;
  let i = 0;

  while (i < n) {
    const anchor = pts[i];
    let cLat = anchor.lat;
    let cLon = anchor.lon;
    let count = 1;
    let j = i + 1;

    while (j < n) {
      const p = pts[j];
      // Must stay near the running centre AND near where the stop began,
      // so a slow walk cannot drag the circle along with it.
      if (distanceM(cLat, cLon, p.lat, p.lon) > opts.stopRadiusM) break;
      if (distanceM(anchor.lat, anchor.lon, p.lat, p.lon) > opts.stopRadiusM * 2) break;
      cLat = (cLat * count + p.lat) / (count + 1);
      cLon = (cLon * count + p.lon) / (count + 1);
      count++;
      j++;
    }

    const last = j - 1;
    if ((pts[last].t - anchor.t) / 1000 >= opts.minStopS) {
      out.push({ first: i, last, lat: cLat, lon: cLon });
      i = last + 1;
    } else {
      i++;
    }
  }

  // Join stops that are really the same stay, split by a moment of GPS drift.
  const merged: StopRange[] = [];
  for (const s of out) {
    const prev = merged[merged.length - 1];
    if (
      prev &&
      (pts[s.first].t - pts[prev.last].t) / 1000 <= 90 &&
      distanceM(prev.lat, prev.lon, s.lat, s.lon) <= opts.stopRadiusM
    ) {
      const nPrev = prev.last - prev.first + 1;
      const nCur = s.last - s.first + 1;
      prev.lat = (prev.lat * nPrev + s.lat * nCur) / (nPrev + nCur);
      prev.lon = (prev.lon * nPrev + s.lon * nCur) / (nPrev + nCur);
      prev.last = s.last;
    } else {
      merged.push({ ...s });
    }
  }
  return merged;
}

function median3(a: number, b: number, c: number): number {
  return Math.max(Math.min(a, b), Math.min(Math.max(a, b), c));
}

export function emptyStats(rawCount = 0): TripStats {
  return {
    startTime: 0,
    endTime: 0,
    durationS: 0,
    distanceM: 0,
    movingS: 0,
    stoppedS: 0,
    gapS: 0,
    avgMovingSpeed: 0,
    maxSpeed: 0,
    pointCount: 0,
    rawCount,
    droppedCount: rawCount,
    bbox: null,
  };
}

/** The main entry point: raw readings in, full trip analysis out. */
export function analyze(raw: RawPoint[], options: Partial<AnalyzeOptions> = {}): Analysis {
  const opts: AnalyzeOptions = { ...DEFAULT_OPTIONS, ...options };
  const clean = cleanPoints(raw, opts);
  const n = clean.length;
  if (n === 0) return { points: [], stops: [], gaps: [], stats: emptyStats(raw.length) };

  const ranges = findStopRanges(clean, opts);

  // Which stop (if any) does each point belong to?
  const stopOf = new Int32Array(n).fill(-1);
  const stops: Stop[] = ranges.map((r, index) => {
    for (let k = r.first; k <= r.last; k++) stopOf[k] = index;
    const start = clean[r.first].t;
    const end = clean[r.last].t;
    return {
      index,
      lat: r.lat,
      lon: r.lon,
      start,
      end,
      durationS: (end - start) / 1000,
      first: r.first,
      last: r.last,
    };
  });

  const points: TrackPoint[] = [];
  const gaps: Gap[] = [];
  let dist = 0;
  let movingS = 0;
  let gapS = 0;
  let lastDir: number | null = null;
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLon = Infinity;
  let maxLon = -Infinity;

  for (let i = 0; i < n; i++) {
    const p = clean[i];
    const prev = i > 0 ? clean[i - 1] : null;
    const inStop = stopOf[i] >= 0;
    const sameStopAsPrev = prev != null && inStop && stopOf[i] === stopOf[i - 1];

    let segD = 0;
    let dt = 0;
    let gapBefore = false;

    if (prev) {
      segD = distanceM(prev.lat, prev.lon, p.lat, p.lon);
      dt = (p.t - prev.t) / 1000;
      if (sameStopAsPrev) {
        // Standing still: the small wobble of the GPS is not real travel.
        segD = 0;
      } else if (dt > opts.gapS) {
        gapBefore = true;
        gapS += dt;
        gaps.push({ from: i - 1, to: i, start: prev.t, end: p.t, durationS: dt, distanceM: segD });
      } else {
        movingS += dt;
      }
      dist += segD;
    }

    // Speed: trust the GPS chip's own measurement when we have it.
    let v: number;
    if (inStop) v = 0;
    else if (p.spd != null && p.spd >= 0 && Number.isFinite(p.spd)) v = p.spd;
    else if (prev && dt > 0 && !gapBefore) v = segD / dt;
    else v = 0;
    // Some phones report "0" when they simply do not know the speed. If the
    // positions clearly show real movement, believe the positions.
    if (!inStop && v < 0.5 && prev && dt > 0 && !gapBefore) {
      const calc = segD / dt;
      if (calc > 2 && segD > (p.acc ?? 10) + (prev.acc ?? 10)) v = calc;
    }

    // Direction: GPS heading is only meaningful while actually moving.
    let dir: number | null = lastDir;
    if (!inStop) {
      if (p.hdg != null && p.hdg >= 0 && Number.isFinite(p.hdg) && v > 0.5) dir = p.hdg % 360;
      else if (prev && segD > 3) dir = bearingDeg(prev.lat, prev.lon, p.lat, p.lon);
    }
    lastDir = dir;

    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lon < minLon) minLon = p.lon;
    if (p.lon > maxLon) maxLon = p.lon;

    points.push({
      t: p.t,
      lat: p.lat,
      lon: p.lon,
      acc: p.acc,
      alt: p.alt,
      v,
      dir,
      dist,
      stop: stopOf[i],
      gapBefore,
    });
  }

  // Top speed: use the middle of each 3 readings so one freak value cannot win.
  let maxSpeed = 0;
  if (n < 3) {
    for (const p of points) maxSpeed = Math.max(maxSpeed, p.v);
  } else {
    for (let i = 1; i < n - 1; i++) {
      maxSpeed = Math.max(maxSpeed, median3(points[i - 1].v, points[i].v, points[i + 1].v));
    }
  }

  const stoppedS = stops.reduce((sum, s) => sum + s.durationS, 0);
  const startTime = points[0].t;
  const endTime = points[n - 1].t;

  return {
    points,
    stops,
    gaps,
    stats: {
      startTime,
      endTime,
      durationS: (endTime - startTime) / 1000,
      distanceM: dist,
      movingS,
      stoppedS,
      gapS,
      avgMovingSpeed: movingS > 0 ? dist / movingS : 0,
      maxSpeed,
      pointCount: n,
      rawCount: raw.length,
      droppedCount: raw.length - n,
      bbox: { minLat, maxLat, minLon, maxLon },
    },
  };
}
