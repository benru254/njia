import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, AppState, Pressable, SectionList, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NjiaTracker, TrackerStatus } from '../../modules/njia-tracker';
import { AlwaysCard } from '../components/AlwaysCard';
import { LegItem } from '../components/LegItem';
import { RecordCard } from '../components/RecordCard';
import { formatDate, formatDistance } from '../core/format';
import { importBuffer } from '../data/importer';
import { LegRow, ensureLegsUpToDate, listLegs, rebuildLegs } from '../data/legs';
import { RecordMode, getRecordMode } from '../data/mode';
import { TripRow, getActiveTripId, getTrip } from '../data/trips';
import { C, S } from '../theme';
import { SetupStatus, getSetupStatus, isReady, requestLocation, requestNotifications } from '../tracking/permissions';
import { StartupState, checkOnStartup, enableAlwaysOn, startRecording, stopRecording } from '../tracking/recorder';

interface Props {
  /** Open a recording. focusT = departure time of the trip to show, or null for all trips. */
  onOpenTrip: (id: number, focusT: number | null) => void;
  onOpenSetup: () => void;
}

interface Section {
  title: string;
  totals: string;
  data: LegRow[];
}

/** Group trips by day, newest day first. */
function byDay(legs: LegRow[]): Section[] {
  const sections: Section[] = [];
  for (const l of legs) {
    const title = formatDate(l.depart_t);
    let s = sections[sections.length - 1];
    if (!s || s.title !== title) {
      s = { title, totals: '', data: [] };
      sections.push(s);
    }
    s.data.push(l);
  }
  for (const s of sections) {
    const trips = s.data.filter((l) => l.mode !== 'still');
    const km = trips.reduce((x, l) => x + l.distance_m, 0);
    s.totals = `${trips.length} ${trips.length === 1 ? 'trip' : 'trips'} · ${formatDistance(km)}`;
  }
  return sections;
}

const LIVE_REBUILD_MS = 20_000;

