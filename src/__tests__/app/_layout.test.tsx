import { act, render } from '@testing-library/react-native';
import * as SplashScreen from 'expo-splash-screen';
import type { ReactNode } from 'react';
import RootLayout from '@/app/_layout';

let mockOnSettled: (() => void) | undefined;

jest.mock('expo-splash-screen', () => ({ preventAutoHideAsync: jest.fn(), hide: jest.fn() }));
jest.mock('expo-font', () => ({ useFonts: () => [true, null] }));
jest.mock('expo-notifications', () => require('@/test-utils/notifications').notificationsMock);
jest.mock('expo-router', () => ({
  Stack: Object.assign(({ children }: { children: ReactNode }) => children, { Screen: () => null }),
}));
// Stands in for a provider whose open is still running (or failed): it never renders the app.
jest.mock('@/db/provider', () => ({
  DatabaseProvider: ({ onSettled }: { onSettled?: () => void }) => {
    mockOnSettled = onSettled;
    return null;
  },
}));

afterEach(() => jest.useRealTimers());

test('keeps the splash up until the database settles, with no timer shortcut', async () => {
  jest.useFakeTimers();
  await render(<RootLayout />);

  await act(async () => jest.advanceTimersByTime(10_000));
  expect(SplashScreen.hide).not.toHaveBeenCalled();

  // Settled also covers a failed open: the provider's error screen must not stay behind the splash.
  await act(async () => mockOnSettled?.());
  expect(SplashScreen.hide).toHaveBeenCalledTimes(1);
});
