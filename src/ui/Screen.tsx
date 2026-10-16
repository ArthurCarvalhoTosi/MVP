import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { space, useTheme } from './theme';

type Props = { children: ReactNode; scroll?: boolean; footer?: ReactNode };

export function Screen({ children, scroll = false, footer }: Props) {
  const { c } = useTheme();
  return (
    <SafeAreaView style={[styles.root, { backgroundColor: c.bg }]}>
      {scroll ? (
        <ScrollView
          style={styles.root}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          {children}
        </ScrollView>
      ) : (
        <View style={[styles.root, styles.content]}>{children}</View>
      )}
      {footer ? <View style={[styles.footer, { borderTopColor: c.line }]}>{footer}</View> : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { padding: space.l },
  footer: { paddingHorizontal: space.l, paddingVertical: space.m, gap: space.s, borderTopWidth: 1 },
});
