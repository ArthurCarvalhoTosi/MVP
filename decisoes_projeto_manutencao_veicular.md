# Resumo de Decisões de Produto: App de Manutenção Veicular (MVP)

Documento consolidado de requisitos, escopo, regras de negócio, UX, arquitetura, dados e segurança definidos para continuidade do desenvolvimento.

**Última revisão:** 2026-10-17

---

## 1. Visão Geral do Produto
* **Proposta:** Aplicativo focado em manutenções preventivas **de carros**, com baixíssimo atrito de entrada, foco em previsibilidade e utilidade prática no dia a dia.
* **Modelo Inicial:** 100% gratuito (foco absoluto em retenção, validação de uso contínuo e engajamento orgânico).
* **Decisão de Escopo:** **Hiper-focado em Carros.**
  * Casa e híbrido descartados (menor dor financeira percebida, diluição de valor).
  * **Motos fora do MVP** (exigem presets próprios — corrente, intervalos de óleo menores — e dobram o trabalho de seed). O modelo de dados mantém `vehicle_type` para permitir inclusão futura.
* **Múltiplos carros:** o usuário pode acompanhar vários carros. O app abre direto no último carro visto (preserva a consulta em 3 segundos); tocar no nome do carro no topo abre "Seus carros", com o status de cada um, "Adicionar carro" (reusa o onboarding) e "Remover" (com confirmação; soft delete do carro e de todos os seus registros). Renomear fica para depois.
* **Sem conta no MVP (v0):** app 100% local. A arquitetura já é preparada para contas e acesso multi-dispositivo na v1 (ver seção 7).
* **Plataforma prioritária:** Android (~80% do mercado BR). iOS sai junto, mas testes de notificação priorizam Android.

---

## 2. Diferenciais Competitivos de Produto

1. **Cola de Bolso (Consulta Rápida em 3 segundos):**
   * Especificações vitais do carro no topo da tela inicial: óleo (ex: *5W-30 Sintético*), calibragem (dianteira/traseira), palhetas, bateria.
   * **Fonte dos dados:** seed curado dos ~40 modelos mais vendidos no Brasil (ranking Fenabrave), em JSON versionado no bundle do app + **preenchimento manual como fallback** (com dica: "confira a etiqueta na porta ou tampa do tanque").
   * O usuário pode sobrescrever qualquer valor do seed.
   * **Aviso legal visível:** "Valores de referência — confira no manual do proprietário."

2. **Projeção de KM (Sem Telemetria Invasiva):**
   * Usuário informa o ritmo mensal aproximado (`< 500 km`, `~1.000 km`, `1.500+ km`) e o hodômetro inicial.
   * Após 2+ leituras reais, o sistema passa a usar a **taxa real observada** (ver seção 4).
   * Ajuste rápido em 1 toque.

3. **Dossiê de Revenda (Valor Financeiro Tangível):**
   * Histórico cronológico de serviços.
   * **v0:** PDF gerado no próprio aparelho. **v1:** link web compartilhável.
   * **Sinais de credibilidade** (o usuário pode digitar qualquer coisa, então o dossiê mostra o critério de confiança ao comprador):
     * "Registrado em" (data de criação) ao lado da data do serviço.
     * Registros retroativos sinalizados.
     * Selo "com comprovante" para registros com foto anexada.

4. **Combate à Fadiga de Notificação:**
   * Resumo semanal agrupado ("Check-up da Semana", sábados às 09h) → toque abre a tela de Check-up.
   * Botões de ação (`[Feito]`, `[Adiar 15 dias]`) **apenas em notificações de item único crítico** (ver seção 6).

---

## 3. Arquitetura de Telas do MVP (3 Telas + 1 Modal)

