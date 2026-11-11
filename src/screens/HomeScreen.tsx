import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, AppState, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { RecordCard } from '../components/RecordCard';
import { TripItem } from '../components/TripItem';
import { formatDistance, formatDurationShort } from '../core/format';
import { TripRow, getActiveTripId, listTrips } from '../data/trips';
import { C, S } from '../theme';
import { SetupStatus, getSetupStatus, isReady, requestLocation, requestNotifications } from '../tracking/permissions';
import { StartupState, checkOnStartup, startRecording, stopRecording } from '../tracking/recorder';

interface Props {
  onOpenTrip: (id: number) => void;
  onOpenSetup: () => void;
}

export function HomeScreen({ onOpenTrip, onOpenSetup }: Props) {
  const insets = useSafeAreaInsets();
  const [trips, setTrips] = useState<TripRow[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [setup, setSetup] = useState<SetupStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const startupDone = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const [list, id, status] = await Promise.all([listTrips(), getActiveTripId(), getSetupStatus()]);
      setTrips(list);
      setActiveId(id);
      setSetup(status);
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
          state = await checkOnStartup();
        } catch {
          /* handled by refresh below */
        }
        if (state === 'resumed') {
          setNotice('Android had paused the recording. It has been started again; the missing part will show as "No data".');
        } else if (state === 'interrupted') {
          setNotice('The recording was interrupted and could not restart. Tap "Stop and save" to keep what was recorded.');
        }
      }
      await refresh();
    })();
  }, [refresh]);

  // While recording, re-read the live numbers every 2 seconds (only while the app is on screen).
  useEffect(() => {
    if (activeId == null) return;
    let timer: ReturnType<typeof setInterval> | null = setInterval(refresh, 2000);
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') {
        refresh();
        if (!timer) timer = setInterval(refresh, 2000);
      } else if (timer) {
        clearInterval(timer);
        timer = null;
      }
    });
    return () => {
      if (timer) clearInterval(timer);
      sub.remove();
    };
  }, [activeId, refresh]);

  // Coming back from Android settings: re-check the setup list.
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
    } catch (err) {
      Alert.alert('Cannot start', String((err as Error)?.message || err));
    }
    await refresh();
    setBusy(false);
  };

  const onStop = () => {
    Alert.alert('Stop recording?', 'The trip will be saved on this phone.', [
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
              Alert.alert('Nothing saved', 'No GPS position was received during this recording, so there is no trip to save.');
            } else {
              onOpenTrip(id);
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

  const active = activeId != null ? trips.find((t) => t.id === activeId) ?? null : null;
  const saved = trips.filter((t) => t.id !== activeId);
  const totalDistance = saved.reduce((sum, t) => sum + (t.distance_m || 0), 0);
  const totalTime = saved.reduce((sum, t) => sum + ((t.ended_at ?? t.started_at) - t.started_at) / 1000, 0);
  const setupNeeded = setup != null && !isReady(setup);

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
        <RecordCard
          active={active}
          busy={busy}
          onStart={onStart}
          onStop={onStop}
          onViewLive={() => active && onOpenTrip(active.id)}
        />
      </View>

      <View style={styles.listHead}>
        <Text style={styles.listTitle}>Saved trips</Text>
        {saved.length > 0 ? (
          <Text style={styles.listTotals}>
            {saved.length} · {formatDistance(totalDistance)} · {formatDurationShort(totalTime)}
          </Text>
        ) : null}
      </View>
    </View>
  );

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <FlatList
        data={saved}
        keyExtractor={(t) => String(t.id)}
        ListHeaderComponent={header}
        renderItem={({ item }) => <TripItem trip={item} live={false} onPress={() => onOpenTrip(item.id)} />}
        ListEmptyComponent={
          <Text style={styles.empty}>
            No trips yet. Tap “Start recording”, take a short walk outside, then tap “Stop and save”.
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
  listHead: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    paddingHorizontal: S.pad,
    paddingTop: 22,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: C.line,
  },
  listTitle: { color: C.text, fontSize: 16, fontWeight: '700' },
  listTotals: { color: C.muted, fontSize: 13 },
  empty: { color: C.muted, fontSize: 14, lineHeight: 20, padding: S.pad },
});
