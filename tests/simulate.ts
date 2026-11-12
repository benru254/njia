/**
 * Makes a realistic fake trip so the logic and the viewer can be tested
 * without walking around Nairobi with a phone.
 */
import { RawPoint } from '../src/core/types';

// Small repeatable random generator, so tests give the same result every run.
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const M_PER_DEG_LAT = 111320;

export interface Leg {
  kind: 'stay' | 'move' | 'gap';
  /** seconds */
  seconds: number;
  /** for 'move' (and optionally 'gap'): speed in km/h and compass direction in degrees */
  kmh?: number;
  dir?: number;
}

export interface SimOptions {
  startLat?: number;
  startLon?: number;
  startTime?: number;
  intervalS?: number;
  /** GPS wobble in metres */
  noiseM?: number;
  seed?: number;
}

export function simulate(legs: Leg[], o: SimOptions = {}): RawPoint[] {
  const rand = rng(o.seed ?? 7);
  const interval = o.intervalS ?? 3;
  const noise = o.noiseM ?? 4;
  let lat = o.startLat ?? -1.2864; // Nairobi CBD
  let lon = o.startLon ?? 36.8172;
  let t = o.startTime ?? Date.UTC(2026, 10, 11, 5, 0, 0); // 08:00 Nairobi
  const mPerDegLon = M_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180);
  const out: RawPoint[] = [];

  const emit = (spd: number, hdg: number | null) => {
    const nLat = ((rand() - 0.5) * 2 * noise) / M_PER_DEG_LAT;
    const nLon = ((rand() - 0.5) * 2 * noise) / mPerDegLon;
    out.push({
      t,
      lat: lat + nLat,
      lon: lon + nLon,
      acc: 4 + rand() * 6,
      alt: 1660 + rand() * 5,
      spd: Math.max(0, spd + (rand() - 0.5) * 0.3),
      hdg,
    });
  };

  for (const leg of legs) {
    if (leg.kind === 'gap') {
      // No readings at all, but you may still have travelled meanwhile.
      if (leg.kmh) {
        const d = (leg.kmh / 3.6) * leg.seconds;
        const dir = ((leg.dir ?? 0) * Math.PI) / 180;
        lat += (Math.cos(dir) * d) / M_PER_DEG_LAT;
        lon += (Math.sin(dir) * d) / mPerDegLon;
      }
      t += leg.seconds * 1000;
      continue;
    }
    const steps = Math.floor(leg.seconds / interval);
    for (let i = 0; i < steps; i++) {
      if (leg.kind === 'move') {
        const mps = (leg.kmh ?? 30) / 3.6;
        const dir = ((leg.dir ?? 0) * Math.PI) / 180;
        lat += (Math.cos(dir) * mps * interval) / M_PER_DEG_LAT;
        lon += (Math.sin(dir) * mps * interval) / mPerDegLon;
        emit(mps, leg.dir ?? 0);
      } else {
        emit(0, null);
      }
      t += interval * 1000;
    }
  }
  return out;
}

/** A typical day-in-the-life trip used by the tests and the viewer demo. */
export function sampleTrip(): RawPoint[] {
  return simulate([
    { kind: 'stay', seconds: 300 }, // 5 min at the start
    { kind: 'move', seconds: 240, kmh: 40, dir: 45 }, // drive NE
    { kind: 'move', seconds: 120, kmh: 15, dir: 90 }, // slow traffic E
    { kind: 'move', seconds: 300, kmh: 65, dir: 100 }, // fast road
    { kind: 'stay', seconds: 900 }, // 15 min stop
    { kind: 'move', seconds: 200, kmh: 5, dir: 180 }, // walk S
    { kind: 'stay', seconds: 60 }, // short pause (not a stop)
    { kind: 'move', seconds: 100, kmh: 5, dir: 180 },
    { kind: 'gap', seconds: 400, kmh: 20, dir: 200 }, // phone lost signal while moving
    { kind: 'move', seconds: 300, kmh: 50, dir: 250 }, // drive back SW
    { kind: 'stay', seconds: 180 }, // 3 min at the end
  ]);
}

/**
 * A delivery run with every situation the trip splitter must handle:
 *   A shop (10 min) -> ride -> B customer: park, walk to the door, 2.5 min inside, walk back (about 4 min)
 *   -> ride -> 2.5 min standstill at a junction -> 4 min crawling in a jam -> ride
 *   -> C petrol station (7 min) -> ride back -> D shop (5 min, end).
 * Expected: 4 destinations (A, B, C, D) = 3 trips; the junction is a pause and the crawl is traffic.
 */
export function deliveryDay(): RawPoint[] {
  return simulate([
    { kind: 'stay', seconds: 600 },
    { kind: 'move', seconds: 600, kmh: 35, dir: 45 },
    { kind: 'stay', seconds: 20 },
    { kind: 'move', seconds: 30, kmh: 4, dir: 135 },
    { kind: 'stay', seconds: 150 },
    { kind: 'move', seconds: 30, kmh: 4, dir: 315 },
    { kind: 'stay', seconds: 20 },
    { kind: 'move', seconds: 300, kmh: 30, dir: 90 },
    { kind: 'stay', seconds: 150 },
    { kind: 'move', seconds: 240, kmh: 1.2, dir: 90 },
    { kind: 'move', seconds: 300, kmh: 40, dir: 90 },
    { kind: 'stay', seconds: 420 },
    { kind: 'move', seconds: 900, kmh: 35, dir: 250 },
    { kind: 'stay', seconds: 300 },
  ]);
}