### Tela 1: Onboarding Flash (< 60 segundos)
* Seleção do modelo (busca no seed) **ou** "Meu carro não está na lista" (preenchimento manual depois).
* Apelido do veículo (ex: *Meu Sandero 2018*) e hodômetro atual.
* Seletor de ritmo mensal médio (chips).
* **Pergunta de uso severo:** "Usa mais na cidade, com trânsito?" → reduz os intervalos dos presets (a maioria dos manuais brasileiros classifica uso urbano como severo).
* Lista de presets pré-marcados:

  | Item | Normal | Severo |
  |---|---|---|
  | Troca de óleo + filtro | 10.000 km / 12 m | 5.000 km / 6 m |
  | Filtro de ar / cabine | 10.000 km / 12 m | 5.000 km / 6 m |
  | Rodízio de pneus | 10.000 km | 10.000 km |
  | Freios (inspeção) | 20.000 km | 10.000 km |
  | Correia dentada | 40.000 km / 48 m | 40.000 km / 48 m |

  *(valores de referência; o seed do modelo pode sobrescrever)*
* **Regra do Marco Zero:** padrão *"Zerar a partir de hoje"*.

### Tela 2: Dashboard Garagem (Feed Operacional)
* **Header:** Odômetro estimado (`~46.250 km`) + `[Ajustar KM]`.
* **Cards de Cola Rápida:** calibragem, óleo, palhetas, bateria.
* **Feed Semáforo (ordenado por urgência):**
  * 🔴 **Crítico:** vencido, ou ≤ 15 dias, ou ≤ 500 km → `[Registrar Troca]` direto.
  * 🟡 **Atenção:** ≤ 45 dias ou ≤ 1.500 km.
  * 🟢 **Em dia:** demais itens, colapsados no rodapé.
* **Estado "tudo verde":** mostrar a próxima coisa que vai acontecer ("Óleo em ~4 meses").
* **Alerta de projeção desatualizada:** sem ajuste de KM há 30+ dias → "Seu KM está certo?".

### Tela 3: Bottom Sheet de Registro (< 10 segundos)
* **KM:** pré-preenchido com o projetado (editável).
* **Data:** padrão "Hoje".
* **Opcionais:** custo (R$), marca/especificação, foto (etiqueta ou nota fiscal).
* Ao salvar: grava leitura de hodômetro + recalcula o próximo vencimento imediatamente.

### Tela 4: Histórico & Dossiê
* Linha do tempo reversa, total financeiro acumulado.
* `[Exportar Dossiê]` → PDF (v0) / Link (v1).
* Fotos **desligadas por padrão** no dossiê (notas fiscais contêm CPF e endereço); usuário liga explicitamente.

---

## 4. Regras de Negócio e Cálculos

Todos os cálculos vivem em `domain/` como **funções puras**, 100% cobertas por testes. **Datas de vencimento são derivadas, nunca gravadas** no banco.

### Projeção do Hodômetro
* **Com < 2 leituras:** taxa = chip mensal escolhido.
$$\text{km\_diario} = \frac{\text{km\_mensal\_estimado}}{30}$$
* **Com ≥ 2 leituras nos últimos 90 dias, espaçadas por ≥ 14 dias:** taxa = regressão linear simples (km/dia) sobre essas leituras, limitada a ≥ 0. Caso contrário, usa o chip. *(O espaçamento mínimo evita taxas ruidosas de leituras próximas sem impedir que a taxa real fique abaixo da estimativa inicial.)*
$$\text{odometro\_projetado} = \text{km\_ultima\_leitura} + (\text{dias\_decorridos} \times \text{km\_diario})$$
* Leituras nunca podem ser menores que a anterior (validação na entrada).

### Previsão de Vencimento
* O que vencer primeiro entre tempo e quilometragem:
$$\text{Vencimento} = \min(\text{baseline\_date} + \text{interval\_months},\ \text{data projetada para baseline\_km} + \text{interval\_km})$$
* Itens com apenas um dos intervalos usam só aquele.
* `snoozed_until` (de "Adiar 15 dias") oculta o item das notificações até a data, mas não altera o vencimento real.

---

## 5. Stack Técnica

