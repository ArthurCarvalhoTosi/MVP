import { ActivityIndicator, Pressable, StyleSheet } from 'react-native';
import { AppText } from './AppText';
import { Icon, type IconName } from './Icon';
import { radius, space, useTheme } from './theme';

type Props = {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'quiet';
  icon?: IconName;
  disabled?: boolean;
  loading?: boolean;
};

export function Button({ label, onPress, variant = 'primary', icon, disabled = false, loading = false }: Props) {
  const { c } = useTheme();
  const fg = variant === 'primary' ? 'onPrimary' : 'primary';
  const inactive = disabled || loading;

  return (
    <Pressable
      onPress={onPress}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: inactive, busy: loading }}
      style={({ pressed }) => [
        styles.base,
        variant === 'primary' && { backgroundColor: c.primary },
        variant === 'secondary' && { borderWidth: 1.5, borderColor: c.primary },
        pressed && (variant === 'primary' ? styles.pressedFill : { backgroundColor: c.line }),
        disabled && styles.disabled,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={c[fg]} />
      ) : icon ? (
        <Icon name={icon} size={20} color={c[fg]} />
      ) : null}
      <AppText variant="bodyStrong" color={fg} style={styles.label}>
        {label}
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 52,
    borderRadius: radius.button,
    paddingHorizontal: space.xl,
    paddingVertical: space.m,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.s,
  },
  label: { textAlign: 'center', flexShrink: 1 },
  pressedFill: { opacity: 0.82 },
  // Disabled controls are exempt from WCAG contrast; dimming is the conventional cue.
  disabled: { opacity: 0.45 },
});
