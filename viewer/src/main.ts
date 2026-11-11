/**
 * Njia trip viewer.
 *
 * The SAME page runs in two places:
 *   - inside the phone app (the app hands it a trip through window.__NJIA_DATA__)
 *   - on a PC, opened as a normal file (you pick a .json or .gpx trip file)
 */
import { analyze } from '../../src/core/analyze';
import {
  formatDate,
  formatDistance,
  formatDuration,
  formatDurationShort,
  formatSpeed,
  formatTime,
  formatTimeSec,
} from '../../src/core/format';
import { compassName } from '../../src/core/geo';
import { TripMeta, readTripFile } from '../../src/core/tripFile';
import { Analysis, RawPoint } from '../../src/core/types';
import { sampleTrip } from '../../tests/simulate';
import { SpeedChart } from './chart';
import { parseGpx } from './gpxParse';
import { BasemapKind, MapView } from './mapView';
import { BUCKETS } from './speedColors';

declare global {
  interface Window {
    __NJIA_DATA__?: unknown;
    ReactNativeWebView?: { postMessage: (msg: string) => void };
    /** Small hooks used by automated checks. */
    __njia?: { ready: boolean; state: () => unknown; seek: (t: number) => void };
  }
}

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

const embedded = window.__NJIA_DATA__ != null;
document.body.classList.add(embedded ? 'embedded' : 'standalone');

// ---------------------------------------------------------------- state
let raw: RawPoint[] = [];
let meta: TripMeta | null = null;
let a: Analysis | null = null;
let cursorT = 0;
let playing = false;
let rate = 60;
let minStopS = 120;
let tab: 'summary' | 'stops' = 'summary';
let lastFrame = 0;

// ---------------------------------------------------------------- error reporting
function toast(message: string) {
  const el = $('toast');
  el.textContent = message;
  el.hidden = false;
  window.clearTimeout((toast as any).timer);
  (toast as any).timer = window.setTimeout(() => (el.hidden = true), 7000);
}
function tellApp(type: string, payload: Record<string, unknown> = {}) {
  try {
    window.ReactNativeWebView?.postMessage(JSON.stringify({ type, ...payload }));
  } catch {
    /* not inside the app */
  }
}
window.addEventListener('error', (e) => {
  tellApp('error', { message: String(e.message || e.error || 'Unknown error') });
});

// ---------------------------------------------------------------- map + chart
const params = new URLSearchParams(location.search);
const mapView = new MapView(
  $('map'),
  {
    onPick: (t) => seek(t, false),
    onStop: (i) => goToStop(i),
    onStatus: (msg) => {
      $('mapstatus').textContent = msg;
      $('mapstatus').hidden = !msg;
      // Show the note briefly, then get out of the way of the map.
      if (msg) window.setTimeout(() => ($('mapstatus').hidden = true), 6000);
    },
  },
  params.get('style')
);
const chart = new SpeedChart($<HTMLCanvasElement>('chart'));
chart.onSeek = (t) => seek(t, false);

$('legend').innerHTML =
  '<span>km/h:</span>' +
  BUCKETS.map((b) => `<div class="row"><span class="sw" style="background:${b.color}"></span>${b.label}</div>`).join('') +
  '<div class="row"><span class="sw gap"></span>no data</div>';

// ---------------------------------------------------------------- loading a trip
function load(tripMeta: TripMeta, points: RawPoint[]) {
  meta = tripMeta;
  raw = points;
  pause();
  reanalyze();
  $('empty').hidden = true;
  if (a && a.points.length) {
    $('top-name').textContent = meta.name || `Trip on ${formatDate(a.stats.startTime)}`;
    // Pick a replay speed that plays the whole trip in about a minute.
    const options = [5, 20, 60, 200, 600];
    rate = options.find((r) => a!.stats.durationS / r <= 70) ?? 600;
    $<HTMLSelectElement>('rate').value = String(rate);
  }
  tellApp('ready', { points: a ? a.points.length : 0, mapOk: mapView.ok });
}

function reanalyze() {
  a = analyze(raw, { minStopS });
  mapView.setTrip(a);
  chart.setData(a);
  renderTab();
  $('tabs').querySelector('[data-tab="stops"]')!.textContent = `Stops (${a.stops.length})`;
  seek(a.points.length ? Math.min(Math.max(cursorT, a.stats.startTime), a.stats.endTime) : 0, false);
}

