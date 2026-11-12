/**
 * Splits one recording (which may last a whole day) into separate trips:
 *
 *   Shop (A) ──trip 1──▶ Customer (B) ──trip 2──▶ Petrol station (C) ──trip 3──▶ Shop (D)
 *
 * A stop becomes a DESTINATION (the end of one trip and the start of the next) when:
 *   - you stayed 5+ minutes (a setting: 3, 5, 7 or 10), or
 *   - you stayed 3+ minutes and walked away from the vehicle and came back to it, or
 *   - you stayed 2+ minutes at a place you saved and named.
 * Shorter stops stay INSIDE a trip as pauses. A slow crawl in a vehicle is "traffic".
 *
 * Every decision can be corrected with one tap: "split" (make it a destination) or
 * "join" (make it a pause). Corrections are stored as Edits and applied every time,
 * so the phone and the PC always show the same result.
 *
 * Pure TypeScript: no phone or browser code here.
 */
import { topSpeed } from './analyze';
import { distanceM } from './geo';
import { Analysis, Edit, ModeOverride, Place, TrackPoint, TravelMode } from './types';

export interface SegmentOptions {
  /** Stay this long (s) anywhere and it is a destination. */
  destMinS: number;
  /** Stay this long (s) AND walk away and back: destination. */
  shortDestMinS: number;
  /** Stay this long (s) at a saved place: destination. */
  placeMinS: number;
  /** Two holds this close in time (s) ... */
  mergeGapS: number;
  /** ... and distance (m) are one visit. */
  mergeDistM: number;
  /** A hold that crept forward this far (m) in a vehicle, without walking, is traffic. */
  trafficDispM: number;
  /** Traffic longer than this (s) is treated like any other long stop. */
  trafficMaxS: number;
  /** "Walked away": went at least this far (m) from where the vehicle stopped ... */
  walkAwayM: number;
  /** ... and came back to within this distance (m) of it. */
  walkBackM: number;
}

export const DEFAULT_SEGMENT: SegmentOptions = {
  destMinS: 300,
  shortDestMinS: 180,
  placeMinS: 120,
  mergeGapS: 240,
  mergeDistM: 80,
  trafficDispM: 35,
  trafficMaxS: 900,
  walkAwayM: 25,
  walkBackM: 20,
};

/** analyze() settings segment() expects: every hold of 1 minute or more. */
export const HOLD_ANALYZE = { minStopS: 60 };

/** Choices offered for "a stop counts as a destination after ..." (seconds). */
export const DEST_MIN_CHOICES = [180, 300, 420, 600];

/** Saved places are this big (radius in metres). Naming a spot inside one renames it. */
export const PLACE_RADIUS_M = 60;

const SLOW_MPS = 12 / 3.6; // between two holds of one visit you only walk or creep
const WALK_MAX_MPS = 7 / 3.6; // walking pace
const VEHICLE_MPS = 20 / 3.6; // nobody walks this fast
const EXTEND_MAX_MS = 180_000; // walking to/from the vehicle: at most 3 min each side
const CONTEXT_MS = 300_000; // look 5 min either side to see if you were in a vehicle
const EDGE_MS = 60_000; // a stop this close to the recording's start/end IS the start/end
const JOIN_WINDOW_MS = 30_000;
const MODE_MATCH_MS = 120_000;

export type DwellKind = 'destination' | 'pause' | 'traffic';
export type DwellReason = 'start' | 'end' | 'long' | 'walked' | 'place' | 'split' | 'join' | 'short' | 'traffic';

/** A place where you stayed still (or nearly) for at least a minute. */
export interface Dwell {
  /** Core: the time you were actually stopped (point indexes, inclusive). */
  first: number;
  last: number;
  start: number;
  end: number;
  durationS: number;
  /** Outer: also the walk from and back to the vehicle. */
  outerFirst: number;
  outerLast: number;
  arriveT: number;
  leaveT: number;
  stayS: number;
  lat: number;
  lon: number;
  /** You came by vehicle (moved faster than walking in the 5 minutes around it). */
  vehicle: boolean;
  /** You walked away from where you stopped and came back. */
  walked: boolean;
  /** You crept forward in a vehicle without walking (jam). */
  trafficLike: boolean;
  place: Place | null;
  kind: DwellKind;
  reason: DwellReason;
}

