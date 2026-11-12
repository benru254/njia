import { describe, expect, it } from 'vitest';
import { analyze } from '../src/core/analyze';
import { googleMapsUrl, googleNavigateUrl } from '../src/core/links';
import {
  HOLD_ANALYZE,
  legIndexAt,
  letterFor,
  resolveMode,
  segment,
  withJoin,
  withMode,
  withPlace,
  withSplit,
} from '../src/core/segment';
import { Place, RawPoint } from '../src/core/types';
import { fullView, legView } from '../src/core/views';
import { deliveryDay, simulate } from './simulate';

const run = (raw: RawPoint[], places: Place[] = [], edits = [] as Parameters<typeof segment>[2], destMinS = 300) => {
  const a = analyze(raw, HOLD_ANALYZE);
  return { a, seg: segment(a, places, edits, { destMinS }) };
};

describe('splitting a delivery day into trips', () => {
  const raw = deliveryDay();
  const { a, seg } = run(raw);

  it('finds A, B, C, D and 3 trips between them', () => {
    expect(seg.endpoints.map((e) => e.letter)).toEqual(['A', 'B', 'C', 'D']);
    expect(seg.legs).toHaveLength(3);
    expect(seg.endpoints[0].kind).toBe('start');
    expect(seg.endpoints[3].kind).toBe('end');
  });

  it('counts the short customer visit because you walked to the door and back', () => {
    const b = seg.endpoints[1].dwell!;
    expect(b.walked).toBe(true);
    expect(b.reason).toBe('walked');
    expect(b.stayS).toBeGreaterThanOrEqual(180);
    expect(b.stayS).toBeLessThan(300);
  });

  it('counts the 7 minute stop because it is longer than 5 minutes', () => {
    expect(seg.endpoints[2].dwell!.reason).toBe('long');
  });

  it('keeps the junction standstill and the jam inside trip 2', () => {
    const leg = seg.legs[1];
    expect(leg.pauseCount + leg.trafficCount).toBeGreaterThanOrEqual(1);
    expect(leg.trafficCount).toBeGreaterThanOrEqual(1);
    expect(leg.trafficS + leg.pauseS).toBeGreaterThan(300);
    expect(leg.movingS).toBeLessThan(leg.durationS);
  });

  it('trips follow each other with no overlap', () => {
    for (let i = 1; i < seg.legs.length; i++) {
      expect(seg.legs[i].departT).toBeGreaterThan(seg.legs[i - 1].arriveT);
      expect(seg.legs[i].from).toBe(seg.legs[i - 1].to);
    }
  });

  it('measures each trip roughly right', () => {
    // Trip 1: 600 s at 35 km/h = 5.8 km
    expect(seg.legs[0].distanceM).toBeGreaterThan(5500);
    expect(seg.legs[0].distanceM).toBeLessThan(6300);
    // Trip 3: 900 s at 35 km/h = 8.75 km
    expect(seg.legs[2].distanceM).toBeGreaterThan(8300);
    expect(seg.legs[2].distanceM).toBeLessThan(9300);
    expect(seg.legs.every((l) => l.autoMode === 'vehicle')).toBe(true);
  });

  it('a longer destination setting turns the 7 minute stop into a pause', () => {
    const r = run(raw, [], [], 600);
    expect(r.seg.legs).toHaveLength(2);
    expect(r.seg.endpoints.map((e) => e.letter)).toEqual(['A', 'B', 'C']);
  });

  it('builds a view of one trip that starts at 0 km', () => {
    const v = legView(a, seg, seg.legs[0]);
    expect(v.analysis.points[0].dist).toBe(0);
    expect(Math.abs(v.analysis.stats.distanceM - seg.legs[0].distanceM)).toBeLessThan(1);
    expect(v.analysis.stats.startTime).toBe(seg.legs[0].departT);
    const v2 = legView(a, seg, seg.legs[1]);
    expect(v2.analysis.stops.length).toBe(seg.legs[1].pauses.length);
  });

  it('builds a view of the whole day with every stop', () => {
    const v = fullView(a, seg);
    expect(v.analysis.points).toHaveLength(a.points.length);
    expect(v.dwells).toHaveLength(seg.dwells.length);
  });

  it('finds the trip at a given time', () => {
    const mid = (seg.legs[1].departT + seg.legs[1].arriveT) / 2;
    expect(legIndexAt(seg, mid)).toBe(1);
  });
});

