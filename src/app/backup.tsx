import { router } from 'expo-router';
import * as Sharing from 'expo-sharing';
import type { File } from 'expo-file-system';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { createBackupFile, MIN_PASSWORD } from '@/backup';
import { useDb } from '@/db/provider';
import { todayISO } from '@/domain';
import { AppText, Button, FormError, Screen, Section, TextField, space } from '@/ui';

type Errors = Partial<Record<'password' | 'confirm', string>>;

export default function Backup() {
  const db = useDb();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const create = async () => {
    if (busy) return;
    const next: Errors = {
      password:
        password.length >= MIN_PASSWORD ? undefined : `Use pelo menos ${MIN_PASSWORD} caracteres.`,
      confirm: confirm === password ? undefined : 'As duas senhas não são iguais.',
    };
    setErrors(next);
    setError(null);
    if (next.password || next.confirm) return;
    setBusy(true);
    let file: File | undefined;
    try {
      file = await createBackupFile(db, password, todayISO());
      await Sharing.shareAsync(file.uri, {
        mimeType: 'application/octet-stream',
        dialogTitle: 'Salvar backup',
      });
      router.back();
    } catch (e) {
      setError(e);
    } finally {
      // Encrypted, but no reason to keep a copy around once it was handed over.
      try {
        if (file?.exists) file.delete();
      } catch {
        // The system clears the cache folder.
      }
      setBusy(false);
    }
  };

  return (
    <Screen
      scroll
      footer={
        <>
          <FormError error={error} />
          {busy ? (
            <AppText color="inkMuted">
              Protegendo o arquivo com a senha. Isso leva alguns segundos.
            </AppText>
          ) : null}
          <Button label="Criar backup" loading={busy} onPress={create} />
        </>
      }
    >
      <Section title="Fazer backup">
        <View style={styles.body}>
          <AppText>
            Guarda carros, trocas e fotos num arquivo protegido por senha. Use para passar seus
            dados para outro aparelho.
          </AppText>
          <TextField
            label="Senha do backup"
            secure
            value={password}
            onChangeText={setPassword}
            error={errors.password}
          />
          <TextField
            label="Repita a senha"
            secure
            value={confirm}
            onChangeText={setConfirm}
            error={errors.confirm}
            hint="Sem a senha, o backup não abre e não há como recuperá-la. Anote num lugar seguro."
          />
        </View>
      </Section>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { gap: space.l },
});
