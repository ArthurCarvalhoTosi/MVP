import { Pressable, StyleSheet, View } from 'react-native';
import { AppText } from './AppText';
import { Button } from './Button';
import { Icon, type IconName } from './Icon';
import { space, useTheme, type ColorName } from './theme';

export type Urgency = 'critical' | 'attention' | 'ok';

// Distinct shapes (octagon / triangle / circle) so urgency never relies on color alone.
const urgencyStyle: Record<Urgency, { icon: IconName; text: ColorName; bar: ColorName; word: string }> = {
  critical: { icon: 'alert-octagon', text: 'critical', bar: 'critical', word: 'Crítico' },
  attention: { icon: 'alert', text: 'attention', bar: 'attentionBar', word: 'Atenção' },
  ok: { icon: 'check-circle-outline', text: 'ok', bar: 'ok', word: 'Em dia' },
};

type Props = {
  name: string;
  urgency: Urgency;
  primary: string;
  secondary?: string | null;
  onPress?: () => void;
  action?: { label: string; onPress: () => void };
};

export function ItemRow({ name, urgency, primary, secondary, onPress, action }: Props) {
  const { c } = useTheme();
  const u = urgencyStyle[urgency];
  const critical = urgency === 'critical';
  const a11yLabel = [name, u.word, primary, secondary].filter(Boolean).join('. ');

  const content = (
    <>
      <Icon name={u.icon} size={24} color={c[u.text]} />
      <View style={styles.text}>
        <AppText variant="bodyStrong">{name}</AppText>
        <AppText color={u.text}>{primary}</AppText>
        {secondary ? (
          <AppText variant="caption" color="inkMuted">
            {secondary}
          </AppText>
        ) : null}
      </View>
    </>
  );

  return (
    <View
      style={[
        styles.row,
        { backgroundColor: critical ? c.criticalTint : c.surface, borderBottomColor: c.line },
      ]}
    >
      <View style={[styles.bar, { backgroundColor: c[u.bar] }]} />
      <View style={styles.body}>
        {/* The summary is one screen-reader stop; the action stays a separate, reachable button. */}
        {onPress ? (
          <Pressable
            onPress={onPress}
            accessibilityRole="button"
            accessibilityLabel={a11yLabel}
            style={({ pressed }) => [styles.info, pressed && { backgroundColor: c.line }]}
          >
            {content}
          </Pressable>
        ) : (
          <View accessible accessibilityLabel={a11yLabel} style={styles.info}>
            {content}
          </View>
        )}
        {critical && action ? (
          <View style={styles.action}>
            <Button label={action.label} onPress={action.onPress} />
          </View>
        ) : null}
      </View>
    </View>
  );
}

const ICON_GAP = space.m;

const styles = StyleSheet.create({
  row: { flexDirection: 'row', borderBottomWidth: 1 },
  bar: { width: 4 },
  body: { flex: 1 },
  info: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: ICON_GAP,
    minHeight: 48,
    paddingVertical: space.m,
    paddingHorizontal: space.l,
  },
  text: { flex: 1 },
  // Aligns the compact button with the text column, not the icon.
  action: { alignItems: 'flex-start', paddingLeft: space.l + 24 + ICON_GAP, paddingBottom: space.m },
});
