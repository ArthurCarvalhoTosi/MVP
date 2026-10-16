import { Redirect, router } from 'expo-router';
import { useState } from 'react';
import { AccessibilityInfo, StyleSheet, View } from 'react-native';
import { useDb } from '@/db/provider';
import { specsQuery, upsertSpecs, vehicleQuery } from '@/db/repo';
import { parseIntBR } from '@/domain';
import { AppText, Button, Screen, Section, TextField, space } from '@/ui';

const PSI_ERROR = 'Digite só números, por exemplo 32.';

export default function Specs() {
  const db = useDb();
  // Read once: the form only needs starting values, not live updates.
  const [start] = useState(() => {
    const vehicle = vehicleQuery(db).all()[0];
    return vehicle ? { vehicleId: vehicle.id, specs: specsQuery(db, vehicle.id).all()[0] } : null;
  });
  const s = start?.specs;
  const [form, setForm] = useState({
    oil: s?.oilSpec ?? '',
    front: s?.tireFrontPsi?.toString() ?? '',
    rear: s?.tireRearPsi?.toString() ?? '',
    wiperDriver: s?.wiperDriver ?? '',
    wiperPassenger: s?.wiperPassenger ?? '',
    battery: s?.battery ?? '',
  });
  const [errors, setErrors] = useState<{ front?: string; rear?: string; form?: string }>({});

  if (!start) return <Redirect href="/" />;

  const bind = (key: keyof typeof form) => ({
    value: form[key],
    onChangeText: (text: string) => setForm({ ...form, [key]: text }),
  });
  const text = (v: string) => v.trim() || null;
  const psi = (v: string) => (v.trim() ? parseIntBR(v) : null);

  const save = async () => {
    const front = psi(form.front);
    const rear = psi(form.rear);
    const next = {
      front: form.front.trim() && front === null ? PSI_ERROR : undefined,
      rear: form.rear.trim() && rear === null ? PSI_ERROR : undefined,
    };
    setErrors(next);
    if (next.front || next.rear) return;
    try {
      await upsertSpecs(db, start.vehicleId, {
        oilSpec: text(form.oil),
        tireFrontPsi: front,
        tireRearPsi: rear,
        wiperDriver: text(form.wiperDriver),
        wiperPassenger: text(form.wiperPassenger),
        battery: text(form.battery),
      });
      router.back();
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setErrors({ form: message });
      AccessibilityInfo.announceForAccessibility(message);
    }
  };

  return (
    <Screen
      scroll
      footer={
        <>
          {errors.form ? <AppText color="critical">{errors.form}</AppText> : null}
          <Button label="Salvar" onPress={save} />
        </>
      }
    >
      <Section title="Cola de bolso">
        <View style={styles.fields}>
          <AppText color="inkMuted">Valores de referência. Confira no manual do proprietário.</AppText>
          <TextField label="Óleo" placeholder="5W-30 sintético" {...bind('oil')} />
          <TextField label="Pneu dianteiro" suffix="psi" keyboardType="number-pad" error={errors.front} {...bind('front')} />
          <TextField label="Pneu traseiro" suffix="psi" keyboardType="number-pad" error={errors.rear} {...bind('rear')} />
          <AppText variant="caption" color="inkMuted">
            A calibragem fica numa etiqueta na porta do motorista ou na tampa do tanque.
          </AppText>
          <TextField label="Palheta do motorista" placeholder='Ex.: 22"' {...bind('wiperDriver')} />
          <TextField label="Palheta do passageiro" placeholder='Ex.: 16"' {...bind('wiperPassenger')} />
          <TextField label="Bateria" placeholder="60 Ah" {...bind('battery')} />
        </View>
      </Section>
    </Screen>
  );
}

const styles = StyleSheet.create({
  fields: { gap: space.l },
});
