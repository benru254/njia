/**
 * Njia trip viewer.
 *
 * The SAME page runs in two places:
 *   - inside the phone app (the app hands it a recording through window.__NJIA_DATA__)
 *   - on a PC, opened as a normal file (you pick a .json or .gpx file)
 *
 * A recording is cut into trips (A → B, B → C, ...). You can look at one trip
 * or all of them, fix the cutting with one tap (split / join), name places,
 * and open any point in Google Maps.
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
import { googleMapsUrl, googleNavigateUrl } from '../../src/core/links';
import {
  DEST_MIN_CHOICES,
  Dwell,
  Endpoint,
  HOLD_ANALYZE,
  Leg,
  Segmentation,
  legIndexAt,
  resolveMode,
  segment,
  withJoin,
  withMode,
  withPlace,
  withSplit,
} from '../../src/core/segment';
import { TripMeta, readTripFile } from '../../src/core/tripFile';
import {
  Analysis,
  DEFAULT_SETTINGS,
  Edit,
  Gap,
  MODE_LABEL,
  ModeOverride,
  Place,
  RawPoint,
  TRAVEL_MODES,
  TravelMode,
  TripExtras,
  TripSettings,
} from '../../src/core/types';
import { fullView, legView } from '../../src/core/views';
import { deliveryDay } from '../../tests/simulate';
import { SpeedChart } from './chart';
import { parseGpx } from './gpxParse';
import { BasemapKind, MapView, Pin } from './mapView';
import { BUCKETS } from './speedColors';

declare global {
  interface Window {
    __NJIA_DATA__?: unknown;
    ReactNativeWebView?: { postMessage: (msg: string) => void };
    /** Small hooks used by automated checks. */
    __njia?: { ready: boolean; state: () => unknown; seek: (t: number) => void; focus: (i: number) => void };
  }
}

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

const embedded = window.__NJIA_DATA__ != null;
document.body.classList.add(embedded ? 'embedded' : 'standalone');

type Tab = 'trip' | 'stops' | 'trips';

// ---------------------------------------------------------------- state
let raw: RawPoint[] = [];
let meta: TripMeta | null = null;
let places: Place[] = [];
let edits: Edit[] = [];
let modes: ModeOverride[] = [];
let settings: TripSettings = { ...DEFAULT_SETTINGS };
let base: Analysis | null = null;
let seg: Segmentation | null = null;
/** Trip being shown, or -1 for all trips. */
let focus = -1;
let view: Analysis | null = null;
let viewDwells: Dwell[] = [];
let cursorT = 0;
let playing = false;
let rate = 60;
let tab: Tab = 'trip';
let lastFrame = 0;
let selectedT: number | null = null;