/** One end of a trip: the recording's start or end, a destination, or a split point. */
export interface Endpoint {
  kind: 'start' | 'end' | 'dest';
  letter: string;
  label: string;
  place: Place | null;
  lat: number;
  lon: number;
  arriveT: number;
  leaveT: number;
  /** Point index where you arrive here / leave from here. */
  arriveIdx: number;
  departIdx: number;
  /** null for the very first/last point and for a split made while moving. */
  dwell: Dwell | null;
}

export interface Leg {
  index: number;
  from: Endpoint;
  to: Endpoint;
  departIdx: number;
  arriveIdx: number;
  departT: number;
  arriveT: number;
  distanceM: number;
  durationS: number;
  movingS: number;
  pauseS: number;
  trafficS: number;
  gapS: number;
  pauseCount: number;
  trafficCount: number;
  maxSpeed: number;
  avgMovingSpeed: number;
  autoMode: 'walk' | 'vehicle';
  /** Pauses and traffic inside this trip. */
  pauses: Dwell[];
}

export interface Segmentation {
  dwells: Dwell[];
  endpoints: Endpoint[];
  legs: Leg[];
}

// ---------------------------------------------------------------- helpers

/** A, B, ... Z, A1, B1 ... */
export function letterFor(i: number): string {
  const base = String.fromCharCode(65 + (i % 26));
  return i < 26 ? base : base + Math.floor(i / 26);
}

/** The saved place this position is inside, if any (closest wins). */
export function nearestPlace(places: Place[], lat: number, lon: number, extraM = 15): Place | null {
  let best: Place | null = null;
  let bestD = Infinity;
  for (const p of places) {
    const d = distanceM(lat, lon, p.lat, p.lon);
    if (d <= p.radiusM + extraM && d < bestD) {
      best = p;
      bestD = d;
    }
  }
  return best;
}

function peak(pts: TrackPoint[], from: number, to: number): number {
  let best = 0;
  for (let k = Math.max(0, from); k <= Math.min(pts.length - 1, to); k++) best = Math.max(best, pts[k].v);
  return best;
}

/** Index of the reading closest in time to t. */
function nearestIndex(pts: TrackPoint[], t: number): number {
  let lo = 0;
  let hi = pts.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (pts[mid].t <= t) lo = mid;
    else hi = mid;
  }
  return Math.abs(pts[lo].t - t) <= Math.abs(pts[hi].t - t) ? lo : hi;
}

/**
 * A hold's first and last readings are often still the vehicle rolling in or
 * pulling away. Drop readings at the edges that moved faster than walking pace.
 */
function trimFast(pts: TrackPoint[], first: number, last: number): [number, number] {
  let f = first;
  let l = last;
  while (f < l && stepFast(pts, f)) f++;
  while (l > f && stepFast(pts, l - 1)) l--;
  return [f, l];
}

/** Did the move from reading k to reading k+1 go faster than walking? */
function stepFast(pts: TrackPoint[], k: number): boolean {
  const dt = (pts[k + 1].t - pts[k].t) / 1000;
  return dt > 0 && distanceM(pts[k].lat, pts[k].lon, pts[k + 1].lat, pts[k + 1].lon) / dt > WALK_MAX_MPS * 1.2;
}

/** Highest steady speed in the 5 minutes before `first` and after `last`. */
function speedAround(pts: TrackPoint[], first: number, last: number): number {
  let a = first;
  while (a > 0 && pts[first].t - pts[a - 1].t <= CONTEXT_MS) a--;
  let b = last;
  while (b < pts.length - 1 && pts[b + 1].t - pts[last].t <= CONTEXT_MS) b++;
  return Math.max(a < first ? topSpeed(pts, a, first) : 0, b > last ? topSpeed(pts, last, b) : 0);
}

// ---------------------------------------------------------------- one-tap corrections

/** Make the stop that lasted over `span` (or the moment t) a destination. */
export function withSplit(edits: Edit[], t: number, span?: { start: number; end: number }): Edit[] {
  const keep = span
    ? edits.filter((e) => !(e.kind === 'join' && e.t >= span.start - JOIN_WINDOW_MS && e.t <= span.end + JOIN_WINDOW_MS))
    : edits.slice();
  keep.push({ t: Math.round(t), kind: 'split' });
  return keep;
}

