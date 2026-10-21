# Plano: empresa, domínio e publicação no Google Play

Criado em 2026-10-20. Este arquivo abre um contexto só sobre formalizar o Garagem em nome da empresa (CNPJ) e preparar a publicação. Ao fechar cada passo, marque aqui e registre a decisão na seção 12 de [decisoes_projeto_manutencao_veicular.md](decisoes_projeto_manutencao_veicular.md).

## Por que

- Hoje tudo está em contas pessoais (Google Cloud `garagem-dev`, Supabase, GitHub).
- **Conta pessoal no Play Console** criada depois de 13/11/2023 só publica depois de um teste fechado com **12 testadores inscritos por 14 dias seguidos**. **Conta de organização não tem essa exigência.**
- Conta de organização exige **D-U-N-S** (gratuito, pela Dun & Bradstreet) e site da organização. O mesmo D-U-N-S serve depois para a Apple.
- O app precisa de domínio de qualquer forma: página do dossiê (fatia 5), política de privacidade (Play Store e tela de login do Google).

## Decisões tomadas

- Formalizar em nome da empresa: domínio, e-mail e contas com e-mail da empresa.
- **Domínio principal `.com.br` no Registro.br**, no CNPJ. O Cloudflare Registrar não vende `.br`.
- **DNS no Cloudflare** (plano gratuito): o registro continua no Registro.br, os servidores DNS apontam para o Cloudflare.
- `.com` do mesmo nome no Cloudflare Registrar: opcional, só para proteger a marca.
- **Google Workspace com um usuário** (Business Starter, plano mensal flexível, cobrado em reais: R$ 39,20/mês nos 12 primeiros meses, depois R$ 49,00; teste de 14 dias iniciado em 2026-10-20). Outros endereços (`contato@`, `privacidade@`, `dev@`) como apelidos gratuitos do mesmo usuário.
- **App num subdomínio** da empresa, por exemplo `garagem.<empresa>.com.br`: dossiê e política de privacidade. Domínio próprio da marca só se ela crescer.
- **Play Console: conta de organização.** O tipo de conta não muda depois da verificação.
- **Domínio: `acttechsoftware.com.br`** (decidido em 2026-10-20), mais o **`acttechsoftware.com`** no Cloudflare Registrar para proteger a marca. App em `garagem.acttechsoftware.com.br`.

## Empresa

- **Nome empresarial (razão social):** ARTHUR CARVALHO TOSI TECNOLOGIA DA INFORMACAO LTDA
- **Nome de fantasia:** ACT TECH & SOFTWARE
- **Endereço do CNPJ:** não é residencial (confirmado em 2026-10-20), então pode aparecer na loja sem problema.
- No D-U-N-S e no Play, razão social e endereço **exatamente** como no cartão CNPJ. O nome de desenvolvedor exibido na loja pode ser o de fantasia.

## Em aberto (decidir antes de comprar)

1. ~~**Nome do domínio.**~~ Decidido: `acttechsoftware.com.br` (ver acima). Consulta pública (RDAP do Registro.br e da Verisign) em 2026-10-20, sem valor de reserva (a confirmação final é na compra):

   | Domínio | Situação |
   |---|---|
   | `acttechsoftware.com.br` | livre |
   | `acttechsoftware.com` | livre |
   | `actsoftware.com.br` | livre (o `.com` já tem dono) |
   | `actsoft.com.br` | livre (o `.com` já tem dono) |
   | `acttech.dev.br`, `acttech.tec.br` | livres |
   | `acttech.com.br` / `act-tech.com.br` | registrado (o Registro.br trata os dois como o mesmo) |
   | `acttech.com`, `actsoft.com`, `actsoftware.com` | registrados |

   Sugestão: **`acttechsoftware.com.br`** (nome de fantasia completo, e o `.com` igual também está livre para proteger a marca). Mais curto: `actsoftware.com.br`, mas sem o `.com` correspondente.
2. **Supabase de produção:** criar `garagem-prod` antes do primeiro teste com outras pessoas, ou testar no `garagem-dev`. O plano gratuito permite 2 projetos e pausa projetos parados há 1 semana. Hoje URL e chave do `garagem-dev` estão fixas em `src/account/index.ts` (atalho anotado para a fatia 7).

## Passos

Dono: **U** = usuário (compras, cadastros, documentos), **C** = Claude (código, textos, configuração no repo).

