import { describe, expect, it } from 'vitest';
import { analyze, cleanPoints } from '../src/core/analyze';
import { formatClock, formatDistance, formatDuration, formatDurationShort, formatSpeed } from '../src/core/format';
import { bearingDeg, compassName, distanceM } from '../src/core/geo';
import { buildGpx, buildTripFile, readTripFile } from '../src/core/tripFile';
import { DEFAULT_OPTIONS, RawPoint } from '../src/core/types';
import { sampleTrip, simulate } from './simulate';

describe('geo', () => {
  it('measures a known distance (Nairobi CBD to JKIA is about 15 km)', () => {
    const d = distanceM(-1.2864, 36.8172, -1.3192, 36.9278);
    expect(d).toBeGreaterThan(12000);
    expect(d).toBeLessThan(13500);
  });
  it('one degree of latitude is about 111 km', () => {
    expect(distanceM(0, 36, 1, 36)).toBeGreaterThan(110500);
    expect(distanceM(0, 36, 1, 36)).toBeLessThan(111500);
  });
  it('gives compass directions', () => {
    expect(Math.round(bearingDeg(0, 0, 1, 0))).toBe(0);
    expect(Math.round(bearingDeg(0, 0, 0, 1))).toBe(90);
    expect(Math.round(bearingDeg(0, 0, -1, 0))).toBe(180);
    expect(Math.round(bearingDeg(0, 0, 0, -1))).toBe(270);
    expect(compassName(0)).toBe('N');
    expect(compassName(100)).toBe('E');
    expect(compassName(225)).toBe('SW');
    expect(compassName(359)).toBe('N');
    expect(compassName(null)).toBe('–');
  });
});

describe('format', () => {
  it('formats durations', () => {
    expect(formatDuration(42)).toBe('42 s');
    expect(formatDuration(185)).toBe('3 min 05 s');
    expect(formatDuration(3725)).toBe('1 h 02 min');
    expect(formatClock(3725)).toBe('1:02:05');
    expect(formatDurationShort(42)).toBe('42 s');
    expect(formatDurationShort(300)).toBe('5 min');
    expect(formatDurationShort(3725)).toBe('1 h 02 min');
  });
  it('formats distance and speed', () => {
    expect(formatDistance(850)).toBe('850 m');
    expect(formatDistance(12345)).toBe('12.3 km');
    expect(formatSpeed(10)).toBe('36 km/h');
    expect(formatSpeed(1)).toBe('3.6 km/h');
    expect(formatSpeed(null)).toBe('– km/h');
  });
});

describe('cleaning', () => {
  const base: RawPoint = { t: 0, lat: -1.28, lon: 36.81, acc: 5, alt: null, spd: null, hdg: null };

  it('drops inaccurate readings', () => {
    const pts = [base, { ...base, t: 3000, acc: 200 }, { ...base, t: 6000 }];
    expect(cleanPoints(pts, DEFAULT_OPTIONS)).toHaveLength(2);
  });

  it('drops an impossible jump but keeps the real path', () => {
    const pts = [
      base,
      { ...base, t: 3000, lat: -1.2801 },
      { ...base, t: 6000, lat: -1.1 }, // 20 km in 3 seconds
      { ...base, t: 9000, lat: -1.2803 },
    ];
    const kept = cleanPoints(pts, DEFAULT_OPTIONS);
    expect(kept).toHaveLength(3);
    expect(kept.some((p) => p.lat === -1.1)).toBe(false);
  });

  it('recovers if the first reading was the bad one', () => {
    const pts = [{ ...base, lat: 5 }];
    for (let i = 1; i <= 10; i++) pts.push({ ...base, t: i * 3000, lat: -1.28 + i * 0.0001 });
    const kept = cleanPoints(pts, DEFAULT_OPTIONS);
    expect(kept.length).toBeGreaterThanOrEqual(7);
  });

  it('sorts by time and ignores rubbish values', () => {
    const pts = [
      { ...base, t: 6000 },
      { ...base, t: 0 },
      { ...base, t: 3000, lat: NaN },
      { ...base, t: 4000, lat: 0, lon: 0 },
    ];
    const kept = cleanPoints(pts, DEFAULT_OPTIONS);
    expect(kept.map((p) => p.t)).toEqual([0, 6000]);
  });
});

