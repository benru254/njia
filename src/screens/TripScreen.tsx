import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView, WebViewMessageEvent } from 'react-native-webview';
import { Btn } from '../components/Btn';
import { formatDate, formatTime } from '../core/format';
import { Edit, ModeOverride, TripFile } from '../core/types';
import { saveEdits, saveModes } from '../data/edits';
import { loadTripFile, shareBackup, shareGpx } from '../data/exportTrip';
import { rebuildAllLegs, rebuildLegs } from '../data/legs';
import { savePlace } from '../data/places';
import { setDestMinS } from '../data/settings';
import { TripRow, deleteTrip, getActiveTripId, getTrip } from '../data/trips';
import { DATA_MARKER, VIEWER_HTML } from '../generated/viewerHtml';
import { C, S } from '../theme';

/** A made-up address the viewer page is loaded under (it never goes on the internet). */
const VIEWER_BASE = 'https://njia.local/';

interface Props {
  /** The recording to show. */
  tripId: number;
  /** Departure time of the trip to show first, or null for all trips. */
  focusT: number | null;
  onBack: () => void;
}

/** Put the recording inside the viewer page (safely, so no character can break the page). */
function buildHtml(file: TripFile): string {
  const json = JSON.stringify(file)
    .replace(/</g, '\\u003c')
    .split(String.fromCharCode(0x2028))
    .join('\\u2028')
    .split(String.fromCharCode(0x2029))
    .join('\\u2029');
  return VIEWER_HTML.replace(DATA_MARKER, () => `window.__NJIA_DATA__=${json};`);
}