export function HomeScreen({ onOpenTrip, onOpenSetup }: Props) {
  const insets = useSafeAreaInsets();
  const [legs, setLegs] = useState<LegRow[]>([]);
  const [active, setActive] = useState<TripRow | null>(null);
  const [setup, setSetup] = useState<SetupStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [mode, setMode] = useState<RecordMode>('manual');
  const [recorder, setRecorder] = useState<TrackerStatus | null>(null);
  const startupDone = useRef(false);
  const startupFinished = useRef(false);
  const lastLive = useRef({ at: 0, points: -1 });

  const refresh = useCallback(async () => {
    if (!startupFinished.current) return; // the first import runs in the startup step
    try {
      // Bring in what the recorder saved since last time (it records even when the app is closed).
      await importBuffer();
      const id = await getActiveTripId();
      const trip = id != null ? await getTrip(id) : null;
      // While recording, cut the trips so far every 20 seconds (it takes a moment on long days).
      if (trip && Date.now() - lastLive.current.at > LIVE_REBUILD_MS && trip.point_count !== lastLive.current.points) {
        lastLive.current = { at: Date.now(), points: trip.point_count };
        await rebuildLegs(trip.id);
      }
      const [list, status, m] = await Promise.all([listLegs(), getSetupStatus(), getRecordMode()]);
      setLegs(list);
      setActive(trip);
      setSetup(status);
      setMode(m);
      setRecorder(NjiaTracker ? NjiaTracker.getStatus() : null);
    } catch (err) {
      setNotice('Could not read saved trips: ' + String((err as Error)?.message || err));
    }
  }, []);

  // When the app opens: repair a recording that Android interrupted, then load everything.
  useEffect(() => {
    (async () => {
      if (!startupDone.current) {
        startupDone.current = true;
        let state: StartupState = 'idle';
        try {
          state = await checkOnStartup((n) => {
            if (n >= 2000) setNotice(`Bringing in ${n.toLocaleString()} recorded points…`);
          });
          setNotice(null);
        } catch (err) {
          setNotice('Could not bring in recorded points: ' + String((err as Error)?.message || err));
        }
        if (state === 'resumed') {
          setNotice('The recorder had been stopped (by Android or a battery manager). It is running again; the missing part shows as "No data".');
        } else if (state === 'interrupted') {
          setNotice('The recorder had stopped and could not start again. Open Setup and check every step is done.');
        } else if (state === 'missing') {
          setNotice('This copy of Njia has no recorder. Install the newest APK from GitHub Releases.');
        }
        try {
          await ensureLegsUpToDate(); // also cuts recordings made with the older version into trips
        } catch (err) {
          setNotice('Could not work out trips: ' + String((err as Error)?.message || err));
        }
        startupFinished.current = true;
      }
      await refresh();
    })();
  }, [refresh]);

  // While recording, bring in new points every 5 seconds (only while the app is on screen).
  useEffect(() => {
    if (!active && mode !== 'always') return;
    let timer: ReturnType<typeof setInterval> | null = setInterval(refresh, 5000);
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') {
        refresh();
        if (!timer) timer = setInterval(refresh, 5000);
      } else if (timer) {
        clearInterval(timer);
        timer = null;
      }
    });
    return () => {
      if (timer) clearInterval(timer);
      sub.remove();
    };
  }, [active?.id, mode, refresh]);

  // Coming back from Android settings or another screen: re-check everything.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') refresh();
    });
    return () => sub.remove();
  }, [refresh]);

  const onStart = async () => {
    setBusy(true);
    setNotice(null);
    try {
      // First time: Android asks for permission right here, then recording starts.
      let status = await getSetupStatus();
      if (!status.location) {
        await requestLocation();
        status = await getSetupStatus();
        if (!status.location) {
          throw new Error('Njia needs the Location permission to record where you go. Open Setup to allow it.');
        }
      }
      if (!status.notifications) await requestNotifications();
      await startRecording();
      lastLive.current = { at: 0, points: -1 };
    } catch (err) {
      Alert.alert('Cannot start', String((err as Error)?.message || err));
    }
    await refresh();
    setBusy(false);
  };

  /** Always on: the recorder was found stopped. */
  const onRestart = async () => {
    setBusy(true);
    try {
      await enableAlwaysOn();
    } catch (err) {
      Alert.alert('Cannot start', String((err as Error)?.message || err));
    }
    await refresh();
    setBusy(false);
  };

  const onStop = () => {
    Alert.alert('Stop recording?', 'Everything recorded is saved on this phone and cut into separate trips.', [
      { text: 'Keep recording', style: 'cancel' },
      {
        text: 'Stop and save',
        style: 'destructive',
        onPress: async () => {
          setBusy(true);
          setNotice(null);
          try {
            const id = await stopRecording();
            await refresh();
            if (id == null) {
              Alert.alert('Nothing saved', 'No GPS position was received during this recording, so there is nothing to save.');
            } else {
              onOpenTrip(id, null);
            }
          } catch (err) {
            Alert.alert('Problem while saving', String((err as Error)?.message || err));
            await refresh();
          }
          setBusy(false);
        },
      },
    ]);
  };

  const activeLegs = active ? legs.filter((l) => l.trip_id === active.id && l.mode !== 'still') : [];
  const lastActiveIdx = activeLegs.length ? Math.max(...activeLegs.map((l) => l.idx)) : -1;
  const sections = byDay(legs);
  const setupNeeded = setup != null && !isReady(setup, mode === 'always');

  const header = (
    <View>
      <View style={styles.top}>
        <View>
          <Text style={styles.brand}>NJIA</Text>
          <Text style={styles.tag}>Your path, recorded offline</Text>
        </View>
        <Pressable onPress={onOpenSetup} style={styles.setupBtn} accessibilityRole="button">
          <Text style={styles.setupBtnText}>Setup</Text>
          {setupNeeded ? <View style={styles.badge} /> : null}
        </Pressable>
      </View>

      {setupNeeded ? (
        <Pressable onPress={onOpenSetup} style={styles.warn} accessibilityRole="button">
          <Text style={styles.warnTitle}>Finish setup for reliable recording</Text>
          <Text style={styles.warnBody}>
            Some phone settings can stop the recording when the screen is off. Tap here to fix them.
          </Text>
        </Pressable>
      ) : null}

      {notice ? (
        <Pressable onPress={() => setNotice(null)} style={styles.notice}>
          <Text style={styles.noticeText}>{notice}</Text>
          <Text style={styles.noticeHide}>Tap to hide</Text>
        </Pressable>
      ) : null}

      <View style={styles.cardWrap}>
        {mode === 'always' ? (
          <AlwaysCard
            status={recorder}
            today={active}
            tripsToday={activeLegs.length}
            busy={busy}
            onViewToday={() => active && onOpenTrip(active.id, null)}
            onRestart={onRestart}
            onOpenSetup={onOpenSetup}
          />
        ) : (
          <RecordCard
            active={active}
            tripsSoFar={activeLegs.length}
            busy={busy}
            onStart={onStart}
            onStop={onStop}
            onViewLive={() => active && onOpenTrip(active.id, null)}
          />
        )}
      </View>

      <Text style={styles.listTitle}>Trips</Text>
    </View>
  );

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <SectionList
        sections={sections}
        keyExtractor={(l) => `${l.trip_id}-${l.idx}`}
        ListHeaderComponent={header}
        stickySectionHeadersEnabled={false}
        renderSectionHeader={({ section }) => (
          <View style={styles.dayHead}>
            <Text style={styles.dayTitle}>{section.title}</Text>
            <Text style={styles.dayTotals}>{section.totals}</Text>
          </View>
        )}
        renderItem={({ item }) => (
          <LegItem
            leg={item}
            live={active != null && item.trip_id === active.id && item.idx === lastActiveIdx}
            onPress={() => onOpenTrip(item.trip_id, item.mode === 'still' ? null : item.depart_t)}
          />
        )}
        ListEmptyComponent={
          <Text style={styles.empty}>
            No trips yet. Tap “Start recording” and go about your day. Every place where you stop for 5 minutes or
            more becomes the end of one trip and the start of the next.
          </Text>
        }
        contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: S.pad,
    paddingTop: 12,
    paddingBottom: 10,
  },
  brand: { color: C.accent, fontSize: 24, fontWeight: '800', letterSpacing: 2 },
  tag: { color: C.muted, fontSize: 13 },
  setupBtn: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.line,
    backgroundColor: C.card,
  },
  setupBtnText: { color: C.text, fontWeight: '600', fontSize: 14 },
  badge: { position: 'absolute', top: -4, right: -4, width: 12, height: 12, borderRadius: 6, backgroundColor: C.warn },
  warn: {
    marginHorizontal: S.pad,
    marginBottom: 10,
    padding: 12,
    borderRadius: 12,
    backgroundColor: '#3a2a12',
    borderWidth: 1,
    borderColor: C.warn,
  },
  warnTitle: { color: C.text, fontWeight: '700', fontSize: 15 },
  warnBody: { color: C.text, fontSize: 13, marginTop: 2, lineHeight: 18 },
  notice: {
    marginHorizontal: S.pad,
    marginBottom: 10,
    padding: 12,
    borderRadius: 12,
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.line,
  },
  noticeText: { color: C.text, fontSize: 13, lineHeight: 18 },
  noticeHide: { color: C.muted, fontSize: 11, marginTop: 4 },
  cardWrap: { paddingHorizontal: S.pad },
  listTitle: { color: C.text, fontSize: 18, fontWeight: '700', paddingHorizontal: S.pad, paddingTop: 22, paddingBottom: 2 },
  dayHead: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    paddingHorizontal: S.pad,
    paddingTop: 16,
    paddingBottom: 6,
    borderBottomWidth: 1,
    borderBottomColor: C.line,
    backgroundColor: C.bg,
  },
  dayTitle: { color: C.accent, fontSize: 14, fontWeight: '700' },
  dayTotals: { color: C.muted, fontSize: 13 },
  empty: { color: C.muted, fontSize: 14, lineHeight: 20, padding: S.pad },
});
