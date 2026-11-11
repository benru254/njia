/** Fixed speed colours, so the same colour means the same speed on every trip. */
export interface SpeedBucket {
  /** Upper limit in km/h (not included). */
  max: number;
  color: string;
  label: string;
}

export const BUCKETS: SpeedBucket[] = [
  { max: 6, color: '#4f7cff', label: '0–6' },
  { max: 20, color: '#12b5a5', label: '6–20' },
  { max: 40, color: '#43b82f', label: '20–40' },
  { max: 60, color: '#e3b008', label: '40–60' },
  { max: 80, color: '#f2801c', label: '60–80' },
  { max: Infinity, color: '#e23d3d', label: '80+' },
];

export function bucketOf(kmh: number): number {
  for (let i = 0; i < BUCKETS.length; i++) if (kmh < BUCKETS[i].max) return i;
  return BUCKETS.length - 1;
}

export const GAP_COLOR = '#7a8794';
