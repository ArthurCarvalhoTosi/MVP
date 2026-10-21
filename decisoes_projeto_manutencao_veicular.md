# Resumo de Decisões de Produto: App de Manutenção Veicular (MVP)

Documento consolidado de requisitos, escopo, regras de negócio, UX, arquitetura, dados e segurança definidos para continuidade do desenvolvimento.

**Última revisão:** 2026-10-20

---

## 1. Visão Geral do Produto
* **Proposta:** Aplicativo focado em manutenções preventivas **de carros**, com baixíssimo atrito de entrada, foco em previsibilidade e utilidade prática no dia a dia.
* **Modelo Inicial:** 100% gratuito (foco absoluto em retenção, validação de uso contínuo e engajamento orgânico).
* **Decisão de Escopo:** **Hiper-focado em Carros.**
  * Casa e híbrido descartados (menor dor financeira percebida, diluição de valor).
  * **Motos fora do MVP** (exigem presets próprios — corrente, intervalos de óleo menores — e dobram o trabalho de seed). O modelo de dados mantém `vehicle_type` para permitir inclusão futura.
* **Múltiplos carros:** o usuário pode acompanhar vários carros. O app abre direto no último carro visto (preserva a consulta em 3 segundos); tocar no nome do carro no topo abre "Seus carros", com o status de cada um, "Adicionar carro" (reusa o onboarding) e "Remover" (com confirmação; soft delete do carro e de todos os seus registros) e renomear (lápis na lista).
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
* **`[Adicionar manutenção]`:** item fora da pré-lista (nome + intervalo em km, meses ou os dois). Começa a contar hoje, no KM projetado. Lápis em cada item: editar nome e intervalos ou remover.

### Tela 3: Bottom Sheet de Registro (< 10 segundos)
* **KM:** pré-preenchido com o projetado (editável).
* **Data:** padrão "Hoje".
* **Opcionais:** custo (R$), marca/especificação, foto (etiqueta ou nota fiscal).
* Ao salvar: grava leitura de hodômetro + recalcula o próximo vencimento imediatamente.

### Tela 4: Histórico & Dossiê
* Linha do tempo reversa, total financeiro acumulado. Cada registro pode ser editado ou excluído.
* `[Exportar histórico em PDF]` gera o dossiê no aparelho (`expo-print`) e abre o compartilhamento. Com conta (v1), também `[Criar e enviar link]`: o mesmo histórico, sem fotos, numa página web cifrada pelo próprio link (8.4).
* Fotos **desligadas por padrão** no dossiê (notas fiscais contêm CPF e endereço); usuário liga explicitamente. Observações, placa e chassi não entram.

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
| Criptografia de arquivos | `expo-crypto` (AES-256-GCM nativo) |
| Notificações | `expo-notifications` (agendamento 100% local) |
| PDF | `expo-print` (HTML → PDF no aparelho) |
| Backend (v1) | **Supabase**: Auth, Postgres + RLS, Storage, Edge Functions |
| Qualidade | Jest + React Native Testing Library + sql.js; ESLint (`eslint-config-expo`, com regras do React Compiler); Prettier (formata ao salvar); TypeScript strict |

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
        Edge Function dossier: cópia cifrada pelo hash → página /d (Cloudflare Pages)
