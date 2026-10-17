# src/ui: design system

A identidade visual e seus motivos estão na seção 10 do [doc de decisões](../../decisoes_projeto_manutencao_veicular.md). Telas novas montam a interface com estes componentes em vez de estilizar do zero.

## Tokens (`theme.ts`)

- Cor só por `useTheme().c` ou pela prop `color` do `AppText` (nome do token). Nenhum hex fora de `theme.ts`; cor nova é token novo nas duas paletas, clara e escura.
- Texto sempre com `<AppText variant=…>`: Barlow na interface, Barlow Condensed (`number`, `odometer`) para km e R$. Caixa de frase, nunca rótulo todo em maiúsculas.
- Espaçamento por `space`; raio por `radius` (botão 10, plaquinha 6, tambor 3, linha 0).
- Sem sombras: a separação é feita com linhas de 1px (`c.line`) e espaço.
- Itens de manutenção são linhas de largura total com barra de urgência (`ItemRow`), não grade de cards.
- O hodômetro de tambores é o único elemento chamativo; o resto fica discreto.

## Acessibilidade (obrigatória)

- Urgência nunca só por cor: ícone com forma própria mais a palavra (veja `ItemRow`).
- Alvos de toque ≥ 48dp.
- Todo controle tem `accessibilityRole`, `accessibilityLabel` e `accessibilityState` corretos. Ícones são decorativos e ficam ocultos do leitor de tela; o rótulo ao redor carrega o sentido.
- Mensagem que surge depois de uma ação: `accessibilityLiveRegion` (Android) e `AccessibilityInfo.announceForAccessibility` (iOS), como em `FormError`.
- Animações respeitam "reduzir movimento" (`useReducedMotion`, como no `Odometer`).
- Contraste WCAG AA nas duas paletas.

## Ícones

`Icon` usa `expo-symbols` com nomes no padrão MaterialCommunityIcons. Ícone novo é uma entrada em `glyphs` com o SF Symbol (iOS) e o Material Symbol (Android). Não instale `@expo/vector-icons`: o SDK 58 não o traz mais.

## Componentes novos

Exporte em `index.ts`. Teste em `__tests__/` com React Native Testing Library, buscando por papel e rótulo (`getByRole('button', { name })`); é isso que prova a acessibilidade. Sem snapshots.