export function TripScreen({ tripId, focusT, onBack }: Props) {
  const insets = useSafeAreaInsets();
  const [trip, setTrip] = useState<TripRow | null>(null);
  const [file, setFile] = useState<TripFile | null>(null);
  const [live, setLive] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [sharing, setSharing] = useState<'gpx' | 'backup' | null>(null);
  const [version, setVersion] = useState(0);
  /** The trip the viewer is showing, so a reload comes back to it. */
  const focusRef = useRef<number | null>(focusT);
  /** Saves run one after another, in the order you made the changes. */
  const saveQueue = useRef<Promise<unknown>>(Promise.resolve());

  const load = useCallback(async () => {
    try {
      const t = await getTrip(tripId);
      if (!t) {
        setProblem('This recording no longer exists.');
        return;
      }
      const loaded = await loadTripFile(t, { focusT: focusRef.current });
      setTrip(t);
      setFile(loaded.file);
      setLive((await getActiveTripId()) === tripId);
      setVersion((v) => v + 1);
      setProblem(loaded.points.length ? null : 'No GPS points have been recorded yet.');
    } catch (err) {
      setProblem('Could not open this recording: ' + String((err as Error)?.message || err));
    }
  }, [tripId]);

  useEffect(() => {
    load();
  }, [load]);

  const html = useMemo(() => (file ? buildHtml(file) : null), [file]);

  /** Save a change made in the viewer. The viewer already shows it; we keep it and update the trip list. */
  const persist = (job: () => Promise<void>) => {
    saveQueue.current = saveQueue.current.then(job).catch((err) => {
      Alert.alert('Your change was not saved', String((err as Error)?.message || err) + '\n\nThe recording will reload.');
      load();
    });
  };

  const onMessage = (e: WebViewMessageEvent) => {
    let msg: any;
    try {
      msg = JSON.parse(e.nativeEvent.data);
    } catch {
      return;
    }
    switch (msg?.type) {
      case 'focus':
        focusRef.current = typeof msg.t === 'number' ? msg.t : null;
        break;
      case 'open':
        if (typeof msg.url === 'string' && msg.url.startsWith('https://www.google.com/maps/')) {
          Linking.openURL(msg.url).catch(() =>
            Alert.alert('Could not open Google Maps', 'Is Google Maps (or a web browser) installed?')
          );
        }
        break;
      case 'edits':
        persist(async () => {
          await saveEdits(tripId, (msg.edits ?? []) as Edit[]);
          await rebuildLegs(tripId);
        });
        break;
      case 'modes':
        persist(async () => {
          await saveModes(tripId, (msg.modes ?? []) as ModeOverride[]);
          await rebuildLegs(tripId);
        });
        break;
      case 'place':
        persist(async () => {
          await savePlace(String(msg.name ?? ''), Number(msg.lat), Number(msg.lon));
          await rebuildAllLegs(); // a named place can change trips on other days too
        });
        break;
      case 'settings':
        persist(async () => {
          await setDestMinS(Number(msg.destMinS));
          await rebuildAllLegs();
        });
        break;
      case 'error':
        setProblem('The map viewer hit a problem: ' + msg.message);
        break;
    }
  };

  const share = async (kind: 'gpx' | 'backup') => {
    if (!trip) return;
    setSharing(kind);
    try {
      await saveQueue.current;
      if (kind === 'gpx') await shareGpx(trip);
      else await shareBackup(trip);
    } catch (err) {
      Alert.alert('Could not share', String((err as Error)?.message || err));
    }
    setSharing(null);
  };

  const remove = () => {
    Alert.alert(
      'Delete this whole recording?',
      'All trips in it are removed from this phone for good. This cannot be undone.',
      [
        { text: 'Keep it', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            await saveQueue.current;
            await deleteTrip(tripId);
            onBack();
          },
        },
      ]
    );
  };

  const back = async () => {
    await saveQueue.current.catch(() => undefined); // let the trip list catch up first
    onBack();
  };

  const title = trip ? trip.name || formatDate(trip.started_at) : 'Recording';
  const sub = trip
    ? `Recorded ${formatTime(trip.started_at)} – ${
        live ? 'now' : formatTime(trip.ended_at ?? trip.last_time ?? trip.started_at)
      }`
    : '';

  return (
    <View style={[styles.screen, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <View style={styles.head}>
        <Pressable onPress={back} style={styles.back} accessibilityRole="button" accessibilityLabel="Back to trips">
          <Text style={styles.backText}>‹ Trips</Text>
        </Pressable>
        <View style={styles.titles}>
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
          <Text style={styles.sub} numberOfLines={1}>
            {sub}
          </Text>
        </View>
      </View>

      <View style={styles.actions}>
        <Btn label="Share GPX" onPress={() => share('gpx')} busy={sharing === 'gpx'} style={styles.action} />
        <Btn label="Send to PC" onPress={() => share('backup')} busy={sharing === 'backup'} style={styles.action} />
        {live ? (
          <Btn label="Refresh" kind="primary" onPress={load} style={styles.action} />
        ) : (
          <Btn label="Delete" onPress={remove} style={styles.action} />
        )}
      </View>

      {problem ? (
        <View style={styles.center}>
          <Text style={styles.problem}>{problem}</Text>
          <Btn label="Back to trips" onPress={onBack} style={{ marginTop: 16 }} />
        </View>
      ) : html ? (
        <WebView
          key={version}
          style={styles.web}
          containerStyle={styles.web}
          originWhitelist={['*']}
          source={{ html, baseUrl: VIEWER_BASE }}
          onShouldStartLoadWithRequest={(req) => {
            // Keep the viewer in place. A tapped link (e.g. map credits) opens in the browser instead.
            if (req.url.startsWith(VIEWER_BASE) || req.url.startsWith('about:')) return true;
            Linking.openURL(req.url).catch(() => undefined);
            return false;
          }}
          javaScriptEnabled
          domStorageEnabled
          cacheEnabled
          overScrollMode="never"
          setBuiltInZoomControls={false}
          textZoom={100}
          onMessage={onMessage}
          onRenderProcessGone={() => setProblem('The map viewer ran out of memory. Go back and open the recording again.')}
        />
      ) : (
        <View style={styles.center}>
          <ActivityIndicator color={C.accent} size="large" />
          <Text style={styles.loading}>Opening…</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  head: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingTop: 6 },
  back: { paddingHorizontal: 10, paddingVertical: 12 },
  backText: { color: C.accent, fontSize: 16, fontWeight: '700' },
  titles: { flex: 1, minWidth: 0, paddingLeft: 4, paddingRight: S.pad },
  title: { color: C.text, fontSize: 17, fontWeight: '700' },
  sub: { color: C.muted, fontSize: 13 },
  actions: { flexDirection: 'row', gap: 8, paddingHorizontal: S.pad, paddingTop: 4, paddingBottom: 10 },
  action: { flex: 1, minHeight: 40, paddingHorizontal: 6 },
  web: { flex: 1, backgroundColor: C.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28 },
  problem: { color: C.text, fontSize: 15, textAlign: 'center', lineHeight: 22 },
  loading: { color: C.muted, marginTop: 12 },
});
