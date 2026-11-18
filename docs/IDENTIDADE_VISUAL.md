# IDENTIDADE VISUAL PROVISÓRIA — Brasil em 5 Eixos

> **Status: identidade visual provisória, planejada no Módulo 5.5 e materializada parcialmente no Módulo 6.**
> Esta proposta não substitui o visual do protótipo original: evolui a paleta navy + amarelo e a tipografia `system-ui` já existentes em `brasil-quiz-prototipo.html`.
> A identidade será reavaliada durante os testes do primeiro Beta. Não se considera definitiva antes dessa validação.
>
> Nenhuma interface comercial foi copiada. As referências abaixo são princípios de hierarquia, linguagem cartográfica e legibilidade, não reproduções de produtos de terceiros.

## 1. Referências complementares da proposta

### A. Identidade brasileira

- Território como protagonista: a silhueta estilizada do Brasil e a rota Norte → Sul já existente no protótipo (item E1 do `ASSET_CATALOG.md`) são a referência cartográfica da campanha.
- Elementos cartográficos: linhas topográficas discretas, grade de coordenadas e símbolos regionais podem aparecer como apoio visual, sem competir com o conteúdo.
- Cores inspiradas em biomas e território (verde-mata, terracota, azul-água e violeta), usadas com sobriedade.
- Evitar combinações tricolores decorativas repetidas. O amarelo da marca é prioritariamente uma cor de ação, não uma faixa ornamental em toda a interface.

### B. Linguagem de jogos

- Hierarquia visual clara: uma ação principal por tela; ações secundárias não competem com ela.
- Progressão visível: marcador de questão, progresso da partida, etapas da campanha e recordes persistidos.
- Cartões, indicadores, botões e feedbacks possuem estados previsíveis e documentados na seção 6.
- Recompensa e evolução: exibir o bônus de tempo junto ao acerto, manter números em fonte monoespaçada e usar microanimações curtas (150–250 ms como referência visual).

### C. Linguagem cartográfica

- A campanha é a tela com maior protagonismo cartográfico. O mapa regional deve ser legível e acompanhado de nomes e legenda.
- Linhas topográficas, coordenadas e sinais regionais são decoração de fundo, nunca informação essencial.
- A linguagem visual deve aproximar o jogo de um **atlas interativo**, não de um quiz genérico.

## 2. Paleta de cores

Tema escuro "noite cartográfica", em continuidade ao protótipo (`#0A1220`, `#FFD23F`). Os valores abaixo são a referência da identidade. Os tokens CSS equivalentes são definidos em `brasil-quiz/css/style.css`.

### Cores estruturais

| Token conceitual | HEX | Papel | Contraste de referência |
|---|---|---|---:|
| `bg` | `#0A1220` | Fundo principal | — |
| `surface-1` | `#182440` | Cartões e painéis | texto primário: 13,7:1 |
| `surface-2` | `#233252` | Superfície elevada / hover / áreas internas | — |
| `border` | `#2C3D66` | Divisórias e bordas decorativas | — |
| `text-primary` | `#EEF2FB` | Texto principal | sobre bg: 16,7:1 |
| `text-secondary` | `#93A1BD` | Legendas e metadados não essenciais | sobre bg: 7,2:1 |

A implementação M6 acrescenta `border-strong` (`#7183A6`) para contornos de controles que precisam ser mais perceptíveis. Essa cor é derivada para acessibilidade e não substitui a cor decorativa `border`.

### Marca e ações

| Token conceitual | HEX | Papel | Contraste de referência |
|---|---|---|---:|
| `primary` | `#FFD23F` | Ação primária e destaques pontuais | sobre bg: 13,0:1 |
| `primary-ink` | `#0A1220` | Texto/ícone sobre primary | sobre primary: 13,0:1 |

### Estados de feedback

