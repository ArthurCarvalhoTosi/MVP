import { useEffect } from 'react';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { AppText } from './AppText';
import { radius, space, type, useTheme } from './theme';

// Drum geometry must match the rendered glyph size exactly, so font scaling is applied
// by hand (capped) instead of letting the OS scale the text inside a fixed-height window.
const MAX_FONT_SCALE = 1.3;
const DRUM_WIDTH = 32;
const MIN_DRUMS = 6;
const DIGITS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

function formatKm(km: number) {
  return String(km).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

type Props = { km: number; estimated?: boolean };

export function Odometer({ km, estimated = false }: Props) {
  const { fontScale } = useWindowDimensions();
  const scale = Math.min(fontScale, MAX_FONT_SCALE);
  const value = Math.max(0, Math.round(km || 0));
  const significant = String(value);
  const digits = significant.padStart(MIN_DRUMS, '0').split('').map(Number);
  const leadingZeros = digits.length - significant.length;
  const label = `Hodômetro${estimated ? ' estimado' : ''}: ${formatKm(value)} quilômetros`;

  return (
    <View accessible accessibilityRole="text" accessibilityLabel={label}>
      <View
        style={styles.row}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <View style={styles.drums}>
          {digits.map((d, i) => (
            <Drum
              // Keyed by place value so the units drum keeps its state when a digit is added.
              key={digits.length - i}
              digit={d}
              scale={scale}
              dim={i < leadingZeros}
              inverted={estimated && i === digits.length - 1}
            />
          ))}
        </View>
        <AppText style={styles.unit}>km</AppText>
      </View>
      {estimated ? (
        <AppText variant="caption" color="inkMuted" style={styles.note}>
          Estimativa de hoje
        </AppText>
      ) : null}
    </View>
  );
}

type DrumProps = { digit: number; scale: number; dim: boolean; inverted: boolean };

function Drum({ digit, scale, dim, inverted }: DrumProps) {
  const { c } = useTheme();
  const reduceMotion = useReducedMotion();
  const position = useSharedValue(digit);
  const height = type.odometer.lineHeight * scale;

  useEffect(() => {
    position.set(
      reduceMotion ? digit : withTiming(digit, { duration: 400, easing: Easing.out(Easing.cubic) }),
    );
  }, [digit, reduceMotion, position]);

  const strip = useAnimatedStyle(() => ({
    transform: [{ translateY: -position.get() * height }],
  }));

  const digitStyle = {
    height,
    lineHeight: height,
    fontSize: type.odometer.fontSize * scale,
    color: inverted ? c.drum : c.drumDigit,
    opacity: dim ? 0.45 : 1,
  };

  return (
    <View
      testID="odometer-drum"
      style={[
        styles.drum,
        {
          width: DRUM_WIDTH * scale,
          height: height + 2, // + top/bottom border, so the digit window is exactly `height`
          backgroundColor: inverted ? c.drumDigit : c.drum,
          // Same as the dark cell, so it only shows as a frame around the inverted (light) drum.
          borderColor: c.drum,
        },
      ]}
    >
      <Animated.View style={strip}>
        {DIGITS.map((n) => (
          <Text key={n} allowFontScaling={false} style={[styles.digit, digitStyle]}>
            {n}
          </Text>
        ))}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-end' },
  drums: { flexDirection: 'row', gap: 3 },
  drum: { borderRadius: radius.drum, borderWidth: 1, overflow: 'hidden' },
  digit: {
    fontFamily: type.odometer.fontFamily,
    textAlign: 'center',
    includeFontPadding: false,
  },
  unit: { marginLeft: space.s, marginBottom: space.xs },
  note: { marginTop: space.xs },
});