```

---

## 6. Notificações Locais

* **Limite do iOS: 64 agendadas.** Estratégia: agendar os próximos ~8 sábados e **reagendar tudo** a cada abertura do app ou mudança de dados. Como a projeção é determinística, o conteúdo de cada sábado é pré-calculado.
* **Resumo semanal:** toque abre a tela de Check-up com itens pendentes (sem botões de ação — `[Feito]` é ambíguo com vários itens).
* **Item único crítico:** notificação individual com `[Feito]` e `[Adiar 15 dias]`.
  * `[Feito]` abre o app com o registro pré-preenchido (salvar em 1 toque). Tratamento de ação com app encerrado é instável no Expo/iOS; abrir o app é mais robusto.
  * `[Adiar 15 dias]` também abre o app: gravar em background com o app encerrado exigiria `expo-task-manager` e não é confiável; no app, a escrita usa o banco cifrado já aberto e o usuário vê o resultado.
* **Quem entra:** itens críticos e em atenção (mesmo critério de "Precisa de atenção"), de todos os carros, exceto os adiados. No máximo uma notificação por sábado, às 09h locais; sábado sem pendência não notifica. Exatamente um crítico gera a notificação individual (itens em atenção citados como "Mais N em atenção."); dois ou mais críticos geram o resumo.
* **Soneca:** o item sai dos lembretes e do Check-up até `snoozed_until`; vencimento e dashboard não mudam. Registrar a troca limpa a soneca.
* **Permissão:** cartão no dashboard explica antes do pedido do sistema; respondido de qualquer forma, não volta. Sem permissão, nada é agendado.
* **Limites:** sem abrir o app por 8 semanas, os lembretes acabam; alarmes inexatos (sem `SCHEDULE_EXACT_ALARM`) podem atrasar alguns minutos.

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

dossier_shares                       -- v1; cópia cifrada pelo segredo do link (8.4)
  id, user_id, vehicle_id, token_hash, ciphertext,
  created_at, expires_at
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
  * A DEK de cada usuário é gerada **na Edge Function `user-key`** no primeiro login e embrulhada (*wrapped*) por uma **chave mestra (KEK)** mantida fora do banco (segredo `KEKS` da Edge Function). No banco fica apenas a DEK embrulhada. *(Antes: gerada no cliente. O servidor vê a DEK de qualquer forma ao embrulhar, então a segurança é a mesma, e gerar no servidor evita que dois aparelhos entrando ao mesmo tempo criem chaves diferentes.)*
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
* Link `https://garagem.acttechsoftware.com.br/d#<segredo>`: segredo aleatório de 128 bits depois do `#`, que o navegador nunca envia a servidor nenhum.
* Do segredo saem o **hash** (SHA-256, único dado que identifica o link no servidor) e a **chave** AES-256-GCM (HKDF-SHA256). O servidor guarda só cifra e hash: nem um vazamento do banco nem nós lemos um dossiê.
* Conteúdo é um **snapshot congelado** gerado no aparelho no momento do compartilhamento. Placa, chassi, observações e fotos ficam fora (as fotos só vão no PDF).
* Servido por Edge Function com rate limit (30 aberturas por IP a cada 10 minutos) — nunca por tabela pública. A página decifra no navegador.
* Validade opcional (30 dias, 90 dias ou sem prazo); desativar apaga o link. Links vencidos são apagados de hora em hora.

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
| **v1** | Login opcional (Google/Apple). Upload inicial de todos os dados locais cifrados. Sync push/pull incremental, *last-write-wins* por linha (pelo `updated_at` do cliente), soft delete; o cursor do pull é um carimbo do servidor (ver "Plano da v1" na seção 12). Link do dossiê. |
| **Futuro** | Opção E2E (chave de recuperação / passkeys), motos, crowdsourcing de specs. |

**Migração v0 → v1:** ao criar conta, o app obtém a DEK (`user-key`), cifra cada linha local e envia; a partir daí o SyncAgent assume. A chave do SQLCipher local continua independente da DEK da nuvem.

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

* **Antes de todo commit:** `npm test`, `npm run typecheck` e `npm run lint` devem passar. Situação atual: 43 suítes, 749 testes, lint sem avisos. O CI roda os três em todo PR para a `main`.
* **Não coberto por testes automatizados (exige dispositivo):** abertura do banco cifrado (SQLCipher + Secure Store), teclado nas sheets, leitores de tela, câmera e notificações. Parte disso foi revalidada no emulador Android em 2026-10-17 (ver seção 12).
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
* ESLint configurado (inclui regras do React Compiler), sem avisos. Prettier formata ao salvar e via `npm run format`.
* App rodando no emulador Android (dev build). Confirmado no aparelho: o arquivo do banco está cifrado.
* Build Windows documentado no README (CMake 3.31.6 por causa do limite de 260 caracteres do ninja antigo).
* Botões só de texto alinhados à coluna.

**Múltiplos carros (2026-10-16)**
* Seletor no topo, lista "Seus carros" com status de cada um, adicionar (reusa o onboarding) e remover com confirmação.
* Carro selecionado lembrado na tabela local `device_prefs` (nunca sincronizada).
* Testado no emulador: adicionar um segundo carro e alternar entre os dois.

**CI/CD (2026-10-17)**
* GitHub Actions (`.github/workflows/ci.yml`): typecheck, lint e testes em todo PR e push para a `main`; na `main`, APK Android de release (arm64, assinado com a chave de debug) publicado como artefato por 30 dias. Play Store exigirá EAS Build com keystore própria.
* Dependências nativas novas instaladas de uma vez (notificações, PDF, compartilhar, câmera/galeria, seletor de arquivo). Criptografia de arquivos pelo AES-256-GCM nativo do `expo-crypto`, sem `react-native-quick-crypto`.

**Histórico, comprovantes e vencimento por km (2026-10-17)**
* Item vencido pelo km mostra "Passou N km" em vez de dias estimados pela média (`computeDue` informa qual limite define o vencimento; empate fica com o km).
* Registros podem ser editados (data, km, custo, marca, observações, foto) e excluídos com confirmação. Cada registro tem sua leitura de hodômetro ligada (`log_id`), que acompanha a edição/exclusão e continua validada contra as demais. O marco zero de cada item fica guardado (`start_km`/`start_date`): excluir ou mover o registro que definia a linha de base a devolve ao registro anterior ou ao marco zero, nunca acima de uma leitura real posterior.
* Renomear carro em "Seus carros".
* Foto do comprovante (câmera ou galeria): reduzida a 1.600 px e re-codificada em JPEG (sem EXIF/GPS), cifrada com AES-256-GCM em `documents/attachments`, chave própria no Secure Store. O JPEG em claro só existe em memória (imagem sem cache de disco); temporários do picker e do manipulador apagados em qualquer caminho. Histórico mostra "Com comprovante" e "Ver foto".
* Remover registro ou carro: soft delete do anexo (para o sync) e o arquivo cifrado é apagado do disco na hora (não há desfazer; notas fiscais têm CPF e endereço).