// ---------------------------------------------------------------- talking to the app / errors
function toast(message: string) {
  const el = $('toast');
  el.textContent = message;
  el.hidden = false;
  window.clearTimeout((toast as any).timer);
  (toast as any).timer = window.setTimeout(() => (el.hidden = true), 6000);
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
function openUrl(url: string) {
  if (embedded) tellApp('open', { url });
  else window.open(url, '_blank', 'noopener');
}

// ---------------------------------------------------------------- map + chart
const params = new URLSearchParams(location.search);
const mapView = new MapView(
  $('map'),
  {
    onPick: (t) => seek(t, false),
    onStatus: (msg) => {
      $('mapstatus').textContent = msg;
      $('mapstatus').hidden = !msg;
      if (msg) window.setTimeout(() => ($('mapstatus').hidden = true), 6000);
    },
  },
  params.get('style')
);
const chart = new SpeedChart($<HTMLCanvasElement>('chart'));
chart.onSeek = (t) => seek(t, false);

$('legend').innerHTML =
  '<span>km/h:</span>' +
  BUCKETS.map((b) => `<span class="row"><span class="sw" style="background:${b.color}"></span>${b.label}</span>`).join('') +
  '<span class="row"><span class="sw gap"></span>no data</span>';

// ---------------------------------------------------------------- small helpers
const currentLeg = (): Leg | null => (seg && focus >= 0 ? seg.legs[focus] ?? null : null);
const modeOf = (l: Leg): TravelMode => resolveMode(l, modes, settings.vehicle);
const endpointOf = (d: Dwell): Endpoint | undefined => seg?.endpoints.find((e) => e.dwell === d);

/** The time shown for an endpoint: when you left it if a trip starts there, else when you arrived. */
function epTime(e: Endpoint, l: Leg | null): number {
  if (l) return e === l.from ? e.leaveT : e.arriveT;
  return e.kind === 'start' ? e.leaveT : e.arriveT;
}
function epClass(e: Endpoint, l: Leg | null): string {
  if (l) return e === l.from ? 'ep-a' : 'ep-z';
  return e.kind === 'start' ? 'ep-a' : e.kind === 'end' ? 'ep-z' : 'ep-d';
}

function resegment() {
  if (!base) return;
  seg = segment(base, places, edits, { destMinS: settings.destMinS });
}

/** Re-cut the trips after a change, staying on the same trip if possible. */
function refreshKeepingFocus() {
  const keepT = currentLeg()?.departT ?? null;
  resegment();
  focus = keepT != null && seg ? legIndexAt(seg, keepT) : -1;
  render(false);
}

// ---------------------------------------------------------------- loading
function load(m: TripMeta, points: RawPoint[], x: TripExtras = {}) {
  meta = m;
  raw = points;
  places = x.places ?? [];
  edits = x.edits ?? [];
  modes = x.modes ?? [];
  settings = { ...DEFAULT_SETTINGS, ...(x.settings ?? {}) };
  pause();
  base = analyze(raw, HOLD_ANALYZE);
  resegment();
  const legs = seg!.legs;
  const ft = x.view?.focusT;
  focus = ft != null ? legIndexAt(seg!, ft) : legs.length === 1 ? 0 : -1;
  cursorT = x.view?.cursorT ?? (focus >= 0 ? legs[focus].departT : base.stats.startTime);
  $('empty').hidden = true;
  $('top-name').textContent =
    meta.name || (base.points.length ? `Recording of ${formatDate(base.stats.startTime)}` : 'Recording');
  render(true);
  tellApp('ready', { points: base.points.length, legs: legs.length, mapOk: mapView.ok });
}

function chooseRate() {
  if (!view || !view.points.length) return;
  const options = [5, 20, 60, 200, 600];
  rate = options.find((r) => view!.stats.durationS / r <= 70) ?? 600;
  $<HTMLSelectElement>('rate').value = String(rate);
}

function setFocus(i: number) {
  if (!seg) return;
  focus = Math.max(-1, Math.min(seg.legs.length - 1, i));
  const l = currentLeg();
  cursorT = l ? l.departT : base?.stats.startTime ?? 0;
  selectedT = null;
  pause();
  render(true);
  tellApp('focus', { t: l ? l.departT : null });
}

function render(fit: boolean) {
  if (!base || !seg) return;
  const l = currentLeg();
  const v = l ? legView(base, seg, l) : fullView(base, seg);
  view = v.analysis;
  viewDwells = v.dwells;
  mapView.setTrip(view, buildPins(l), fit);
  chart.setData(view);
  if (fit) chooseRate();
  renderBar();
  renderTab();
  const s = view.stats;
  if (view.points.length) seek(Math.min(Math.max(cursorT, s.startTime), s.endTime), false);
}

// ---------------------------------------------------------------- map pins
function buildPins(l: Leg | null): Pin[] {
  if (!seg) return [];
  const pins: Pin[] = [];
  for (const d of viewDwells) {
    if (d.kind === 'destination') continue;
    const traffic = d.kind === 'traffic';
    pins.push({
      lngLat: [d.lon, d.lat],
      cls: traffic ? 'mk-pz mk-traffic' : 'mk-pz',
      html: formatDurationShort(d.durationS),
      title: `${traffic ? 'Traffic' : 'Pause'} ${formatTime(d.start)} – ${formatTime(d.end)}`,
      onClick: () => showRow(d.start),
    });
  }
  const eps = l ? [l.from, l.to] : seg.endpoints;
  for (const e of eps) {
    const t = epTime(e, l);
    pins.push({
      lngLat: [e.lon, e.lat],
      cls: 'mk-ep ' + epClass(e, l),
      // Short label so pins fit on a phone: letter, time, and the name only if you gave one.
      html: `<b>${e.letter}</b><span>${e.place ? esc(clip(e.place.name, 14)) + ' · ' : ''}${formatTime(t)}</span>`,
      anchor: 'left',
      offset: [-13, 0],
      title: e.label,
      onClick: () => showRow(t),
    });
  }
  return pins;
}

/** Jump to a stop and show its row in the Stops tab. */
function showRow(t: number) {
  pause();
  seekAndShow(t);
  selectedT = t;
  setTab('stops');
  openDetails();
  requestAnimationFrame(() => document.querySelector('.ev.on')?.scrollIntoView({ block: 'nearest' }));
}

// ---------------------------------------------------------------- moving through the trip
function seek(t: number, follow: boolean) {
  if (!view || !view.points.length) return;
  const s = view.stats;
  cursorT = Math.min(s.endTime, Math.max(s.startTime, t));
  const pos = mapView.positionAt(cursorT);
  if (!pos) return;
  const pts = view.points;
  const p = pts[pos.index];
  const next = pts[pos.index + 1];

  let v = p.v;
  let state = 'Moving';
  let cls = '';
  if (p.stop >= 0 && (!next || next.stop === p.stop || cursorT <= p.t)) {
    const d = viewDwells[p.stop];
    if (d.kind === 'destination') {
      const e = endpointOf(d);
      state = e ? `At ${e.letter} · ${e.label}` : 'At a destination';
      cls = 'stopped';
    } else if (d.kind === 'traffic') {
      state = `Traffic · ${formatDurationShort(d.durationS)}`;
      cls = 'traffic';
    } else {
      state = `Pause · ${formatDurationShort(d.durationS)}`;
      cls = 'stopped';
    }
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
  const l = currentLeg();
  const extra = [`${formatDistance(p.dist)} from ${l ? l.from.letter : 'start'}`];
  if (p.acc != null) extra.push(`accuracy ±${Math.round(p.acc)} m`);
  if (p.alt != null) extra.push(`altitude ${Math.round(p.alt)} m`);
  $('now-extra').textContent = extra.join(' · ');
  $('now-time').textContent = formatTimeSec(cursorT);
  const dir = moving ? p.dir : null;
  $('now-compass').textContent = dir != null ? `${compassName(dir)} ${Math.round(dir)}°` : '–';
  const arrow = $('now-arrow') as unknown as SVGElement;
  arrow.style.transform = `rotate(${dir ?? 0}deg)`;
  arrow.style.opacity = dir != null ? '1' : '0.25';

  const span = Math.max(1, s.endTime - s.startTime);
  $<HTMLInputElement>('seek').value = String(Math.round(((cursorT - s.startTime) / span) * 10000));
  chart.setCursor(cursorT);
  mapView.setCursor(pos.lngLat, p.dir, moving, follow);
  const splitBtn = document.querySelector<HTMLElement>('[data-act="split-here"]');
  if (splitBtn) splitBtn.textContent = `Split this trip at ${formatTime(cursorT)}`;
}

function frame(now: number) {
  if (!playing || !view) return;
  const dt = Math.min(0.1, (now - lastFrame) / 1000);
  lastFrame = now;
  const t = cursorT + dt * rate * 1000;
  if (t >= view.stats.endTime) {
    seek(view.stats.endTime, true);
    pause();
    return;
  }
  seek(t, true);
  requestAnimationFrame(frame);
}
const ICON_PLAY = '<path d="M4 2l10 6-10 6z"/>';
const ICON_PAUSE = '<path d="M3 2h4v12H3zM9 2h4v12H9z"/>';
function play() {
  if (!view || view.points.length < 2) return;
  if (cursorT >= view.stats.endTime) cursorT = view.stats.startTime;
  playing = true;
  lastFrame = performance.now();
  $('ico-play').innerHTML = ICON_PAUSE;
  requestAnimationFrame(frame);
}
function pause() {
  playing = false;
  $('ico-play').innerHTML = ICON_PLAY;
}

/** Times worth jumping to: start, each stop, end. */
function eventTimes(): number[] {
  if (!view || !view.points.length) return [];
  return [view.stats.startTime, ...view.stops.map((s) => s.start), view.stats.endTime].sort((a, b) => a - b);
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

// ---------------------------------------------------------------- trip bar
function renderBar() {
  const legs = seg?.legs ?? [];
  const l = currentLeg();
  if (l) {
    $('leg-main').textContent = `Trip ${focus + 1} of ${legs.length} · ${l.from.letter} → ${l.to.letter}`;
    $('leg-sub').textContent = `${l.from.label} → ${l.to.label}`;
  } else {
    $('leg-main').textContent = legs.length ? `All trips (${legs.length})` : 'No trips: stayed in one place';
    $('leg-sub').textContent = base && base.points.length ? formatDate(base.stats.startTime) : '';
  }
  $<HTMLButtonElement>('leg-prev').disabled = focus <= -1;
  $<HTMLButtonElement>('leg-next').disabled = focus >= legs.length - 1;
  $('leg-all').classList.toggle('on', focus === -1);
}

// ---------------------------------------------------------------- details tabs
function setTab(t: Tab) {
  tab = t;
  $('tabs')
    .querySelectorAll<HTMLElement>('button[data-tab]')
    .forEach((b) => b.classList.toggle('on', b.dataset.tab === t));
  renderTab();
}
function openDetails() {
  const d = $('details');
  if (d.hidden) {
    d.hidden = false;
    $('btn-details').textContent = 'Hide details';
    requestAnimationFrame(() => mapView.resize());
  }
}

const stat = (k: string, v: string) => `<div class="stat"><div class="k">${k}</div><div class="v">${v}</div></div>`;
const mapsBtns = (lat: number, lon: number) =>
  `<button type="button" class="mini" data-act="maps" data-lat="${lat}" data-lon="${lon}">Google Maps</button>` +
  `<button type="button" class="mini" data-act="nav" data-lat="${lat}" data-lon="${lon}">Navigate</button>`;
const nameBtn = (e: Endpoint) =>
  `<button type="button" class="mini" data-act="name" data-lat="${e.lat}" data-lon="${e.lon}" data-name="${esc(
    e.place?.name ?? ''
  )}">${e.place ? 'Rename' : 'Name this place'}</button>`;

function renderTab() {
  const body = $('tabbody');
  $('tabs').querySelector('[data-tab="trips"]')!.textContent = `Trips (${seg?.legs.length ?? 0})`;
  if (!base || !seg || !view || !base.points.length) {
    body.innerHTML = '<p class="note">This recording has no usable GPS points.</p>';
    return;
  }
  body.innerHTML = tab === 'trip' ? tripTab() : tab === 'stops' ? stopsTab() : tripsTab();
}

function tripTab(): string {
  const l = currentLeg();
  if (l && seg) {
    const mode = modeOf(l);
    const epBlock = (e: Endpoint, verb: string, t: number) =>
      `<div class="ep"><span class="badge ${epClass(e, l)}">${e.letter}</span>` +
      `<div class="what"><div>${esc(e.label)}</div><div>${verb} ${formatTimeSec(t)}</div></div></div>` +
      `<div class="acts">${mapsBtns(e.lat, e.lon)}${nameBtn(e)}</div>`;
    return (
      '<div class="route">' +
      epBlock(l.from, 'Left at', l.from.leaveT) +
      `<div class="route-line">${formatDistance(l.distanceM)} · ${formatDurationShort(l.durationS)} · ${MODE_LABEL[mode]}</div>` +
      epBlock(l.to, 'Arrived at', l.to.arriveT) +
      '</div>' +
      '<div class="stats">' +
      stat('Distance', formatDistance(l.distanceM)) +
      stat('Time', formatDuration(l.durationS)) +
      stat('Moving', formatDuration(l.movingS)) +
      stat('Paused', `${formatDuration(l.pauseS)} (${l.pauseCount})`) +
      (l.trafficCount ? stat('Traffic', `${formatDuration(l.trafficS)} (${l.trafficCount})`) : '') +
      stat('Average speed', formatSpeed(l.avgMovingSpeed)) +
      stat('Top speed', formatSpeed(l.maxSpeed)) +
      (l.gapS > 0 ? stat('No data', formatDuration(l.gapS)) : '') +
      '</div>' +
      `<label class="opt">Travelled by <select id="leg-mode">${TRAVEL_MODES.map(
        (m) => `<option value="${m}"${m === mode ? ' selected' : ''}>${MODE_LABEL[m]}</option>`
      ).join('')}</select></label>` +
      '<div class="acts big">' +
      `<button type="button" data-act="split-here">Split this trip at ${formatTime(cursorT)}</button>` +
      (l.from.kind === 'dest' ? '<button type="button" data-act="join-prev">Join with previous trip</button>' : '') +
      (l.to.kind === 'dest' ? '<button type="button" data-act="join-next">Join with next trip</button>' : '') +
      '</div>' +
      '<p class="note">To split: drag the chart or tap the path where the new trip should start, then tap Split. ' +
      'Join turns the stop between two trips into a pause, so they become one trip.</p>' +
      (embedded ? '' : '<p class="note">Changes made here on the PC are not saved. Make them in the phone app to keep them.</p>')
    );
  }

  // All trips of the recording
  const s = base!.stats;
  const legs = seg!.legs;
  const moving = legs.reduce((x, y) => x + y.movingS, 0);
  const atDest = seg!.dwells.filter((d) => d.kind === 'destination').reduce((x, d) => x + d.stayS, 0);
  const paused = seg!.dwells.filter((d) => d.kind !== 'destination').reduce((x, d) => x + d.durationS, 0);
  return (
    '<div class="stats">' +
    stat('Date', formatDate(s.startTime)) +
    stat('Recorded', `${formatTime(s.startTime)} – ${formatTime(s.endTime)}`) +
    stat('Trips', String(legs.length)) +
    stat('Places stopped at', String(seg!.endpoints.length)) +
    stat('Distance', formatDistance(s.distanceM)) +
    stat('Moving', formatDuration(moving)) +
    stat('At destinations', formatDuration(atDest)) +
    stat('Pauses and traffic', formatDuration(paused)) +
    stat('Top speed', formatSpeed(s.maxSpeed)) +
    stat('GPS points', s.pointCount.toLocaleString()) +
    '</div>' +
    `<label class="opt">A stop counts as a destination after <select id="dest-min">${DEST_MIN_CHOICES.map(
      (v) => `<option value="${v}"${v === settings.destMinS ? ' selected' : ''}>${v / 60} min</option>`
    ).join('')}</select></label>` +
    '<p class="note">A stop also counts after 3 minutes if you walked away from the vehicle and came back, ' +
    'and after 2 minutes at a place you named. Shorter stops stay inside the trip as a pause or traffic.</p>' +
    '<p class="note">Open the Trips tab to see each trip on its own.</p>'
  );
}

function stopsTab(): string {
  const l = currentLeg();
  const rows: Array<{ t: number; html: string }> = [];
  const eps = l ? [l.from, l.to] : seg!.endpoints;
  const on = (t: number) => (selectedT != null && Math.abs(selectedT - t) < 1000 ? ' on' : '');

  for (const e of eps) {
    const t = epTime(e, l);
    let when: string;
    if (l) when = e === l.from ? `Left at ${formatTime(e.leaveT)}` : `Arrived at ${formatTime(e.arriveT)}`;
    else if (e.kind === 'start') when = `Recording began here · left at ${formatTime(e.leaveT)}`;
    else if (e.kind === 'end') when = `Arrived at ${formatTime(e.arriveT)} · recording ended`;
    else when = `${formatTime(e.arriveT)} – ${formatTime(e.leaveT)}`;
    const stay = e.dwell ? formatDurationShort(e.dwell.stayS) : '';
    rows.push({
      t,
      html:
        `<div class="ev${on(t)}" data-seek="${t}">` +
        `<div class="ev-main"><span class="badge ${epClass(e, l)}">${e.letter}</span>` +
        `<span class="what"><div>${esc(e.label)}</div><div>${when}</div></span><span class="dur">${stay}</span></div>` +
        `<div class="acts">${mapsBtns(e.lat, e.lon)}${nameBtn(e)}` +
        (e.kind === 'dest'
          ? `<button type="button" class="mini" data-act="join" data-a="${e.arriveT}" data-b="${e.leaveT}">Not a destination</button>`
          : '') +
        '</div></div>',
    });
  }

  for (const d of viewDwells) {
    if (d.kind === 'destination') continue;
    const traffic = d.kind === 'traffic';
    rows.push({
      t: d.start,
      html:
        `<div class="ev${on(d.start)}" data-seek="${d.start}">` +
        `<div class="ev-main"><span class="badge ${traffic ? 'tr' : 'p'}">${traffic ? 'T' : 'P'}</span>` +
        `<span class="what"><div>${traffic ? 'Traffic' : 'Pause'}</div><div>${formatTime(d.start)} – ${formatTime(
          d.end
        )}</div></span>` +
        `<span class="dur">${formatDurationShort(d.durationS)}</span></div>` +
        `<div class="acts">${mapsBtns(d.lat, d.lon)}` +
        `<button type="button" class="mini" data-act="split" data-a="${d.arriveT}" data-b="${d.leaveT}">Make it a destination</button>` +
        '</div></div>',
    });
  }

  for (const g of view!.gaps as Gap[]) {
    rows.push({
      t: g.start,
      html:
        `<div class="ev${on(g.start)}" data-seek="${g.start}"><div class="ev-main"><span class="badge g">?</span>` +
        `<span class="what"><div>No data</div><div>${formatTime(g.start)} – ${formatTime(g.end)} · jumped ${formatDistance(
          g.distanceM
        )}</div></span><span class="dur">${formatDurationShort(g.durationS)}</span></div></div>`,
    });
  }

  rows.sort((x, y) => x.t - y.t);
  return rows.map((r) => r.html).join('') || '<p class="note">No stops.</p>';
}

function tripsTab(): string {
  const legs = seg!.legs;
  if (!legs.length) return '<p class="note">You stayed in one place for the whole recording, so there are no trips.</p>';
  return (
    `<div class="ev${focus === -1 ? ' on' : ''}" data-leg="-1"><div class="ev-main"><span class="badge g">∑</span>` +
    `<span class="what"><div>All trips together</div><div>${formatDistance(base!.stats.distanceM)} · ${formatDurationShort(
      base!.stats.durationS
    )}</div></span></div></div>` +
    legs
      .map((l, i) => {
        const mode = modeOf(l);
        return (
          `<div class="ev${i === focus ? ' on' : ''}" data-leg="${i}"><div class="ev-main"><span class="badge">${i + 1}</span>` +
          `<span class="what"><div>${l.from.letter} ${esc(clip(l.from.label, 16))} → ${l.to.letter} ${esc(
            clip(l.to.label, 16)
          )}</div>` +
          `<div>${formatTime(l.departT)} – ${formatTime(l.arriveT)} · ${formatDistance(l.distanceM)} · ${MODE_LABEL[mode]}</div></span>` +
          `<span class="dur">${formatDurationShort(l.durationS)}</span></div></div>`
        );
      })
      .join('')
  );
}

// ---------------------------------------------------------------- actions (split, join, name, mode)
function changeEdits(next: Edit[]) {
  edits = next;
  refreshKeepingFocus();
  tellApp('edits', { edits });
  tellApp('focus', { t: currentLeg()?.departT ?? null });
}

function splitHere() {
  const l = currentLeg();
  if (!l) return;
  if (cursorT - l.departT < 30_000 || l.arriveT - cursorT < 30_000) {
    toast('Move the cursor into the trip first (drag the chart), then tap Split.');
    return;
  }
  const d = viewDwells.find((x) => cursorT >= x.arriveT && cursorT <= x.leaveT);
  changeEdits(d ? withSplit(edits, cursorT, { start: d.arriveT, end: d.leaveT }) : withSplit(edits, cursorT));
  toast('Trip split in two.');
}

function joinAt(e: Endpoint) {
  if (e.kind !== 'dest') return;
  changeEdits(withJoin(edits, { start: e.arriveT, end: e.leaveT }));
  toast(`${e.letter} is now a pause. The trips on each side are joined.`);
}

function toggleNameForm(btn: HTMLElement) {
  const acts = btn.closest('.acts');
  if (!acts) return;
  const existing = acts.nextElementSibling;
  if (existing && existing.classList.contains('nameform')) {
    existing.remove();
    return;
  }
  const form = document.createElement('div');
  form.className = 'nameform';
  form.innerHTML =
    `<input type="text" maxlength="40" placeholder="e.g. Shop 2, Mama Njeri, Home" value="${esc(btn.dataset.name || '')}">` +
    `<button type="button" class="mini save" data-act="name-save" data-lat="${btn.dataset.lat}" data-lon="${btn.dataset.lon}">Save</button>`;
  acts.after(form);
  form.querySelector('input')!.focus();
}

function saveName(btn: HTMLElement) {
  const input = btn.parentElement?.querySelector('input');
  const name = (input?.value || '').trim();
  if (!name) {
    toast('Type a name first.');
    return;
  }
  const lat = Number(btn.dataset.lat);
  const lon = Number(btn.dataset.lon);
  places = withPlace(places, name, lat, lon);
  refreshKeepingFocus();
  tellApp('place', { name, lat, lon });
  toast(`Saved "${name}". Stops here will use this name.`);
}

function onAction(btn: HTMLElement) {
  const d = btn.dataset;
  const l = currentLeg();
  switch (d.act) {
    case 'maps':
      openUrl(googleMapsUrl(Number(d.lat), Number(d.lon)));
      break;
    case 'nav':
      openUrl(googleNavigateUrl(Number(d.lat), Number(d.lon)));
      break;
    case 'name':
      toggleNameForm(btn);
      break;
    case 'name-save':
      saveName(btn);
      break;
    case 'join':
      changeEdits(withJoin(edits, { start: Number(d.a), end: Number(d.b) }));
      toast('Joined: that stop is now a pause inside one trip.');
      break;
    case 'split': {
      const a = Number(d.a);
      const b = Number(d.b);
      changeEdits(withSplit(edits, (a + b) / 2, { start: a, end: b }));
      toast('That stop is now a destination.');
      break;
    }
    case 'split-here':
      splitHere();
      break;
    case 'join-prev':
      if (l) joinAt(l.from);
      break;
    case 'join-next':
      if (l) joinAt(l.to);
      break;
  }
}

$('tabbody').addEventListener('click', (e) => {
  const target = e.target as HTMLElement;
  const btn = target.closest<HTMLElement>('[data-act]');
  if (btn) {
    onAction(btn);
    return;
  }
  if (target.closest('.nameform')) return;
  const legRow = target.closest<HTMLElement>('[data-leg]');
  if (legRow) {
    setFocus(Number(legRow.dataset.leg));
    return;
  }
  const row = target.closest<HTMLElement>('[data-seek]');
  if (row) {
    pause();
    const t = Number(row.dataset.seek);
    selectedT = t;
    seekAndShow(t);
    document.querySelectorAll('.ev.on').forEach((el) => el.classList.remove('on'));
    row.classList.add('on');
  }
});

$('tabbody').addEventListener('keydown', (e) => {
  const input = e.target as HTMLElement;
  if (e.key === 'Enter' && input.tagName === 'INPUT') {
    const save = input.parentElement?.querySelector<HTMLElement>('[data-act="name-save"]');
    if (save) onAction(save);
  }
});

$('tabbody').addEventListener('change', (e) => {
  const el = e.target as HTMLSelectElement;
  if (el.id === 'leg-mode') {
    const l = currentLeg();
    if (!l) return;
    modes = withMode(modes, l.departT, el.value as TravelMode);
    renderTab();
    tellApp('modes', { modes });
  } else if (el.id === 'dest-min') {
    settings = { ...settings, destMinS: Number(el.value) };
    refreshKeepingFocus();
    tellApp('settings', { destMinS: settings.destMinS });
  }
});

$('tabs').addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLElement>('button[data-tab]');
  if (btn) setTab(btn.dataset.tab as Tab);
});

// ---------------------------------------------------------------- controls
$('btn-play').addEventListener('click', () => (playing ? pause() : play()));
$('btn-prev').addEventListener('click', () => jump(-1));
$('btn-next').addEventListener('click', () => jump(1));
$('btn-fit').addEventListener('click', () => mapView.fit());
$('leg-prev').addEventListener('click', () => setFocus(focus - 1));
$('leg-next').addEventListener('click', () => setFocus(focus + 1));
$('leg-all').addEventListener('click', () => {
  setFocus(-1);
  setTab('trips');
  openDetails();
});
$('rate').addEventListener('change', (e) => (rate = Number((e.target as HTMLSelectElement).value)));
$('seek').addEventListener('input', (e) => {
  if (!view || !view.points.length) return;
  pause();
  const f = Number((e.target as HTMLInputElement).value) / 10000;
  seek(view.stats.startTime + f * (view.stats.endTime - view.stats.startTime), false);
});
$('btn-details').addEventListener('click', () => {
  const d = $('details');
  d.hidden = !d.hidden;
  $('btn-details').textContent = d.hidden ? 'Details' : 'Hide details';
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
      load(f.trip, f.points, f.extras);
    }
  } catch (err) {
    toast(
      err instanceof SyntaxError
        ? 'This file could not be read. Choose a Njia .json or a .gpx file.'
        : String((err as Error).message || err)
    );
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
    const pts = deliveryDay();
    load(
      { id: 'demo', name: 'Demo delivery run (made-up data)', startedAt: pts[0].t, endedAt: pts[pts.length - 1].t },
      pts,
      { view: { focusT: null } }
    );
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
  focus: (i) => setFocus(i),
  state: () => ({
    points: base?.points.length ?? 0,
    legs: seg?.legs.length ?? 0,
    endpoints: seg?.endpoints.map((e) => e.letter + ':' + e.label) ?? [],
    pauses: seg?.dwells.filter((d) => d.kind !== 'destination').length ?? 0,
    focus,
    edits: edits.length,
    places: places.length,
    cursorT,
    playing,
    mapOk: mapView.ok,
  }),
};

if (embedded) {
  try {
    const f = readTripFile(window.__NJIA_DATA__);
    load(f.trip, f.points, f.extras);
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
