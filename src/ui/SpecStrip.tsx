import * as Clipboard from 'expo-clipboard';
import { useEffect, useState } from 'react';
import { AccessibilityInfo, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { AppText } from './AppText';
import { Button } from './Button';
import { Icon, type IconName } from './Icon';
import { radius, space, useTheme } from './theme';

export type SpecItem = { key: string; icon: IconName; label: string; value: string | null };

type Props = { items: SpecItem[]; onEdit: () => void };

export function SpecStrip({ items, onEdit }: Props) {
  const { c } = useTheme();
  const { width, fontScale } = useWindowDimensions();
  // One row of plaques only when there's real room (wide screen at the current text size).
  const basis = width / fontScale >= 600 ? '20%' : '40%';
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  useEffect(() => {
    if (!copiedKey) return;
    const t = setTimeout(() => setCopiedKey(null), 1500);
    return () => clearTimeout(t);
  }, [copiedKey]);

  const copy = async (item: SpecItem & { value: string }) => {
    await Clipboard.setStringAsync(item.value);
    AccessibilityInfo.announceForAccessibility('Copiado');
    setCopiedKey(item.key);
  };

  return (
    <View>
      <View style={styles.grid}>
        {items.map((item) => {
          const { value } = item;
          const plaqueStyle = ({ pressed }: { pressed: boolean }) =>
            [
              styles.plaque,
              {
                flexBasis: basis,
                borderColor: c.line,
                backgroundColor: pressed ? c.line : c.surface,
              },
            ] as const;
          const icon = <Icon name={item.icon} size={20} color={c.inkMuted} />;

          if (!value) {
            return (
              <Pressable
                key={item.key}
                onPress={onEdit}
                accessibilityRole="button"
                accessibilityLabel={`${item.label}: Adicionar`}
                style={plaqueStyle}
              >
                {icon}
                <View style={styles.text}>
                  <AppText variant="bodyStrong" color="primary">
                    Adicionar
                  </AppText>
                  <AppText variant="caption" color="inkMuted">
                    {item.label}
                  </AppText>
                </View>
              </Pressable>
            );
          }

          const copied = copiedKey === item.key;
          return (
            <Pressable
              key={item.key}
              onLongPress={() => copy({ ...item, value })}
              accessibilityLabel={`${item.label}: ${value}`}
              accessibilityHint="Toque longo para copiar"
              accessibilityActions={[{ name: 'longpress', label: 'Copiar' }]}
              onAccessibilityAction={() => copy({ ...item, value })}
              style={plaqueStyle}
            >
              {icon}
              <View style={styles.text}>
                <AppText variant="number">{value}</AppText>
                <AppText variant="caption" color={copied ? 'ok' : 'inkMuted'}>
                  {copied ? 'Copiado' : item.label}
                </AppText>
              </View>
            </Pressable>
          );
        })}
      </View>
      <View style={styles.edit}>
        <Button variant="quiet" label="Editar" icon="pencil" onPress={onEdit} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s },
  plaque: {
    flexGrow: 1,
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.s,
    padding: space.m,
    borderWidth: 1,
    borderRadius: radius.plaque,
  },
  text: { flex: 1 },
  edit: { alignItems: 'flex-end' },
});