**Notificações locais (2026-10-17)**
* `buildDigest` no domínio; lembrete de sábado agrupando os carros; notificação de item único crítico com `[Feito]` / `[Adiar 15 dias]`; tela Check-up; pedido de permissão explicado num cartão do dashboard; respostas tratadas também com o app aberto pela notificação (regras na seção 6).

**Seed curado (2026-10-17, dados parciais)**
* `src/domain/models.json` versionado, com fontes por campo; valores não confirmados ficam vazios. Busca no onboarding (ignora acentos, maiúsculas e hífen; aceita ano), sugestão de apelido e "Meu carro não está na lista".
* Specs copiadas para `vehicle_specs` na criação: o que o usuário edita ou apaga vale; correção do seed só alcança carros novos.
* O seed tira a correia dentada de motores com corrente e de elétricos e ajusta intervalos quando o manual diverge (ex.: VW severo 10.000 km / 6 m; correia VW 120.000 km / 5 anos). Aviso "Valores de referência" na cola de bolso de carros do seed.

**Seed preenchido (2026-10-17)**
* Versão 2 do JSON: 51 modelos, 124 entradas (~41% dos valores preenchidos). Entrou o que a pesquisa já tinha coletado (Fiat, GM, Stellantis, Toyota/Honda, VW, Renault, Ford, BYD) mais HB20/HB20S, Creta, Kicks e Haval H6, a partir dos manuais oficiais brasileiros. Palhetas continuam quase todas vazias (os manuais mandam ver a etiqueta). Tiggo 7 ficou de fora: não houve fonte brasileira confiável no prazo.
* Sandero Stepway 2010 1.6 (manual do proprietário da Renault, pág. 0.04): 35 psi na frente. A traseira impressa diz 32 psi e 2,4 bar na mesma célula, então ficou vazia. Óleo, palheta, bateria e prazo da correia não estão nesse manual.
* Testes do seed de volta ao mínimo de 45 modelos e às buscas por "hb20" / "onix 2018".

**Dossiê em PDF (2026-10-17)**
* `dossierHtml` no domínio monta a página com os sinais de credibilidade (data de registro, registros feitos depois do serviço, selo "Com comprovante"). Observações, placa e chassi não entram. Sheet em Histórico: fotos só se o dono ligar, com aviso de CPF/endereço. `expo-print` gera o PDF, o sistema compartilha, o arquivo em claro some em seguida.

**Backup cifrado (2026-10-17)**
* Arquivo `.bkp`: cabeçalho JSON autenticado + AES-256-GCM. Senha vira chave com Argon2id (19 MiB, 2 passes, mínimo OWASP). Inclui todas as linhas sincronizáveis (também as apagadas) e as fotos, recifradas com a chave deste aparelho na restauração. Restaurar substitui os dados locais, com confirmação se já houver carro. Entrada em "Seus carros" e no onboarding do primeiro uso.

**Sheets e reset (2026-10-17)**
* Em `formSheet` no Android o conteúdo continua em altura de tela cheia mesmo no detent de 50%: o `footer` do `Screen` fica abaixo da dobra. Ajustar KM, renomear, dossiê e as sheets curtas passam o botão para o conteúdo. Registro, backup e restauração abrem em tela cheia.
* `resetDatabase` também apaga `documents/attachments`.

**Validação no emulador Android (2026-10-17, segunda rodada)**
* Confirmado: busca "hb20", apelido sugerido, cola de bolso do seed, Ajustar KM, permissão de notificação e lembrete de teste (`checkup-test` disparou com o texto certo), foto pela câmera (prévia, histórico "Com comprovante"/"Ver foto", arquivo `.bin` em `files/attachments`, cache do picker vazio), edição de registro, PDF (`Historico-Meu-HB20-….pdf` no compartilhamento), sheet de backup, modo escuro, botão visível com o teclado em Ajustar KM.
* Não fechado nesta rodada: TalkBack; criar/restaurar o `.bkp` até o fim (a digitação da senha falhou na automação); conferir de novo se o vencimento do item acompanha o registro depois de um force-stop.

**Validação no emulador Android (2026-10-17, terceira rodada)**
* Registrar "Filtros de ar e cabine" a 55.600 km tira o item do crítico na hora ("Em dia. Faltam 10.000 km"). Depois de `force-stop` e reabrir, continua em dia. O sumiço da troca na rodada anterior não se repetiu.
* Backup de ponta a ponta: senha de 9 caracteres, arquivo `Garagem-backup-2026-10-17.bkp` (cabeçalho Argon2id) no compartilhamento, restauração pelo seletor de arquivos. O carro tinha sido renomeado para "HB20QA" depois do backup; ao restaurar voltou a "Meu HB20" e o filtro continuou em dia.
* TalkBack ligado: o foco anda pelos controles com os rótulos do app ("Editar", "Trocar de carro. Atual: Meu HB20", itens com "Crítico"/"Em dia") e o sintetizador de voz dispara. Desligado ao fim do teste.

