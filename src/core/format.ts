/**
 * Human-readable text for times, distances and speeds.
 * Written by hand (no Intl) so it behaves the same on every phone and browser.
 */

const pad = (n: number) => (n < 10 ? '0' + n : '' + n);
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** 3725 -> "1 h 02 min", 185 -> "3 min 05 s", 42 -> "42 s" */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h} h ${pad(m)} min`;
  if (m > 0) return `${m} min ${pad(sec)} s`;
  return `${sec} s`;
}

/** Short form for labels: 42 -> "42 s", 300 -> "5 min", 3725 -> "1 h 02 min" */
export function formatDurationShort(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s} s`;
  const totalMin = Math.round(s / 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h} h ${pad(m)} min` : `${m} min`;
}

/** 3725 -> "1:02:05" (for a running clock) */
export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}:${pad(m)}:${pad(s % 60)}`;
}

/** 850 -> "850 m", 12345 -> "12.3 km" */
export function formatDistance(metres: number): string {
  if (!Number.isFinite(metres) || metres < 0) return '0 m';
  if (metres < 1000) return `${Math.round(metres)} m`;
  if (metres < 100000) return `${(metres / 1000).toFixed(1)} km`;
  return `${Math.round(metres / 1000)} km`;
}

/** Metres per second -> "43 km/h" */
export function formatSpeed(mps: number | null | undefined): string {
  if (mps == null || !Number.isFinite(mps)) return '– km/h';
  const kmh = mps * 3.6;
  return `${kmh < 10 ? kmh.toFixed(1) : Math.round(kmh)} km/h`;
}

export const toKmh = (mps: number) => mps * 3.6;

/** "14:05" in the device's own time zone */
export function formatTime(ms: number): string {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** "14:05:09" */
export function formatTimeSec(ms: number): string {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** "Wed 11 Nov 2026" */
export function formatDate(ms: number): string {
  const d = new Date(ms);
  return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/** "2026-11-11_1405" — safe to use in a file name */
export function fileStamp(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
}
