import { Pressable, StyleSheet, View } from 'react-native';
import { AppText } from './AppText';
import { Icon } from './Icon';
import { radius, space, useTheme } from './theme';

type Props<T> = {
  /** The question, shown above the options, e.g. "Quanto você roda por mês?". */
  label: string;
  options: readonly { label: string; value: T }[];
  value: T | null;
  onChange: (v: T) => void;
};

export function ChipGroup<T>({ label, options, value, onChange }: Props<T>) {
  const { c } = useTheme();
  return (
    <View style={styles.wrap}>
      {/* Readable text, not a label on the group: iOS has no radiogroup container, so VoiceOver
          never reads a container's label; this is read right before the first option instead. */}
      <AppText variant="caption" color="inkMuted">
        {label}
      </AppText>
      <View accessibilityRole="radiogroup" style={styles.group}>
        {options.map((o) => {
          const selected = o.value === value;
          return (
            <Pressable
              key={o.label}
              onPress={() => onChange(o.value)}
              accessibilityRole="radio"
              accessibilityLabel={o.label}
              accessibilityState={{ checked: selected }}
              style={({ pressed }) => [
                styles.chip,
                {
                  // inkMuted (not line) keeps the unselected boundary at >= 3:1 (WCAG 1.4.11).
                  borderColor: selected ? c.primary : c.inkMuted,
                  backgroundColor: selected ? c.primary : pressed ? c.line : c.surface,
                },
              ]}
            >
              {/* Check mark so selection isn't conveyed by fill color alone. */}
              {selected ? <Icon name="check" size={18} color={c.onPrimary} /> : null}
              <AppText color={selected ? 'onPrimary' : 'ink'}>{o.label}</AppText>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.s },
  group: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s },
  chip: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: radius.button,
    paddingHorizontal: space.l,
    paddingVertical: space.s,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
  },
});