**`npm audit` (2026-10-17): risco aceito**
* As 67 ocorrências vêm de 5 pacotes-raiz, todos de ferramentas de build/teste (Metro, Jest, CLI do Expo, drizzle-kit); nada entra no app instalado. `braces`, `node-forge` e `sprintf-js` não têm versão corrigida; `uuid@7` só entra pelo `xcode` (prebuild iOS) e a falha é em v3/v5/v6; o `esbuild` 0.18 do drizzle-kit não usa o servidor de desenvolvimento vulnerável. As "correções" do npm são rebaixamentos (expo@44, react-native@0.72). Reavaliar a cada atualização do SDK.

**Manutenção fora da pré-lista (2026-10-19)**
* "Adicionar manutenção" no dashboard abre uma sheet com nome e intervalo (km, meses ou os dois; vale o que chegar primeiro). O item nasce sem `template_key`, com marco zero hoje no KM projetado (`addItem`); projeção não vira leitura de hodômetro, e uma leitura real menor depois ajusta a linha de base como em qualquer item.
* Lápis em cada linha do dashboard abre a mesma sheet para editar nome e intervalos de qualquer item (da pré-lista ou não). A linha de base não muda: o próximo vencimento se recalcula a partir da última troca. "Remover manutenção" pede confirmação e faz soft delete só do item; as trocas continuam no histórico com o nome dele.

### Pendente
1. **Seed:** palhetas (e muita calibragem) continuam vazias — os manuais mandam ver a etiqueta. Falta o Tiggo 7. No Stepway 2010 a traseira ficou vazia de propósito (o manual contradiz psi e bar). Completar só com fonte brasileira; vazio continua melhor que chute.
2. **Rodar no iOS** (exige macOS ou EAS Build).

### Plano da v1 (2026-10-20)

A v0 fechou na tag `v0` (`2870790`). A v1 começa no branch `feat/v1-backend`.

**Correção de desenho: cursor do sync.** O `updated_at` vem do relógio do aparelho; usado como cursor do pull, um relógio atrasado faz outro aparelho pular linhas. Cada `sync_records` ganha um carimbo do servidor (`server_updated_at`, gravado pelo Postgres, ou uma sequência), e o pull pede "tudo depois do último carimbo visto". O `updated_at` do cliente continua decidindo o *last-write-wins*. O cursor fica em `device_prefs`; o esquema local não muda.

**Achado: HTML nas Edge Functions.** No domínio padrão `*.supabase.co`, respostas `text/html` são reescritas como `text/plain`; HTML só com domínio próprio, que no Supabase é add-on pago (exige plano Pro). Decidido: a página do dossiê fica no Cloudflare Pages (`/d`) e a Edge Function só devolve a cópia cifrada (fatia 5).

**Fatias, em ordem** (cada uma entregável sozinha):
1. **Backend base:** pasta `supabase/` no repo (CLI, migrations), `sync_records`, `user_keys`, `dossier_shares`, RLS em tudo, testes de RLS no CI. ✅ (ver abaixo)
2. **Login e chave:** Google (Apple quando houver iOS); Edge Function que embrulha/desembrulha a DEK; DEK no Secure Store.
3. **SyncAgent** (`src/sync`): upload inicial, push/pull incremental, soft delete; merge LWW como função pura testada com sql.js.
4. **Fotos na nuvem:** recifradas com a DEK, bucket privado. ✅ (ver abaixo; `remote_path` acabou sem uso)
5. **Link do dossiê:** snapshot congelado, token de 128 bits (só o hash gravado), expiração, revogação, rate limit. ✅ (ver abaixo)
6. **Excluir conta no app:** apaga a DEK (crypto-shredding).
7. **Publicação:** EAS Build com keystore própria (`eas.json` e conta Expo entram aqui; saíram da fatia 1 porque o iOS ficou para depois); política de privacidade publicada antes.

