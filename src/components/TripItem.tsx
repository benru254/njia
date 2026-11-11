import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { formatDate, formatDistance, formatDurationShort, formatTime } from '../core/format';
import { TripRow } from '../data/trips';
import { C, S } from '../theme';

interface Props {
  trip: TripRow;
  live: boolean;
  onPress: () => void;
}

/** One line in the list of saved trips. */
export function TripItem({ trip, live, onPress }: Props) {
  const end = trip.ended_at ?? trip.last_time ?? trip.started_at;
  const duration = (end - trip.started_at) / 1000;
  const details: string[] = [formatDurationShort(duration)];
  if (trip.stop_count != null) details.push(trip.stop_count === 1 ? '1 stop' : `${trip.stop_count} stops`);
  if (trip.max_speed != null) details.push(`top ${Math.round(trip.max_speed * 3.6)} km/h`);

  return (
    <Pressable
      onPress={onPress}
      android_ripple={{ color: 'rgba(255,255,255,0.08)' }}
      style={styles.row}
      accessibilityRole="button"
    >
      <View style={styles.left}>
        <Text style={styles.name} numberOfLines={1}>
          {trip.name || formatDate(trip.started_at)}
        </Text>
        <Text style={styles.sub} numberOfLines={1}>
          {formatTime(trip.started_at)} – {live ? 'now' : formatTime(end)} · {details.join(' · ')}
        </Text>
      </View>
      <View style={styles.right}>
        <Text style={styles.dist}>{formatDistance(trip.distance_m)}</Text>
        {live ? <Text style={styles.live}>RECORDING</Text> : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 13,
    paddingHorizontal: S.pad,
    borderBottomWidth: 1,
    borderBottomColor: C.line,
    backgroundColor: C.bg,
  },
  left: { flex: 1, minWidth: 0, paddingRight: 10 },
  name: { color: C.text, fontSize: 16, fontWeight: '600' },
  sub: { color: C.muted, fontSize: 13, marginTop: 2 },
  right: { alignItems: 'flex-end' },
  dist: { color: C.text, fontSize: 17, fontWeight: '700', fontVariant: ['tabular-nums'] },
  live: { color: C.stop, fontSize: 10, fontWeight: '700', letterSpacing: 0.8, marginTop: 2 },
});