| Camada | Escolha |
|---|---|
| App | React Native + **Expo** (TypeScript), EAS Build + OTA Updates |
| Banco local | `expo-sqlite` com **SQLCipher** + **Drizzle ORM** (migrations tipadas) |
| Segredos locais | `expo-secure-store` (Android Keystore / iOS Keychain) |
| Criptografia de arquivos | `react-native-quick-crypto` (AES-256-GCM) |
| Notificações | `expo-notifications` (agendamento 100% local) |
| PDF | `expo-print` (HTML → PDF no aparelho) |
| Backend (v1) | **Supabase**: Auth, Postgres + RLS, Storage, Edge Functions |
| Qualidade | Jest + React Native Testing Library + sql.js; ESLint (`eslint-config-expo`, com regras do React Compiler); TypeScript strict |

*Versões em uso:* Expo SDK 58, React Native 0.88, React 19 (React Compiler ativo), expo-router 58, Drizzle 0.45. Ícones via `expo-symbols` (SF Symbols / Material Symbols) — `@expo/vector-icons` não vem mais no SDK.

### Arquitetura (local-first)

```
┌─────────────── App (Expo) ───────────────┐
│ UI (3 telas + sheet)                     │
│   ↓                                      │
│ domain/  ← funções PURAS, testadas       │
│   projectOdometer(), computeDue(),       │
│   urgency(), buildDigest()               │
│   ↓                                      │
│ SQLite + SQLCipher (fonte da verdade)    │
│   ↓                 ↓                    │
│ NotificationScheduler   SyncAgent (v1)   │
└───────────────────────────┬──────────────┘
                            ↓ (v1, só se logado)
        Supabase: Auth · Postgres+RLS (blobs cifrados) · Storage
        Edge Function: GET /d/{token} → página do dossiê
```

---

## 6. Notificações Locais

* **Limite do iOS: 64 agendadas.** Estratégia: agendar os próximos ~8 sábados e **reagendar tudo** a cada abertura do app ou mudança de dados. Como a projeção é determinística, o conteúdo de cada sábado é pré-calculado.
* **Resumo semanal:** toque abre a tela de Check-up com itens pendentes (sem botões de ação — `[Feito]` é ambíguo com vários itens).
* **Item único crítico:** notificação individual com `[Feito]` e `[Adiar 15 dias]`.
  * `[Feito]` abre o app com o registro pré-preenchido (salvar em 1 toque). Tratamento de ação com app encerrado é instável no Expo/iOS; abrir o app é mais robusto.
  * `[Adiar 15 dias]` pode ser tratado em background (operação trivial e idempotente).

---

## 7. Modelo de Dados

### Princípios
* **IDs UUIDv7** gerados no cliente (ordenáveis, sem colisão no sync futuro).
* **Desde a v0**, toda tabela sincronizável tem `created_at`, `updated_at`, `deleted_at` (soft delete) — o sync da v1 não exige migração de esquema.
* Dinheiro em **centavos (inteiro)**. Datas em ISO-8601 UTC.
* Hodômetro é **série de leituras**, não campo.
* Templates de preset e seed de modelos são **JSON versionado no bundle**, não tabelas sincronizadas.

### Tabelas

```sql
vehicles
  id, vehicle_type ('car'), model_ref (FK seed, nullable), nickname,
  plate (sensível, nullable), vin (sensível, nullable),
  monthly_km_estimate, severe_use (bool),
  created_at, updated_at, deleted_at

odometer_readings
  id, vehicle_id, km, read_at,
  source ('onboarding'|'adjust'|'log'),
  created_at, updated_at, deleted_at

maintenance_items
  id, vehicle_id, template_key (nullable p/ item custom), name,
  interval_km (nullable), interval_months (nullable),
  baseline_km, baseline_date,       -- marco zero ou última troca
  snoozed_until (nullable), active,
  created_at, updated_at, deleted_at

maintenance_logs
  id, vehicle_id, item_id (nullable p/ serviço avulso),
  performed_at, km, cost_cents, brand_spec, notes,
  created_at,                        -- ≠ performed_at (sinal de retroativo)
  updated_at, deleted_at

attachments
  id, log_id, file_path (arquivo cifrado), mime, size_bytes,
  remote_path (v1), created_at, updated_at, deleted_at

vehicle_specs                        -- override do seed (cola de bolso)
  vehicle_id PK, oil_spec, tire_front_psi, tire_rear_psi,
  wiper_driver, wiper_passenger, battery,
  updated_at

device_prefs                         -- estado de UI local do aparelho; NUNCA sincronizado
  key PK, value, updated_at          -- ex.: selectedVehicleId (carro aberto por último)

dossier_shares                       -- v1
  id, vehicle_id, token_hash, include_photos,
  created_at, expires_at, revoked_at
```