**Fatia 1 entregue (2026-10-20).** Migration `supabase/migrations/…_sync_keys_shares.sql`:
* `sync_records`: chave `(user_id, table_name, id)` (`vehicle_specs` reusa o id do carro); só as 6 tabelas sincronizáveis (`device_prefs` recusada); payload ≤ 64 KiB, nonce de 12 bytes. Um gatilho garante o *last-write-wins* no servidor (cópia com `updated_at` igual ou mais velho é ignorada, sem quebrar o lote) e grava `server_updated_at` com o relógio do Postgres. Esse carimbo sai na execução, não no commit: o pull relê uma pequena janela antes do cursor (a fusão é idempotente).
* `user_keys`: sem política e sem permissão para o app; só Edge Functions (service role) leem a DEK embrulhada.
* `dossier_shares`: snapshot em `jsonb` (≤ 256 KiB) congelado; o dono só muda `expires_at` e `revoked_at`, ou apaga. *(Mudou na fatia 5: só cifra e hash, imutável; ver abaixo.)*
* Permissões por coluna: o app não escolhe o dono da linha (`user_id` vem de `auth.uid()`) nem forja o cursor; não há `delete` em `sync_records` (soft delete). Excluir o usuário em `auth.users` apaga em cascata linhas, DEK e links.
* Testes pgTAP (`supabase/tests/database/rls.test.sql`, 29 casos) com anônimo e dois usuários; conferidos abrindo brechas de propósito (6 falham). Migration aplicada no `garagem-dev` e os mesmos testes passam lá (`supabase test db --linked`; o teste assume o papel `postgres`, porque o login temporário da CLI não enxerga o schema `extensions`). CI: job `database` (`supabase db start` + `supabase test db`); o APK da `main` depende dele.
* Portas locais do Supabase em 443xx (`config.toml`): o Windows reserva 54242–54941 em algumas máquinas.

**Fatia 2 em andamento: login Google (2026-10-20).** Login pelo navegador com PKCE (`signInWithOAuth` → aba segura com a tela do Google → `garagem://auth-callback` → `exchangeCodeForSession`). *Mudou do login nativo:* a versão gratuita de `@react-native-google-signin/google-signin` ainda usa a API de login do Android que o Google descontinuou; a moderna (Credential Manager) só existe na versão paga. O navegador não exige código nativo nem licença, funciona igual no iOS e custa um toque a mais, uma vez por aparelho. O PKCE impede que outro app que capture o `garagem://` termine o login. Google Cloud: projeto `garagem-dev`, tela de consentimento externa em modo de teste (só usuários de teste entram), escopos básicos (e-mail e perfil). Dois clientes OAuth: **Web** (`680900132295-1njieevhtrcll6rpuslbs5i0v2cukh61.apps.googleusercontent.com`, usado pelo Supabase para validar o token; o *secret* fica só no painel do Supabase) e **Android** (`br.com.garagem.app` + SHA-1 da chave de debug; criado para o login nativo e hoje sem uso). Supabase: `garagem://auth-callback` na lista de *Redirect URLs*.

**App: conta (2026-10-20).** "Conta" em "Seus carros" abre a sheet: sem conta, explica que é opcional e oferece o botão padrão do Google ("Continuar com o Google", `GoogleButton` em `src/ui`: G colorido oficial em SVG via `expo-image`, cores, Roboto e texto das diretrizes de marca do Google, versões clara e escura com o G sobre branco; só a altura sobe para 48dp; as cores são tokens próprios, fora da paleta); com conta, mostra o e-mail e "Sair da conta" (com confirmação; os dados continuam no aparelho). Módulo `src/account`:
* Sessão do Supabase guardada em `device_prefs` (chaves `auth:*`), dentro do banco cifrado: a sessão com o perfil do Google passa do limite de ~2 KB do Secure Store. Fica fora do backup e sobrevive a uma restauração.
* Depois do login, o app busca a DEK em `user-key` e a guarda no Secure Store (`garagem.cloud.dek`, só neste aparelho). Se a chave não vier, o app sai da conta: logado sem chave não sincronizaria nada.
* Sair apaga a DEK e encerra só a sessão deste aparelho; "apagar e recomeçar" também apaga a DEK.
* A sessão se renova só com o app em primeiro plano. URL e chave publicável do `garagem-dev` fixas no código (públicas por definição) até existir o projeto de produção.

**Edge Function `user-key` (2026-10-20).** `POST /functions/v1/user-key` com a sessão do usuário devolve `{ dek }` (base64, `Cache-Control: no-store`), criando a chave no primeiro uso. Detalhes:
* KEK: segredo `KEKS` da função, JSON `{"<versão>": "<base64 de 32 bytes>"}`; a maior versão embrulha chaves novas, as antigas continuam abrindo as delas (rotação = acrescentar versão, nunca trocar). Sem KMS externo por ora. **Perder a KEK perde os dados de todos os usuários na nuvem**: ela fica também num cofre de senhas do dono do projeto (o Supabase não mostra segredos depois de gravados).
* Formato embrulhado: nonce (12) + AES-256-GCM (48) = 60 bytes, com o id do usuário como dado associado (uma DEK copiada para outra linha não abre).
* Corrida de primeiro login: `insert … on conflict do nothing` e releitura; todos recebem a chave que ficou gravada.
* Login validado pelo `@supabase/server` (`auth: 'user'`, JWKS do projeto). Erros devolvem só `internal`; nada de chave em log.
* Testes: Deno (`npm run test:functions`: lint, check e 14 testes de cifra, corrida e rotação; roda no CI). Ponta a ponta no Supabase local: login real, mesma chave em chamadas seguidas e em 5 chamadas simultâneas, chave diferente por usuário, 401 sem token ou com token adulterado, 403 ao ler `user_keys` pela API.
* `supabase/functions` é código Deno: fora do `tsc` e do ESLint do app; Deno fixado como devDependency.

