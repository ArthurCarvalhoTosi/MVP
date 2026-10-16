# Garagem

App de manutenção preventiva de carros (Expo + React Native, pt-BR). Decisões de produto e arquitetura em [decisoes_projeto_manutencao_veicular.md](decisoes_projeto_manutencao_veicular.md).

## Rodar

O banco local é cifrado com SQLCipher, que exige build nativo — **o Expo Go não funciona**.

```bash
npm install
npx expo run:android   # ou: npx expo run:ios (macOS)
```

Alternativa sem toolchain local: `eas build --profile development`.

## Testar

```bash
npm test            # Jest: domínio, banco (sql.js + migrations reais), componentes e telas
npm run typecheck
```

Ambos devem passar antes de todo commit.

## Banco

Schema em `src/db/schema.ts`. Depois de alterá-lo:

```bash
npm run db:generate   # gera a migration em drizzle/ (não editar à mão)
```

## Estrutura

| Pasta | Conteúdo |
|---|---|
| `src/domain` | Regras puras (projeção de KM, vencimentos, semáforo, formatação) |
| `src/db` | Schema, abertura cifrada, repositório |
| `src/ui` | Design system (tokens, hodômetro, componentes) |
| `src/app` | Telas (expo-router) |