describe('analysis of a full sample trip', () => {
  const raw = sampleTrip();
  const a = analyze(raw);

  it('finds exactly the three real stops', () => {
    expect(a.stops).toHaveLength(3);
    const mins = a.stops.map((s) => Math.round(s.durationS / 60));
    expect(mins[0]).toBeGreaterThanOrEqual(4);
    expect(mins[0]).toBeLessThanOrEqual(6);
    expect(mins[1]).toBeGreaterThanOrEqual(14);
    expect(mins[1]).toBeLessThanOrEqual(16);
    expect(mins[2]).toBeGreaterThanOrEqual(2);
    expect(mins[2]).toBeLessThanOrEqual(4);
  });

  it('does not call a 1 minute pause a stop', () => {
    // The 60 s pause must not create a 4th stop.
    expect(a.stops.every((s) => s.durationS >= 120)).toBe(true);
  });

  it('finds the recording gap', () => {
    expect(a.gaps).toHaveLength(1);
    expect(a.gaps[0].durationS).toBeGreaterThan(390);
    expect(a.points.filter((p) => p.gapBefore)).toHaveLength(1);
  });

  it('measures distance within a few percent', () => {
    // 240s@40 + 120s@15 + 300s@65 + 200s@5 + 100s@5 + 300s@50 km/h
    // The last term is the straight line covered during the 400 s recording gap.
    const expected = (240 * 40 + 120 * 15 + 300 * 65 + 300 * 5 + 300 * 50 + 400 * 20) / 3.6;
    expect(a.stats.distanceM).toBeGreaterThan(expected * 0.95);
    expect(a.stats.distanceM).toBeLessThan(expected * 1.08);
  });

  it('gets top speed right (about 65 km/h)', () => {
    expect(a.stats.maxSpeed * 3.6).toBeGreaterThan(63);
    expect(a.stats.maxSpeed * 3.6).toBeLessThan(67);
  });

  it('splits time into moving, stopped and gap', () => {
    const s = a.stats;
    expect(s.stoppedS).toBeGreaterThan(1300);
    expect(s.stoppedS).toBeLessThan(1500);
    expect(s.movingS).toBeGreaterThan(1200);
    expect(s.movingS).toBeLessThan(1500);
    expect(Math.abs(s.movingS + s.stoppedS + s.gapS - s.durationS)).toBeLessThan(30);
  });

  it('shows zero speed while stopped and a direction while moving', () => {
    const inStop = a.points.filter((p) => p.stop >= 0);
    expect(inStop.every((p) => p.v === 0)).toBe(true);
    const fast = a.points.filter((p) => p.v > 15);
    expect(fast.length).toBeGreaterThan(50);
    expect(fast.every((p) => p.dir != null)).toBe(true);
  });

  it('distance never goes backwards', () => {
    for (let i = 1; i < a.points.length; i++) {
      expect(a.points[i].dist).toBeGreaterThanOrEqual(a.points[i - 1].dist);
    }
  });
});

describe('analysis edge cases', () => {
  it('handles no data', () => {
    const a = analyze([]);
    expect(a.points).toHaveLength(0);
    expect(a.stats.distanceM).toBe(0);
  });

  it('handles a single reading', () => {
    const a = analyze([{ t: 1000, lat: -1.28, lon: 36.81, acc: 5, alt: null, spd: null, hdg: null }]);
    expect(a.points).toHaveLength(1);
    expect(a.stats.durationS).toBe(0);
    expect(a.stops).toHaveLength(0);
  });

  it('a phone lying still for an hour is one stop with almost no distance', () => {
    const raw = simulate([{ kind: 'stay', seconds: 3600 }], { noiseM: 8 });
    const a = analyze(raw);
    expect(a.stops).toHaveLength(1);
    expect(a.stats.distanceM).toBeLessThan(5);
    expect(a.stats.stoppedS).toBeGreaterThan(3500);
  });

  it('works out speed and direction when the phone gives none', () => {
    const raw = simulate([{ kind: 'move', seconds: 300, kmh: 36, dir: 90 }], { noiseM: 1 }).map((p) => ({
      ...p,
      spd: null,
      hdg: null,
    }));
    const a = analyze(raw);
    const mid = a.points[50];
    expect(mid.v * 3.6).toBeGreaterThan(30);
    expect(mid.v * 3.6).toBeLessThan(42);
    expect(mid.dir).toBeGreaterThan(80);
    expect(mid.dir).toBeLessThan(100);
  });

  it('a slow walk is not mistaken for a stop', () => {
    const raw = simulate([{ kind: 'move', seconds: 600, kmh: 4, dir: 0 }]);
    const a = analyze(raw);
    expect(a.stops).toHaveLength(0);
    expect(a.stats.distanceM).toBeGreaterThan(600);
  });

  it('a long silence in the same place still counts as a stop', () => {
    const raw = simulate([
      { kind: 'move', seconds: 120, kmh: 30, dir: 0 },
      { kind: 'stay', seconds: 30 },
      { kind: 'gap', seconds: 1800 },
      { kind: 'stay', seconds: 30 },
      { kind: 'move', seconds: 120, kmh: 30, dir: 0 },
    ]);
    const a = analyze(raw);
    expect(a.stops).toHaveLength(1);
    expect(a.stops[0].durationS).toBeGreaterThan(1800);
    expect(a.gaps).toHaveLength(0);
  });
});

describe('export files', () => {
  const raw = sampleTrip();
  const a = analyze(raw);
  const meta = { id: 1, name: 'Test <trip> & more', startedAt: raw[0].t, endedAt: raw[raw.length - 1].t };

  it('builds a GPX file with every point, speed, direction and stops', () => {
    const gpx = buildGpx(
      meta,
      raw,
      a.stops.map((s, i) => ({ lat: s.lat, lon: s.lon, t: s.start, name: `Stop ${i + 1}` }))
    );
    expect(gpx.startsWith('<?xml')).toBe(true);
    expect(gpx.match(/<trkpt /g)).toHaveLength(raw.length);
    expect(gpx.match(/<wpt /g)).toHaveLength(3);
    expect(gpx).toContain('<gpxtpx:speed>');
    expect(gpx).toContain('<gpxtpx:course>');
    expect(gpx).toContain('Test &lt;trip&gt; &amp; more');
    expect(gpx.trim().endsWith('</gpx>')).toBe(true);
  });

  it('backup file round-trips without losing anything that matters', () => {
    const file = buildTripFile(meta, raw);
    const back = readTripFile(JSON.parse(JSON.stringify(file)));
    expect(back.points).toHaveLength(raw.length);
    expect(back.trip.name).toBe(meta.name);
    const a2 = analyze(back.points);
    expect(a2.stops).toHaveLength(a.stops.length);
    expect(Math.abs(a2.stats.distanceM - a.stats.distanceM)).toBeLessThan(20);
  });

  it('rejects a file that is not a trip', () => {
    expect(() => readTripFile({ hello: 1 })).toThrow('not a Njia trip file');
  });
});