**Fatia 3: sincronização (2026-10-20).** Módulo `src/sync` (lado local em `src/db/sync.ts`).
* **O que vai:** carros, itens, trocas, leituras de hodômetro e cola de bolso, inclusive as linhas apagadas (soft delete). Anexos ficaram para a fatia 4 (a linha sem o arquivo mostraria uma foto que o outro celular não abre) e entraram lá. `device_prefs` e a sessão nunca saem do aparelho.
* **Cifra:** cada linha vira um envelope JSON (`{v:1,row}`) cifrado com a DEK (AES-256-GCM); `tabela:id` entra como dado associado, então o servidor não consegue fazer uma linha passar por outra. Ao abrir, o app também confere que o id e o `updated_at` de dentro batem com os de fora. Linha que não abre (chave errada, bytes adulterados, tabela desconhecida) é pulada e contada.
* **O que falta subir:** tabela local `sync_state` com o `updated_at` de cada linha na última ida/vinda. Pendente é quem está *diferente* (não "mais novo que um cursor"): relógio atrasado não esconde edição, e uma edição feita durante o envio continua pendente.
* **Ciclo:** pull (cursor = carimbo do servidor, relendo 1 minuto antes) → aplica numa transação, pais antes dos filhos, cada linha num savepoint → push em lotes de 200 → marca enviado. A cópia mais nova vence (comparação dos `updated_at`, normalizados para o formato do app: o Postgres devolve `+00:00`).
* **Quando:** ao abrir o app, ao voltar para ele, logo após entrar na conta e 3 s depois de uma pausa nas edições; uma execução por vez (pedido no meio enfileira mais uma). Falha (sem internet) só marca o status; o próximo gatilho tenta de novo.
* **Tela "Conta":** "Dados na nuvem: sincronizado hoje às 14:32", "Sincronizando…" ou "Não foi possível sincronizar agora. O app tenta de novo sozinho.", e "Sincronizar agora". Sair da conta apaga a DEK e o `sync_state`/cursor deste aparelho (outra conta começa do zero).
* **Servidor:** o upsert do PostgREST regrava todas as colunas enviadas, inclusive `table_name` e `id`: migration `…_sync_upsert_grants` libera `update` nessas duas (o dono continua sem poder mexer em `user_id`). O pgTAP agora imita esse upsert (31 casos).
* **Testes:** banco local (pendências, relógio atrasado, edição durante o envio, LWW, filhos antes do pai, linha estragada), dois celulares com servidor falso (cifra real via Node), adulteração/troca de linha, agendador, gancho. Ponta a ponta contra o Supabase local real (`SYNC_E2E=1 npx jest src/sync/__tests__/supabase.e2e.test.ts`): dois celulares convergem e outra conta não vê nem sobrescreve nada. O typecheck pegou a opção errada do `expo-crypto` (`includeTag`) que o mock aceitava.
* **Celular novo:** o primeiro uso oferece "Já usei o app: entrar na minha conta" (ao lado de restaurar backup). O cadastro sai para a garagem quando carros chegam por outro caminho; a sheet "Conta" aberta num aparelho sem carros também fecha sozinha quando os carros da conta chegam (conta vazia: fica na sheet).
* **PKCE de verdade no Hermes:** sem WebCrypto, o supabase-js gerava o segredo do PKCE com `Math.random` e o mandava sem hash ("plain"). `src/account/webcrypto.ts` preenche só o que ele usa (`getRandomValues` e SHA-256 nativos do `expo-crypto`); o aviso sumiu e o login usa S256.
* **Validado no emulador Android (2026-10-20):** login → "Dados na nuvem: sincronizado"; app desinstalado e reinstalado (aparelho novo, sem dados nem chave) → entrar na conta → o carro volta da nuvem, decifrado, e o app abre na garagem.

