import { useEffect } from 'react';
import { AccessibilityInfo, Platform } from 'react-native';
import { ValidationError } from '@/domain';
import { AppText } from './AppText';

const GENERIC = 'Não foi possível salvar. Tente de novo.';

/** Why a save failed. Only repo validation messages are written for people; anything else gets a generic line. */
export function FormError({ error }: { error: unknown }) {
  const message = error == null ? null : error instanceof ValidationError ? error.message : GENERIC;

  // Same as TextField: accessibilityLiveRegion is Android-only; VoiceOver needs an explicit announcement.
  // Keyed on the error too, so a second identical failure is announced again.
  useEffect(() => {
    if (message && Platform.OS === 'ios') AccessibilityInfo.announceForAccessibility(message);
  }, [error, message]);

  if (!message) return null;
  return (
    <AppText color="critical" accessibilityLiveRegion="polite">
      {message}
    </AppText>
  );
}
