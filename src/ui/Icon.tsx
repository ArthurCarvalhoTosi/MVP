import { SymbolView, type AndroidSymbol, type SFSymbol } from 'expo-symbols';

// @expo/vector-icons is not installed (SDK 58 no longer ships it), so names keep
// MaterialCommunityIcons spelling but render native SF Symbols (iOS) / Material Symbols (Android, web).
// Swapping to vector-icons later only touches this file.
const glyphs = {
  'alert-octagon': { ios: 'exclamationmark.octagon.fill', android: 'report' },
  alert: { ios: 'exclamationmark.triangle.fill', android: 'warning' },
  'check-circle-outline': { ios: 'checkmark.circle', android: 'check_circle' },
  check: { ios: 'checkmark', android: 'check' },
  plus: { ios: 'plus', android: 'add' },
  pencil: { ios: 'pencil', android: 'edit' },
  oil: { ios: 'oilcan.fill', android: 'oil_barrel' },
  // SF 'tirepressure' needs iOS 17+; on 16.x the glyph is blank but labels still carry meaning.
  'car-tire-alert': { ios: 'tirepressure', android: 'tire_repair' },
  'car-battery': { ios: 'minus.plus.batteryblock.fill', android: 'battery_full' },
  // Material Symbols has no wiper glyph; the windshield is the closest recognizable shape.
  wiper: { ios: 'windshield.front.and.wiper', android: 'windshield_defrost_front' },
  speedometer: { ios: 'speedometer', android: 'speed' },
  calendar: { ios: 'calendar', android: 'calendar_today' },
  camera: { ios: 'camera', android: 'photo_camera' },
  'image-multiple': { ios: 'photo.on.rectangle', android: 'photo_library' },
  'share-variant': { ios: 'square.and.arrow.up', android: 'share' },
  'file-pdf-box': { ios: 'doc.richtext', android: 'picture_as_pdf' },
  car: { ios: 'car.fill', android: 'directions_car' },
  history: { ios: 'clock.arrow.circlepath', android: 'history' },
  magnify: { ios: 'magnifyingglass', android: 'search' },
  close: { ios: 'xmark', android: 'close' },
  'chevron-right': { ios: 'chevron.right', android: 'chevron_right' },
  'chevron-down': { ios: 'chevron.down', android: 'expand_more' },
  'trash-can-outline': { ios: 'trash', android: 'delete' },
} satisfies Record<string, { ios: SFSymbol; android: AndroidSymbol }>;

export type IconName = keyof typeof glyphs;

type Props = { name: IconName; size?: number; color: string };

/** Decorative: always hidden from screen readers; the surrounding label carries the meaning. */
export function Icon({ name, size = 24, color }: Props) {
  const g = glyphs[name];
  return (
    <SymbolView
      name={{ ios: g.ios, android: g.android, web: g.android }}
      size={size}
      tintColor={color}
      testID={`icon-${name}`}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    />
  );
}
