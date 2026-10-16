import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { Text, View } from 'react-native';
import { DatabaseKeyError, openDatabase, type Db } from './client';

const DbContext = createContext<Db | null>(null);

// Once per process: two concurrent opens on first launch could each generate a different key.
let opening: Promise<Db> | undefined;

type State = { db: Db } | { error: unknown } | null;

export function DatabaseProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>(null);

  useEffect(() => {
    (opening ??= openDatabase()).then(
      (db) => setState({ db }),
      (error: unknown) => setState({ error }),
    );
  }, []);

  if (!state) return null; // root layout keeps the splash screen up meanwhile
  if ('error' in state) {
    const { error } = state;
    return (
      <View style={{ flex: 1, justifyContent: 'center', padding: 24 }}>
        {error instanceof DatabaseKeyError ? (
          <Text>Não foi possível abrir seus dados neste aparelho. A chave de segurança não foi encontrada.</Text>
        ) : (
          <Text>
            Não foi possível abrir seus dados. {error instanceof Error ? error.message : String(error)}
          </Text>
        )}
      </View>
    );
  }
  return <DbContext.Provider value={state.db}>{children}</DbContext.Provider>;
}

export function useDb(): Db {
  const db = useContext(DbContext);
  if (!db) throw new Error('useDb must be used inside <DatabaseProvider>');
  return db;
}