### 1. Domínio e e-mail
- [x] U: comprar `acttechsoftware.com.br` no Registro.br, titular o CNPJ (2026-10-20).
- [x] U (2026-10-20; delegação em transição, ~2 h no Registro.br): servidores `elliott.ns.cloudflare.com` e `nina.ns.cloudflare.com`; registros de "domínio sem e-mail" do Registro.br (MX nulo, SPF `-all`, DMARC `reject`) importados e mantidos até o Workspace; IA: busca e agentes liberados, treinamento bloqueado. Criar conta no Cloudflare com o e-mail definitivo (ou pessoal e trocar depois), adicionar o domínio, trocar os servidores DNS no Registro.br pelos que o Cloudflare indicar.
- [x] U: contratar o Google Workspace para o domínio; verificar o domínio (registro TXT no Cloudflare). Usuário administrador `arthur@acttechsoftware.com.br` (2026-10-20).
- [x] C: registros de e-mail no Cloudflare, conferidos no DNS público em 2026-10-20: MX `smtp.google.com` prioridade 1 (MX nulo do Registro.br apagado), SPF `v=spf1 include:_spf.google.com ~all`, DKIM `google._domainkey` (RSA 2048) e DMARC `v=DMARC1; p=none; rua=mailto:arthur@acttechsoftware.com.br`. Endurecer o DMARC para `quarantine` e depois `reject` quando os relatórios mostrarem só envios legítimos.
- [x] U: criar apelidos `contato@`, `privacidade@`, `dev@` (2026-10-20).
- [x] U: comprar o `acttechsoftware.com` no Cloudflare Registrar (2026-10-20). Fica como proteção de marca; o principal continua o `.com.br`. Depois, pode entrar no Workspace como domínio alternativo (gratuito) para receber e-mails `@acttechsoftware.com`.

### 2. D-U-N-S (disparar cedo: leva de alguns dias úteis a até 30 dias)
- [x] U: pedir pelo site oficial da Dun & Bradstreet (gratuito; ignorar sites que cobram). Razão social e endereço **idênticos** ao cartão CNPJ, site da empresa e e-mail do domínio. Pedido em 2026-10-20 pela consulta da Apple (`developer.apple.com/enroll/duns-lookup/`; só abriu em janela anônima): a empresa não tinha número; a Apple diz que o número foi enviado ao e-mail informado. Também ficou um contato aberto na CIAL (parceira da D&B na América Latina), que oferece um "expresso" pago: dispensar e avisar do pedido pela Apple.
- [ ] U: **D-U-N-S `571894742` recebido em 2026-10-20 com a razão social errada** ("JOSEMAR T. M. DA S. CARVALHO TECNOLOGIA DA INFORMACAO LTDA"). Não usar no Play até a D&B mostrar a razão social e o endereço atuais do cartão CNPJ: pedir a atualização gratuita (CIAL ou consulta da Apple) com o cartão CNPJ como prova. Se o número for de outra empresa, pedir um novo.

### 3. Enquanto o D-U-N-S não chega (C, no repo)
- [x] C: sites estáticos em `sites/` (2026-10-20), sem fontes, scripts nem rastreadores de terceiros (CSP em `_headers`):
  - `sites/acttech`: página da empresa (exigência do Play para conta de organização) → `acttechsoftware.com.br` e `www`.
  - `sites/garagem`: página do app, `/privacidade` (LGPD) e `/excluir-conta` (o Play pede uma URL de exclusão fora do app) → `garagem.acttechsoftware.com.br`.
  - Preview local: `.claude/launch.json` (`site-garagem`, porta 4320).
- [x] C: CNPJ `68.301.882/0001-69` e endereço do cartão CNPJ (R Pais Leme, 215, conj 1713, Pinheiros, São Paulo/SP, CEP 05424-150) nos sites (2026-10-20).
- [x] U: publicado no Cloudflare Pages em 2026-10-20 (projetos `acttech` e `garagem`, este em `garagem-f1r.pages.dev`), domínios ligados. Conferido no ar: as 5 páginas com 200, CSP e HSTS, HTTP redireciona para HTTPS. Comandos em "Publicar os sites" abaixo.
- [ ] Antes da produção, a política promete e o app ainda não faz:
  - **Registros de acesso por 6 meses** (Marco Civil, art. 15; provedor de aplicação PJ com fins econômicos). Os logs do Supabase gratuito duram 1 dia: gravar IP, data e hora dos logins e das chamadas autenticadas numa tabela própria, com expurgo após 6 meses.
  - **Exclusão de conta no app** (fatia 6) no caminho descrito em `/excluir-conta`: Seus carros → Conta → Excluir conta.
  - **Link do dossiê** (fatia 5) com o que a política diz: snapshot sem placa, chassi e observações; fotos só se o dono ligar; validade e desativação; só o hash do token gravado.
  - **`garagem-prod` em São Paulo** (`sa-east-1`): a política diz "servidores em São Paulo".
  - Mudou fornecedor, dado coletado ou permissão: atualizar a política e a data no topo.
