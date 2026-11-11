import React from 'react';
import { ActivityIndicator, Pressable, StyleProp, StyleSheet, Text, ViewStyle } from 'react-native';
import { C } from '../theme';

type Kind = 'primary' | 'go' | 'stop' | 'plain';

interface Props {
  label: string;
  onPress: () => void;
  kind?: Kind;
  big?: boolean;
  busy?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}

const BG: Record<Kind, string> = { primary: C.accent, go: C.go, stop: C.stop, plain: C.card };
const FG: Record<Kind, string> = { primary: C.onAccent, go: C.white, stop: C.white, plain: C.text };

/** The one button used everywhere, so every button looks and behaves the same. */
export function Btn({ label, onPress, kind = 'plain', big, busy, disabled, style }: Props) {
  const off = !!disabled || !!busy;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={off}
      onPress={onPress}
      android_ripple={{ color: 'rgba(255,255,255,0.18)' }}
      style={[
        styles.base,
        big && styles.big,
        { backgroundColor: BG[kind] },
        kind === 'plain' && styles.plainBorder,
        off && styles.off,
        style,
      ]}
    >
      {busy ? (
        <ActivityIndicator color={FG[kind]} />
      ) : (
        <Text style={[styles.label, big && styles.bigLabel, { color: FG[kind] }]}>{label}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 46,
    paddingHorizontal: 16,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  big: { minHeight: 62, borderRadius: 16 },
  plainBorder: { borderWidth: 1, borderColor: C.line },
  off: { opacity: 0.5 },
  label: { fontSize: 15, fontWeight: '700' },
  bigLabel: { fontSize: 19 },
});