**Fatia 4: fotos na nuvem (2026-10-20).** As linhas de `attachments` entram no sync, e o arquivo de cada foto vai para o Storage.
* **Bucket `attachments`** (migration `…_attachments_bucket`): privado, até 5 MiB, só `application/octet-stream`. Um objeto por foto em `<id do usuário>/<id do anexo>.bin`; as políticas em `storage.objects` só deixam o dono ler, enviar, substituir e apagar na própria pasta, e só nomes nesse formato. pgTAP: 12 casos novos (43 no total), conferidos abrindo brechas de propósito (3 falham).
* **Cifra:** o JPEG é decifrado com a chave local do aparelho e cifrado de novo com a DEK (AES-256-GCM, com o id do anexo como dado associado: o servidor não troca uma foto por outra). Formato: 1 byte de versão + nonce + cifra + tag. No celular que recebe, a foto é recifrada com a chave local dele.
* **`file_path` não sai do aparelho:** cada celular guarda a foto com a própria chave e o próprio nome de arquivo. A linha viaja sem essa coluna; no celular que recebe, o arquivo ganha o nome `attachments/<id>.bin`, e uma cópia vinda da nuvem nunca sobrescreve o nome local (senão o arquivo certo não seria apagado na remoção).
* **Ordem:** a foto sobe antes da linha (linha na nuvem garante que o arquivo está lá); falha no envio interrompe o sync e tudo é tentado de novo. Foto que o aparelho não consegue ler fica só nele, com a linha, e o resto sobe. Foto removida sai do Storage antes de a linha apagada subir. Depois do envio, o app baixa as fotos que ainda não tem; uma que não chegou à nuvem espera o próximo sync, e uma adulterada é pulada.
* **Remoção em outro aparelho:** ao receber a linha apagada, o arquivo local some na hora (notas fiscais têm CPF e endereço).
* **"Já subiu"** fica no `sync_state` local (nome `photo_files`), não em `remote_path`: sair da conta zera, e outra conta no mesmo aparelho envia a própria cópia. O caminho na nuvem sai do id do usuário e do anexo, então `remote_path` continua sem uso.
* **Histórico:** foto que ainda não baixou mostra "A foto ainda está vindo da nuvem. Tente de novo daqui a pouco."
* **Testes:** dois celulares com servidor falso (foto chega cifrada e com nome próprio, ordem do envio, foto ilegível, remoção nos dois lados, adulteração, troca de conta) e ponta a ponta no Supabase local com Storage real (outra conta não baixa nem sobrescreve; o objeto some depois da remoção). Para rodar, o `supabase start` local precisa incluir o `storage-api`.
* **Validado no emulador Android (2026-10-20):** migration aplicada no `garagem-dev` (`db push`, testes `--linked` passando). Troca com foto da câmera → "sincronizado"; app desinstalado e reinstalado (aparelho novo) → entrar na conta → carro, troca e "Com comprovante" voltam, o arquivo chega como `attachments/<id>.bin` cifrado com a chave nova do aparelho e "Ver foto" mostra a imagem.
* **Fica para a fatia 6:** excluir a conta precisa esvaziar a pasta do usuário pela API do Storage (apagar o usuário não apaga os objetos; a DEK apagada já os deixa ilegíveis).

**Ordem depois da fatia 4 (2026-10-21).** Com o D-U-N-S em correção (ver plano de publicação), segue o plano: fatia 5 → fatia 6 → registros de acesso por 6 meses (Marco Civil, prometidos na política) → publicação. Uma conversa nova por fatia.

