# src/db: banco local cifrado

SQLite + SQLCipher (`expo-sqlite`) com Drizzle. O banco é a fonte da verdade; as telas leem pelas queries de `repo.ts` e escrevem só pelas funções de escrita dele.

## Schema e migrations

- Mudou `schema.ts`? Rode `npm run db:generate` e inclua a migration gerada em `drizzle/` no mesmo commit. Nunca edite `drizzle/` à mão.
- Toda tabela sincronizável usa `...timestamps` (`created_at`, `updated_at`, `deleted_at`): o sync da v1 depende disso. A exceção é `device_prefs`, estado local do aparelho, nunca sincronizado e apagado de verdade.
- IDs vêm de `uuidv7()` (`id.ts`), gerados no cliente. Dinheiro em centavos; dias de calendário como `ISODate`; instantes em ISO-8601 UTC.
- Não grave nada que possa ser derivado (vencimento, km projetado).

## Repositório (`repo.ts`)

- Exclusão é sempre soft delete (`deletedAt` + `updatedAt`), e toda leitura filtra `isNull(deletedAt)`. Remover um carro marca também as leituras, itens, registros, specs e anexos dele.
- Funções de escrita validam a entrada e lançam `ValidationError` com mensagem pt-BR pronta para a tela; conflito de hodômetro lança `OdometerError`.
- Escrita que toca mais de uma tabela vai dentro de `db.transaction`.
- `useLiveQuery` só observa a tabela do `FROM`, não as do `JOIN`. Numa query com `JOIN`, garanta que as escritas relevantes também alterem a tabela principal (veja o comentário acima de `allItemsQuery`).
- Uma leitura de hodômetro nunca fica abaixo de uma anterior nem acima de uma posterior (`checkReading`). Só "Ajustar KM" com `correct` apaga leituras acima do valor real.

## Abertura cifrada (`client.ts`, `provider.tsx`)

Um erro aqui perde os dados do usuário.

- A chave fica no Secure Store e só é salva depois de abrir o arquivo com ela.
- Sem SQLCipher ativo o app se recusa a abrir (falha fechada). Não remova essa checagem.
- Nunca apague nem recrie o arquivo ao falhar; isso só acontece em `resetDatabase()`, depois de confirmação explícita do usuário.
- Nunca registre nem exiba o erro original da abertura: ele pode conter a chave.

## Testes

`createTestDb()` (`test-utils/testDb.ts`) cria um banco sql.js em memória com as migrations reais (sem SQLCipher). Mocke `expo-crypto` como em `__tests__/repo.test.ts`. Cubra validação, rollback de transação, soft delete e ordenação. A abertura cifrada só pode ser validada no aparelho.
