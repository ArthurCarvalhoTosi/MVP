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
- [ ] U: contratar o Google Workspace para o domínio; verificar o domínio (registro TXT no Cloudflare).
- [ ] C: passar os registros de e-mail para o Cloudflare, conferindo os valores na tela do Workspace na hora: MX, SPF (TXT), DKIM (gerado no Admin do Workspace) e DMARC (começar com `p=none`).
- [ ] U: criar apelidos `contato@`, `privacidade@`, `dev@`.
- [ ] U: comprar o `acttechsoftware.com` no Cloudflare Registrar.

### 2. D-U-N-S (disparar cedo: leva de alguns dias úteis a até 30 dias)
- [ ] U: pedir pelo site oficial da Dun & Bradstreet (gratuito; ignorar sites que cobram). Razão social e endereço **idênticos** ao cartão CNPJ, site da empresa e e-mail do domínio.

### 3. Enquanto o D-U-N-S não chega (C, no repo)
- [ ] Política de privacidade em pt-BR (LGPD): dados coletados, criptografia local e na nuvem, exclusão de conta (fatia 6), contato `privacidade@`. Publicar no Cloudflare Pages no subdomínio.
- [ ] Fatia 5 (link do dossiê): página estática no Cloudflare Pages, snapshot em JSON pela Edge Function. Ver "Achado: HTML nas Edge Functions" na seção 12 do doc.
- [ ] Fatia 7 adiantada: `eas.json`, build AAB assinado pelo EAS com chave própria (Play App Signing), sair do atalho do `garagem-dev` fixo no código.
- [ ] Textos da ficha da loja, classificação de conteúdo, formulário de segurança de dados (o que o app coleta, criptografia, exclusão).

### 4. Contas em nome da empresa
- [ ] U: Play Console, conta de **organização**, com o D-U-N-S e o e-mail da empresa. Taxa única de US$ 25. Verificar por código e-mail e telefone de contato e de desenvolvedor.
- [ ] U: Google Cloud `garagem-dev`: adicionar o e-mail da empresa como Owner; na tela de consentimento OAuth, trocar e-mail de suporte, preencher página inicial, política de privacidade e domínio autorizado. Depois, publicar a tela (sair do modo de teste) para qualquer conta Google entrar.
- [ ] U: Supabase: convidar o e-mail da empresa para a organização e transferir a posse.
- [ ] U: Expo: criar a conta com o e-mail da empresa (usada no EAS).
- [ ] GitHub: pode continuar pessoal.

### 5. Publicação
- [ ] C: primeiro build de produção (AAB) e checklist da ficha.
- [ ] U: subir num teste interno/fechado curto com quem quiser (sem mínimo de testadores nem prazo na conta de organização), depois produção.

## Como começar a nova conversa

Peça para ler este arquivo, o `AGENTS.md` e a seção 12 do doc de decisões. Comece pelas decisões em aberto (nome do domínio, endereço do CNPJ) e pelo passo 1.

## Fontes (consultadas em 2026-10-20)

- [Requisitos de teste para contas pessoais novas (Google Play)](https://support.google.com/googleplay/android-developer/answer/14151465)
- [Requisitos de conta de organização no Play Console](https://support.google.com/googleplay/android-developer/answer/13628312)
- [Testes abertos, fechados e internos (Google Play)](https://support.google.com/googleplay/android-developer/answer/9845334)
- [TLDs do Cloudflare Registrar](https://www.cloudflare.com/tld-policies/)
- [D-U-N-S (ajuda da Apple)](https://developer.apple.com/br/help/account/membership/D-U-N-S/)
