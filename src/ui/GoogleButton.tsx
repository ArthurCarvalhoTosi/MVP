import { Image } from 'expo-image';
import { ActivityIndicator, Platform, Pressable, StyleSheet, View } from 'react-native';
import { AppText } from './AppText';
import { useTheme } from './theme';

const G = require('../../assets/images/google-g.svg');

type Props = { onPress: () => void; loading?: boolean };

/**
 * The standard "Continue with Google" button. Its look is set by Google's sign-in branding
 * guidelines (standard G, fixed colours, Roboto Medium, approved wording), not by our design
 * system; only the height grows to our 48dp touch target.
 */
export function GoogleButton({ onPress, loading = false }: Props) {
  const { c } = useTheme();
  const label = 'Continuar com o Google';

  return (
    <Pressable
      onPress={onPress}
      disabled={loading}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: loading, busy: loading }}
      style={({ pressed }) => [
        styles.base,
        { backgroundColor: c.googleFill, borderColor: c.googleStroke },
        pressed && styles.pressed,
      ]}
    >
      <View style={[styles.logo, { backgroundColor: c.googleLogoBg }]}>
        {loading ? (
          <ActivityIndicator size="small" color={c.googleStroke} />
        ) : (
          <Image source={G} style={styles.g} accessible={false} />
        )}
      </View>
      <AppText style={[styles.label, { color: c.googleText }]}>{label}</AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: 4,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  pressed: { opacity: 0.88 },
  logo: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  g: { width: 18, height: 18 },
  // shortcut: Roboto is the Android system font; iOS falls back to its system font until the
  // iOS build bundles Roboto.
  label: {
    fontFamily: Platform.select({ android: 'sans-serif-medium', default: undefined }),
    fontWeight: '500',
    fontSize: 14,
    lineHeight: 20,
  },
});