---

## 8. Segurança, Privacidade e Criptografia

### 8.1 Classificação de dados

| Classe | Exemplos | Tratamento |
|---|---|---|
| Sensível | placa, chassi, fotos (notas fiscais com CPF/endereço), notas livres, e-mail (v1) | Cifrado local e na nuvem; fora do dossiê por padrão |
| Pessoal | histórico de manutenção, custos, hodômetro | Cifrado local e na nuvem |
| Público | seed de modelos, templates | Sem cifra |

### 8.2 Criptografia local (v0)
* **Banco inteiro cifrado com SQLCipher** (AES-256).
* **Chave do banco:** 256 bits aleatórios gerados no primeiro uso, guardada no Keystore/Keychain via `expo-secure-store` (`AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`). Sem biometria obrigatória (preserva baixo atrito).
* **Anexos (fotos):** cifrados em arquivo com AES-256-GCM (chave própria no Secure Store), nunca salvos em claro na galeria ou cache.
* **EXIF/GPS removidos** de toda foto antes de cifrar e salvar.
* **Consequência:** sem conta, trocar de aparelho ou restaurar backup do SO **perde os dados** (a chave não migra). Mitigação na v0: **exportar/importar backup cifrado** (`.bkp` protegido por senha escolhida pelo usuário, chave derivada com Argon2id). Esse mesmo formato serve de ponte para a migração para conta.

### 8.3 Criptografia na nuvem (v1)
* **Transporte:** TLS. **Repouso:** criptografia de disco nativa do Supabase.
* **Criptografia no cliente (envelope encryption):** o app cifra o **payload inteiro de cada linha** com uma chave de dados do usuário (DEK, AES-256-GCM) antes do upload. O servidor é um armazenamento "burro" de blobs cifrados — viável porque todo cálculo é local.
  ```sql
  sync_records
    id, user_id, table_name, updated_at, deleted_at,
    ciphertext, nonce, key_version
  ```
  Anexos no Storage também vão cifrados com a DEK.
* **Gestão da DEK — DECIDIDO: chave gerenciada pelo servidor.**
  * A DEK de cada usuário é gerada no cliente no momento da criação da conta e embrulhada (*wrapped*) por uma **chave mestra (KEK)** mantida fora do banco (segredo de Edge Function / KMS). No banco fica apenas a DEK embrulhada.
  * Ao logar em novo dispositivo, o app obtém a DEK via Edge Function autenticada (JWT do Supabase) e a guarda no Secure Store do aparelho. **Zero atrito para o usuário.**
  * **Protege contra:** vazamento de dump/backup do banco, falha de RLS, acesso indevido ao Storage.
  * **Não protege contra:** comprometimento total do servidor (banco + segredos das Edge Functions).
  * **Rotação:** a KEK tem `key_version`; rotacionar = re-embrulhar as DEKs (barato), sem re-cifrar os dados.
  * **Evolução futura:** o formato suporta a DEK embrulhada por **múltiplas chaves** (servidor, recuperação, dispositivo), permitindo oferecer um modo ponta a ponta (E2E) opcional sem re-cifrar dados.
  ```sql
  user_keys
    user_id PK, wrapped_dek, kek_version, created_at, rotated_at
  ```
* **Exclusão de conta = crypto-shredding:** apagar a DEK torna ilegível todo dado remanescente, inclusive em backups.

### 8.4 Dossiê público (v1)
* Token aleatório de 128 bits; **somente o hash** é gravado.
* Conteúdo é um **snapshot congelado** gerado e (necessariamente) decifrado no aparelho no momento do compartilhamento, com consentimento explícito. Fotos, placa e chassi excluídos por padrão.
* Servido por Edge Function com rate limit — nunca por tabela pública.
* Revogável, com expiração opcional.