describe('one-tap corrections', () => {
  const raw = deliveryDay();
  const base = run(raw).seg;

  it('join: a destination becomes a pause and two trips become one', () => {
    const c = base.endpoints[2];
    const edits = withJoin([], { start: c.arriveT, end: c.leaveT });
    const { seg } = run(raw, [], edits);
    expect(seg.legs).toHaveLength(2);
    expect(seg.legs[1].from.letter).toBe('B');
    expect(seg.legs[1].pauses.some((d) => d.reason === 'join')).toBe(true);
  });

  it('split at a pause: it becomes a destination and one trip becomes two', () => {
    const p = base.legs[1].pauses.find((d) => d.kind === 'pause' || d.kind === 'traffic')!;
    const edits = withSplit([], (p.arriveT + p.leaveT) / 2, { start: p.arriveT, end: p.leaveT });
    const { seg } = run(raw, [], edits);
    expect(seg.legs).toHaveLength(4);
  });

  it('split while moving: cuts the trip at that moment', () => {
    const l = base.legs[0];
    const t = (l.departT + l.arriveT) / 2;
    const { seg } = run(raw, [], withSplit([], t));
    expect(seg.legs).toHaveLength(4);
    expect(seg.endpoints[1].dwell).toBeNull();
    expect(Math.abs(seg.endpoints[1].arriveT - t)).toBeLessThan(5000);
  });

  it('join undoes a split made while moving', () => {
    const l = base.legs[0];
    const t = (l.departT + l.arriveT) / 2;
    const split = withSplit([], t);
    const r1 = run(raw, [], split).seg;
    const e = r1.endpoints[1];
    const joined = withJoin(split, { start: e.arriveT, end: e.leaveT });
    expect(joined.some((x) => x.kind === 'split')).toBe(false);
    expect(run(raw, [], joined).seg.legs).toHaveLength(3);
  });

  it('split after join brings the destination back', () => {
    const c = base.endpoints[2];
    const joined = withJoin([], { start: c.arriveT, end: c.leaveT });
    const again = withSplit(joined, (c.arriveT + c.leaveT) / 2, { start: c.arriveT, end: c.leaveT });
    expect(again.some((x) => x.kind === 'join')).toBe(false);
    expect(run(raw, [], again).seg.legs).toHaveLength(3);
  });

  it('travel mode: your choice wins, otherwise your usual vehicle', () => {
    const l = base.legs[0];
    expect(resolveMode(l, [], 'motorbike')).toBe('motorbike');
    expect(resolveMode(l, withMode([], l.departT, 'car'), 'motorbike')).toBe('car');
    const twice = withMode(withMode([], l.departT, 'car'), l.departT + 1000, 'matatu');
    expect(twice).toHaveLength(1);
    expect(resolveMode(l, twice, 'motorbike')).toBe('matatu');
  });
});

describe('saved places', () => {
  it('a 2.5 minute stop at a saved place is a destination, with its name', () => {
    const raw = simulate([
      { kind: 'move', seconds: 300, kmh: 30, dir: 0 },
      { kind: 'stay', seconds: 150 },
      { kind: 'move', seconds: 300, kmh: 30, dir: 0 },
    ]);
    const without = run(raw).seg;
    expect(without.legs).toHaveLength(1);
    const d = without.dwells[0];
    const places = withPlace([], 'Mama Njeri', d.lat, d.lon);
    const withIt = run(raw, places).seg;
    expect(withIt.legs).toHaveLength(2);
    expect(withIt.endpoints[1].label).toBe('Mama Njeri');
  });

  it('naming a spot inside an existing place renames it', () => {
    const p1 = withPlace([], 'Shop', -1.28, 36.81);
    const p2 = withPlace(p1, 'Shop 2', -1.2801, 36.8101);
    expect(p2).toHaveLength(1);
    expect(p2[0].name).toBe('Shop 2');
    const p3 = withPlace(p2, 'Home', -1.3, 36.9);
    expect(p3).toHaveLength(2);
  });
});

describe('walking and odd cases', () => {
  it('a walk is labelled walking, a ride is not', () => {
    const walk = run(
      simulate([
        { kind: 'move', seconds: 600, kmh: 4.5, dir: 30 },
        { kind: 'stay', seconds: 400 },
        { kind: 'move', seconds: 600, kmh: 4.5, dir: 200 },
      ])
    ).seg;
    expect(walk.legs).toHaveLength(2);
    expect(walk.legs.every((l) => l.autoMode === 'walk')).toBe(true);
  });

  it('a walker visiting a shop for 6 minutes is a destination, never traffic', () => {
    const { seg } = run(
      simulate([
        { kind: 'move', seconds: 400, kmh: 4, dir: 0 },
        { kind: 'stay', seconds: 360 },
        { kind: 'move', seconds: 400, kmh: 4, dir: 90 },
      ])
    );
    expect(seg.dwells.some((d) => d.kind === 'traffic')).toBe(false);
    expect(seg.legs).toHaveLength(2);
  });

  it('a 4 minute traffic-light stop without walking stays a pause', () => {
    const { seg } = run(
      simulate([
        { kind: 'move', seconds: 300, kmh: 40, dir: 0 },
        { kind: 'stay', seconds: 240 },
        { kind: 'move', seconds: 300, kmh: 40, dir: 0 },
      ])
    );
    expect(seg.legs).toHaveLength(1);
    expect(seg.legs[0].pauseCount).toBe(1);
  });

  it('staying in one place all the time gives no trips', () => {
    const { seg } = run(simulate([{ kind: 'stay', seconds: 3600 }]));
    expect(seg.legs).toHaveLength(0);
    expect(seg.endpoints).toHaveLength(1);
  });

  it('recording that starts and ends while moving still has A and B', () => {
    const { seg } = run(simulate([{ kind: 'move', seconds: 600, kmh: 30, dir: 0 }]));
    expect(seg.legs).toHaveLength(1);
    expect(seg.legs[0].from.dwell).toBeNull();
    expect(seg.legs[0].to.dwell).toBeNull();
  });

  it('handles an empty recording', () => {
    const { seg } = run([]);
    expect(seg.legs).toHaveLength(0);
    expect(seg.endpoints).toHaveLength(0);
  });

  it('letters go on after Z', () => {
    expect(letterFor(0)).toBe('A');
    expect(letterFor(25)).toBe('Z');
    expect(letterFor(26)).toBe('A1');
  });

  it('makes Google Maps links', () => {
    expect(googleMapsUrl(-1.2864, 36.8172)).toBe('https://www.google.com/maps/search/?api=1&query=-1.286400,36.817200');
    expect(googleNavigateUrl(-1.2864, 36.8172)).toContain('/maps/dir/?api=1&destination=-1.286400,36.817200');
  });
});
