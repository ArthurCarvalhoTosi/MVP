import { useEffect, useState } from 'react';
import {
  AccessibilityInfo,
  Platform,
  StyleSheet,
  TextInput,
  View,
  type KeyboardTypeOptions,
} from 'react-native';
import { AppText } from './AppText';
import { radius, space, type, useTheme } from './theme';

type Props = {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  prefix?: string;
  suffix?: string;
  error?: string | null;
  /** Muted note under the field, read after it by screen readers. */
  hint?: string | null;
  keyboardType?: KeyboardTypeOptions;
  placeholder?: string;
  maxLength?: number;
  selectTextOnFocus?: boolean;
  /** Off for names the keyboard doesn't know (car models): Android would "fix" onix into onyx. */
  autoCorrect?: boolean;
};

export function TextField({
  label,
  value,
  onChangeText,
  prefix,
  suffix,
  error,
  hint,
  keyboardType,
  placeholder,
  maxLength,
  selectTextOnFocus,
  autoCorrect,
}: Props) {
  const { c } = useTheme();
  const [focused, setFocused] = useState(false);
  const emphasized = focused || !!error;

  // accessibilityLiveRegion is Android-only; VoiceOver needs an explicit announcement.
  useEffect(() => {
    if (error && Platform.OS === 'ios') AccessibilityInfo.announceForAccessibility(error);
  }, [error]);

  return (
    <View style={styles.wrap}>
      {/* Hidden from screen readers: the input itself carries this label (plus unit). */}
      <AppText
        variant="caption"
        color="inkMuted"
        accessibilityElementsHidden
        importantForAccessibility="no"
      >
        {label}
      </AppText>
      <View
        style={[
          styles.field,
          {
            backgroundColor: c.surface,
            // inkMuted (not line) keeps the field boundary at >= 3:1 (WCAG 1.4.11).
            borderColor: error ? c.critical : focused ? c.primary : c.inkMuted,
            borderWidth: emphasized ? 2 : 1,
            paddingHorizontal: emphasized ? space.m - 1 : space.m,
          },
        ]}
      >
        {prefix ? <Affix text={prefix} /> : null}
        <TextInput
          value={value}
          onChangeText={onChangeText}
          keyboardType={keyboardType}
          placeholder={placeholder}
          maxLength={maxLength}
          selectTextOnFocus={selectTextOnFocus}
          autoCorrect={autoCorrect}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          accessibilityLabel={[label, prefix ?? suffix].filter(Boolean).join(', ')}
          accessibilityHint={error ?? undefined}
          placeholderTextColor={c.inkMuted}
          selectionColor={c.primary}
          // No lineHeight: it misaligns single-line TextInput text on iOS.
          style={[styles.input, { color: c.ink }]}
        />
        {suffix ? <Affix text={suffix} /> : null}
      </View>
      {error ? (
        <AppText variant="caption" color="critical" accessibilityLiveRegion="polite">
          {error}
        </AppText>
      ) : null}
      {hint ? (
        <AppText variant="caption" color="inkMuted">
          {hint}
        </AppText>
      ) : null}
    </View>
  );
}

function Affix({ text }: { text: string }) {
  return (
    <AppText color="inkMuted" accessibilityElementsHidden importantForAccessibility="no">
      {text}
    </AppText>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.xs },
  field: {
    minHeight: 52,
    borderRadius: radius.plaque,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.s,
  },
  input: {
    flex: 1,
    minHeight: 48,
    paddingVertical: 0,
    fontFamily: type.body.fontFamily,
    fontSize: type.body.fontSize,
  },
});
