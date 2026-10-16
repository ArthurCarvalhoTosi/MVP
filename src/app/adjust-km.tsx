import { Redirect, router } from 'expo-router';
import { useState } from 'react';
import { Alert } from 'react-native';
import { useDb } from '@/db/provider';
import { addOdometerReading, OdometerError, readingsQuery, vehicleQuery } from '@/db/repo';
import { MAX_KM, parseIntBR, projectOdometer, READING_ERRORS, todayISO } from '@/domain';
import { Button, FormError, Screen, Section, TextField } from '@/ui';

export default function AdjustKm() {
  const db = useDb();
  // Read once: the form only needs starting values, not live updates.
  const [start] = useState(() => {
    const vehicle = vehicleQuery(db).all()[0];
    if (!vehicle) return null;
    const km = projectOdometer(readingsQuery(db, vehicle.id).all(), vehicle.monthlyKmEstimate, todayISO());
    return { vehicleId: vehicle.id, km };
  });
  const [km, setKm] = useState(start ? String(start.km) : '');
  const [kmError, setKmError] = useState<string>();
  const [saveError, setSaveError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);

  if (!start) return <Redirect href="/" />;

  const save = async (correct: boolean) => {
    if (saving) return;
    const value = parseIntBR(km);
    const error =
      value === null
        ? 'Digite o KM do painel usando só números.'
        : value > MAX_KM
          ? 'Confira o KM: o valor parece alto demais.'
          : undefined;
    setKmError(error);
    setSaveError(null);
    if (value === null || error) return;
    setSaving(true);
    try {
      await addOdometerReading(db, start.vehicleId, value, todayISO(), 'adjust', { correct });
      router.back(); // stays "saving" while the sheet closes
    } catch (e) {
      setSaving(false);
      if (!(e instanceof OdometerError)) return setSaveError(e);
      if (e.check !== 'below_previous') return setKmError(READING_ERRORS[e.check]);
      // The panel is the source of truth: a lower number means an earlier reading was wrong.
      Alert.alert(
        'Corrigir o KM?',
        'Esse valor é menor que um KM registrado antes. Se o painel mostra este número, as leituras maiores serão descartadas e as próximas trocas recalculadas.',
        [
          { text: 'Cancelar', style: 'cancel' },
          { text: 'Corrigir KM', style: 'destructive', onPress: () => save(true) },
        ],
      );
    }
  };

  return (
    <Screen
      scroll
      footer={
        <>
          <FormError error={saveError} />
          <Button label="Salvar KM" loading={saving} onPress={() => save(false)} />
        </>
      }
    >
      <Section title="Ajustar KM">
        <TextField
          label="KM no painel agora"
          suffix="km"
          keyboardType="number-pad"
          selectTextOnFocus
          maxLength={9}
          value={km}
          onChangeText={setKm}
          error={kmError}
          hint={km === String(start.km) ? 'Valor estimado. Confira no painel do carro.' : null}
        />
      </Section>
    </Screen>
  );
}
