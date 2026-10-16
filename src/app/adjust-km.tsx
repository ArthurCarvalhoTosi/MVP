import { Redirect, router } from 'expo-router';
import { useState } from 'react';
import { AccessibilityInfo, StyleSheet, View } from 'react-native';
import { useDb } from '@/db/provider';
import { addOdometerReading, OdometerError, readingsQuery, vehicleQuery } from '@/db/repo';
import { parseIntBR, projectOdometer, READING_ERRORS, todayISO } from '@/domain';
import { AppText, Button, Screen, Section, TextField, space } from '@/ui';

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
  const [errors, setErrors] = useState<{ km?: string; form?: string }>({});

  if (!start) return <Redirect href="/" />;

  const save = async () => {
    const value = parseIntBR(km);
    if (value === null) return setErrors({ km: 'Digite o KM do painel usando só números.' });
    try {
      await addOdometerReading(db, start.vehicleId, value, todayISO(), 'adjust');
      router.back();
    } catch (e) {
      if (e instanceof OdometerError) return setErrors({ km: READING_ERRORS[e.check] });
      const message = e instanceof Error ? e.message : String(e);
      setErrors({ form: message });
      AccessibilityInfo.announceForAccessibility(message);
    }
  };

  return (
    <Screen
      footer={
        <>
          {errors.form ? <AppText color="critical">{errors.form}</AppText> : null}
          <Button label="Salvar KM" onPress={save} />
        </>
      }
    >
      <Section title="Ajustar KM">
        <View style={styles.field}>
          <TextField
            label="KM no painel agora"
            suffix="km"
            keyboardType="number-pad"
            value={km}
            onChangeText={setKm}
            error={errors.km}
          />
          <AppText variant="caption" color="inkMuted">
            Olhe o hodômetro do painel e digite o valor exato.
          </AppText>
        </View>
      </Section>
    </Screen>
  );
}

const styles = StyleSheet.create({
  field: { gap: space.s },
});
