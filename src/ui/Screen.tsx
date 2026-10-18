import { HeaderHeightContext } from 'expo-router/react-navigation';
import { useContext, type ReactNode } from 'react';
import { KeyboardAvoidingView, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { space, useTheme } from './theme';

type Props = { children: ReactNode; scroll?: boolean; footer?: ReactNode };

export function Screen({ children, scroll = false, footer }: Props) {
  const { c } = useTheme();
  // The view measures itself below the header, so the header height is its offset from the screen top.
  const headerHeight = useContext(HeaderHeightContext) ?? 0;
  return (
    <SafeAreaView style={[styles.root, { backgroundColor: c.bg }]}>
      {/* 'padding' on both platforms: Android is edge-to-edge since SDK 54, so adjustResize no longer
          shrinks the window and the view has to make room itself, like on iOS (Expo's edge-to-edge
          guidance). Not 'height': it keeps the first measured height, which breaks when a sheet changes detent. */}
      <KeyboardAvoidingView
        behavior="padding"
        keyboardVerticalOffset={headerHeight}
        style={styles.root}
      >
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
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { padding: space.l },
  footer: { paddingHorizontal: space.l, paddingVertical: space.m, gap: space.s, borderTopWidth: 1 },
});