// ---------------------------------------------------------------- moving through the trip
function seek(t: number, follow: boolean) {
  if (!a || !a.points.length) return;
  const s = a.stats;
  cursorT = Math.min(s.endTime, Math.max(s.startTime, t));
  const pos = mapView.positionAt(cursorT);
  if (!pos) return;
  const pts = a.points;
  const p = pts[pos.index];
  const next = pts[pos.index + 1];

  // Speed between two readings is blended so the number does not jump.
  let v = p.v;
  let state = 'Moving';
  let cls = '';
  if (p.stop >= 0 && (!next || next.stop === p.stop || cursorT <= p.t)) {
    const st = a.stops[p.stop];
    state = `Stop ${p.stop + 1} · stayed ${formatDurationShort(st.durationS)}`;
    cls = 'stopped';
    v = 0;
  } else if (next && next.gapBefore && cursorT > p.t) {
    state = 'No data here';
    cls = 'nodata';
    v = 0;
  } else if (next && next.t > p.t) {
    const f = (cursorT - p.t) / (next.t - p.t);
    v = p.v + (next.v - p.v) * f;
  }
  const moving = cls === '' && v > 0.3;
  if (cls === '' && !moving) state = 'Standing';

  const kmh = v * 3.6;
  $('now-speed').innerHTML = `${kmh < 10 ? kmh.toFixed(1) : Math.round(kmh)}<small>km/h</small>`;
  $('now-state').textContent = state;
  $('now-state').className = cls;
  const extra = [`${formatDistance(p.dist)} from start`];
  if (p.acc != null) extra.push(`accuracy ±${Math.round(p.acc)} m`);
  if (p.alt != null) extra.push(`altitude ${Math.round(p.alt)} m`);
  $('now-extra').textContent = extra.join(' · ');
  $('now-time').textContent = formatTimeSec(cursorT);
  const dir = moving ? p.dir : null;
  $('now-compass').textContent = dir != null ? `${compassName(dir)} ${Math.round(dir)}°` : '–';
  ($('now-arrow') as unknown as SVGElement).style.transform = `rotate(${dir ?? 0}deg)`;
  ($('now-arrow') as unknown as SVGElement).style.opacity = dir != null ? '1' : '0.25';

  const span = Math.max(1, s.endTime - s.startTime);
  $<HTMLInputElement>('seek').value = String(Math.round(((cursorT - s.startTime) / span) * 10000));
  chart.setCursor(cursorT);
  mapView.setCursor(pos.lngLat, p.dir, moving, follow);
}

function frame(now: number) {
  if (!playing || !a) return;
  const dt = Math.min(0.1, (now - lastFrame) / 1000);
  lastFrame = now;
  const t = cursorT + dt * rate * 1000;
  if (t >= a.stats.endTime) {
    seek(a.stats.endTime, true);
    pause();
    return;
  }
  seek(t, true);
  requestAnimationFrame(frame);
}
const ICON_PLAY = '<path d="M4 2l10 6-10 6z"/>';
const ICON_PAUSE = '<path d="M3 2h4v12H3zM9 2h4v12H9z"/>';
function play() {
  if (!a || a.points.length < 2) return;
  if (cursorT >= a.stats.endTime) cursorT = a.stats.startTime;
  playing = true;
  lastFrame = performance.now();
  $('ico-play').innerHTML = ICON_PAUSE;
  requestAnimationFrame(frame);
}
function pause() {
  playing = false;
  $('ico-play').innerHTML = ICON_PLAY;
}

/** Times worth jumping to: the start, each stop, the end. */
function eventTimes(): number[] {
  if (!a || !a.points.length) return [];
  return [a.stats.startTime, ...a.stops.map((s) => s.start), a.stats.endTime];
}
function jump(direction: 1 | -1) {
  const times = eventTimes();
  pause();
  if (direction === 1) {
    const t = times.find((x) => x > cursorT + 500);
    if (t != null) seekAndShow(t);
  } else {
    const before = times.filter((x) => x < cursorT - 500);
    if (before.length) seekAndShow(before[before.length - 1]);
  }
}
function seekAndShow(t: number) {
  seek(t, false);
  const pos = mapView.positionAt(cursorT);
  if (pos) mapView.flyTo(pos.lngLat);
}
function goToStop(i: number) {
  if (!a || !a.stops[i]) return;
  pause();
  seekAndShow(a.stops[i].start);
  document.querySelectorAll('.ev.on').forEach((el) => el.classList.remove('on'));
  document.querySelector(`.ev[data-stop="${i}"]`)?.classList.add('on');
}

