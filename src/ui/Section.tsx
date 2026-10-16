import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { AppText } from './AppText';
import { space } from './theme';

type Props = { title: string; children: ReactNode };

export function Section({ title, children }: Props) {
  return (
    <View style={styles.section}>
      <AppText variant="title" accessibilityRole="header" style={styles.title}>
        {title}
      </AppText>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { marginBottom: space.xxl },
  title: { marginBottom: space.m },
});
