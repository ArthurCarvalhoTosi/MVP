import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { AccessibilityInfo, Alert, Platform, StyleSheet, View } from 'react-native';
import { useDb } from '@/db/provider';
import { allItemsQuery, allReadingsQuery, setSnooze, vehiclesQuery } from '@/db/repo';
import { addDays, dueLabel, formatDate, pendingByVehicle, SNOOZE_DAYS, todayISO } from '@/domain';
import { sendTestDigest } from '@/notifications/scheduler';
import { AppText, Button, FormError, ItemRow, Screen, Section, space } from '@/ui';

/** Everything the Saturday reminder is about, across all cars. Also where the reminders open. */
export default function Checkup() {
  const db = useDb();
  // Set when Adiar 15 dias was tapped on the notification itself.
  const { snoozed } = useLocalSearchParams<{ snoozed?: string }>();
  const cars = useLiveQuery(vehiclesQuery(db));
  const items = useLiveQuery(allItemsQuery(db));
  const readings = useLiveQuery(allReadingsQuery(db));
  const [today] = useState(todayISO);
  const [snoozedId, setSnoozedId] = useState(snoozed ?? null);
  const [error, setError] = useState<unknown>(null);

  const snoozedItem = items.data.find((i) => i.id === snoozedId);
  const notice = snoozedItem?.snoozedUntil
    ? `${snoozedItem.name}: lembrete adiado até ${formatDate(snoozedItem.snoozedUntil)}.`
    : null;

  // accessibilityLiveRegion is Android-only; VoiceOver needs an explicit announcement.
  useEffect(() => {
    if (notice && Platform.OS === 'ios') AccessibilityInfo.announceForAccessibility(notice);
  }, [notice]);

  const failed = cars.error ?? items.error ?? readings.error;
  if (failed) throw failed;
  if (!cars.updatedAt || !items.updatedAt || !readings.updatedAt) return null;

  const groups = pendingByVehicle(cars.data, items.data, readings.data, today);
  const register = (itemId: string) => router.push({ pathname: '/register', params: { itemId } });
  const snooze = async (itemId: string) => {
    setError(null);
    try {
      await setSnooze(db, itemId, addDays(todayISO(), SNOOZE_DAYS));
      setSnoozedId(itemId);
    } catch (e) {
      setError(e);
    }
  };
  const test = async () => {
    const sent = await sendTestDigest().catch(() => false);
    Alert.alert(
      'Lembrete de teste',
      sent ? 'Chega em 10 segundos. Feche o app para testar a abertura pelo lembrete.' : 'Nada pendente para testar.',
    );
  };

  return (
    <Screen
      scroll
      footer={
        notice || error ? (
          <>
            {notice ? <AppText accessibilityLiveRegion="polite">{notice}</AppText> : null}
            <FormError error={error} />
          </>
        ) : undefined
      }
    >
      {groups.length === 0 ? (
        <View style={styles.block}>
          <AppText variant="lead">Nenhum lembrete para esta semana.</AppText>
          <AppText color="inkMuted">
            Quando uma troca estiver perto de vencer, ela aparece aqui e no lembrete de sábado, às 9h.
          </AppText>
        </View>
      ) : (
        groups.map(({ vehicle, entries }) => (
          <Section key={vehicle.id} title={vehicle.nickname}>
            <View>
              {entries.map(({ item, due }) => {
                const label = dueLabel(due);
                return (
                  <ItemRow
                    key={item.id}
                    name={item.name}
                    urgency={due.urgency}
                    primary={label.primary}
                    secondary={label.secondary}
                    onPress={() => register(item.id)}
                    actions={[
                      { label: 'Registrar troca', onPress: () => register(item.id) },
                      { label: 'Adiar 15 dias', onPress: () => snooze(item.id) },
                    ]}
                  />
                );
              })}
            </View>
          </Section>
        ))
      )}
      {/* Lets a tester see a reminder without waiting for Saturday; never in a release build. */}
      {__DEV__ ? (
        <View style={styles.start}>
          <Button variant="quiet" label="Testar lembrete (desenvolvimento)" onPress={test} />
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  block: { gap: space.s, marginBottom: space.xxl },
  start: { alignItems: 'flex-start' },
});
