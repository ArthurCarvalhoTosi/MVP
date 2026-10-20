import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import { signInWithGoogle, signOut, useAccount } from '@/account';
import { useDb } from '@/db/provider';
import { vehiclesQuery } from '@/db/repo';
import { formatMoment } from '@/domain';
import { syncNow, useSyncStatus, type SyncStatus } from '@/sync/useSync';
import { AppText, Button, FormError, GoogleButton, Screen, Section, space } from '@/ui';

export default function Account() {
  const db = useDb();
  const account = useAccount(db);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const sync = useSyncStatus();
  // Opened from a new phone's first screen: once the account's cars land, show the garage.
  const [firstRun] = useState(() => vehiclesQuery(db).all().length === 0);
  const cars = useLiveQuery(vehiclesQuery(db));
  const landed = firstRun && account.status === 'signed-in' && (cars.data?.length ?? 0) > 0;
  useEffect(() => {
    if (landed) router.dismissTo('/');
  }, [landed]);

  if (account.status === 'loading') return null;

  const signIn = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      // Cancelled: nothing to say, the person chose to.
      await signInWithGoogle(db);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  const leave = () =>
    Alert.alert('Sair da conta?', 'Seus carros e o histórico continuam neste aparelho.', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Sair',
        style: 'destructive',
        onPress: async () => {
          setError(null);
          try {
            await signOut(db);
          } catch (e) {
            setError(e);
          }
        },
      },
    ]);

  if (account.status === 'signed-in') {
    return (
      <Screen
        scroll
        footer={
          <>
            <FormError error={error} />
            <Button
              variant="secondary"
              label="Sincronizar agora"
              loading={sync.state === 'syncing'}
              onPress={syncNow}
            />
            <Button variant="quiet" label="Sair da conta" onPress={leave} />
          </>
        }
      >
        <Section title="Conta">
          <View style={styles.body}>
            <AppText>Conectado como {account.email}.</AppText>
            <AppText color="inkMuted" accessibilityLiveRegion="polite">
              {syncLine(sync)}
            </AppText>
          </View>
        </Section>
      </Screen>
    );
  }

  return (
    <Screen
      scroll
      footer={
        <>
          <FormError error={error} />
          <GoogleButton loading={busy} onPress={signIn} />
        </>
      }
    >
      <Section title="Conta">
        <View style={styles.body}>
          <AppText>
            Entre com sua conta Google para guardar uma cópia dos seus dados na nuvem, protegida com
            criptografia, e usar em outro celular.
          </AppText>
          <AppText color="inkMuted">
            É opcional. Sem conta, tudo continua só neste aparelho.
          </AppText>
        </View>
      </Section>
    </Screen>
  );
}

function syncLine(sync: SyncStatus): string {
  if (sync.state === 'syncing') return 'Sincronizando…';
  if (sync.state === 'failed')
    return 'Não foi possível sincronizar agora. O app tenta de novo sozinho.';
  if (!sync.lastSyncAt) return 'Seus dados ainda não foram para a nuvem.';
  return `Dados na nuvem: sincronizado ${formatMoment(new Date(sync.lastSyncAt), new Date())}.`;
}

const styles = StyleSheet.create({
  body: { gap: space.l },
});
