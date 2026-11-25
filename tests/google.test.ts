import { describe, expect, it } from 'vitest';
import { analyze } from '../src/core/analyze';
import { buildKml } from '../src/core/kml';
import { googleRouteUrl } from '../src/core/links';
import { HOLD_ANALYZE, segment } from '../src/core/segment';
import { evenlyAlong, simplifyIndexes } from '../src/core/simplify';
import { deliveryDay, simulate } from './simulate';

describe('simplify', () => {
  it('a straight line keeps only its two ends', () => {
    const pts = Array.from({ length: 100 }, (_, i) => ({ lat: -1.28 + i * 0.0001, lon: 36.8 }));
    expect(simplifyIndexes(pts, 5)).toEqual([0, 99]);
  });
  it('keeps the corner of an L-shaped path', () => {
    const pts = [
      ...Array.from({ length: 50 }, (_, i) => ({ lat: -1.28 + i * 0.0001, lon: 36.8 })),
      ...Array.from({ length: 50 }, (_, i) => ({ lat: -1.28 + 49 * 0.0001, lon: 36.8 + (i + 1) * 0.0001 })),
    ];
    const keep = simplifyIndexes(pts, 5);
    expect(keep).toContain(49);
    expect(keep.length).toBeLessThan(6);
  });
  it('a real day shrinks a lot but still follows the path', () => {
    const a = analyze(deliveryDay(), HOLD_ANALYZE);
    const keep = simplifyIndexes(a.points, 6);
    expect(keep.length).toBeLessThan(a.points.length / 5);
  });
  it('picks points spread along the path', () => {
    const a = analyze(simulate([{ kind: 'move', seconds: 900, kmh: 36, dir: 0 }]), HOLD_ANALYZE);
    const idx = evenlyAlong(a.points, 8);
    expect(idx).toHaveLength(8);
    for (let i = 1; i < idx.length; i++) expect(idx[i]).toBeGreaterThan(idx[i - 1]);
  });
});

describe('Google', () => {
  it('builds a KML file with every trip and stop', () => {
    const a = analyze(deliveryDay(), HOLD_ANALYZE);
    const seg = segment(a);
    const kml = buildKml(a, seg, { title: 'Test <day> & more' });
    expect(kml.startsWith('<?xml')).toBe(true);
    expect(kml.match(/<LineString>/g)).toHaveLength(seg.legs.length);
    expect(kml.match(/<Point>/g)).toHaveLength(seg.endpoints.length);
    expect(kml).toContain('Test &lt;day&gt; &amp; more');
    expect(kml.trim().endsWith('</kml>')).toBe(true);
    expect(kml.length).toBeLessThan(60_000);
  });
  it('builds a Google Maps route link through points of the path', () => {
    const url = googleRouteUrl({ lat: -1.28, lon: 36.8 }, { lat: -1.3, lon: 36.9 }, [
      { lat: -1.29, lon: 36.85 },
      { lat: -1.295, lon: 36.87 },
    ]);
    expect(url).toContain('origin=-1.280000,36.800000');
    expect(url).toContain('destination=-1.300000,36.900000');
    expect(url).toContain('waypoints=-1.290000%2C36.850000%7C-1.295000%2C36.870000');
    const many = Array.from({ length: 20 }, (_, i) => ({ lat: -1.28 - i * 0.001, lon: 36.8 }));
    const u2 = googleRouteUrl(many[0], many[19], many);
    expect(decodeURIComponent(u2.split('waypoints=')[1]).split('|')).toHaveLength(8);
  });
});
