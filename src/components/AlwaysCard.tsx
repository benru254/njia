import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { TrackerStatus } from '../../modules/njia-tracker';
import { formatDistance, formatDurationShort, formatTime } from '../core/format';
import { TripRow } from '../data/trips';
import { C, S } from '../theme';
import { Btn } from './Btn';

interface Props {
  status: TrackerStatus | null;
  /** Today's recording (null until the first point of the day arrives). */
  today: TripRow | null;
  tripsToday: number;
  busy: boolean;
  onViewToday: () => void;
  onRestart: () => void;
  onOpenSetup: () => void;
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

/** Top card in Always-on mode: is the recorder running, and what has today looked like. */
export function AlwaysCard({ status, today, tripsToday, busy, onViewToday, onRestart, onOpenSetup }: Props) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(id);
  }, []);

  const running = !!status?.running;
  let line: string;
  let lineColor = C.go;
  if (!running) {
    line = 'The recorder is not running. Tap "Start again".';
    lineColor = C.warn;
  } else if (status!.mode === 'still') {
    line = `Still since ${formatTime(status!.modeSince)} · GPS off, saving battery`;
  } else if (!status!.lastFixT || now - status!.lastFixT > 60_000) {
    line = 'Moving mode · looking for GPS satellites…';
    lineColor = C.warn;
  } else {
    const acc = status!.lastFixAcc > 0 ? ` (±${Math.round(status!.lastFixAcc)} m)` : '';
    line = `Moving · GPS on${acc}`;
  }

  return (
    <View style={[styles.card, running ? styles.cardOn : styles.cardOff]}>
      <View style={styles.row}>
        <View style={[styles.dot, { backgroundColor: running ? C.go : C.warn }]} />
        <Text style={styles.title}>ALWAYS ON</Text>
        <Text style={styles.small}>{running ? 'recording by itself' : 'stopped'}</Text>
      </View>
      <View style={styles.grid}>
        <Cell label="Trips today" value={String(tripsToday)} />
        <Cell label="Distance today" value={formatDistance(today?.distance_m ?? 0)} />
        <Cell
          label="Since"
          value={today ? formatDurationShort((now - today.started_at) / 1000) : '–'}
        />
      </View>
      <Text style={[styles.line, { color: lineColor }]}>{line}</Text>
      {running ? (
        <Btn label="See today's trips" kind="primary" big onPress={onViewToday} disabled={!today} style={styles.btn} />
      ) : (
        <Btn label="Start again" kind="go" big busy={busy} onPress={onRestart} style={styles.btn} />
      )}
      <Btn label="Recording settings" onPress={onOpenSetup} style={styles.btn2} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: C.card, borderRadius: S.radius, padding: S.pad, borderWidth: 1 },
  cardOn: { borderColor: C.go },
  cardOff: { borderColor: C.warn },
  row: { flexDirection: 'row', alignItems: 'center' },
  dot: { width: 10, height: 10, borderRadius: 5, marginRight: 8 },
  title: { color: C.text, fontWeight: '800', letterSpacing: 1, fontSize: 14 },
  small: { color: C.muted, fontSize: 13, marginLeft: 8 },
  grid: { flexDirection: 'row', marginTop: 12, gap: 8 },
  cell: { flex: 1, backgroundColor: C.bg, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 10 },
  cellLabel: { color: C.muted, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 },
  cellValue: { color: C.text, fontSize: 17, fontWeight: '700', marginTop: 2, fontVariant: ['tabular-nums'] },
  line: { marginTop: 10, fontSize: 13 },
  btn: { marginTop: 14 },
  btn2: { marginTop: 8 },
});
