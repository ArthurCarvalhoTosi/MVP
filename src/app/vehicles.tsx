import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';
import { deleteRemovedPhotos } from '@/attachments';
import { useDb } from '@/db/provider';
import {
  allItemsQuery,
  allReadingsQuery,
  removeVehicle,
  selectedVehicleIdQuery,
  selectVehicle,
  vehiclesQuery,
} from '@/db/repo';
import { buildFeed, formatKm, projectOdometer, todayISO, vehicleStatus } from '@/domain';
import { Button, FormError, Icon, ItemRow, Screen, Section, useTheme } from '@/ui';

export default function Vehicles() {
  const db = useDb();
  const { c } = useTheme();
  const cars = useLiveQuery(vehiclesQuery(db));
  const selected = useLiveQuery(selectedVehicleIdQuery(db));
  const items = useLiveQuery(allItemsQuery(db));
  const readings = useLiveQuery(allReadingsQuery(db));
  const [today] = useState(todayISO);
  const [error, setError] = useState<unknown>(null);

  const failed = cars.error ?? selected.error ?? items.error ?? readings.error;
  if (failed) throw failed;
  if (!cars.updatedAt || !selected.updatedAt || !items.updatedAt || !readings.updatedAt) return null;

  // Same fallback as the dashboard, so the check mark is on the car it shows.
  const current = cars.data.find((v) => v.id === selected.data[0]?.value) ?? cars.data[0];

  const choose = async (vehicleId: string) => {
    setError(null);
    try {
      await selectVehicle(db, vehicleId);
      router.back();
    } catch (e) {
      setError(e);
    }
  };

  const remove = (vehicle: { id: string; nickname: string }) => {
    const last = cars.data.length === 1;
    Alert.alert(
      `Remover ${vehicle.nickname}?`,
      'O histórico deste carro será apagado deste aparelho. Isso não pode ser desfeito.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Remover',
          style: 'destructive',
          onPress: async () => {
            setError(null);
            try {
              await removeVehicle(db, vehicle.id);
              deleteRemovedPhotos(db);
              // The dashboard's redirect to onboarding only runs once it's back in focus.
              if (last) router.back();
            } catch (e) {
              setError(e);
            }
          },
        },
      ],
    );
  };

  return (
    // Actions sit inline after the list: a pinned footer falls below the fold at the half-height detent.
    <Screen scroll>
      <Section title="Seus carros">
        {cars.data.map((v) => {
          const carReadings = readings.data.filter((r) => r.vehicleId === v.id);
          const feed = buildFeed(
            items.data.filter((i) => i.vehicleId === v.id),
            carReadings,
            v.monthlyKmEstimate,
            today,
          );
          const status = vehicleStatus(feed);
          return (
            <ItemRow
              key={v.id}
              name={v.nickname}
              urgency={status.urgency}
              primary={status.label}
              secondary={formatKm(projectOdometer(carReadings, v.monthlyKmEstimate, today))}
              selected={v.id === current?.id}
              onPress={() => choose(v.id)}
              end={
                <View style={styles.actions}>
                  <Pressable
                    // Replace, not push: on iOS a pushed screen would open underneath this sheet.
                    onPress={() => router.replace({ pathname: '/rename-vehicle', params: { vehicleId: v.id } })}
                    accessibilityRole="button"
                    accessibilityLabel={`Renomear ${v.nickname}`}
                    style={({ pressed }) => [styles.action, pressed && { backgroundColor: c.line }]}
                  >
                    <Icon name="pencil" size={24} color={c.inkMuted} />
                  </Pressable>
                  <Pressable
                    onPress={() => remove(v)}
                    accessibilityRole="button"
                    accessibilityLabel={`Remover ${v.nickname}`}
                    style={({ pressed }) => [styles.action, pressed && { backgroundColor: c.line }]}
                  >
                    <Icon name="trash-can-outline" size={24} color={c.inkMuted} />
                  </Pressable>
                </View>
              }
            />
          );
        })}
      </Section>
      <FormError error={error} />
      {/* Replace, not push: on iOS a pushed screen would open underneath this sheet. */}
      <Button variant="secondary" label="Adicionar carro" onPress={() => router.replace('/onboarding')} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row' },
  action: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
});
