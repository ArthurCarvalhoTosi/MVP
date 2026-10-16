import { useColorScheme, type TextStyle } from 'react-native';

const light = {
  bg: '#F3F5F4',
  surface: '#FFFFFF',
  ink: '#1B2226',
  inkMuted: '#55616A',
  line: '#D4DADD',
  primary: '#0F3B9C',
  onPrimary: '#FFFFFF',
  critical: '#B3261E',
  criticalTint: '#FBEAE8',
  attention: '#8A5300',
  attentionBar: '#E8A317',
  attentionTint: '#FDF3DC',
  ok: '#2D6A4F',
  okTint: '#E4F1EA',
  drum: '#1B2226',
  drumDigit: '#F4F4EE',
};

export type ColorName = keyof typeof light;
export type Colors = Record<ColorName, string>;

const dark: Colors = {
  bg: '#12171A',
  surface: '#1A2126',
  ink: '#E6EAEA',
  inkMuted: '#9AA6AE',
  line: '#2B343A',
  primary: '#8FA8FF',
  onPrimary: '#0A1A44',
  critical: '#FF8A80',
  criticalTint: '#3A1D1B',
  attention: '#FFC761',
  attentionBar: '#E8A317',
  attentionTint: '#3A2E14',
  ok: '#74C69D',
  okTint: '#16302A',
  drum: '#262E34',
  drumDigit: '#F4F4EE',
};

export const type = {
  caption: { fontFamily: 'Barlow_500Medium', fontSize: 13, lineHeight: 18 },
  body: { fontFamily: 'Barlow_400Regular', fontSize: 16, lineHeight: 24 },
  bodyStrong: { fontFamily: 'Barlow_600SemiBold', fontSize: 16, lineHeight: 24 },
  lead: { fontFamily: 'Barlow_500Medium', fontSize: 18, lineHeight: 26 },
  title: { fontFamily: 'Barlow_700Bold', fontSize: 22, lineHeight: 28 },
  display: { fontFamily: 'Barlow_700Bold', fontSize: 28, lineHeight: 34 },
  number: { fontFamily: 'BarlowCondensed_600SemiBold', fontSize: 20, lineHeight: 24 },
  odometer: { fontFamily: 'BarlowCondensed_600SemiBold', fontSize: 44, lineHeight: 52 },
} satisfies Record<string, TextStyle>;

export type TypeVariant = keyof typeof type;

export const space = { xs: 4, s: 8, m: 12, l: 16, xl: 24, xxl: 32, xxxl: 48 };

export const radius = { button: 10, plaque: 6, drum: 3, row: 0 };

export function useTheme() {
  const c = useColorScheme() === 'dark' ? dark : light;
  return { c, type, space, radius };
}
