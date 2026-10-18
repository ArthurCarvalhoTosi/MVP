import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import { readBackupFile, restoreBackup } from '@/backup';
import { useDb } from '@/db/provider';
import { vehiclesQuery } from '@/db/repo';
import { AppText, Button, FormError, Screen, Section, TextField, space } from '@/ui';

type Errors = Partial<Record<'file' | 'password', string>>;

export default function Restore() {
  const db = useDb();
  const [picked, setPicked] = useState<{ uri: string; name: string } | null>(null);
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const pick = async () => {
    setError(null);
    try {
      // Any type: Android rarely knows a mime type for .bkp files.
      const result = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true });
      if (result.canceled) return;
      const [asset] = result.assets;
      setPicked({ uri: asset.uri, name: asset.name });
      setErrors((e) => ({ ...e, file: undefined }));
    } catch (e) {
      setError(e);
    }
  };

  const run = async (file: { uri: string }) => {
    setBusy(true);
    try {
      await restoreBackup(db, await readBackupFile(file.uri, password));
      try {
        new File(file.uri).delete();
      } catch {
        // The picker's copy sits in the cache folder, which the system clears.
      }
      router.dismissTo('/'); // stays busy while the garage opens
    } catch (e) {
      setBusy(false);
      setError(e);
    }
  };

  const restore = () => {
    if (busy) return;
    const next: Errors = {
      file: picked ? undefined : 'Escolha o arquivo do backup.',
      password: password ? undefined : 'Digite a senha do backup.',
    };
    setErrors(next);
    setError(null);
    if (!picked || next.password) return;
    if (vehiclesQuery(db).all().length === 0) return run(picked);
    Alert.alert(
      'Substituir os dados deste aparelho?',
      'Os carros e trocas que estão aqui serão trocados pelos do backup. Isso não pode ser desfeito.',
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Substituir', style: 'destructive', onPress: () => run(picked) },
      ],
    );
  };

  return (
    <Screen
      scroll
      footer={
        <>
          <FormError error={error} />
          {busy ? <AppText color="inkMuted">Abrindo o backup. Isso leva alguns segundos.</AppText> : null}
          <Button label="Restaurar" loading={busy} onPress={restore} />
        </>
      }
    >
      <Section title="Restaurar backup">
        <View style={styles.body}>
          <AppText>Traz os carros, trocas e fotos de um arquivo de backup do Garagem.</AppText>
          <View style={styles.file}>
            <AppText variant="caption" color="inkMuted">
              Arquivo
            </AppText>
            <AppText variant="bodyStrong">{picked ? picked.name : 'Nenhum arquivo escolhido'}</AppText>
            {errors.file ? (
              <AppText variant="caption" color="critical" accessibilityLiveRegion="polite">
                {errors.file}
              </AppText>
            ) : null}
          </View>
          <Button variant="secondary" label={picked ? 'Escolher outro arquivo' : 'Escolher arquivo'} onPress={pick} />
          <TextField label="Senha do backup" secure value={password} onChangeText={setPassword} error={errors.password} />
        </View>
      </Section>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { gap: space.l },
  file: { gap: space.xs },
});