| Token conceitual | HEX | Papel | Contraste de referência sobre bg |
|---|---|---|---:|
| `success` | `#2FBF71` | Acerto e progresso concluído | 7,9:1 |
| `error` | `#FF6B6B` | Erro, alternativa incorreta e tempo esgotado | 6,8:1 |
| `warning` | `#FF9D3F` | Atenção e faixa final do relógio | 9,1:1 |
| `disabled-text` | `#5E6A85` | Texto realmente desabilitado, não essencial | 3,4:1 |
| `disabled-surface` | `#202B47` | Superfície de controles desabilitados | — |

A cor de texto desabilitado tem contraste deliberadamente inferior a AA porque identifica conteúdo não interativo. Não usar esse token em instruções, perguntas, alternativas disponíveis ou informação essencial.

### Cores dos cinco eixos

Usadas em marcadores, bordas, ícones e contexto visual. O nome do eixo deve sempre estar presente; cor nunca é o único meio de identificação.

| Eixo | Token conceitual | HEX | Contraste de referência sobre bg |
|---|---|---|---:|
| Cultura | `theme-cultura` | `#C97B5A` | 5,8:1 |
| Economia | `theme-economia` | `#4E8FD1` | 5,5:1 |
| Animais | `theme-animais` | `#E0A458` | 8,6:1 |
| Vegetação | `theme-vegetacao` | `#2FBF71` | 7,9:1 |
| Cidades | `theme-cidades` | `#A78BFA` | 6,9:1 |

**Clima não é um sexto eixo.** É um assunto/subtópico associado ao eixo Vegetação. Quando necessário, a interface pode identificá-lo separadamente por `data-subtopic="clima"`, mantendo `data-theme="vegetacao"` para a cor e a classificação principal.

### Regras de uso e equilíbrio

1. Cada tela deve ter uma ação principal inequívoca. O amarelo deve concentrar a hierarquia dessa ação e pode aparecer em sinais funcionais pequenos previstos nesta especificação (por exemplo, faixa normal do relógio ou estado selecionado); não deve formar grandes áreas decorativas concorrentes.
2. `success`, `error` e `warning` são cores semânticas: usar em feedback, indicadores, bordas e ícones, não como decoração de grandes superfícies.
3. Cores dos eixos aparecem nos contextos de eixo (ícone, marcador, chip e cabeçalho). Texto de pergunta e alternativas permanece em `text-primary`.
4. Manter no máximo dois níveis de elevação além do fundo: `bg` → `surface-1` → `surface-2`.
5. Gradientes são permitidos apenas em tons navy próximos. Textura cartográfica de fundo deve ter opacidade muito baixa.
6. Texto secundário não substitui texto primário em enunciados, alternativas, pontuação ou instruções essenciais.

## 3. Tipografia

**Beta: somente fontes locais/sistema — sem CDN e sem download de fontes.** WOFF2 é uma possibilidade futura (item F9 do catálogo), condicionada a licença documentada.

| Papel | Stack | Peso/tamanho | Regra |
|---|---|---|---|
| Títulos e display | `system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif` | display 800; títulos 700–800 | Hierarquia por peso, tamanho e espaçamento |
| Textos, perguntas e alternativas | mesma stack de sistema | corpo mínimo 16 px; pergunta 17–18 px no mobile | line-height confortável (alvo 1,5) |
| Indicadores numéricos | `Consolas, "SF Mono", ui-monospace, Menlo, monospace` | corpo ou maior; peso 600–700 | `font-variant-numeric: tabular-nums` |

### Regras de hierarquia e legibilidade

1. Manter no máximo três níveis tipográficos visíveis por tela: título, corpo e legenda.
2. Texto interativo e informativo deve atender ao contraste AA (4,5:1), exceto estados realmente desabilitados e não essenciais.
3. Não usar itálico para conteúdo essencial. Negrito deve reforçar hierarquia, acerto e números importantes, sem excesso.
4. Numerais de pontuação, relógio e contagem devem usar algarismos tabulares.

## 4. Espaçamento, dimensões e elevação

### Escala de espaçamentos

Base de 4 px: `4 · 8 · 12 · 16 · 24 · 32 · 48 px`, tokens CSS `--bq5-sp-1` a `--bq5-sp-7`.

- Padding interno típico de cartão: 16 px.
- Espaçamento entre cartões de lista: 12 px no mobile e 16 px em telas maiores.
- Margem lateral de tela: 16 px no mobile e 24 px em telas maiores.

