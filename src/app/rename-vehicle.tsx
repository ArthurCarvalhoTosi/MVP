import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useDb } from '@/db/provider';
import { renameVehicle, vehiclesQuery } from '@/db/repo';
import { Button, FormError, Screen, Section, TextField, space } from '@/ui';

export default function RenameVehicle() {
  const db = useDb();
  const { vehicleId } = useLocalSearchParams<{ vehicleId: string }>();
  // Read once: the form only needs the starting name.
  const [vehicle] = useState(() => vehiclesQuery(db).all().find((v) => v.id === vehicleId));
  const [nickname, setNickname] = useState(vehicle?.nickname ?? '');
  const [error, setError] = useState<string>();
  const [saveError, setSaveError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);

  if (!vehicle) return <Redirect href="/" />;

  const save = async () => {
    if (saving) return;
    const next = nickname.trim() ? undefined : 'Digite um nome para o carro.';
    setError(next);
    setSaveError(null);
    if (next) return;
    setSaving(true);
    try {
      await renameVehicle(db, vehicle.id, nickname);
      router.back(); // stays "saving" while the sheet closes
    } catch (e) {
      setSaving(false);
      setSaveError(e);
    }
  };

  return (
    // Button inline, not in the footer: a pinned footer falls below the fold at the half-height detent.
    <Screen scroll>
      <Section title="Renomear carro">
        <View style={styles.body}>
          <TextField
            label="Como você chama o carro?"
            placeholder="Meu Sandero 2018"
            value={nickname}
            onChangeText={setNickname}
            error={error}
          />
          <FormError error={saveError} />
          <Button label="Salvar nome" loading={saving} onPress={save} />
        </View>
      </Section>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { gap: space.l },
});
