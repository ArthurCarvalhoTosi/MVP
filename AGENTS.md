# Garagem: guia para agentes

App de manutenção preventiva de carros (Expo SDK 58 + React Native, interface em pt-BR), 100% local na v0.

Antes de mudar comportamento, leia [decisoes_projeto_manutencao_veicular.md](decisoes_projeto_manutencao_veicular.md): produto, regras de negócio, modelo de dados, segurança e pendências. Ao fechar uma decisão ou entregar um item, atualize esse documento (seção 12) no mesmo trabalho.

## Mapa

| Pasta | O que é | Regras |
|---|---|---|
| `src/domain` | Regras puras: projeção de KM, vencimento, semáforo, presets, formatação e parsing pt-BR | [src/domain/AGENTS.md](src/domain/AGENTS.md) |
| `src/db` | Schema Drizzle, banco cifrado (SQLCipher), repositório | [src/db/AGENTS.md](src/db/AGENTS.md) |
| `src/ui` | Design system: tokens, hodômetro, componentes acessíveis | [src/ui/AGENTS.md](src/ui/AGENTS.md) |
| `src/app` | Telas (expo-router) | seção "Telas" abaixo |
| `src/notifications` | Lembrete de sábado: agendador (expo-notifications), respostas aos toques, pedido de permissão | reagenda tudo a cada abertura e mudança de dados; nunca quebra a tela se a permissão for negada |
| `drizzle/` | Migrations geradas | nunca editar à mão |

Importe pelo alias `@/` (`@/domain`, `@/db/repo`, `@/ui`). `src/domain` não importa nada de fora dele.

## Comandos

```bash
npm test             # Jest: domínio, banco (sql.js + migrations reais), componentes e telas
npm run typecheck
npm run lint         # inclui as regras do React Compiler
npm run db:generate  # depois de mudar src/db/schema.ts
npx expo run:android # dev build; o Expo Go não funciona (SQLCipher exige build nativo)
```

Os três primeiros passam antes de todo commit. Notas de build no Windows (CMake 3.31.6, caminhos longos) estão no [README.md](README.md).

## Convenções

- Código, comentários, nomes e mensagens de commit em inglês. Tudo que o usuário vê ou ouve (textos, rótulos de acessibilidade, erros) em pt-BR, linguagem simples, sem jargão.
- Commits no padrão Conventional Commits com o escopo da camada: `feat(domain): …`, `fix(app): …`, `docs: …`, `chore: …`.
- Comentários explicam o porquê, não o quê. Um atalho consciente leva `// shortcut:` dizendo o limite e quando resolver.
- Nenhuma lógica não trivial entra sem teste. Sem snapshots.
- React Compiler ligado: não use `useMemo`, `useCallback` ou `React.memo` para desempenho.

## Telas (`src/app`)

- Todo arquivo em `src/app` vira rota, então os testes das telas ficam em `src/__tests__/app` e usam os mocks de `src/test-utils/screens.tsx` (banco sql.js com migrations reais, router e `useLiveQuery` falsos, `seedVehicle`).
- Leitura reativa com `useLiveQuery(<query do repo>)`; escrita só pelas funções de `src/db/repo.ts`.
- "Hoje" vem de `todayISO()` no momento da ação; o dashboard o atualiza quando o app volta ao primeiro plano.
- Formulários: ignoram toque duplo (`if (saving) return`), validam com o parsing de `@/domain` e mostram falhas com `<FormError>`. Só a mensagem de `ValidationError` aparece; erro bruto nunca chega à tela.
- Sheets (`formSheet`) desenham o próprio título: o cabeçalho nativo não é confiável dentro delas no Android.
- Ação primária na metade de baixo da tela (`footer` do `Screen`), ao alcance do polegar.