### Raios, bordas e sombras

| Elemento | Raio | Borda | Elevação |
|---|---:|---|---|
| Botão | 10 px | primário sem borda; secundário com contorno | primário `0 2px 6px rgba(0,0,0,.35)` |
| Cartão de questão/painel | 14 px | 1 px `border` | sombra discreta, sem competir com o conteúdo |
| Chip | 999 px | borda de 1 px; seleção pode usar 2 px | sem sombra |
| Modal | 16 px | 1 px de borda | sombra `0 8px 24px rgba(0,0,0,.35)` + overlay |

### Larguras e limites

- Mobile abaixo de 600 px: largura fluida com margens laterais; alternativas em uma coluna no retrato.
- Fluxo de questão: largura máxima 720 px, centralizada.
- Menu e campanha: podem ocupar até 960 px em telas amplas.
- Alternativas: área clicável mínima de 56 px de altura no mobile; botão primário e demais controles principais com pelo menos 48 px.

## 5. Responsividade mobile-first

O projeto nasce mobile-first. A experiência de computador amplia a de celular; não é a referência inversa.

1. **Celular (< 600 px):** coluna única; alternativas empilhadas no retrato; áreas clicáveis de pelo menos 48×48 px; intervalo entre alternativas de pelo menos 8 px; sem dependência de hover.
2. **Tablet/landscape (a partir de aproximadamente 600 px):** menus e seleções podem usar duas colunas. O fluxo de questão continua limitado a 720 px.
3. **Desktop (a partir de 1024 px):** mesma hierarquia, com hover e foco visíveis; atalhos A–D e Enter só entram quando implementados/documentados no módulo de partida.
4. **Orientação:** retrato é a referência. Landscape deve refluír sem corte de conteúdo; não forçar rotação. O timer deve permanecer visualmente associado ao painel da questão.
5. **Legibilidade:** corpo mínimo de 16 px; pergunta de 17–18 px no mobile. Não reduzir fonte para acomodar conteúdo extenso.
6. **Acessibilidade:** feedback de acerto/erro por cor + ícone + texto; foco visível de 2 px; `prefers-reduced-motion` deve reduzir animações não essenciais.

## 6. Componentes visuais — aparência e comportamento

### Botões

- **Primário:** preenchido `primary`, texto `primary-ink`, peso 700, raio 10 px, altura mínima 48 px. Hover pode elevar discretamente; active indica pressão.
- **Secundário:** transparente ou superfície neutra, contorno discreto e texto primário. Usado para voltar/cancelar.
- **Perigo:** contorno/texto `error` (por exemplo, sair de uma partida); ações destrutivas exigem confirmação por modal.
- **Desabilitado:** superfície e texto `disabled`; cursor e estado precisam deixar claro que não é interativo.

### Cartões

Painéis de conteúdo usam `surface-1`, borda de 1 px, raio 14 px e padding de 16 px. Seleção usa borda/contexto do eixo ou estágio, sem grande preenchimento saturado.

### Alternativas

- Cartão horizontal com selo A–D à esquerda e texto da alternativa.
- Mobile: uma coluna; a partir de 640 px, grade 2×2 pode ser usada.
- Estados: normal → selecionada → revelação. Na revelação, correta usa `success` e ícone de confirmação; incorreta escolhida usa `error` e ícone de erro; demais ficam neutras/desabilitadas.
- O fluxo de partida usa seleção seguida de confirmação explícita pelo botão principal. Após confirmar, o mesmo controle pode virar “Próxima pergunta” ou “Ver resultado”.

### Painel de questão

Cartão centralizado, largura máxima 720 px; cabeçalho com eixo/região/dificuldade e contador; enunciado em 17–18 px no mobile; alternativas abaixo; temporizador em barra fina no topo do painel e numeral ao lado.

### Temporizador e progresso

