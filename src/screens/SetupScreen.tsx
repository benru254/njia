import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, AppState, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Btn } from '../components/Btn';
import { NjiaTracker, TrackerEvent } from '../../modules/njia-tracker';
import { formatDate, formatTime } from '../core/format';
import { DEST_MIN_CHOICES } from '../core/segment';
import { DEFAULT_SETTINGS, MODE_LABEL, Place, TravelMode, TripSettings } from '../core/types';
import { rebuildAllLegs } from '../data/legs';
import { RecordMode, getRecordMode } from '../data/mode';
import { deletePlace, listPlaces } from '../data/places';
import { getSettings, setDestMinS, setVehicle } from '../data/settings';
import { getActiveTripId } from '../data/trips';
import { C, S } from '../theme';
import {
  SetupStatus,
  getSetupStatus,
  requestBatteryFree,
  requestGpsOn,
  requestLocation,
  requestNotifications,
  requestBackgroundLocation,
  openNotificationSettings,
  canHideNotification,
} from '../tracking/permissions';
import {
  INTERVAL_CHOICES,
  applySettings,
  disableAlwaysOn,
  enableAlwaysOn,
  getIntervalS,
  setIntervalS,
} from '../tracking/recorder';

interface Props {
  onBack: () => void;
}

const DEST_HINTS: Record<number, string> = {
  180: 'Catches quick drop-offs. More traffic jams may be counted by mistake.',
  300: 'Recommended. Short stops and most jams stay inside the trip.',
  420: 'Fewer trips. Quick drop-offs need you to walk away and back.',
  600: 'Only long stays count. Best for long drives with heavy traffic.',
};
const VEHICLES: TravelMode[] = ['motorbike', 'car', 'matatu', 'other'];

interface ChoiceProps {
  on: boolean;
  label: string;
  hint?: string;
  onPress: () => void;
}

function Choice({ on, label, hint, onPress }: ChoiceProps) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.choice, on && styles.choiceOn]}
      accessibilityRole="radio"
      accessibilityState={{ selected: on }}
    >
      <View style={[styles.radio, on && styles.radioOn]}>{on ? <View style={styles.radioDot} /> : null}</View>
      <View style={{ flex: 1 }}>
        <Text style={styles.choiceLabel}>{label}</Text>
        {hint ? <Text style={styles.choiceHint}>{hint}</Text> : null}
      </View>
    </Pressable>
  );
}

interface StepProps {
  ok: boolean;
  title: string;
  why: string;
  action: string;
  onPress: () => void;
}

function Step({ ok, title, why, action, onPress }: StepProps) {
  return (
    <View style={styles.step}>
      <View style={[styles.mark, { backgroundColor: ok ? C.go : C.warn }]}>
        <Text style={styles.markText}>{ok ? '✓' : '!'}</Text>
      </View>
      <View style={styles.stepBody}>
        <Text style={styles.stepTitle}>{title}</Text>
        <Text style={styles.stepWhy}>{why}</Text>
        {ok ? <Text style={styles.done}>Done</Text> : <Btn label={action} kind="primary" onPress={onPress} style={styles.stepBtn} />}
      </View>
    </View>
  );
}

