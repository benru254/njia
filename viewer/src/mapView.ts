/**
 * The map: speed-coloured path, direction arrows, start / end / stop markers
 * and the moving replay cursor.
 *
 * The path is ALWAYS drawn, even with no internet. The street-map background
 * is a bonus that appears when the device is online (or has it cached).
 */
import type { FeatureCollection, LineString } from 'geojson';
import type * as ML from 'maplibre-gl';
import { formatDurationShort, formatTime } from '../../src/core/format';
import { Analysis } from '../../src/core/types';
import { BUCKETS, GAP_COLOR, bucketOf } from './speedColors';

declare const maplibregl: typeof ML;

export type BasemapKind = 'light' | 'streets' | 'plain';

const STYLE_URLS: Record<Exclude<BasemapKind, 'plain'>, string> = {
  light: 'https://tiles.openfreemap.org/styles/positron',
  streets: 'https://tiles.openfreemap.org/styles/liberty',
};

const PLAIN_STYLE: ML.StyleSpecification = {
  version: 8,
  sources: {},
  layers: [{ id: 'njia-bg', type: 'background', paint: { 'background-color': '#e6eaee' } }],
};

type LngLat = [number, number];
type FC = FeatureCollection<LineString>;
const EMPTY: FC = { type: 'FeatureCollection', features: [] };

export interface MapCallbacks {
  /** User tapped the path: jump to this time. */
  onPick: (t: number) => void;
  /** User tapped a stop marker. */
  onStop: (index: number) => void;
  /** Short note about the map background (e.g. offline). Empty string clears it. */
  onStatus: (message: string) => void;
}

function pill(className: string, html: string): HTMLDivElement {
  const el = document.createElement('div');
  el.className = 'mk ' + className;
  el.innerHTML = html;
  return el;
}

function arrowImage(): ImageData {
  const size = 28;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const g = c.getContext('2d')!;
  // A chevron pointing right (east): MapLibre lines icons up along the path.
  g.lineJoin = 'round';
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(9, 7);
  g.lineTo(19, 14);
  g.lineTo(9, 21);
  g.strokeStyle = 'rgba(10,16,24,0.9)';
  g.lineWidth = 6;
  g.stroke();
  g.strokeStyle = '#ffffff';
  g.lineWidth = 2.6;
  g.stroke();
  return g.getImageData(0, 0, size, size);
}

export class MapView {
  ok = false;
  private map!: ML.Map;
  private a: Analysis | null = null;
  /** Where each point is drawn. Points inside a stop are all drawn at the stop's centre. */
  private disp: LngLat[] = [];
  private track: FC = EMPTY;
  private gaps: FC = EMPTY;
  private markers: ML.Marker[] = [];
  private cursor: ML.Marker | null = null;
  private cursorArrow: HTMLElement | null = null;
  private styleCache: Partial<Record<BasemapKind, ML.StyleSpecification>> = {};
  private wanted: BasemapKind = 'light';

  constructor(
    container: HTMLElement,
    private cb: MapCallbacks,
    private styleOverride: string | null = null
  ) {
    try {
      this.map = new maplibregl.Map({
        container,
        style: PLAIN_STYLE,
        center: [36.8172, -1.2864],
        zoom: 11,
        attributionControl: { compact: true },
        dragRotate: false,
        pitchWithRotate: false,
        maxPitch: 0,
      });
      this.map.touchZoomRotate.disableRotation();
      this.map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');
      if (window.matchMedia('(min-width: 900px)').matches) {
        this.map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
      }
      this.map.on('style.load', () => this.install());
      this.map.on('click', (e) => this.pick(e.point));
      this.ok = true;
    } catch (err) {
      this.ok = false;
      container.innerHTML =
        '<div class="mapfail">The map could not start on this device.<br>Your trip details, chart and stops below still work.</div>';
      console.error(err);
    }
  }

