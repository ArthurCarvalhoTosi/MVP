import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { DatabaseProvider } from '@/db/provider';
import { fonts, type, useTheme } from '@/ui';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts(fonts);

  // shortcut: DatabaseProvider exposes no error signal, so this timer uncovers its error screen;
  // replace with an onSettled prop on the provider when one exists.
  useEffect(() => {
    const t = setTimeout(SplashScreen.hide, 3000);
    return () => clearTimeout(t);
  }, []);

  return (
    <DatabaseProvider>
      {fontsLoaded || fontError ? <AppStack /> : null}
    </DatabaseProvider>
  );
}

// Mounts only once the database is open and fonts are settled.
function AppStack() {
  const { c } = useTheme();
  useEffect(() => SplashScreen.hide(), []);

  // Sheets draw their own title: native headers aren't reliable inside formSheet on Android.
  const sheet = { presentation: 'formSheet', headerShown: false, sheetGrabberVisible: true } as const;

  return (
    <>
      <StatusBar style="auto" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: c.bg },
          headerTintColor: c.primary,
          headerTitleStyle: { fontFamily: type.title.fontFamily, color: c.ink },
          headerShadowVisible: false,
          contentStyle: { backgroundColor: c.bg },
        }}
      >
        <Stack.Screen name="index" options={{ title: '' }} />
        <Stack.Screen name="onboarding" options={{ title: 'Seu carro' }} />
        <Stack.Screen name="history" options={{ title: 'Histórico' }} />
        <Stack.Screen name="register" options={{ ...sheet, sheetAllowedDetents: [0.75, 1] }} />
        <Stack.Screen name="adjust-km" options={{ ...sheet, sheetAllowedDetents: [0.5, 1] }} />
        <Stack.Screen name="specs" options={{ ...sheet, sheetAllowedDetents: [1] }} />
      </Stack>
    </>
  );
}
