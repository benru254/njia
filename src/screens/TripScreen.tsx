import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import { Btn } from '../components/Btn';
import { formatDate, formatTime } from '../core/format';
import { TripFile } from '../core/types';
import { loadTripFile, shareBackup, shareGpx } from '../data/exportTrip';
import { TripRow, deleteTrip, getActiveTripId, getTrip } from '../data/trips';
import { DATA_MARKER, VIEWER_HTML } from '../generated/viewerHtml';
import { C, S } from '../theme';

/** A made-up address the viewer page is loaded under (it never goes on the internet). */
const VIEWER_BASE = 'https://njia.local/';

interface Props {
  tripId: number;
  onBack: () => void;
}

/** Put the trip's data inside the viewer page (safely, so no character can break the page). */
function buildHtml(file: TripFile): string {
  const json = JSON.stringify(file)
    .replace(/</g, '\\u003c')
    .split(String.fromCharCode(0x2028))
    .join('\\u2028')
    .split(String.fromCharCode(0x2029))
    .join('\\u2029');
  return VIEWER_HTML.replace(DATA_MARKER, () => `window.__NJIA_DATA__=${json};`);
}

export function TripScreen({ tripId, onBack }: Props) {
  const insets = useSafeAreaInsets();
  const [trip, setTrip] = useState<TripRow | null>(null);
  const [file, setFile] = useState<TripFile | null>(null);
  const [live, setLive] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [sharing, setSharing] = useState<'gpx' | 'backup' | null>(null);
  const [version, setVersion] = useState(0);

  const load = useCallback(async () => {
    try {
      const t = await getTrip(tripId);
      if (!t) {
        setProblem('This trip no longer exists.');
        return;
      }
      const loaded = await loadTripFile(t);
      setTrip(t);
      setFile(loaded.file);
      setLive((await getActiveTripId()) === tripId);
      setVersion((v) => v + 1);
      setProblem(loaded.points.length ? null : 'No GPS points have been recorded for this trip yet.');
    } catch (err) {
      setProblem('Could not open this trip: ' + String((err as Error)?.message || err));
    }
  }, [tripId]);

  useEffect(() => {
    load();
  }, [load]);

  const html = useMemo(() => (file ? buildHtml(file) : null), [file]);

  const share = async (kind: 'gpx' | 'backup') => {
    if (!trip) return;
    setSharing(kind);
    try {
      if (kind === 'gpx') await shareGpx(trip);
      else await shareBackup(trip);
    } catch (err) {
      Alert.alert('Could not share', String((err as Error)?.message || err));
    }
    setSharing(null);
  };

  const remove = () => {
    Alert.alert('Delete this trip?', 'It will be removed from this phone for good. This cannot be undone.', [
      { text: 'Keep it', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await deleteTrip(tripId);
          onBack();
        },
      },
    ]);
  };

  const title = trip ? trip.name || formatDate(trip.started_at) : 'Trip';
  const sub = trip
    ? `${formatTime(trip.started_at)} – ${live ? 'still recording' : formatTime(trip.ended_at ?? trip.last_time ?? trip.started_at)}`
    : '';

  return (
    <View style={[styles.screen, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <View style={styles.head}>
        <Pressable onPress={onBack} style={styles.back} accessibilityRole="button" accessibilityLabel="Back to trips">
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
          onMessage={(e) => {
            try {
              const msg = JSON.parse(e.nativeEvent.data);
              if (msg.type === 'error') setProblem('The map viewer hit a problem: ' + msg.message);
            } catch {
              /* not one of ours */
            }
          }}
          onRenderProcessGone={() => setProblem('The map viewer ran out of memory. Go back and open the trip again.')}
        />
      ) : (
        <View style={styles.center}>
          <ActivityIndicator color={C.accent} size="large" />
          <Text style={styles.loading}>Opening trip…</Text>
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