  /** (Re)create our layers. Runs every time the background style changes. */
  private install() {
    const m = this.map;
    if (!m.hasImage('njia-arrow')) m.addImage('njia-arrow', arrowImage());
    if (!m.getSource('njia-track')) m.addSource('njia-track', { type: 'geojson', data: this.track });
    if (!m.getSource('njia-gaps')) m.addSource('njia-gaps', { type: 'geojson', data: this.gaps });

    if (!m.getLayer('njia-gaps')) {
      m.addLayer({
        id: 'njia-gaps',
        type: 'line',
        source: 'njia-gaps',
        layout: { 'line-cap': 'butt' },
        paint: { 'line-color': GAP_COLOR, 'line-width': 3, 'line-dasharray': [1.2, 1.6] },
      });
    }
    if (!m.getLayer('njia-track-casing')) {
      m.addLayer({
        id: 'njia-track-casing',
        type: 'line',
        source: 'njia-track',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#0a1018', 'line-width': 7.5, 'line-opacity': 0.75 },
      });
    }
    if (!m.getLayer('njia-track')) {
      m.addLayer({
        id: 'njia-track',
        type: 'line',
        source: 'njia-track',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': ['get', 'color'], 'line-width': 4.5 },
      });
    }
    if (!m.getLayer('njia-arrows')) {
      m.addLayer({
        id: 'njia-arrows',
        type: 'symbol',
        source: 'njia-track',
        minzoom: 11,
        layout: {
          'symbol-placement': 'line',
          'symbol-spacing': 90,
          'icon-image': 'njia-arrow',
          'icon-size': 0.6,
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
          'icon-rotation-alignment': 'map',
        },
      });
    }
  }

  private setSourceData() {
    const t = this.map.getSource('njia-track') as ML.GeoJSONSource | undefined;
    const g = this.map.getSource('njia-gaps') as ML.GeoJSONSource | undefined;
    if (t) t.setData(this.track);
    if (g) g.setData(this.gaps);
  }