### 8.5 Backend (v1)
* RLS em todas as tabelas (`user_id = auth.uid()`).
* Bucket de Storage privado, acesso por URLs assinadas de curta duração.
* Login: Google / Apple (sem senha própria).

### 8.6 LGPD e Lojas
* Coleta mínima; placa e chassi opcionais.
* Política de privacidade clara antes da v1.
* **Exclusão de conta dentro do app** (exigência Apple/Google) a partir da v1.

---

## 9. Roadmap de Contas e Multi-dispositivo

| Fase | Escopo |
|---|---|
| **v0** | 100% local, sem conta. SQLCipher. PDF do dossiê. Backup cifrado por arquivo. Esquema já com campos de sync. |
| **v1** | Login opcional (Google/Apple). Upload inicial de todos os dados locais cifrados. Sync push/pull incremental por `updated_at`, *last-write-wins* por linha, soft delete. Link do dossiê. |
| **Futuro** | Opção E2E (chave de recuperação / passkeys), motos, crowdsourcing de specs. |

**Migração v0 → v1:** ao criar conta, o app gera a DEK, cifra cada linha local e envia; a partir daí o SyncAgent assume. A chave do SQLCipher local continua independente da DEK da nuvem.

---

## 10. Diretrizes de UI/UX

* **Uso com uma mão:** ações primárias na metade inferior; "Registrar" sempre ao alcance do polegar.
* **Acessibilidade:** urgência nunca só por cor — ícone + texto ("Vence em 8 dias"); contraste WCAG AA; suporte a fonte dinâmica do sistema; alvos de toque ≥ 48dp; rótulos para leitores de tela.
* **Cola de Bolso legível no sol:** fonte grande, alto contraste, toque longo para copiar.
* **Defaults inteligentes:** todo campo pré-preenchido quando possível (KM projetado, data de hoje, presets marcados).
* **Feedback imediato:** ao salvar, o card muda de cor/posição com animação curta; desfazer via snackbar em vez de diálogos de confirmação.
* **Tema claro/escuro** seguindo o sistema.
* **Linguagem simples**, sem jargão técnico; números formatados em pt-BR (`46.250 km`, `R$ 1.234,56`).
* **Estados vazios úteis**, nunca telas em branco.

### Identidade visual
O vocabulário visual vem do universo do carro brasileiro, não de templates.
* **Elemento memorável (único):** hodômetro de tambores mecânicos no topo do dashboard. O último tambor é invertido (claro com dígito escuro), sinalizando "estimado". Os dígitos rolam quando o KM muda (instantâneo com "reduzir movimento" ativo). Todo o resto é discreto.
* **Cor:** ação primária no azul da faixa da placa Mercosul (`#0F3B9C`); fundo concreto frio (`#F3F5F4`); atenção no âmbar de placa de trânsito (`#E8A317`); crítico `#B3261E`; em dia `#2D6A4F`. Paleta escura equivalente.
* **Tipografia:** Barlow (derivada da sinalização rodoviária) para a interface; Barlow Condensed para números (hodômetro, km, R$). Sempre em caixa de frase, sem rótulos em caixa alta.
* **Estrutura:** itens de manutenção como linhas de largura total com barra lateral de urgência — não grade de cards iguais. Sem sombras; separação por linhas de 1px e espaçamento. Raios variam por papel (botões 10, plaquinhas de specs 6, tambores 3, linhas 0).
* Tokens implementados em `src/ui/theme.ts`.

---

## 11. Estratégia de Testes

Testes unitários desde o primeiro commit; nenhuma lógica não trivial entra sem teste.

| Camada | Ferramenta | O que cobre |
|---|---|---|
| `src/domain` | Jest (jest-expo) | Todas as regras: datas, projeção, vencimento, urgência, presets, formatação. Casos de borda obrigatórios (fim de mês, ano bissexto, limites do semáforo). |
| `src/db` | Jest + **sql.js** (SQLite em WASM) rodando as migrations reais | Repositório: criação, validações, constraints, transações e rollback, soft delete, ordenação. |
| `src/ui` | Jest + React Native Testing Library | Comportamento e acessibilidade dos componentes (papéis, estados, rótulos, anúncios). Sem snapshots. |
| `src/app` (telas) | Jest + RNTL | Fluxos com banco em memória: onboarding, registro de troca, ajuste/correção de KM, cola de bolso, histórico, troca/adição/remoção de carros. |

