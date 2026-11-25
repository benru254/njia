/**
 * Makes a path lighter by dropping points that lie almost on a straight line
 * (Douglas–Peucker). A day of 20,000 points becomes a few hundred that look
 * the same on a map, which keeps files for Google Earth / My Maps small.
 */

export interface LatLon {
  lat: number;
  lon: number;
}

/** Keep the points (indexes, in order) needed to stay within `toleranceM` metres of the real path. */
export function simplifyIndexes(points: LatLon[], toleranceM: number): number[] {
  const n = points.length;
  if (n <= 2) return points.map((_, i) => i);

  // Flat x/y in metres around the first point (accurate enough within a city or a country).
  const lat0 = (points[0].lat * Math.PI) / 180;
  const mLat = 111320;
  const mLon = 111320 * Math.cos(lat0);
  const x = points.map((p) => (p.lon - points[0].lon) * mLon);
  const y = points.map((p) => (p.lat - points[0].lat) * mLat);

  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  const tol2 = toleranceM * toleranceM;
  const stack: Array<[number, number]> = [[0, n - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    if (b - a < 2) continue;
    const dx = x[b] - x[a];
    const dy = y[b] - y[a];
    const len2 = dx * dx + dy * dy;
    let worst = -1;
    let worstD = -1;
    for (let i = a + 1; i < b; i++) {
      let d2: number;
      if (len2 === 0) {
        d2 = (x[i] - x[a]) ** 2 + (y[i] - y[a]) ** 2;
      } else {
        const t = Math.max(0, Math.min(1, ((x[i] - x[a]) * dx + (y[i] - y[a]) * dy) / len2));
        d2 = (x[i] - x[a] - t * dx) ** 2 + (y[i] - y[a] - t * dy) ** 2;
      }
      if (d2 > worstD) {
        worstD = d2;
        worst = i;
      }
    }
    if (worstD > tol2) {
      keep[worst] = 1;
      stack.push([a, worst], [worst, b]);
    }
  }
  const out: number[] = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(i);
  return out;
}

/** Pick `count` points spread evenly by distance along the path (not counting the two ends). */
export function evenlyAlong(points: Array<LatLon & { dist: number }>, count: number): number[] {
  const n = points.length;
  if (n < 3 || count <= 0) return [];
  const d0 = points[0].dist;
  const total = points[n - 1].dist - d0;
  if (total <= 0) return [];
  const out: number[] = [];
  let j = 1;
  for (let k = 1; k <= count; k++) {
    const target = d0 + (total * k) / (count + 1);
    while (j < n - 1 && points[j].dist < target) j++;
    if (j < n - 1 && (out.length === 0 || out[out.length - 1] !== j)) out.push(j);
  }
  return out;
}