/** Turn the destination over `span` into a pause, joining the trips on each side into one. */
export function withJoin(edits: Edit[], span: { start: number; end: number }): Edit[] {
  const keep = edits.filter(
    (e) => !(e.kind === 'split' && e.t >= span.start - 60_000 && e.t <= span.end + 60_000)
  );
  keep.push({ t: Math.round((span.start + span.end) / 2), kind: 'join' });
  return keep;
}

/** Name a place. Naming a spot inside an existing place renames that place instead of adding another. */
export function withPlace(places: Place[], name: string, lat: number, lon: number): Place[] {
  const existing = nearestPlace(places, lat, lon, 0);
  if (existing) return places.map((p) => (p === existing ? { ...p, name } : p));
  return [...places, { id: `new-${Date.now()}`, name, lat, lon, radiusM: PLACE_RADIUS_M }];
}

/** Set how one trip (identified by its departure time) was travelled. */
export function withMode(modes: ModeOverride[], t: number, mode: TravelMode): ModeOverride[] {
  return [...modes.filter((m) => Math.abs(m.t - t) > MODE_MATCH_MS), { t: Math.round(t), mode }];
}

/** How this trip was travelled: your choice if you made one, else walking or your usual vehicle. */
export function resolveMode(leg: Leg, modes: ModeOverride[], vehicle: TravelMode): TravelMode {
  let chosen: TravelMode | null = null;
  for (const m of modes) if (Math.abs(m.t - leg.departT) <= MODE_MATCH_MS) chosen = m.mode;
  if (chosen) return chosen;
  return leg.autoMode === 'walk' ? 'walk' : vehicle;
}

// ---------------------------------------------------------------- the main job

interface Group {
  first: number;
  last: number;
  lat: number;
  lon: number;
  count: number;
}

interface Boundary {
  dwell: Dwell | null;
  idx: number;
  t: number;
}

/**
 * Cut a recording into trips.
 * @param a  analyze(points, HOLD_ANALYZE)  (every hold of 1+ minute)
 */