- [x] C: Fatia 5 (link do dossiê) construída em 2026-10-21 no branch `feat/dossier-link`: cópia **cifrada pelo próprio link** (segredo depois do `#`, servidor só com cifra e hash), sem fotos, política seção 6 atualizada. Detalhes na seção 12 do doc ("Fatia 5: link do dossiê").
- [ ] U: no ar: cadastrar no GitHub os segredos `SUPABASE_ACCESS_TOKEN` e `SUPABASE_DB_PASSWORD` e fazer o merge do PR; o CI da `main` aplica a migration, publica as Edge Functions e os sites (página `/d` e política nova). Ordem combinada: fatia 5 → fatia 6 → registros de acesso → publicação.
- [ ] Fatia 7 adiantada: `eas.json`, build AAB assinado pelo EAS com chave própria (Play App Signing), sair do atalho do `garagem-dev` fixo no código.
- [ ] Textos da ficha da loja, classificação de conteúdo, formulário de segurança de dados (o que o app coleta, criptografia, exclusão).

### 4. Contas em nome da empresa
- [ ] U: Play Console, conta de **organização**, com o D-U-N-S e o e-mail da empresa. Taxa única de US$ 25. Verificar por código e-mail e telefone de contato e de desenvolvedor.
- [ ] U: Google Cloud `garagem-dev`: adicionar o e-mail da empresa como Owner; na tela de consentimento OAuth, trocar e-mail de suporte, preencher página inicial, política de privacidade e domínio autorizado. Depois, publicar a tela (sair do modo de teste) para qualquer conta Google entrar.
- [ ] U: Supabase: convidar o e-mail da empresa para a organização e transferir a posse.
- [ ] U: Expo: criar a conta com o e-mail da empresa (usada no EAS).
- [ ] GitHub: pode continuar pessoal.

### 5. Publicação
- [ ] U+C: **nome no login do Google.** Hoje a tela do Google diz "para continuar em `bphuqkvehtmmktuyuxyc.supabase.co`": o Google mostra o domínio que recebe a volta do login. Decidido em 2026-10-21: o dev fica assim; no `garagem-prod` (U) contratar o plano Pro com o add-on de domínio próprio do Supabase (ex.: `auth.acttechsoftware.com.br`; conferir o preço, um relato fala em ~US$ 10/mês além do plano) e (U) pedir a verificação da marca no Google Cloud (Branding: nome "Garagem", logo, domínio verificado, política; leva alguns dias úteis; em "Authorized domains" só domínios nossos). (C) Trocar juntos o endereço do Supabase no app, `FUNCTION_URL` em `sites/garagem/d.js` e o `connect-src` de `/d` em `sites/garagem/_headers`. Fontes: [Supabase: Login with Google](https://supabase.com/docs/guides/auth/social-login/auth-google), [discussão #2925](https://github.com/orgs/supabase/discussions/2925).
- [ ] C: primeiro build de produção (AAB) e checklist da ficha.
- [ ] U: subir num teste interno/fechado curto com quem quiser (sem mínimo de testadores nem prazo na conta de organização), depois produção.

## Publicar os sites

**Automático:** todo push para o `main` publica os dois projetos pelo job `sites` do CI (`.github/workflows/ci.yml`). Os projetos foram criados por envio direto, e a Cloudflare não permite ligar o Git a esse tipo de projeto depois; por isso o CI publica com o Wrangler, sem dar à Cloudflare acesso ao repositório. Segredos do repositório: `CLOUDFLARE_API_TOKEN` (token só com Account → Cloudflare Pages → Edit) e `CLOUDFLARE_ACCOUNT_ID`, gravados pelo dono com `gh secret set`.

**Manual** (primeira publicação de um projeto novo ou emergência), pelo Wrangler (CLI do Cloudflare). O login abre o navegador uma vez; a primeira publicação cria o projeto. O Wrangler cria o projeto com o branch do git atual como produção: em projeto novo, confira em Settings → Branch control que o branch de produção é `main`, senão a publicação fica como Preview e o domínio dá 404.

```bash
npx wrangler login
npx wrangler pages deploy sites/garagem --project-name garagem --branch main
npx wrangler pages deploy sites/acttech --project-name acttech --branch main
```

Depois, no painel: Workers & Pages → projeto → Custom domains → `garagem.acttechsoftware.com.br` (projeto `garagem`), `acttechsoftware.com.br` e `www.acttechsoftware.com.br` (projeto `acttech`). Como a zona está na mesma conta, o Cloudflare cria os registros DNS e o certificado sozinho. Para atualizar, repita o `pages deploy`.

## Como começar a nova conversa

Peça para ler este arquivo, o `AGENTS.md` e a seção 12 do doc de decisões. Comece pelas decisões em aberto (nome do domínio, endereço do CNPJ) e pelo passo 1.

## Fontes (consultadas em 2026-10-20)

- [Requisitos de teste para contas pessoais novas (Google Play)](https://support.google.com/googleplay/android-developer/answer/14151465)
- [Requisitos de conta de organização no Play Console](https://support.google.com/googleplay/android-developer/answer/13628312)
- [Testes abertos, fechados e internos (Google Play)](https://support.google.com/googleplay/android-developer/answer/9845334)
- [TLDs do Cloudflare Registrar](https://www.cloudflare.com/tld-policies/)
- [D-U-N-S (ajuda da Apple)](https://developer.apple.com/br/help/account/membership/D-U-N-S/)
