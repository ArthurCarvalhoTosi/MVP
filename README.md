# Garagem

App de manutenção preventiva de carros (Expo + React Native, pt-BR). Decisões de produto e arquitetura em [decisoes_projeto_manutencao_veicular.md](decisoes_projeto_manutencao_veicular.md).

## Rodar

O banco local é cifrado com SQLCipher, que exige build nativo — **o Expo Go não funciona**.

```bash
npm install
npx expo run:android   # ou: npx expo run:ios (macOS)
```

Alternativa sem toolchain local: `eas build --profile development`.

### Windows

- `JAVA_HOME` → JBR do Android Studio (`C:\Program Files\Android\Android Studio\jbr`); `ANDROID_HOME` → `%LOCALAPPDATA%\Android\Sdk`.
- O CMake 3.22.1 padrão traz o ninja 1.10, que falha com caminhos > 260 caracteres. Instale um CMake mais novo (`sdkmanager "cmake;3.31.6"`, traz ninja 1.12) e aponte em `android/local.properties`:
  ```
  cmake.dir=C\:\\Users\\<você>\\AppData\\Local\\Android\\Sdk\\cmake\\3.31.6
  ```
  (`android/` é gerado pelo `expo prebuild`; refaça este passo após `prebuild --clean`.) O registro `LongPathsEnabled` do Windows também precisa estar em 1.

## Testar

```bash
npm test            # Jest: domínio, banco (sql.js + migrations reais), componentes e telas
npm run typecheck
npm run lint        # ESLint (eslint-config-expo, inclui regras do React Compiler)
npm run format      # Prettier (também roda ao salvar, no editor)
```

Os três devem passar antes de todo commit.

## CI/CD

[.github/workflows/ci.yml](.github/workflows/ci.yml) roda os três comandos acima em todo PR para a `main` e em todo push nela. Na `main`, se passarem, gera um APK Android de release (arm64, assinado com a chave de debug) e o publica como artefato da execução por 30 dias: baixe em **Actions → execução → Artifacts** e instale no celular. Para a Play Store, troque por EAS Build com keystore própria.

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