export function SetupScreen({ onBack }: Props) {
  const insets = useSafeAreaInsets();
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [interval, setIntervalState] = useState(3);
  const [recording, setRecording] = useState(false);
  const [trip, setTrip] = useState<TripSettings>(DEFAULT_SETTINGS);
  const [places, setPlaces] = useState<Place[]>([]);
  const [working, setWorking] = useState<string | null>(null);
  const [mode, setMode] = useState<RecordMode>('manual');
  const [events, setEvents] = useState<TrackerEvent[]>([]);
  const [modeBusy, setModeBusy] = useState(false);

  const refresh = useCallback(async () => {
    setMode(await getRecordMode());
    if (NjiaTracker) setEvents(await NjiaTracker.getEvents(30).catch(() => []));
    setStatus(await getSetupStatus());
    setIntervalState(await getIntervalS());
    setRecording((await getActiveTripId()) != null);
    setTrip(await getSettings());
    setPlaces(await listPlaces());
  }, []);

  /** Save a change that affects how trips are cut, then redo the trip list. */
  const redo = async (label: string, job: () => Promise<void>) => {
    setWorking(label);
    try {
      await job();
      await rebuildAllLegs();
    } catch (err) {
      Alert.alert('Could not save', String((err as Error)?.message || err));
    }
    setWorking(null);
    refresh();
  };

  const removePlace = (p: Place) => {
    Alert.alert(`Forget "${p.name}"?`, 'Stops there will be shown as a letter again. Your trips are kept.', [
      { text: 'Keep it', style: 'cancel' },
      { text: 'Forget', style: 'destructive', onPress: () => redo('Updating trips…', () => deletePlace(p.id)) },
    ]);
  };

  useEffect(() => {
    refresh();
    // Re-check each time the user returns from an Android settings screen.
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') refresh();
    });
    return () => sub.remove();
  }, [refresh]);

  const chooseMode = async (m: RecordMode) => {
    if (modeBusy || m === mode) return;
    setModeBusy(true);
    try {
      if (m === 'always') {
        const st = await getSetupStatus();
        if (!st.background) {
          await requestBackgroundLocation();
          if (!(await getSetupStatus()).background) {
            throw new Error(
              'Always on needs location "Allow all the time". On the page that opened, choose "Allow all the time", ' +
                'then come back and choose Always on again.'
            );
          }
        }
        await enableAlwaysOn();
      } else {
        await disableAlwaysOn();
      }
    } catch (err) {
      Alert.alert('Not changed', String((err as Error)?.message || err));
    }
    setModeBusy(false);
    refresh();
  };

  const run = (fn: () => Promise<void>) => async () => {
    try {
      await fn();
    } catch {
      /* the user closed the pop-up */
    }
    refresh();
  };

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <View style={styles.head}>
        <Pressable onPress={onBack} style={styles.back} accessibilityRole="button">
          <Text style={styles.backText}>‹ Back</Text>
        </Pressable>
        <Text style={styles.title}>Setup</Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: S.pad, paddingBottom: insets.bottom + 32 }}>
        <Text style={styles.section}>How recording starts</Text>
        {modeBusy ? (
          <View style={styles.working}>
            <ActivityIndicator color={C.accent} />
            <Text style={styles.workingText}>Switching…</Text>
          </View>
        ) : null}
        <Choice
          on={mode === 'always'}
          label="Always on"
          hint="Records by itself all day, every day, also after the phone restarts. No Start or Stop. GPS stays on at full accuracy. Each day is one recording, cut into trips."
          onPress={() => chooseMode('always')}
        />
        <Choice
          on={mode === 'manual'}
          label="Manual"
          hint="Records only between Start recording and Stop."
          onPress={() => chooseMode('manual')}
        />

        <Text style={[styles.section, { marginTop: 28 }]}>Make recording reliable</Text>
        <Text style={styles.intro}>
          Android tries to save battery by stopping apps when the screen is off. These four steps tell it to leave
          Njia alone while a trip is being recorded.
        </Text>

        {status ? (
          <>
            <Step
              ok={status.location && status.precise}
              title="1. Allow precise location"
              why={
                status.location && !status.precise
                  ? 'Location is set to "Approximate", which can be wrong by kilometres. Change it to "Precise".'
                  : 'Choose "While using the app" and keep "Precise" switched on.'
              }
              action="Allow location"
              onPress={run(requestLocation)}
            />
            {mode === 'always' ? (
              <Step
                ok={status.background}
                title="1b. Location: Allow all the time"
                why="Needed for Always on: lets the recorder start again by itself after the phone restarts or the battery dies."
                action="Allow all the time"
                onPress={run(requestBackgroundLocation)}
              />
            ) : null}
            <Step
              ok={status.gpsOn}
              title="2. Switch Location (GPS) on"
              why="The phone's Location switch must be on. It works without internet."
              action="Switch on"
              onPress={run(requestGpsOn)}
            />
            <Step
              ok={status.notifications}
              title="3. Allow notifications"
              why={
                mode === 'always' && canHideNotification
                  ? 'Optional with Always on: you may hide the notice instead (see “Hide the notification” below).'
                  : 'Shows the “Njia is recording” notice, so you always know when you are being recorded.'
              }
              action="Allow notifications"
              onPress={run(requestNotifications)}
            />
            <Step
              ok={status.batteryFree}
              title="4. Remove battery limits"
              why="The most important step. Without it, many phones stop the recording after a few minutes with the screen off."
              action="Remove limits"
              onPress={run(requestBatteryFree)}
            />
          </>
        ) : (
          <Text style={styles.intro}>Checking…</Text>
        )}

        <View style={styles.tip}>
          <Text style={styles.tipTitle}>Tecno, Infinix, itel, Xiaomi, Oppo, Vivo, Huawei</Text>
          <Text style={styles.tipBody}>
            These brands have an extra battery manager. If a trip shows long “No data” parts, also do this once:{'\n'}
            • Open recent apps, long-press Njia and choose Lock.{'\n'}
            • In Settings › Apps › Njia, allow Auto-start (or “Auto-launch”).{'\n'}
            • In Settings › Battery, set Njia to “No restrictions”.
          </Text>
        </View>

        <Text style={[styles.section, { marginTop: 28 }]}>Hide the notification</Text>
        <Text style={styles.intro}>
          {canHideNotification
            ? 'Android must show that an app uses GPS in the background, but on this phone you can hide it: turn off ' +
              'notifications for Njia. Recording continues; Njia then only appears in the “Active apps” list at the ' +
              'bottom of your quick settings. The notice is already set to the quietest level (no sound, no icon in ' +
              'the status bar on most phones).'
            : 'This phone runs Android 12 or older. Android does not allow hiding this notice completely there. It is set ' +
              'to the quietest level: no sound, folded away at the bottom of the list, and no icon in the status bar on ' +
              'most phones. If you turn it off, Android shows its own “running in background” notice instead.'}
        </Text>
        <Btn label="Open Njia notification settings" onPress={run(openNotificationSettings)} style={styles.stepBtn} />

        <Text style={[styles.section, { marginTop: 28 }]}>Battery</Text>
        <Text style={styles.intro}>
          GPS stays on at full accuracy the whole time Njia records, moving or not, so no part of a trip is missed. On
          Always on that is all day: GPS will be one of the biggest battery users on the phone. A charger at home and
          at the office keeps it going. Recording every 5 or 10 seconds (below) saves a little.
        </Text>

        <Text style={[styles.section, { marginTop: 28 }]}>When does a stop end a trip?</Text>
        <Text style={styles.intro}>
          A stop this long becomes a destination: one trip ends there and the next begins. Shorter stops stay inside
          the trip as a pause or traffic. A stop of 3+ minutes also counts if you walked away from the vehicle and
          came back, and 2+ minutes counts at a place you named.
        </Text>
        {working ? (
          <View style={styles.working}>
            <ActivityIndicator color={C.accent} />
            <Text style={styles.workingText}>{working}</Text>
          </View>
        ) : null}
        {DEST_MIN_CHOICES.map((sec) => (
          <Choice
            key={sec}
            on={sec === trip.destMinS}
            label={`${sec / 60} minutes`}
            hint={DEST_HINTS[sec]}
            onPress={() => {
              if (working || sec === trip.destMinS) return;
              setTrip({ ...trip, destMinS: sec });
              redo('Re-cutting your trips…', () => setDestMinS(sec));
            }}
          />
        ))}

        <Text style={[styles.section, { marginTop: 28 }]}>Your usual vehicle</Text>
        <Text style={styles.intro}>
          Walking is recognised by itself. Trips faster than walking are labelled with this vehicle; you can change any
          single trip on its Trip tab.
        </Text>
        {VEHICLES.map((m) => (
          <Choice
            key={m}
            on={m === trip.vehicle}
            label={MODE_LABEL[m]}
            onPress={() => {
              if (working || m === trip.vehicle) return;
              setTrip({ ...trip, vehicle: m });
              redo('Updating trips…', () => setVehicle(m));
            }}
          />
        ))}

        <Text style={[styles.section, { marginTop: 28 }]}>Named places</Text>
        <Text style={styles.intro}>
          {places.length
            ? 'Stops at these places show their name. To add one, open a trip and tap “Name this place” on a stop.'
            : 'None yet. Open a trip and tap “Name this place” on a stop (for example Shop 2, Home, or a customer).'}
        </Text>
        {places.map((p) => (
          <View key={String(p.id)} style={styles.placeRow}>
            <Text style={styles.placeName} numberOfLines={1}>
              {p.name}
            </Text>
            <Btn label="Forget" onPress={() => removePlace(p)} disabled={!!working} style={styles.placeBtn} />
          </View>
        ))}

        <Text style={[styles.section, { marginTop: 28 }]}>How often to record a point</Text>
        {recording ? <Text style={styles.intro}>A change here applies from your next trip.</Text> : null}
        {INTERVAL_CHOICES.map((c) => (
          <Choice
            key={c.seconds}
            on={c.seconds === interval}
            label={c.label}
            hint={c.hint}
            onPress={async () => {
              setIntervalState(c.seconds);
              await setIntervalS(c.seconds);
            }}
          />
        ))}

        <Text style={[styles.section, { marginTop: 28 }]}>Good to know</Text>
        <Text style={styles.intro}>
          • Your trips are stored only on this phone. Nothing is sent anywhere unless you tap Share.{'\n'}
          • GPS is accurate to about 3–5 m under open sky, and 10–30 m between tall buildings or inside a vehicle.{'\n'}
          • The street map behind your path needs internet the first time you look at an area. The path itself,
          speeds and stops always work offline.{'\n'}
          • For a full offline street map, tap “Share GPX” on a trip and open it in Organic Maps.
        </Text>
        <Text style={[styles.section, { marginTop: 28 }]}>Recorder diary</Text>
        <Text style={styles.intro}>
          What the recorder did lately, newest first. If a trip has a gap, look here: “stopped by Android” or “could
          not restart” means a phone setting above is still blocking Njia.
        </Text>
        {events.length ? (
          <View style={styles.diary}>
            {events.map((e, i) => (
              <Text key={i} style={[styles.diaryLine, e.kind === 'error' ? { color: C.warn } : null]}>
                {formatDate(e.t).slice(4, 10)} {formatTime(e.t)} · {e.kind}
                {e.detail ? ` · ${e.detail}` : ''}
              </Text>
            ))}
          </View>
        ) : (
          <Text style={styles.intro}>Nothing yet.</Text>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  head: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingTop: 6 },
  back: { paddingHorizontal: 10, paddingVertical: 12 },
  backText: { color: C.accent, fontSize: 16, fontWeight: '700' },
  title: { color: C.text, fontSize: 18, fontWeight: '700', marginLeft: 4 },
  section: { color: C.text, fontSize: 17, fontWeight: '700' },
  intro: { color: C.muted, fontSize: 14, lineHeight: 21, marginTop: 6 },
  step: {
    flexDirection: 'row',
    marginTop: 14,
    padding: 14,
    backgroundColor: C.card,
    borderRadius: S.radius,
    borderWidth: 1,
    borderColor: C.line,
  },
  mark: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  markText: { color: C.white, fontWeight: '800', fontSize: 15 },
  stepBody: { flex: 1 },
  stepTitle: { color: C.text, fontSize: 16, fontWeight: '700' },
  stepWhy: { color: C.muted, fontSize: 13, lineHeight: 19, marginTop: 3 },
  stepBtn: { marginTop: 10, alignSelf: 'flex-start' },
  done: { color: C.go, fontWeight: '700', marginTop: 8 },
  tip: { marginTop: 16, padding: 14, borderRadius: S.radius, borderWidth: 1, borderColor: C.line },
  tipTitle: { color: C.text, fontWeight: '700', fontSize: 14 },
  tipBody: { color: C.muted, fontSize: 13, lineHeight: 20, marginTop: 6 },
  choice: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 10,
    padding: 14,
    borderRadius: S.radius,
    borderWidth: 1,
    borderColor: C.line,
    backgroundColor: C.card,
  },
  choiceOn: { borderColor: C.accent },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: C.muted,
    marginRight: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioOn: { borderColor: C.accent },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: C.accent },
  choiceLabel: { color: C.text, fontSize: 15, fontWeight: '600' },
  choiceHint: { color: C.muted, fontSize: 13, marginTop: 2 },
  working: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 10 },
  workingText: { color: C.accent, fontSize: 14, fontWeight: '600' },
  placeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: S.radius,
    borderWidth: 1,
    borderColor: C.line,
    backgroundColor: C.card,
  },
  diary: { marginTop: 8, padding: 10, borderRadius: S.radius, borderWidth: 1, borderColor: C.line, backgroundColor: C.card },
  diaryLine: { color: C.text, fontSize: 12, lineHeight: 18, fontVariant: ['tabular-nums'] },
  placeName: { flex: 1, color: C.text, fontSize: 15, fontWeight: '600', marginRight: 10 },
  placeBtn: { minHeight: 36, paddingHorizontal: 12 },
});