**Fatia 5: link do dossiê (2026-10-21).** A cópia fica **cifrada pelo próprio link**.
* **Link:** `https://garagem.acttechsoftware.com.br/d#<segredo>`, segredo de 128 bits em base64url (22 caracteres). Do segredo saem o hash (SHA-256 puro, `dossier_shares.token_hash`) e a chave AES-256-GCM (HKDF-SHA256, sem sal, rótulo `garagem/dossier/key/v1`). Formato da cópia: 1 byte de versão + nonce + cifra + tag. O rótulo e o byte de versão estão no app e na página: mudar quebra todo link já enviado.
* **App** (`src/dossier-link`): a sheet do dossiê ganhou "Link do histórico". Sem conta, aponta para "Entrar na conta". Com conta: validade (30 dias, 90 dias ou sem prazo), "Criar e enviar link" (sorteia o segredo, cifra o mesmo HTML do PDF, grava cifra e hash, abre o compartilhamento do sistema com o link) e "Links ativos" com "Desativar" (com confirmação). O segredo não fica guardado: link perdido, cria-se outro. O link não depende do sync, só do login. `@noble/hashes` (já instalado) faz SHA-256 e HKDF; `TextEncoder` codifica o HTML.
* **Fotos ficam fora do link** (decidido na fatia): nota fiscal tem CPF e endereço, e link se repassa. O PDF continua com a opção de fotos. Sem fotos, a cópia cabe folgada nos 256 KiB e não precisa de bucket.
* **Banco** (migration `…_dossier_link`): `snapshot`, `include_photos` e `revoked_at` saíram; entrou `ciphertext` (≤ 256 KiB). A linha é imutável: o dono cria, lista e apaga ("desativar" apaga, nada fica guardado). Links criados no desenho antigo (só dev) foram apagados.
* **Abrir:** função `open_dossier(hash, cliente)`, só para o service role: conta a abertura (janela fixa de 10 minutos, 30 por cliente, erro `GA429` acima disso) e devolve a cifra se o link existe e não venceu. Cliente = SHA-256 do IP; o IP não é gravado. **pg_cron** (`dossier-cleanup`, de hora em hora) apaga links vencidos e contadores velhos, como a política promete.
* **Edge Function `dossier`** (`GET /functions/v1/dossier?h=<64 hex>`, `auth: 'none'`, `verify_jwt = false`, CORS padrão): 200 com os bytes, 404 para link desconhecido, apagado ou vencido, 429 com `Retry-After: 600`, 400 para hash malformado; tudo `no-store`. *Atalho:* o IP vem do primeiro `x-forwarded-for`, que quem chama pode forjar para fugir do limite; trocar pelo cabeçalho de IP da plataforma se houver abuso (adivinhar link continua inútil: 128 bits).
* **Página `/d`** (`sites/garagem/d.html` + `d.js`): lê o `#`, pede a cópia pelo hash, decifra com WebCrypto e troca a página pelo HTML do dossiê via `DOMParser` (scripts dali nunca rodam). Mensagens para link incompleto, desativado/vencido, muitas aberturas e falha de rede. `_headers`: `/d` troca a CSP do site (`!` remove a geral) por uma que libera script do próprio site, estilo inline (o HTML do dossiê traz o próprio `<style>`) e conexão só com o Supabase; `X-Robots-Tag: noindex`. Conferido com `wrangler pages dev`. `dossierHtml` ganhou viewport e margem menor em tela estreita.
* **Testes:** app cifra e o `d.js` de verdade abre (WebCrypto do Node): hash = SHA-256 do segredo, link de outra cópia, byte adulterado, link cortado sem ir ao servidor. Tela (sem conta, validade, sem fotos mesmo com fotos ligadas no PDF, toque duplo, falha, lista e desativar). Deno: 6 casos da function. pgTAP: 52 casos (função só para o service role, link vencido, limite e nova janela, job do cron), conferidos abrindo brechas de propósito. Ponta a ponta no Supabase local com a function servida (`npx supabase functions serve` + `SYNC_E2E=1 npx jest src/dossier-link`): link abre pela "página", servidor só tem cifra e hash, outra conta não lista nem apaga, desativado dá 404; 429 na 31ª abertura.
* **Política:** seção 6 reescrita (cifra pelo link, sem fotos), data nova no topo.
* **Deploy pelo CI (2026-10-21):** push na `main` agora aplica as migrations e publica todas as Edge Functions no `garagem-dev` (job `supabase`, depois de `check` e `database`; `supabase link` + `db push --yes` + `functions deploy --use-api`), e só então publica os sites (o job `sites` passou a depender dele). Na `main`, uma execução nova espera a anterior em vez de cancelá-la (não corta migration no meio). Segredos no GitHub: `SUPABASE_ACCESS_TOKEN` (token pessoal do Supabase, vale para a conta toda) e `SUPABASE_DB_PASSWORD`; o `KEKS` continua só no painel do Supabase. Prod entra com segredos e ambiente protegido próprios na publicação.
* **No ar e validado (2026-10-21):** segredos cadastrados, PR #8 na `main`, CI publicou migration, functions e sites (conferido: `/d` com a CSP própria, política com a data nova, function com 404/400 e CORS). No emulador, com o `garagem-dev` real: entrar na conta → carro volta da nuvem → "Criar e enviar link" (30 dias) → compartilhamento com o link → aberto no Chrome do aparelho, o histórico aparece decifrado, sem foto e com "Com comprovante" → "Desativar" com confirmação → some dos links ativos. Reabrir o link desativado no Chrome não foi refeito no aparelho (coberto pelo teste ponta a ponta local: 404).

**Decisões em aberto:**
* **Supabase:** conta criada; projeto `garagem-dev` em São Paulo (`sa-east-1`), sem exposição automática de tabelas e com RLS automático. O de prod (`garagem-prod`) fica para a publicação: o plano gratuito dá 2 projetos e pausa os parados há 1 semana — ok para dev, não para prod. **Login do Google (2026-10-21):** a tela do Google mostra o domínio do projeto (`….supabase.co`), que recebe a volta do login. No prod: plano Pro com domínio próprio do Supabase e marca verificada no Google, para aparecer "Garagem" e o nosso domínio (passos no plano de publicação, seção 5).
* **Domínio:** necessário na fatia 5 (página do dossiê) e para a URL da política de privacidade. **Direção (2026-10-20):** formalizar em nome da empresa (CNPJ): domínio `.com.br` no Registro.br com DNS no Cloudflare, Google Workspace, D-U-N-S e conta de organização no Play Console (sem a exigência dos 12 testadores por 14 dias das contas pessoais). Plano e passos em [plano_empresa_publicacao.md](plano_empresa_publicacao.md). **Decidido (2026-10-20):** `acttechsoftware.com.br` (mais o `.com` no Cloudflare para proteger a marca); o app fica em `garagem.acttechsoftware.com.br`. **Política de privacidade (2026-10-20):** `sites/garagem/privacidade.html`, servida em `/privacidade`, com `/excluir-conta` ao lado; página da empresa em `sites/acttech`. A política descreve o app com conta, link do dossiê e exclusão; o que ela promete e ainda falta construir (registros de acesso por 6 meses, fatias 5 e 6, prod em São Paulo) está no plano de publicação.
* **iOS / Apple:** sem conta Apple Developer. Proposta: v1 sai primeiro no Android, só com login Google; "Entrar com Apple" (obrigatório na App Store quando há login Google) entra junto com o iOS.
