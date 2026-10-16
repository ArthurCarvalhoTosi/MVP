import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { AppText } from './AppText';
import { space } from './theme';

type Props = { title: string; children: ReactNode; trailing?: ReactNode };

export function Section({ title, children, trailing }: Props) {
  return (
    <View style={styles.section}>
      <View style={styles.header}>
        <AppText variant="title" accessibilityRole="header" style={styles.title}>
          {title}
        </AppText>
        {trailing}
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { marginBottom: space.xxl },
  header: { flexDirection: 'row', alignItems: 'center', gap: space.s, marginBottom: space.m },
  title: { flex: 1 },
});
