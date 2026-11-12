import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { formatClock, formatDistance, formatDurationShort } from '../core/format';
import { TripRow } from '../data/trips';
import { C, S } from '../theme';
import { Btn } from './Btn';

interface Props {
  /** The trip being recorded right now, or null when idle. */
  active: TripRow | null;
  /** Trips cut from the recording so far. */
  tripsSoFar: number;
  busy: boolean;
  onStart: () => void;
  onStop: () => void;
  onViewLive: () => void;
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.cell}>
      <Text style={styles.cellLabel}>{label}</Text>
      <Text style={styles.cellValue} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

/** The big card at the top: start a trip, or watch the one being recorded. */
export function RecordCard({ active, tripsSoFar, busy, onStart, onStop, onViewLive }: Props) {
  // A once-a-second tick so the clock and "GPS signal" line stay fresh.
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);

  if (!active) {
    return (
      <View style={styles.card}>
        <Text style={styles.title}>Ready to record</Text>
        <Text style={styles.body}>
          Record your whole day. Each place where you stop becomes the end of one trip and the start of the next.
          Works with no internet; you can switch the screen off.
        </Text>
        <Btn label="Start recording" kind="go" big busy={busy} onPress={onStart} style={styles.mainBtn} />
      </View>
    );
  }

  const sinceFix = active.last_time ? (now - active.last_time) / 1000 : Infinity;
  let signal: string;
  let signalColor = C.go;
  if (active.point_count === 0) {
    signal = 'Looking for GPS satellites… go outside or near a window.';
    signalColor = C.warn;
  } else if (sinceFix > 30) {
    signal = `No GPS signal for the last ${formatDurationShort(sinceFix)}. It will carry on when the signal returns.`;
    signalColor = C.warn;
  } else if (active.last_accuracy != null && active.last_accuracy > 30) {
    signal = `GPS signal weak (accurate to about ${Math.round(active.last_accuracy)} m).`;
    signalColor = C.warn;
  } else {
    signal = `GPS signal good${active.last_accuracy != null ? ` (accurate to about ${Math.round(active.last_accuracy)} m)` : ''}.`;
  }
  const kmh = active.last_speed != null && sinceFix < 15 ? active.last_speed * 3.6 : 0;

  return (
    <View style={[styles.card, styles.cardLive]}>
      <View style={styles.liveRow}>
        <View style={styles.dot} />
        <Text style={styles.liveText}>RECORDING</Text>
        <Text style={styles.clock}>{formatClock((now - active.started_at) / 1000)}</Text>
      </View>
      <View style={styles.grid}>
        <Cell label="Distance" value={formatDistance(active.distance_m)} />
        <Cell label="Speed now" value={`${kmh < 10 ? kmh.toFixed(1) : Math.round(kmh)} km/h`} />
        <Cell label="Trips so far" value={String(tripsSoFar)} />
      </View>
      <Text style={[styles.signal, { color: signalColor }]}>{signal}</Text>
      <Btn label="Stop and save" kind="stop" big busy={busy} onPress={onStop} style={styles.mainBtn} />
      <Btn label="See today's trips so far" onPress={onViewLive} style={styles.secondBtn} disabled={active.point_count < 2} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: C.card,
    borderRadius: S.radius,
    padding: S.pad,
    borderWidth: 1,
    borderColor: C.line,
  },
  cardLive: { borderColor: C.stop },
  title: { color: C.text, fontSize: 20, fontWeight: '700' },
  body: { color: C.muted, fontSize: 14, marginTop: 4, lineHeight: 20 },
  mainBtn: { marginTop: 14 },
  secondBtn: { marginTop: 8 },
  liveRow: { flexDirection: 'row', alignItems: 'center' },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: C.stop, marginRight: 8 },
  liveText: { color: C.text, fontWeight: '700', letterSpacing: 1, fontSize: 13, flex: 1 },
  clock: { color: C.text, fontSize: 28, fontWeight: '700', fontVariant: ['tabular-nums'] },
  grid: { flexDirection: 'row', marginTop: 12, gap: 8 },
  cell: { flex: 1, backgroundColor: C.bg, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 10 },
  cellLabel: { color: C.muted, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 },
  cellValue: { color: C.text, fontSize: 17, fontWeight: '700', marginTop: 2, fontVariant: ['tabular-nums'] },
  signal: { marginTop: 10, fontSize: 13 },
});