// ---------------------------------------------------------------- details panel
function stat(k: string, v: string) {
  return `<div class="stat"><div class="k">${k}</div><div class="v">${v}</div></div>`;
}

function renderTab() {
  const body = $('tabbody');
  if (!a || !a.points.length) {
    body.innerHTML = '<p class="note">This trip has no usable GPS points.</p>';
    return;
  }
  const s = a.stats;
  if (tab === 'summary') {
    body.innerHTML =
      '<div class="stats">' +
      stat('Date', formatDate(s.startTime)) +
      stat('From – to', `${formatTime(s.startTime)} – ${formatTime(s.endTime)}`) +
      stat('Distance', formatDistance(s.distanceM)) +
      stat('Total time', formatDuration(s.durationS)) +
      stat('Moving', formatDuration(s.movingS)) +
      stat('Stopped', `${formatDuration(s.stoppedS)} (${a.stops.length})`) +
      stat('Average (moving)', formatSpeed(s.avgMovingSpeed)) +
      stat('Top speed', formatSpeed(s.maxSpeed)) +
      (s.gapS > 0 ? stat('No data', formatDuration(s.gapS)) : '') +
      stat('GPS points', `${s.pointCount.toLocaleString()}`) +
      '</div>' +
      '<label class="opt">Count it as a stop after' +
      '<select id="minstop">' +
      [1, 2, 5, 10, 20]
        .map((m) => `<option value="${m * 60}"${m * 60 === minStopS ? ' selected' : ''}>${m} min</option>`)
        .join('') +
      '</select></label>' +
      (s.droppedCount > 0
        ? `<p class="note">${s.droppedCount.toLocaleString()} of ${s.rawCount.toLocaleString()} readings were ignored because they were inaccurate.</p>`
        : '') +
      '<p class="note">Tap the path or drag on the chart to see the exact time, speed and direction at any spot.</p>';
    $<HTMLSelectElement>('minstop').addEventListener('change', (e) => {
      minStopS = Number((e.target as HTMLSelectElement).value);
      reanalyze();
    });
    return;
  }

  // Stops tab: a timeline of start, every stop and gap, end.
  type Row = { t: number; html: string };
  const rows: Row[] = [];
  rows.push({
    t: s.startTime - 1,
    html: `<button class="ev" data-t="${s.startTime}"><span class="badge s">S</span><span class="what"><div>Start</div><div>${formatTimeSec(s.startTime)}</div></span></button>`,
  });
  a.stops.forEach((st, i) => {
    rows.push({
      t: st.start,
      html: `<button class="ev" data-stop="${i}"><span class="badge">${i + 1}</span><span class="what"><div>Stop ${i + 1}</div><div>${formatTime(st.start)} – ${formatTime(st.end)}</div></span><span class="dur">${formatDurationShort(st.durationS)}</span></button>`,
    });
  });
  a.gaps.forEach((g) => {
    rows.push({
      t: g.start,
      html: `<button class="ev" data-t="${g.start}"><span class="badge g">?</span><span class="what"><div>No data</div><div>${formatTime(g.start)} – ${formatTime(g.end)} · jumped ${formatDistance(g.distanceM)}</div></span><span class="dur">${formatDurationShort(g.durationS)}</span></button>`,
    });
  });
  rows.push({
    t: s.endTime + 1,
    html: `<button class="ev" data-t="${s.endTime}"><span class="badge e">E</span><span class="what"><div>End</div><div>${formatTimeSec(s.endTime)}</div></span></button>`,
  });
  rows.sort((x, y) => x.t - y.t);
  body.innerHTML =
    rows.map((r) => r.html).join('') +
    (a.stops.length === 0 ? '<p class="note">No stops on this trip (you never stayed in one place long enough).</p>' : '');
}

$('tabbody').addEventListener('click', (e) => {
  const row = (e.target as HTMLElement).closest<HTMLElement>('.ev');
  if (!row) return;
  if (row.dataset.stop != null) goToStop(Number(row.dataset.stop));
  else if (row.dataset.t != null) {
    pause();
    seekAndShow(Number(row.dataset.t));
  }
});

