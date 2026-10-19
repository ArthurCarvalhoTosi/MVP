import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import { useDb } from '@/db/provider';
import { addItem, allItemsQuery, removeItem, updateItem, vehiclesQuery } from '@/db/repo';
import { MAX_KM, parseIntBR, todayISO } from '@/domain';
import { AppText, Button, FormError, Screen, Section, TextField, space } from '@/ui';

// Twenty years: anything longer is a typo, not a maintenance plan.
const MAX_MONTHS = 240;

type Errors = Partial<Record<'name' | 'km' | 'months' | 'form', string>>;

/** Starts tracking a maintenance on car `vehicleId` (outside the presets), or edits item `itemId`. */
export default function Item() {
  const db = useDb();
  const { vehicleId, itemId } = useLocalSearchParams<{ vehicleId?: string; itemId?: string }>();
  // Read once: the form only needs starting values.
  const [start] = useState(() => {
    if (itemId)
      return (
        allItemsQuery(db)
          .all()
          .find((i) => i.id === itemId) ?? null
      );
    const vehicle = vehiclesQuery(db)
      .all()
      .find((v) => v.id === vehicleId);
    return vehicle ? { vehicleId: vehicle.id } : null;
  });
  const item = start && 'id' in start ? start : null;
  const [name, setName] = useState(item?.name ?? '');
  const [km, setKm] = useState(item?.intervalKm != null ? String(item.intervalKm) : '');
  const [months, setMonths] = useState(
    item?.intervalMonths != null ? String(item.intervalMonths) : '',
  );
  const [errors, setErrors] = useState<Errors>({});
  const [saveError, setSaveError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);

  if (!start) return <Redirect href="/" />;

  const save = async () => {
    if (saving) return;
    const intervalKm = interval(km, MAX_KM);
    const intervalMonths = interval(months, MAX_MONTHS);
    const next: Errors = {
      name: name.trim() ? undefined : 'Digite o nome da manutenção.',
      km: typeof intervalKm === 'string' ? intervalKm : undefined,
      months: typeof intervalMonths === 'string' ? intervalMonths : undefined,
      form:
        intervalKm === null && intervalMonths === null
          ? 'Preencha os km, os meses ou os dois.'
          : undefined,
    };
    setErrors(next);
    setSaveError(null);
    // The typeof checks repeat next.km/next.months so TypeScript narrows both to number | null.
    if (
      Object.values(next).some(Boolean) ||
      typeof intervalKm === 'string' ||
      typeof intervalMonths === 'string'
    )
      return;
    setSaving(true);
    try {
      const fields = { name, intervalKm, intervalMonths };
      if (item) await updateItem(db, item.id, fields);
      else await addItem(db, start.vehicleId, { ...fields, templateKey: null }, todayISO());
      router.back(); // stays "saving" while the sheet closes
    } catch (e) {
      setSaving(false);
      setSaveError(e);
    }
  };

  const remove = (it: NonNullable<typeof item>) =>
    Alert.alert(
      `Remover ${it.name}?`,
      'O item sai do painel e dos lembretes. As trocas já registradas continuam no histórico.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Remover',
          style: 'destructive',
          onPress: async () => {
            if (saving) return;
            setSaveError(null);
            setSaving(true);
            try {
              await removeItem(db, it.id);
              router.back();
            } catch (e) {
              setSaving(false);
              setSaveError(e);
            }
          },
        },
      ],
    );

  return (
    <Screen
      scroll
      footer={
        <>
          {errors.form ? <AppText color="critical">{errors.form}</AppText> : null}
          <FormError error={saveError} />
          <Button
            label={item ? 'Salvar alterações' : 'Adicionar'}
            loading={saving}
            onPress={save}
          />
        </>
      }
    >
      <Section title={item ? 'Editar manutenção' : 'Nova manutenção'}>
        <View style={styles.body}>
          <TextField
            label="O que você quer acompanhar?"
            placeholder="Ex.: Fluido de freio"
            value={name}
            onChangeText={setName}
            error={errors.name}
          />
          <TextField
            label="A cada quantos km?"
            suffix="km"
            keyboardType="number-pad"
            maxLength={9}
            value={km}
            onChangeText={setKm}
            error={errors.km}
          />
          <TextField
            label="Ou a cada quantos meses?"
            suffix="meses"
            keyboardType="number-pad"
            maxLength={3}
            value={months}
            onChangeText={setMonths}
            error={errors.months}
          />
          <AppText color="inkMuted">
            {item
              ? 'Preencha um ou os dois: vale o que chegar primeiro. A contagem segue da última troca.'
              : 'Preencha um ou os dois: vale o que chegar primeiro. A contagem começa hoje.'}
          </AppText>
          {item ? (
            <View style={styles.start}>
              <Button
                variant="quiet"
                label="Remover manutenção"
                disabled={saving}
                onPress={() => remove(item)}
              />
            </View>
          ) : null}
        </View>
      </Section>
    </Screen>
  );
}

/** null when left blank, the number when it's a whole number in 1..max, else the error to show. */
function interval(s: string, max: number): number | null | string {
  if (!s.trim()) return null;
  const n = parseIntBR(s);
  if (n === null || n <= 0) return 'Use só números maiores que zero.';
  return n > max ? 'Confira o valor: parece alto demais.' : n;
}

const styles = StyleSheet.create({
  body: { gap: space.l },
  start: { alignItems: 'flex-start' },
});