  setTrip(a: Analysis) {
    this.a = a;
    const pts = a.points;
    this.disp = pts.map((p) =>
      p.stop >= 0 ? ([a.stops[p.stop].lon, a.stops[p.stop].lat] as LngLat) : ([p.lon, p.lat] as LngLat)
    );

    // Colour by a short moving average, so the colour does not flicker when
    // the speed hovers right on the edge between two colour bands.
    const smooth = new Float64Array(pts.length);
    for (let i = 0; i < pts.length; i++) {
      let sum = 0;
      let count = 0;
      for (let k = Math.max(0, i - 3); k <= Math.min(pts.length - 1, i + 3); k++) {
        if (pts[k].stop >= 0) continue;
        sum += pts[k].v;
        count++;
      }
      smooth[i] = count ? sum / count : 0;
    }

    // Build the path as runs of same-coloured line.
    const track: FC = { type: 'FeatureCollection', features: [] };
    const gaps: FC = { type: 'FeatureCollection', features: [] };
    let run: LngLat[] = [];
    let runBucket = -1;
    const flush = () => {
      if (run.length > 1) {
        track.features.push({
          type: 'Feature',
          properties: { color: BUCKETS[runBucket].color },
          geometry: { type: 'LineString', coordinates: run },
        });
      }
      run = [];
      runBucket = -1;
    };
    for (let i = 1; i < pts.length; i++) {
      const from = this.disp[i - 1];
      const to = this.disp[i];
      if (from[0] === to[0] && from[1] === to[1]) continue; // standing still
      if (pts[i].gapBefore) {
        flush();
        gaps.features.push({
          type: 'Feature',
          properties: {},
          geometry: { type: 'LineString', coordinates: [from, to] },
        });
        continue;
      }
      const b = bucketOf(smooth[i] * 3.6);
      if (b !== runBucket) {
        flush();
        run = [from];
        runBucket = b;
      }
      run.push(to);
    }
    flush();
    this.track = track;
    this.gaps = gaps;
    if (!this.ok) return;
    this.setSourceData();

    // Markers
    this.markers.forEach((mk) => mk.remove());
    this.markers = [];
    if (this.cursor) this.cursor.remove();
    this.cursor = null;
    if (!pts.length) return;

    a.stops.forEach((s, i) => {
      const el = pill('mk-stop', `<b>${i + 1}</b><span>${formatDurationShort(s.durationS)}</span>`);
      el.title = `Stop ${i + 1}: ${formatTime(s.start)} to ${formatTime(s.end)}`;
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        this.cb.onStop(i);
      });
      // Anchor so the numbered circle (not the middle of the label) sits on the exact spot.
      this.markers.push(
        new maplibregl.Marker({ element: el, anchor: 'left', offset: [-13, 0] }).setLngLat([s.lon, s.lat]).addTo(this.map)
      );
    });

    const first = this.disp[0];
    const last = this.disp[this.disp.length - 1];
    this.markers.push(
      new maplibregl.Marker({
        element: pill('mk-start', `Start ${formatTime(a.stats.startTime)}`),
        anchor: 'bottom',
        offset: [0, -16],
      })
        .setLngLat(first)
        .addTo(this.map),
      new maplibregl.Marker({
        element: pill('mk-end', `End ${formatTime(a.stats.endTime)}`),
        anchor: 'top',
        offset: [0, 16],
      })
        .setLngLat(last)
        .addTo(this.map)
    );

    const cur = document.createElement('div');
    cur.className = 'mk-cursor';
    cur.innerHTML = '<i></i>';
    this.cursorArrow = cur.firstElementChild as HTMLElement;
    this.cursor = new maplibregl.Marker({ element: cur, rotationAlignment: 'map' })
      .setLngLat(first)
      .addTo(this.map);

    this.fit(false);
  }

  /** Zoom so the whole trip is visible. */
  fit(animate = true) {
    const b = this.a?.stats.bbox;
    if (!this.ok || !b) return;
    this.map.resize();
    this.map.fitBounds(
      [
        [b.minLon, b.minLat],
        [b.maxLon, b.maxLat],
      ],
      { padding: { top: 76, bottom: 44, left: 44, right: 70 }, maxZoom: 17, duration: animate ? 500 : 0 }
    );
  }

  /** Where the path is at time t (smoothly between readings). */
  positionAt(t: number): { lngLat: LngLat; index: number } | null {
    const pts = this.a?.points;
    if (!pts || !pts.length) return null;
    if (t <= pts[0].t) return { lngLat: this.disp[0], index: 0 };
    const n = pts.length;
    if (t >= pts[n - 1].t) return { lngLat: this.disp[n - 1], index: n - 1 };
    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (pts[mid].t <= t) lo = mid;
      else hi = mid;
    }
    const f = (t - pts[lo].t) / (pts[hi].t - pts[lo].t);
    const a = this.disp[lo];
    const b = this.disp[hi];
    return { lngLat: [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f], index: lo };
  }

  setCursor(lngLat: LngLat, dir: number | null, moving: boolean, follow: boolean) {
    if (!this.ok || !this.cursor) return;
    this.cursor.setLngLat(lngLat);
    if (this.cursorArrow) this.cursorArrow.style.display = moving && dir != null ? 'block' : 'none';
    if (dir != null) this.cursor.setRotation(dir);
    if (follow) {
      const p = this.map.project(lngLat);
      const c = this.map.getContainer();
      const m = 40;
      if (p.x < m || p.y < m || p.x > c.clientWidth - m || p.y > c.clientHeight - m) {
        // Jump (no animation): at fast replay speeds an animation would never catch up.
        this.map.jumpTo({ center: lngLat });
      }
    }
  }

  flyTo(lngLat: LngLat, minZoom = 15) {
    if (!this.ok) return;
    this.map.easeTo({ center: lngLat, zoom: Math.max(this.map.getZoom(), minZoom), duration: 500 });
  }

  resize() {
    if (this.ok) this.map.resize();
  }

  private pick(point: ML.Point) {
    const pts = this.a?.points;
    if (!pts || !pts.length) return;
    let best = -1;
    let bestD = 28 * 28; // must tap within 28 px of the path
    for (let i = 0; i < pts.length; i++) {
      const p = this.map.project(this.disp[i]);
      const d = (p.x - point.x) ** 2 + (p.y - point.y) ** 2;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    if (best >= 0) this.cb.onPick(pts[best].t);
  }

  /** Switch the background. Falls back to plain when there is no internet. */
  async setBasemap(kind: BasemapKind): Promise<BasemapKind> {
    if (!this.ok) return 'plain';
    this.wanted = kind;
    if (kind === 'plain') {
      this.map.setStyle(PLAIN_STYLE, { diff: false });
      this.cb.onStatus('');
      return 'plain';
    }
    try {
      let style = this.styleCache[kind];
      if (!style) {
        const ctl = new AbortController();
        const timer = setTimeout(() => ctl.abort(), 8000);
        const res = await fetch(this.styleOverride || STYLE_URLS[kind], { signal: ctl.signal });
        clearTimeout(timer);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        style = (await res.json()) as ML.StyleSpecification;
        this.styleCache[kind] = style;
      }
      if (this.wanted !== kind) return this.wanted; // user changed their mind meanwhile
      this.map.setStyle(style, { diff: false });
      this.cb.onStatus('');
      return kind;
    } catch {
      if (this.wanted === kind) {
        this.cb.onStatus('No internet: street map hidden. Your path is still exact.');
      }
      return 'plain';
    }
  }
}
