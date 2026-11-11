import React, { useCallback, useEffect, useState } from 'react';
import { AppState, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Btn } from '../components/Btn';
import { getActiveTripId } from '../data/trips';
import { C, S } from '../theme';
import {
  SetupStatus,
  getSetupStatus,
  requestBatteryFree,
  requestGpsOn,
  requestLocation,
  requestNotifications,
} from '../tracking/permissions';
import { INTERVAL_CHOICES, getIntervalS, setIntervalS } from '../tracking/recorder';

interface Props {
  onBack: () => void;
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

  const refresh = useCallback(async () => {
    setStatus(await getSetupStatus());
    setIntervalState(await getIntervalS());
    setRecording((await getActiveTripId()) != null);
  }, []);

  useEffect(() => {
    refresh();
    // Re-check each time the user returns from an Android settings screen.
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') refresh();
    });
    return () => sub.remove();
  }, [refresh]);

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
        <Text style={styles.section}>Make recording reliable</Text>
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
              why="Shows the “Njia is recording” notice, so you always know when you are being recorded."
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

        <Text style={[styles.section, { marginTop: 28 }]}>How often to record a point</Text>
        {recording ? <Text style={styles.intro}>A change here applies from your next trip.</Text> : null}
        {INTERVAL_CHOICES.map((c) => {
          const on = c.seconds === interval;
          return (
            <Pressable
              key={c.seconds}
              onPress={async () => {
                setIntervalState(c.seconds);
                await setIntervalS(c.seconds);
              }}
              style={[styles.choice, on && styles.choiceOn]}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
            >
              <View style={[styles.radio, on && styles.radioOn]}>{on ? <View style={styles.radioDot} /> : null}</View>
              <View style={{ flex: 1 }}>
                <Text style={styles.choiceLabel}>{c.label}</Text>
                <Text style={styles.choiceHint}>{c.hint}</Text>
              </View>
            </Pressable>
          );
        })}

        <Text style={[styles.section, { marginTop: 28 }]}>Good to know</Text>
        <Text style={styles.intro}>
          • Your trips are stored only on this phone. Nothing is sent anywhere unless you tap Share.{'\n'}
          • GPS is accurate to about 3–5 m under open sky, and 10–30 m between tall buildings or inside a vehicle.{'\n'}
          • The street map behind your path needs internet the first time you look at an area. The path itself,
          speeds and stops always work offline.{'\n'}
          • For a full offline street map, tap “Share GPX” on a trip and open it in Organic Maps.
        </Text>
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
});
