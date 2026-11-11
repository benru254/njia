/**
 * Speed-over-time chart drawn on a canvas.
 * Stops are shaded, gaps are hatched, and you can drag on it to move through the trip.
 */
import { formatTime } from '../../src/core/format';
import { Analysis } from '../../src/core/types';
import { BUCKETS, bucketOf } from './speedColors';

const PAD_L = 34;
const PAD_R = 8;
const PAD_T = 8;
const PAD_B = 16;

export class SpeedChart {
  private a: Analysis | null = null;
  private cursorT = 0;
  private maxKmh = 20;
  private base: HTMLCanvasElement | null = null;
  onSeek: (t: number) => void = () => {};

  constructor(private canvas: HTMLCanvasElement) {
    const seek = (clientX: number) => {
      if (!this.a || !this.a.points.length) return;
      const rect = this.canvas.getBoundingClientRect();
      const w = rect.width - PAD_L - PAD_R;
      const f = Math.min(1, Math.max(0, (clientX - rect.left - PAD_L) / w));
      const s = this.a.stats;
      this.onSeek(s.startTime + f * (s.endTime - s.startTime));
    };
    let dragging = false;
    canvas.addEventListener('pointerdown', (e) => {
      dragging = true;
      canvas.setPointerCapture(e.pointerId);
      seek(e.clientX);
    });
    canvas.addEventListener('pointermove', (e) => dragging && seek(e.clientX));
    const end = () => (dragging = false);
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    if (typeof ResizeObserver !== 'undefined') {
      new ResizeObserver(() => this.redraw()).observe(canvas);
    } else {
      window.addEventListener('resize', () => this.redraw());
    }
  }

  setData(a: Analysis) {
    this.a = a;
    const top = a.stats.maxSpeed * 3.6;
    this.maxKmh = Math.max(20, Math.ceil((top * 1.1) / 10) * 10);
    this.redraw();
  }

  setCursor(t: number) {
    this.cursorT = t;
    this.paint();
  }

  /** Rebuild the static picture (only when data or size changes). */
  private redraw() {
    const c = this.canvas;
    const dpr = window.devicePixelRatio || 1;
    const w = c.clientWidth;
    const h = c.clientHeight;
    if (!w || !h) return;
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);

    const base = document.createElement('canvas');
    base.width = c.width;
    base.height = c.height;
    const g = base.getContext('2d')!;
    g.scale(dpr, dpr);
    g.fillStyle = '#0d1218';
    g.fillRect(0, 0, w, h);

    const a = this.a;
    const plotW = w - PAD_L - PAD_R;
    const plotH = h - PAD_T - PAD_B;
    if (a && a.points.length > 1) {
      const t0 = a.stats.startTime;
      const span = Math.max(1, a.stats.endTime - t0);
      const x = (t: number) => PAD_L + ((t - t0) / span) * plotW;
      const y = (kmh: number) => PAD_T + plotH - (Math.min(kmh, this.maxKmh) / this.maxKmh) * plotH;

      // Stops: solid bands
      g.fillStyle = 'rgba(255,255,255,0.10)';
      for (const s of a.stops) g.fillRect(x(s.start), PAD_T, Math.max(1, x(s.end) - x(s.start)), plotH);

      // Gaps: hatched bands
      g.save();
      g.strokeStyle = 'rgba(255,255,255,0.22)';
      g.lineWidth = 1;
      for (const gap of a.gaps) {
        const x0 = x(gap.start);
        const x1 = x(gap.end);
        g.save();
        g.beginPath();
        g.rect(x0, PAD_T, x1 - x0, plotH);
        g.clip();
        for (let k = x0 - plotH; k < x1; k += 6) {
          g.beginPath();
          g.moveTo(k, PAD_T + plotH);
          g.lineTo(k + plotH, PAD_T);
          g.stroke();
        }
        g.restore();
      }
      g.restore();

      // Grid lines + labels
      g.font = '10px system-ui, sans-serif';
      g.textBaseline = 'middle';
      g.textAlign = 'right';
      for (const frac of [0, 0.5, 1]) {
        const kmh = this.maxKmh * frac;
        g.strokeStyle = 'rgba(255,255,255,0.08)';
        g.beginPath();
        g.moveTo(PAD_L, y(kmh));
        g.lineTo(w - PAD_R, y(kmh));
        g.stroke();
        g.fillStyle = '#8b98a8';
        g.fillText(String(Math.round(kmh)), PAD_L - 5, y(kmh));
      }
      g.textBaseline = 'alphabetic';
      g.textAlign = 'left';
      g.fillText(formatTime(a.stats.startTime), PAD_L, h - 3);
      g.textAlign = 'right';
      g.fillText(formatTime(a.stats.endTime), w - PAD_R, h - 3);
      g.textAlign = 'center';
      g.fillText('km/h over time', PAD_L + plotW / 2, h - 3);

      // Speed line, coloured the same way as the path on the map
      g.lineWidth = 1.6;
      g.lineJoin = 'round';
      const pts = a.points;
      for (let i = 1; i < pts.length; i++) {
        if (pts[i].gapBefore) continue;
        const k0 = pts[i - 1].v * 3.6;
        const k1 = pts[i].v * 3.6;
        g.strokeStyle = BUCKETS[bucketOf(Math.max(k0, k1))].color;
        g.beginPath();
        g.moveTo(x(pts[i - 1].t), y(k0));
        g.lineTo(x(pts[i].t), y(k1));
        g.stroke();
      }
    }
    this.base = base;
    this.paint();
  }

  /** Cheap repaint: static picture plus the moving cursor line. */
  private paint() {
    const c = this.canvas;
    const g = c.getContext('2d');
    if (!g || !this.base) return;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.drawImage(this.base, 0, 0);
    const a = this.a;
    if (!a || a.points.length < 2) return;
    const dpr = window.devicePixelRatio || 1;
    const w = c.clientWidth;
    const h = c.clientHeight;
    const plotW = w - PAD_L - PAD_R;
    const span = Math.max(1, a.stats.endTime - a.stats.startTime);
    const cx = PAD_L + ((this.cursorT - a.stats.startTime) / span) * plotW;
    g.scale(dpr, dpr);
    g.strokeStyle = '#ffffff';
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(cx, PAD_T - 2);
    g.lineTo(cx, h - PAD_B + 2);
    g.stroke();
  }
}