export function segment(
  a: Analysis,
  places: Place[] = [],
  edits: Edit[] = [],
  options: Partial<SegmentOptions> = {}
): Segmentation {
  const o: SegmentOptions = { ...DEFAULT_SEGMENT, ...options };
  const pts = a.points;
  const n = pts.length;
  if (n === 0) return { dwells: [], endpoints: [], legs: [] };

  // 1. Holds close together in place and time are one visit (GPS drift indoors,
  //    stepping out to the gate and back, ...).
  const groups: Group[] = [];
  for (const s of a.stops) {
    const count = s.last - s.first + 1;
    const g = groups[groups.length - 1];
    if (
      g &&
      (pts[s.first].t - pts[g.last].t) / 1000 <= o.mergeGapS &&
      distanceM(g.lat, g.lon, s.lat, s.lon) <= o.mergeDistM &&
      peak(pts, g.last + 1, s.first - 1) <= SLOW_MPS
    ) {
      g.lat = (g.lat * g.count + s.lat * count) / (g.count + count);
      g.lon = (g.lon * g.count + s.lon * count) / (g.count + count);
      g.count += count;
      g.last = s.last;
    } else {
      groups.push({ first: s.first, last: s.last, lat: s.lat, lon: s.lon, count });
    }
  }

  // 2. Describe each visit.
  const dwells: Dwell[] = [];
  for (let gi = 0; gi < groups.length; gi++) {
    const g = groups[gi];
    [g.first, g.last] = trimFast(pts, g.first, g.last);
    const lower = gi > 0 ? dwells[gi - 1].outerLast + 1 : 0;
    const upper = gi < groups.length - 1 ? groups[gi + 1].first - 1 : n - 1;
    const vehicle = speedAround(pts, g.first, g.last) >= VEHICLE_MPS;

    // Came by vehicle? Then walking to the door and back belongs to the visit.
    let of = g.first;
    let ol = g.last;
    if (vehicle) {
      const near = (k: number) => distanceM(g.lat, g.lon, pts[k].lat, pts[k].lon) <= o.mergeDistM;
      while (
        of - 1 >= lower &&
        !pts[of].gapBefore &&
        pts[of - 1].v <= WALK_MAX_MPS &&
        !stepFast(pts, of - 1) &&
        pts[g.first].t - pts[of - 1].t <= EXTEND_MAX_MS &&
        near(of - 1)
      )
        of--;
      while (
        ol + 1 <= upper &&
        !pts[ol + 1].gapBefore &&
        pts[ol + 1].v <= WALK_MAX_MPS &&
        !stepFast(pts, ol) &&
        pts[ol + 1].t - pts[g.last].t <= EXTEND_MAX_MS &&
        near(ol + 1)
      )
        ol++;
    }

    // Walked away from where you stopped, then came back to it?
    const p0 = pts[of];
    let maxAway = 0;
    for (let k = of; k <= ol; k++) {
      const p = pts[k];
      if (p.acc != null && p.acc > 25) continue;
      maxAway = Math.max(maxAway, distanceM(p0.lat, p0.lon, p.lat, p.lon));
    }
    const walked = maxAway >= o.walkAwayM && distanceM(p0.lat, p0.lon, pts[ol].lat, pts[ol].lon) <= o.walkBackM;
    const creep = distanceM(pts[g.first].lat, pts[g.first].lon, pts[g.last].lat, pts[g.last].lon);

    dwells.push({
      first: g.first,
      last: g.last,
      start: pts[g.first].t,
      end: pts[g.last].t,
      durationS: (pts[g.last].t - pts[g.first].t) / 1000,
      outerFirst: of,
      outerLast: ol,
      arriveT: pts[of].t,
      leaveT: pts[ol].t,
      stayS: (pts[ol].t - pts[of].t) / 1000,
      lat: g.lat,
      lon: g.lon,
      vehicle,
      walked,
      trafficLike: vehicle && !walked && creep >= o.trafficDispM,
      place: null,
      kind: 'pause',
      reason: 'short',
    });
  }

  // 3. Apply the owner's corrections, in the order they were made.
  const forced: Array<'destination' | 'pause' | undefined> = new Array(dwells.length);
  let splitPoints: number[] = [];
  for (const e of edits) {
    if (e.kind === 'join') {
      dwells.forEach((d, i) => {
        if (e.t >= d.arriveT - JOIN_WINDOW_MS && e.t <= d.leaveT + JOIN_WINDOW_MS) forced[i] = 'pause';
      });
      splitPoints = splitPoints.filter((idx) => Math.abs(pts[idx].t - e.t) > JOIN_WINDOW_MS);
    } else {
      const i = dwells.findIndex((d) => e.t >= d.arriveT && e.t <= d.leaveT);
      if (i >= 0) forced[i] = 'destination';
      else {
        const idx = nearestIndex(pts, e.t);
        if (idx > 0 && idx < n - 1 && !splitPoints.includes(idx)) splitPoints.push(idx);
      }
    }
  }

  // 4. Decide what each visit was.
  dwells.forEach((d, i) => {
    d.place = nearestPlace(places, d.lat, d.lon);
    const set = (kind: DwellKind, reason: DwellReason) => {
      d.kind = kind;
      d.reason = reason;
    };
    const f = forced[i];
    if (f === 'destination') set('destination', 'split');
    else if (f === 'pause') set(d.trafficLike ? 'traffic' : 'pause', 'join');
    else if (d.place && d.stayS >= o.placeMinS) set('destination', 'place');
    else if (d.trafficLike && d.durationS < o.trafficMaxS) set('traffic', 'traffic');
    else if (d.durationS >= o.destMinS) set('destination', 'long');
    else if (d.walked && d.stayS >= o.shortDestMinS) set('destination', 'walked');
    else set('pause', 'short');
  });

  // 5. The recording's start and end. A stop right at the start/end IS the start/end.
  const firstD = dwells[0];
  const lastD = dwells[dwells.length - 1];
  const startDwell = firstD && pts[firstD.outerFirst].t - pts[0].t <= EDGE_MS ? firstD : null;
  const endDwell = lastD && pts[n - 1].t - pts[lastD.outerLast].t <= EDGE_MS ? lastD : null;
  if (endDwell) {
    endDwell.kind = 'destination';
    endDwell.reason = 'end';
  }
  if (startDwell) {
    startDwell.kind = 'destination';
    startDwell.reason = 'start';
  }

  const departIdx = (b: Boundary) => (b.dwell ? b.dwell.outerLast : b.idx);
  const arriveIdx = (b: Boundary) => (b.dwell ? b.dwell.outerFirst : b.idx);
  const startB: Boundary = startDwell
    ? { dwell: startDwell, idx: startDwell.outerFirst, t: startDwell.arriveT }
    : { dwell: null, idx: 0, t: pts[0].t };
  const endB: Boundary = endDwell
    ? { dwell: endDwell, idx: endDwell.outerFirst, t: endDwell.arriveT }
    : { dwell: null, idx: n - 1, t: pts[n - 1].t };

  const makeEndpoint = (b: Boundary, kind: Endpoint['kind'], i: number): Endpoint => {
    const letter = letterFor(i);
    const d = b.dwell;
    const p = pts[b.idx];
    const place = d ? d.place : nearestPlace(places, p.lat, p.lon);
    return {
      kind,
      letter,
      label: place ? place.name : `Point ${letter}`,
      place,
      lat: d ? d.lat : p.lat,
      lon: d ? d.lon : p.lon,
      arriveT: d ? d.arriveT : p.t,
      leaveT: d ? d.leaveT : p.t,
      arriveIdx: arriveIdx(b),
      departIdx: departIdx(b),
      dwell: d,
    };
  };

  // Stayed in one place for the whole recording: no trips.
  if (n === 1 || (startDwell && startDwell === endDwell)) {
    return { dwells, endpoints: [makeEndpoint(startB, 'start', 0)], legs: [] };
  }

  const mids: Boundary[] = [];
  for (const d of dwells) {
    if (d.kind === 'destination' && d !== startDwell && d !== endDwell) {
      mids.push({ dwell: d, idx: d.outerFirst, t: d.arriveT });
    }
  }
  for (const idx of splitPoints) mids.push({ dwell: null, idx, t: pts[idx].t });
  mids.sort((x, y) => x.t - y.t);
  const chain = [
    startB,
    ...mids.filter((m) => m.idx > departIdx(startB) && departIdx(m) < arriveIdx(endB)),
    endB,
  ];
  const endpoints = chain.map((b, i) => makeEndpoint(b, i === 0 ? 'start' : i === chain.length - 1 ? 'end' : 'dest', i));

  // 6. The trips between them.
  const legs: Leg[] = [];
  for (let i = 0; i + 1 < endpoints.length; i++) {
    const from = endpoints[i];
    const to = endpoints[i + 1];
    const dep = from.departIdx;
    const arr = to.arriveIdx;
    if (arr <= dep) continue;

    const pauses = dwells.filter((d) => d.kind !== 'destination' && d.first >= dep && d.last <= arr);
    const pauseS = pauses.filter((d) => d.kind === 'pause').reduce((s, d) => s + d.durationS, 0);
    const trafficS = pauses.filter((d) => d.kind === 'traffic').reduce((s, d) => s + d.durationS, 0);
    const gapS = a.gaps.filter((g) => g.from >= dep && g.to <= arr).reduce((s, g) => s + g.durationS, 0);
    const durationS = (pts[arr].t - pts[dep].t) / 1000;
    const movingS = Math.max(0, durationS - pauseS - trafficS - gapS);
    const distance = pts[arr].dist - pts[dep].dist;
    const maxSpeed = topSpeed(pts, dep, arr);

    // Walking or riding? Look at the usual speed while moving (85th percentile).
    const speeds: number[] = [];
    for (let k = dep + 1; k <= arr; k++) if (pts[k].stop < 0 && pts[k].v > 0.3) speeds.push(pts[k].v);
    speeds.sort((x, y) => x - y);
    const usual = speeds.length ? speeds[Math.floor(0.85 * (speeds.length - 1))] : 0;
    const autoMode = usual * 3.6 < 9 && maxSpeed * 3.6 < 15 ? 'walk' : 'vehicle';

    legs.push({
      index: legs.length,
      from,
      to,
      departIdx: dep,
      arriveIdx: arr,
      departT: pts[dep].t,
      arriveT: pts[arr].t,
      distanceM: distance,
      durationS,
      movingS,
      pauseS,
      trafficS,
      gapS,
      pauseCount: pauses.filter((d) => d.kind === 'pause').length,
      trafficCount: pauses.filter((d) => d.kind === 'traffic').length,
      maxSpeed,
      avgMovingSpeed: movingS > 0 ? distance / movingS : 0,
      autoMode,
      pauses,
    });
  }

  return { dwells, endpoints, legs };
}

/** Index of the trip that contains time t (or the last one that started before it). */
export function legIndexAt(seg: Segmentation, t: number): number {
  if (!seg.legs.length) return -1;
  let best = 0;
  for (let i = 0; i < seg.legs.length; i++) {
    const l = seg.legs[i];
    if (t >= l.departT && t <= l.arriveT) return i;
    if (l.departT <= t) best = i;
  }
  return best;
}
