# src/domain: regras puras

Só funções puras em TypeScript: sem React, React Native, Expo ou banco. Quem chama passa `today`; apenas `todayISO(now?)` lê o relógio.

- **Datas** são `ISODate` (`'YYYY-MM-DD'`, dia de calendário local, sem hora). Aritmética de calendário só pelas funções de `dates.ts`, que trabalham em meia-noite UTC para o horário de verão não somar nem perder dia. Comparar `ISODate` como string é válido.
- **Vencimento é derivado** por `computeDue`, nunca gravado no banco: vale o que vier primeiro entre tempo e km.
- **Semáforo** em `urgencyOf`: crítico com ≤ 15 dias ou ≤ 500 km; atenção com ≤ 45 dias ou ≤ 1.500 km. Mudou um limite? Atualize também a seção 3 do doc de decisões.
- **Projeção de KM**: usa o chip mensal até existirem ≥ 2 leituras nos últimos 90 dias, com ≥ 14 dias entre a primeira e a última; daí em diante, regressão linear, nunca negativa.
- **Unidades**: dinheiro em centavos inteiros; km inteiro, com teto `MAX_KM`.
- **Texto para o usuário** sai daqui (`format.ts`, `READING_ERRORS`, `vehicleStatus`) em pt-BR, com singular e plural certos. Números sempre por `Intl` pt-BR (`46.250 km`, `R$ 1.234,56`).
- **Parsing** (`parse.ts`) aceita o que os teclados Android enviam (ponto como decimal em `parseBRL`) e devolve `null` em vez de lançar erro.
- **Erros**: só `ValidationError` carrega mensagem que pode ir para a tela (em pt-BR).
- Arquivo novo é exportado em `index.ts`; o resto do app importa de `@/domain`.

## Testes

Um arquivo por módulo em `__tests__/`, sempre com `today` fixo, nunca a data real. Casos de borda obrigatórios: fim de mês e ano bissexto (`addMonths`), valores exatamente nos limites do semáforo, leituras no mesmo dia, nenhuma leitura e taxa zero.
