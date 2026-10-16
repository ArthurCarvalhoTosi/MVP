import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { Alert, View } from 'react-native';
import { AppText, Button, Screen, space } from '@/ui';
import { DatabaseKeyError, EncryptionUnavailableError, openDatabase, resetDatabase, type Db } from './client';

const DbContext = createContext<Db | null>(null);

// Once per process: two concurrent opens on first launch could each generate a different key.
// A failed open is forgotten so a retry opens again.
let opening: Promise<Db> | undefined;

function open(): Promise<Db> {
  return (opening ??= openDatabase().catch((error: unknown) => {
    opening = undefined;
    throw error;
  }));
}

async function resetAndOpen(): Promise<Db> {
  await resetDatabase();
  opening = undefined;
  return open();
}

const KEY_MESSAGE =
  'Não foi possível abrir seus dados neste aparelho porque a chave de segurança deles não foi encontrada. ' +
  'Isso pode acontecer depois de restaurar um backup em outro aparelho.';
const RESET_CONFIRM =
  'Os registros salvos neste aparelho não podem ser lidos sem a chave original e serão apagados. ' +
  'Isso não pode ser desfeito.';
// Raw errors are SQLite/Drizzle English text and may say too much; never shown.
const GENERIC_MESSAGE = 'Não foi possível abrir seus dados. Feche e abra o app de novo.';

type State = { db: Db } | { error: unknown } | null;

export function DatabaseProvider({ children, onSettled }: { children: ReactNode; onSettled?: () => void }) {
  const [state, setState] = useState<State>(null);
  const [resetting, setResetting] = useState(false);

  useEffect(() => {
    open().then(
      (db) => {
        onSettled?.();
        setState({ db });
      },
      (error: unknown) => {
        onSettled?.();
        setState({ error });
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- open once per mount; re-running on a new onSettled identity would reopen the DB
  }, []);

  if (!state) return null; // the root layout keeps the splash screen up until onSettled
  if ('db' in state) return <DbContext.Provider value={state.db}>{children}</DbContext.Provider>;

  const { error } = state;
  const confirmReset = () =>
    Alert.alert('Apagar dados?', RESET_CONFIRM, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Apagar',
        style: 'destructive',
        onPress: () => {
          setResetting(true);
          resetAndOpen()
            .then(
              (db) => setState({ db }),
              (e: unknown) => setState({ error: e }),
            )
            .finally(() => setResetting(false));
        },
      },
    ]);

  return (
    <Screen>
      <View style={{ flex: 1, justifyContent: 'center', gap: space.l }}>
        {error instanceof DatabaseKeyError ? (
          <>
            <AppText variant="lead">{KEY_MESSAGE}</AppText>
            <AppText>Para continuar usando o app, apague os dados antigos e comece de novo.</AppText>
            <Button
              label="Apagar dados e começar de novo"
              variant="secondary"
              loading={resetting}
              onPress={confirmReset}
            />
          </>
        ) : (
          <AppText variant="lead">
            {error instanceof EncryptionUnavailableError ? error.message : GENERIC_MESSAGE}
          </AppText>
        )}
      </View>
    </Screen>
  );
}

export function useDb(): Db {
  const db = useContext(DbContext);
  if (!db) throw new Error('useDb must be used inside <DatabaseProvider>');
  return db;
}