$('tabs').addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLElement>('button[data-tab]');
  if (!btn) return;
  tab = btn.dataset.tab as typeof tab;
  $('tabs')
    .querySelectorAll('button')
    .forEach((b) => b.classList.toggle('on', b === btn));
  renderTab();
});

// ---------------------------------------------------------------- controls
$('btn-play').addEventListener('click', () => (playing ? pause() : play()));
$('btn-prev').addEventListener('click', () => jump(-1));
$('btn-next').addEventListener('click', () => jump(1));
$('btn-fit').addEventListener('click', () => mapView.fit());
$('rate').addEventListener('change', (e) => (rate = Number((e.target as HTMLSelectElement).value)));
$('seek').addEventListener('input', (e) => {
  if (!a || !a.points.length) return;
  pause();
  const f = Number((e.target as HTMLInputElement).value) / 10000;
  seek(a.stats.startTime + f * (a.stats.endTime - a.stats.startTime), false);
});
$('btn-details').addEventListener('click', () => {
  const d = $('details');
  d.hidden = !d.hidden;
  $('btn-details').textContent = d.hidden ? 'Details' : 'Hide details';
  // The map area changed size: let the map re-measure, keeping the trip in view.
  requestAnimationFrame(() => (playing ? mapView.resize() : mapView.fit(false)));
});
$('basemap').addEventListener('change', async (e) => {
  const sel = e.target as HTMLSelectElement;
  const got = await mapView.setBasemap(sel.value as BasemapKind);
  sel.value = got;
});
window.addEventListener('resize', () => mapView.resize());

// ---------------------------------------------------------------- opening files (PC viewer)
function openText(name: string, text: string) {
  try {
    const trimmed = text.trimStart();
    if (/\.gpx$/i.test(name) || trimmed.startsWith('<')) {
      const g = parseGpx(text);
      load({ id: name, name: g.name || name, startedAt: g.points[0].t, endedAt: g.points[g.points.length - 1].t }, g.points);
    } else {
      const f = readTripFile(JSON.parse(text));
      load(f.trip, f.points);
    }
  } catch (err) {
    toast(err instanceof SyntaxError ? 'This file could not be read. Choose a Njia .json or a .gpx file.' : String((err as Error).message || err));
  }
}
function openFile(file: File | undefined | null) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => openText(file.name, String(reader.result || ''));
  reader.onerror = () => toast('The file could not be read.');
  reader.readAsText(file);
}

if (!embedded) {
  const empty = $('empty');
  const fileInput = $<HTMLInputElement>('file');
  empty.hidden = false;
  $('btn-choose').addEventListener('click', () => fileInput.click());
  $('btn-open').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    openFile(fileInput.files?.[0]);
    fileInput.value = '';
  });
  $('btn-demo').addEventListener('click', () => {
    const pts = sampleTrip();
    load({ id: 'demo', name: 'Demo trip (made-up data)', startedAt: pts[0].t, endedAt: pts[pts.length - 1].t }, pts);
  });
  window.addEventListener('dragover', (e) => {
    e.preventDefault();
    empty.classList.add('over');
  });
  window.addEventListener('dragleave', () => empty.classList.remove('over'));
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    empty.classList.remove('over');
    openFile(e.dataTransfer?.files?.[0]);
  });
}

// ---------------------------------------------------------------- start
window.__njia = {
  ready: false,
  seek: (t) => seek(t, false),
  state: () => ({
    points: a?.points.length ?? 0,
    stops: a?.stops.length ?? 0,
    gaps: a?.gaps.length ?? 0,
    distanceM: a?.stats.distanceM ?? 0,
    cursorT,
    playing,
    mapOk: mapView.ok,
  }),
};

if (embedded) {
  try {
    const f = readTripFile(window.__NJIA_DATA__);
    load(f.trip, f.points);
  } catch (err) {
    toast(String((err as Error).message || err));
    tellApp('error', { message: String((err as Error).message || err) });
  }
} else if (params.get('demo') === '1') {
  $('btn-demo').click();
}

// Try for a street-map background. If offline this quietly stays plain.
mapView.setBasemap('light').then((got) => {
  $<HTMLSelectElement>('basemap').value = got;
  window.__njia!.ready = true;
});
