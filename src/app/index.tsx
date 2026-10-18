import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { Redirect, router, Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { AppState, Pressable, StyleSheet, View } from 'react-native';
import { useDb } from '@/db/provider';
import {
  itemsQuery,
  readingsQuery,
  selectedVehicleIdQuery,
  specsQuery,
  vehiclesQuery,
} from '@/db/repo';
import type { vehicles } from '@/db/schema';
import {
  buildFeed,
  dueLabel,
  formatPair,
  isProjectionStale,
  projectOdometer,
  todayISO,
} from '@/domain';
import { NotificationPrompt } from '@/notifications/NotificationPrompt';
import {
  AppText,
  Button,
  Icon,
  ItemRow,
  Odometer,
  Screen,
  Section,
  SpecStrip,
  space,
  useTheme,
} from '@/ui';

export default function Dashboard() {
  const db = useDb();
  const cars = useLiveQuery(vehiclesQuery(db));
  const selected = useLiveQuery(selectedVehicleIdQuery(db));
  const failed = cars.error ?? selected.error;
  if (failed) throw failed;
  // First reads still running: [] here doesn't mean "no vehicle" yet.
  if (!cars.updatedAt || !selected.updatedAt) return null;
  // No pref (upgrade) or a removed car: fall back to the oldest.
  const vehicle = cars.data.find((v) => v.id === selected.data[0]?.value) ?? cars.data[0];
  if (!vehicle) return <Redirect href="/onboarding" />;

  return (
    <>
      <Stack.Screen
        options={{
          title: vehicle.nickname,
          headerTitle: () => <CarSwitcher nickname={vehicle.nickname} />,
        }}
      />
      {/* Keyed: useLiveQuery keeps the previous car's data while it reloads, so a fresh mount
          waits for the new car instead of rolling the drums between two cars' numbers. */}
      <Garage key={vehicle.id} vehicle={vehicle} />
    </>
  );
}

function CarSwitcher({ nickname }: { nickname: string }) {
  const { c } = useTheme();
  return (
    <Pressable
      onPress={() => router.push('/vehicles')}
      accessibilityRole="button"
      accessibilityLabel={`Trocar de carro. Atual: ${nickname}`}
      style={({ pressed }) => [styles.switcher, pressed && styles.pressed]}
    >
      <AppText variant="title" numberOfLines={1} style={styles.shrink}>
        {nickname}
      </AppText>
      <Icon name="chevron-down" size={20} color={c.primary} />
    </Pressable>
  );
}

function Garage({ vehicle }: { vehicle: typeof vehicles.$inferSelect }) {
  const db = useDb();
  const readings = useLiveQuery(readingsQuery(db, vehicle.id), [vehicle.id]);
  const items = useLiveQuery(itemsQuery(db, vehicle.id), [vehicle.id]);
  const specs = useLiveQuery(specsQuery(db, vehicle.id), [vehicle.id]);
  const [showOk, setShowOk] = useState(false);
  // State, not computed per render: the compiler would reuse a stale value until the queries change.
  const [today, setToday] = useState(todayISO);

  // The app can sit in the background past midnight; pick up the new day when it comes back.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') setToday(todayISO());
    });
    return () => sub.remove();
  }, []);

  const failed = readings.error ?? items.error ?? specs.error;
  if (failed) throw failed;
  // Wait for real data so the drums don't roll up from zero and the feed doesn't flash "Tudo em dia".
  if (!readings.updatedAt || !items.updatedAt || !specs.updatedAt) return null;

  const feed = buildFeed(items.data, readings.data, vehicle.monthlyKmEstimate, today);
  const needsAttention = [...feed.critical, ...feed.attention];
  const s = specs.data[0];

  const register = (itemId: string) => router.push({ pathname: '/register', params: { itemId } });
  const params = { vehicleId: vehicle.id };
  const row = ({ item, due }: (typeof feed.ok)[number]) => {
    const label = dueLabel(due);
    return (
      <ItemRow
        key={item.id}
        name={item.name}
        urgency={due.urgency}
        primary={label.primary}
        secondary={label.secondary}
        onPress={() => register(item.id)}
        action={{ label: 'Registrar troca', onPress: () => register(item.id) }}
      />
    );
  };

  return (
    <Screen
      scroll
      footer={
        <Button
          variant="secondary"
          label="Ver histórico"
          onPress={() => router.push({ pathname: '/history', params })}
        />
      }
    >
      <View style={styles.block}>
        <Odometer km={projectOdometer(readings.data, vehicle.monthlyKmEstimate, today)} estimated />
        <View style={styles.start}>
          <Button
            variant="quiet"
            label="Ajustar KM"
            onPress={() => router.push({ pathname: '/adjust-km', params })}
          />
        </View>
        {isProjectionStale(readings.data, today) ? (
          <AppText color="inkMuted">
            Faz mais de 30 dias que o KM não é atualizado. Ajuste para melhorar as previsões.
          </AppText>
        ) : null}
      </View>

      <Section title="Cola de bolso">
        <SpecStrip
          items={[
            { key: 'oil', icon: 'oil', label: 'Óleo', value: s?.oilSpec ?? null },
            {
              key: 'tires',
              icon: 'car-tire-alert',
              label: 'Calibragem',
              value: formatPair(s?.tireFrontPsi, s?.tireRearPsi, 'psi'),
            },
            {
              key: 'wipers',
              icon: 'wiper',
              label: 'Palhetas',
              value: formatPair(s?.wiperDriver, s?.wiperPassenger),
            },
            { key: 'battery', icon: 'car-battery', label: 'Bateria', value: s?.battery ?? null },
          ]}
          onEdit={() => router.push({ pathname: '/specs', params })}
        />
        {/* Values from the seed: the user didn't type them, so say where they came from. */}
        {vehicle.modelRef ? (
          <AppText variant="caption" color="inkMuted">
            Valores de referência. Confira no manual do proprietário.
          </AppText>
        ) : null}
      </Section>

      {needsAttention.length > 0 ? (
        <Section title="Precisa de atenção">
          <View>{needsAttention.map(row)}</View>
        </Section>
      ) : (
        <View style={styles.block}>
          <AppText variant="lead">Tudo em dia.</AppText>
          {feed.next ? (
            <AppText color="inkMuted">
              {`Próxima: ${feed.next.item.name}, ${lowerFirst(dueLabel(feed.next.due).primary)}`}
            </AppText>
          ) : null}
        </View>
      )}

      <NotificationPrompt />

      {feed.ok.length > 0 ? (
        <View>
          <View style={styles.start}>
            <Button
              variant="quiet"
              label={`Em dia (${feed.ok.length})`}
              expanded={showOk}
              onPress={() => setShowOk(!showOk)}
            />
          </View>
          {showOk ? feed.ok.map(row) : null}
        </View>
      ) : null}
    </Screen>
  );
}

const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

const styles = StyleSheet.create({
  block: { gap: space.s, marginBottom: space.xxl },
  start: { alignItems: 'flex-start' },
  switcher: { flexDirection: 'row', alignItems: 'center', gap: space.xs, minHeight: 48 },
  shrink: { flexShrink: 1 },
  pressed: { opacity: 0.82 },
});
