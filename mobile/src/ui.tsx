// Общие элементы интерфейса.

import { Pressable, StyleSheet, Text, View } from 'react-native';

export const colors = {
  text: '#1c1c1e',
  muted: '#6b6b70',
  border: '#d0d0d5',
  surface: '#f2f2f5',
  accent: '#0a64f0',
  success: '#1a7f3c',
  error: '#b3261e',
  warningSurface: '#fff4d6',
  errorSurface: '#fde7e5',
};

export function ActionButton(props: { title: string; onPress: () => void; disabled?: boolean; secondary?: boolean }) {
  return (
    <Pressable
      onPress={props.onPress}
      disabled={props.disabled}
      style={({ pressed }) => [
        styles.button,
        props.secondary && styles.secondary,
        props.disabled && styles.disabled,
        pressed && styles.pressed,
      ]}
    >
      <Text style={[styles.buttonText, props.secondary && styles.secondaryText]}>{props.title}</Text>
    </Pressable>
  );
}

export function Banner(props: { text: string; tone: 'warning' | 'error'; action?: { title: string; onPress: () => void } }) {
  return (
    <View style={[styles.banner, { backgroundColor: props.tone === 'error' ? colors.errorSurface : colors.warningSurface }]}>
      <Text style={styles.bannerText}>{props.text}</Text>
      {props.action && (
        <Pressable onPress={props.action.onPress} hitSlop={8}>
          <Text style={styles.bannerAction}>{props.action.title}</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  button: { backgroundColor: colors.accent, borderRadius: 10, paddingVertical: 13, paddingHorizontal: 16, alignItems: 'center' },
  secondary: { backgroundColor: colors.surface },
  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.7 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  secondaryText: { color: colors.accent },
  banner: { borderRadius: 10, padding: 12, gap: 8 },
  bannerText: { color: colors.text, fontSize: 14, lineHeight: 19 },
  bannerAction: { color: colors.accent, fontSize: 14, fontWeight: '600' },
});