* **Antes de todo commit:** `npm test`, `npm run typecheck` e `npm run lint` devem passar. Situação atual: 28 suítes, 207 testes, lint sem avisos.
* **Não coberto por testes automatizados (exige dispositivo):** abertura do banco cifrado (SQLCipher + Secure Store), teclado nas sheets, leitores de tela e notificações. Validados manualmente no emulador Android.
* `better-sqlite3` foi descartado nos testes (falha nativa no Windows); `sql.js` não exige build nativo.

---

## 12. Próximos Passos

### Feito

**Fundação (2026-10-16)**
* Decisões fechadas: só carros, seed curado + manual, conta só na v1, criptografia local e na nuvem com **chave gerenciada pelo servidor** (8.3).
* Projeto Expo SDK 58 + TypeScript + Drizzle + SQLCipher, com repositório git.
* Camada `domain/` (projeção de KM, vencimentos, semáforo, presets, formatação e parsing pt-BR).
* Banco local cifrado com chave no Keystore/Keychain; schema com campos de sync desde a v0; migrations geradas.
* Design system com a identidade visual (hodômetro de tambores, azul Mercosul, Barlow) e componentes acessíveis.
* Telas: onboarding, dashboard, registro de troca, ajuste de KM, cola de bolso e histórico com total gasto.
* Testes desde o primeiro commit (domínio, banco com migrations reais, componentes, telas).

**Revisão e correções (2026-10-16)**
* Limite de KM e "Ajustar KM" capaz de corrigir uma leitura errada (com confirmação).
* App se recusa a abrir se o SQLCipher não estiver ativo (falha fechada).
* iPhone restaurado sem a chave: oferece apagar e recomeçar, com confirmação, só quando a chave realmente não existe.
* "Hoje" atualizado ao voltar ao app; proteção contra toque duplo; teclado não cobre o botão de salvar; perguntas de múltipla escolha lidas pelo leitor de tela; mensagens de erro só em pt-BR.

**Ambiente e validação (2026-10-16)**
* ESLint configurado (inclui regras do React Compiler), sem avisos.
* App rodando no emulador Android (dev build). Confirmado no aparelho: o arquivo do banco está cifrado.
* Build Windows documentado no README (CMake 3.31.6 por causa do limite de 260 caracteres do ninja antigo).
* Botões só de texto alinhados à coluna.

**Múltiplos carros (2026-10-16)**
* Seletor no topo, lista "Seus carros" com status de cada um, adicionar (reusa o onboarding) e remover com confirmação.
* Carro selecionado lembrado na tabela local `device_prefs` (nunca sincronizada).
* Testado no emulador: adicionar um segundo carro e alternar entre os dois.

### Pendente
1. **Validar o restante no emulador:** registrar troca, correção de KM, histórico, remover carro, modo escuro, teclado nas sheets, TalkBack.
2. **Rótulo de item vencido por km:** hoje mostra "Vencido há 2813 dias" (estimativa a partir da média). Destacar "Passou N km" quando o vencimento vier do km.
3. **Seed curado:** levantar os ~40 modelos mais vendidos e suas specs + busca no onboarding.
4. **Notificações locais** (resumo semanal + item crítico; `buildDigest`, adiar 15 dias), agrupando os carros.
5. **Dossiê em PDF** (`expo-print`) com sinais de credibilidade.
6. **Foto do comprovante** (anexo cifrado, sem EXIF).
7. **Backup cifrado por arquivo** (exportar/importar com senha).
8. Edição/exclusão de registros no histórico; renomear carro.
9. **Rodar no iOS** (exige macOS ou EAS Build).
10. Tratar os avisos do `npm audit` (vindos do template e das ferramentas de teste).