- Relógio: barra fina amarela em estado normal, laranja em `warning` e vermelha em `error/0`; numeral monoespaçado ao lado.
- Progresso da partida: sequência de pontos/pílulas, um marcador por questão. Marcadores concluídos são verdes para acerto e vermelhos para erro; pendentes permanecem neutros; questão atual recebe destaque.
- Progresso da campanha: cinco etapas Norte → Sul, conectadas pela rota; etapa concluída recebe marca de conclusão e pontuação.

### Feedback de acerto e erro

Ícone/check ou cross em CSS/SVG local + cor semântica + microanimação curta + texto. Bônus de tempo deve aparecer junto do acerto. A cor nunca é o único sinal.

### Modais

Overlay escuro próximo de `rgba(4,8,16,.7)`; painel centralizado com raio 16 px; largura de referência 420 px no mobile e até 520 px em telas maiores; altura limitada com rolagem interna; título, corpo e ações. Ao abrir, o foco entra e permanece no modal; Escape/backdrop só fecham quando a ação permitir; ao fechar, foco retorna ao controle que o abriu.

### Navegação

- Mobile: botão de voltar no topo e título da tela; menus como cartões em lista.
- Desktop: barra superior compacta, marca à esquerda e ações à direita; breadcrumb pode ser usado em fluxo multi-etapa quando agregar orientação.

### Resultados e recordes

Pontuação final em fonte monoespaçada, recorde solo destacado quando atualizado e revisão educativa organizada por pergunta, resposta do jogador, resposta correta e explicação. A ação de repetir é primária; voltar ao menu é secundária.

### Seleção de temas e dificuldades

- Cinco eixos selecionáveis + “Todos os temas”. Clima não aparece como sexto eixo.
- Dificuldades usam os rótulos definidos pela configuração real do projeto; não duplicar nomes no HTML se forem gerados dinamicamente.

## 7. Padrões técnicos para assets

Convenções completas em `docs/ASSET_CATALOG.md`:

- Logo, ícones e mapas: SVG local.
- Ilustrações/fundos raster: WebP ou AVIF; PNG apenas quando transparência/compatibilidade justificar.
- Fontes: WOFF2 com licença documentada.
- Áudio offline: OGG/MP3 compacto e com licença clara.
- Sem CDN, fonte remota ou imagem remota.
- **CSS antes de arquivo:** gradientes navy, linhas topográficas sutis, selos e ícones simples devem ser CSS quando isso reduzir arquivos e manutenção.
- Todo asset futuro deve ter origem, autoria, licença/atribuição e hash SHA-256 registrado antes de ser consumido.

## 8. Integração por módulo e rastreabilidade

| Módulo | Consumo/entrega |
|---|---|
| 5.5 | Planejamento de identidade e inventário de assets; sem implementação de código ou criação de arquivos de mídia |
| 6 | Materializa tokens, estrutura HTML, componentes CSS, responsividade e contratos visuais |
| 7 | UI comum, navegação, modal/toast e templates |
| 8 | Menu principal e apresentação do banco/recorde |
| 9 | Configuração de temas/dificuldades/quantidade |
| 10 | Questão, alternativas, timer, progresso e feedback |
| 11 | Resultados, recordes e revisão |
| 12 | Campanha, etapas regionais e mapa |

Expansões futuras incluem modo Aprendizado, dificuldade Geógrafo, campanha mundial e componentes de cartas/multiplayer. Devem reaproveitar os tokens e contratos existentes, com mudanças registradas antes da implementação.

**Atualização de continuidade:** a frase original do planejamento de que os tokens ainda não estavam implementados descrevia o encerramento do Módulo 5.5. A implementação começou no Módulo 6 e está materializada em `brasil-quiz/css/style.css`; diferenças justificadas ficam registradas no `UI_CONTRACT.md`.

## 9. Restrições da identidade provisória

- Não substitui o visual do protótipo: evolui a base navy + amarelo e a stack de fontes do sistema.
- Está sujeita a ajustes durante testes visuais do Beta.
- Mudanças de identidade aprovadas devem atualizar este documento, o catálogo e o CSS/HTML correspondentes.
- Este documento não cria nem licencia assets por si só; nenhum arquivo visual é considerado existente sem arquivo correspondente no disco.
