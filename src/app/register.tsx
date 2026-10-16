import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useDb } from '@/db/provider';
import { itemsQuery, OdometerError, readingsQuery, registerMaintenance, vehicleQuery } from '@/db/repo';
import { addDays, MAX_KM, parseBRDate, parseBRL, parseIntBR, projectOdometer, READING_ERRORS, todayISO } from '@/domain';
import { Button, ChipGroup, FormError, Screen, Section, TextField, space } from '@/ui';

const DATE_OPTIONS = [
  { label: 'Hoje', value: 'today' },
  { label: 'Ontem', value: 'yesterday' },
  { label: 'Outra data', value: 'other' },
] as const;

type Errors = Partial<Record<'km' | 'date' | 'cost', string>>;

export default function Register() {
  const db = useDb();
  const { itemId } = useLocalSearchParams<{ itemId: string }>();
  // Read once: the form only needs starting values, not live updates.
  const [start] = useState(() => {
    const vehicle = vehicleQuery(db).all()[0];
    const item = vehicle && itemsQuery(db, vehicle.id).all().find((i) => i.id === itemId);
    if (!vehicle || !item) return null;
    const km = projectOdometer(readingsQuery(db, vehicle.id).all(), vehicle.monthlyKmEstimate, todayISO());
    return { vehicleId: vehicle.id, item, km };
  });
  const [km, setKm] = useState(start ? String(start.km) : '');
  const [dateChoice, setDateChoice] = useState<(typeof DATE_OPTIONS)[number]['value']>('today');
  const [otherDate, setOtherDate] = useState('');
  const [cost, setCost] = useState('');
  const [brandSpec, setBrandSpec] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [saveError, setSaveError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);

  if (!start) return <Redirect href="/" />;

  const save = async () => {
    if (saving) return;
    const today = todayISO();
    const kmValue = parseIntBR(km);
    const performedAt =
      dateChoice === 'today' ? today : dateChoice === 'yesterday' ? addDays(today, -1) : parseBRDate(otherDate, today);
    const costCents = cost.trim() ? parseBRL(cost) : null;
    const next: Errors = {
      km:
        kmValue === null
          ? 'Digite o KM do painel usando só números.'
          : kmValue > MAX_KM
            ? 'Confira o KM: o valor parece alto demais.'
            : undefined,
      date: performedAt === null ? 'Use uma data até hoje, no formato DD/MM/AAAA.' : undefined,
      cost: cost.trim() && costCents === null ? 'Digite o valor em reais, por exemplo 150,00.' : undefined,
    };
    setErrors(next);
    setSaveError(null);
    if (kmValue === null || next.km || performedAt === null || next.cost) return;
    setSaving(true);
    try {
      await registerMaintenance(db, {
        vehicleId: start.vehicleId,
        itemId: start.item.id,
        performedAt,
        km: kmValue,
        costCents,
        brandSpec,
      });
      router.back(); // stays "saving" while the sheet closes
    } catch (e) {
      setSaving(false);
      if (!(e instanceof OdometerError)) return setSaveError(e);
      // Fixing an earlier reading discards data, so it only happens in Ajustar KM, after a confirmation.
      const fix = e.check === 'below_previous' ? ' Se o KM salvo antes estava errado, corrija em Ajustar KM.' : '';
      setErrors({ km: READING_ERRORS[e.check] + fix });
    }
  };

  return (
    <Screen
      scroll
      footer={
        <>
          <FormError error={saveError} />
          <Button label="Registrar troca" loading={saving} onPress={save} />
        </>
      }
    >
      <Section title={start.item.name}>
        <View style={styles.fields}>
          <TextField
            label="KM no momento da troca"
            suffix="km"
            keyboardType="number-pad"
            selectTextOnFocus
            maxLength={9}
            value={km}
            onChangeText={setKm}
            error={errors.km}
            hint={km === String(start.km) ? 'Valor estimado. Confira no painel do carro.' : null}
          />
          <ChipGroup label="Data da troca" options={DATE_OPTIONS} value={dateChoice} onChange={setDateChoice} />
          {dateChoice === 'other' ? (
            <TextField
              label="Data (DD/MM/AAAA)"
              keyboardType="numbers-and-punctuation"
              value={otherDate}
              onChangeText={setOtherDate}
              error={errors.date}
            />
          ) : null}
          <TextField
            label="Custo (opcional)"
            prefix="R$"
            keyboardType="decimal-pad"
            value={cost}
            onChangeText={setCost}
            error={errors.cost}
          />
          <TextField
            label="Marca ou especificação (opcional)"
            placeholder="Ex.: Mobil 5W-30 sintético"
            value={brandSpec}
            onChangeText={setBrandSpec}
          />
        </View>
      </Section>
    </Screen>
  );
}

const styles = StyleSheet.create({
  fields: { gap: space.xl },
});
