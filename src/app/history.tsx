import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { Redirect, router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useDb } from '@/db/provider';
import { logsQuery, vehicleQuery } from '@/db/repo';
import { formatBRL, formatDate, formatKm, todayISO } from '@/domain';
import { AppText, Button, Screen, Section, space, useTheme } from '@/ui';

export default function History() {
  const db = useDb();
  const { c } = useTheme();
  const [vehicle] = useState(() => vehicleQuery(db).all()[0]);
  const logs = useLiveQuery(logsQuery(db, vehicle?.id ?? ''), [vehicle?.id]);

  if (!vehicle) return <Redirect href="/" />;
  if (logs.error) throw logs.error;
  if (!logs.updatedAt) return null;

  if (logs.data.length === 0) {
    return (
      <Screen>
        <View style={styles.empty}>
          <AppText>Nenhuma troca registrada ainda. Quando você registrar a primeira, ela aparece aqui.</AppText>
          <Button variant="secondary" label="Voltar para a garagem" onPress={() => router.dismissTo('/')} />
        </View>
      </Screen>
    );
  }

  const total = logs.data.reduce((sum, l) => sum + (l.costCents ?? 0), 0);
  const count = logs.data.length;

  return (
    <Screen scroll>
      <View style={styles.total} accessible>
        <AppText variant="caption" color="inkMuted">
          Total gasto em manutenção
        </AppText>
        <AppText variant="number">{formatBRL(total)}</AppText>
        <AppText color="inkMuted">{count === 1 ? '1 troca registrada' : `${count} trocas registradas`}</AppText>
      </View>

      <Section title="Trocas">
        {logs.data.map((log) => {
          // createdAt is a UTC timestamp; compare its local calendar day with the service date.
          const registeredOn = todayISO(new Date(log.createdAt));
          return (
            <View key={log.id} accessible style={[styles.row, { borderBottomColor: c.line }]}>
              <AppText variant="bodyStrong">{log.itemName ?? 'Manutenção'}</AppText>
              <AppText>{`${formatDate(log.performedAt)} · ${formatKm(log.km)}`}</AppText>
              {log.costCents != null ? <AppText variant="number">{formatBRL(log.costCents)}</AppText> : null}
              {log.brandSpec ? <AppText color="inkMuted">{log.brandSpec}</AppText> : null}
              {registeredOn !== log.performedAt ? (
                <AppText variant="caption" color="inkMuted">
                  {`Registrado em ${formatDate(registeredOn)}`}
                </AppText>
              ) : null}
            </View>
          );
        })}
      </Section>
    </Screen>
  );
}

const styles = StyleSheet.create({
  empty: { gap: space.xl },
  total: { gap: space.xs, marginBottom: space.xxl },
  row: { gap: space.xs, paddingVertical: space.m, borderBottomWidth: 1 },
});
