import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { formatDistance, formatDurationShort, formatTime } from '../core/format';
import { MODE_LABEL, TravelMode } from '../core/types';
import { LegRow } from '../data/legs';
import { C, S } from '../theme';

interface Props {
  leg: LegRow;
  /** This is the trip being recorded right now. */
  live: boolean;
  onPress: () => void;
}

const place = (letter: string, name: string | null) => (name ? `${letter} ${name}` : letter);

/** One trip in the list: when, from where to where, how far, how long. */
export function LegItem({ leg, live, onPress }: Props) {
  const still = leg.mode === 'still';
  const route = still
    ? `Stayed at ${place(leg.from_letter, leg.from_name)} (no trip)`
    : `${place(leg.from_letter, leg.from_name)}  →  ${place(leg.to_letter, leg.to_name)}`;
  const details: string[] = [];
  if (!still) {
    details.push(MODE_LABEL[leg.mode as TravelMode] ?? leg.mode);
    if (leg.pause_count > 0) details.push(leg.pause_count === 1 ? '1 pause' : `${leg.pause_count} pauses`);
    if (leg.max_speed > 0) details.push(`top ${Math.round(leg.max_speed * 3.6)} km/h`);
  }

  return (
    <Pressable
      onPress={onPress}
      android_ripple={{ color: 'rgba(255,255,255,0.08)' }}
      style={styles.row}
      accessibilityRole="button"
      accessibilityLabel={`Trip ${route}`}
    >
      <View style={styles.left}>
        <Text style={styles.time}>
          {formatTime(leg.depart_t)} → {live ? 'now' : formatTime(leg.arrive_t)}
        </Text>
        <Text style={styles.route} numberOfLines={1}>
          {route}
        </Text>
        {details.length ? (
          <Text style={styles.sub} numberOfLines={1}>
            {details.join(' · ')}
          </Text>
        ) : null}
      </View>
      <View style={styles.right}>
        <Text style={styles.dist}>{still ? '–' : formatDistance(leg.distance_m)}</Text>
        <Text style={styles.dur}>{formatDurationShort(leg.duration_s)}</Text>
        {live ? <Text style={styles.live}>RECORDING</Text> : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: S.pad,
    borderBottomWidth: 1,
    borderBottomColor: C.line,
    backgroundColor: C.bg,
  },
  left: { flex: 1, minWidth: 0, paddingRight: 10 },
  time: { color: C.text, fontSize: 16, fontWeight: '700', fontVariant: ['tabular-nums'] },
  route: { color: C.text, fontSize: 14, marginTop: 2 },
  sub: { color: C.muted, fontSize: 12, marginTop: 2 },
  right: { alignItems: 'flex-end' },
  dist: { color: C.text, fontSize: 16, fontWeight: '700', fontVariant: ['tabular-nums'] },
  dur: { color: C.muted, fontSize: 13, marginTop: 2 },
  live: { color: C.stop, fontSize: 10, fontWeight: '700', letterSpacing: 0.8, marginTop: 2 },
});
