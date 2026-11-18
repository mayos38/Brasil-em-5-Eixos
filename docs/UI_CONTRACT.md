# UI_CONTRACT — Brasil em 5 Eixos

**Contrato atualizado até o Módulo 11, sobre a estrutura visual consolidada no Módulo 6 e o planejamento do Módulo 5.5.**

Contrato entre `brasil-quiz/index.html`, `brasil-quiz/css/style.css`, `docs/IDENTIDADE_VISUAL.md`, `docs/ASSET_CATALOG.md` e os módulos de interface 7–15.

Este documento descreve a estrutura e os estados visuais que os módulos futuros devem consumir. Ele **não substitui** as APIs públicas reais de `config.js`, `bank.js`, `storage.js` ou `engine.js`. Nenhum módulo de interface deve presumir uma função, propriedade ou modo que não exista no respectivo módulo-base.

## Regras gerais

1. Os módulos 7–15 consomem os IDs, atributos, classes e templates definidos aqui. Não renomeiam elementos sem atualizar HTML, CSS, contrato e testes em conjunto.
2. O HTML fornece a estrutura; o CSS fornece apresentação e estados; o JavaScript controla dados, navegação e comportamento.
3. Não usar `onclick` inline, inserir texto do banco como HTML, nem escrever cores diretamente no JavaScript.
4. O banco atual contém **508 questões**, mas a quantidade é dinâmica. A interface deve ler a contagem por meio da API real de `bank.js`; nunca fixar `508` no código.
5. O produto possui cinco eixos selecionáveis: **Cultura, Economia, Animais, Vegetação e Cidades**. Clima é subtópico associado a Vegetação, não um sexto eixo.
6. A identidade visual é provisória e segue `docs/IDENTIDADE_VISUAL.md`. O CSS não carrega imagens, fontes ou outros recursos remotos.
7. O layout começa em 320 px, mantém alvos de toque mínimos de 48 px e respeita `prefers-reduced-motion`.
8. O Módulo 9 coleta configuração; o Módulo 10 apresenta o jogo; `engine.js` continua sendo a autoridade de sorteio, respostas, pontuação, tempo e persistência. `bank.js` continua sendo a autoridade sobre disponibilidade e dados.
9. **Regra obrigatória: não implementar pausa de partida.** Não criar botão, ação, estado, evento, atalho, API ou fluxo de pausa/retomada; não congelar o cronômetro por modal, troca de aba, `visibilitychange` ou perda de foco. Sair abandona a partida por `engine.abort()`. Esta restrição é permanente para os próximos LLMs, salvo mudança explícita de requisito pelo usuário.

---

## 1. Telas e navegação

Cada tela é uma `<section class="bq5-screen" data-screen="...">`. Apenas uma tela fica visível por vez; as demais recebem `hidden`.

| `data-screen` | ID | Módulo principal | Observação |
|---|---|---:|---|
| `boot` | `screen-boot` | 15 | Inicialização; `data-state="loading"` ou `data-state="error"`. |
| `menu` | `screen-menu` | 8 | Menu, recorde solo e quantidade carregada no banco. |
| `setup` | `screen-setup` | 9 | Configuração da partida; somente solo individual está habilitado nesta versão. |
| `play` | `screen-play` | 10 | Partida solo nesta versão; demais modos dependem de seus módulos futuros. |
| `handoff` | `screen-handoff` | 13 | Troca de aparelho entre jogadores no grupo local. |
| `results` | `screen-results` | 11 | Pontuação, ranking quando aplicável e revisão educativa. |
| `campaign` | `screen-campaign` | 12 | Progresso e rota pelas cinco regiões. |
| `lan` | `screen-lan` | 14 | Esqueleto inicial da sala com amigos; pode ser detalhado dentro da tela. |

### Regras de navegação

- `#bq5-app[data-screen]` reflete a tela ativa.
- Ao trocar de tela, ocultar a anterior e revelar a nova sem deixar duas telas visíveis simultaneamente.
- Atualizar `#bq5-back` conforme a navegação permitir retorno.
- Mover o foco para o `h1` da tela aberta. Se não for adequado, focar `#bq5-main` (`tabindex="-1"`). Títulos focados programaticamente devem receber `tabindex="-1"`; nunca usar `tabindex` positivo.
- `bq5-is-entering` é opcional e só deve ser aplicado se a preferência de movimento permitir.
- `screen-boot` começa visível e com `data-state="loading"`.

### Estado de inicialização

- `#screen-boot[data-state="loading"]` mostra `#boot-status` e oculta visualmente `.bq5-boot__error` pelo CSS.
- `#screen-boot[data-state="error"]` oculta `#boot-status` e mostra o bloco `#boot-error`.
- `#boot-error` não começa com `hidden`: a visibilidade depende do estado de `.bq5-boot`. Não adicionar `hidden` sem alterar também a estratégia CSS, pois `[hidden]` prevalece.
- `#boot-error-details` recebe um `<li>` por detalhe, com conteúdo inserido por `textContent`.
- `retry-boot` solicita nova tentativa; não deve indicar sucesso antes do retorno real do carregador.

---

## 2. Ações (`data-action`)

Os eventos são delegados por `ui.js` a partir de um ancestral estável. Não criar `onclick` inline.

| Ação | Uso esperado |
|---|---|
| `back` | Voltar conforme a pilha/estado de navegação. |
| `retry-boot` | Tentar novamente o carregamento inicial. |
| `go-solo` | Abrir configuração solo. |
| `go-campaign` | Abrir a campanha. |
| `go-local` | Abrir configuração para grupo no mesmo aparelho. |
| `go-lan` | Abrir a sala com amigos. |
| `setup-select-mode` | Selecionar modalidade pelo `data-value`; somente `solo` está disponível no Módulo 9. |
| `setup-select-theme` | Selecionar um dos cinco eixos ou `all` (todos). |
| `setup-select-diff` | Selecionar uma chave existente em `config.tiers`. |
| `count-dec` | Diminuir a quantidade de perguntas, respeitando o mínimo válido. |
| `count-inc` | Aumentar a quantidade de perguntas, respeitando o máximo válido. |
| `players-add` | Adicionar jogador local, respeitando o limite configurado (planejado: 2–4). |
| `players-remove` | Remover o último jogador sem ultrapassar o mínimo permitido. |
| `start-game` | Validar configuração e solicitar início de partida. |
| `quit-game` | Solicitar confirmação e abandonar a partida conforme as regras do motor; não oferece pausa. |
| `next` | No estado de escolha, confirmar a alternativa selecionada; após a revelação, avançar; na última, abrir resultados. |
| `handoff-ready` | Confirmar que o próximo participante está pronto. |
| `to-menu` | Retornar ao menu. |
| `to-campaign` | Abrir mapa/progresso da campanha. |
| `replay` | Repetir o modo/etapa compatível com o resultado atual. |
| `campaign-stage` | Solicitar a etapa indicada em `data-value` (chave da região). |
| `campaign-reset` | Solicitar confirmação e reiniciar o progresso da campanha. |
| `lan-copy` | Copiar o código do campo/contexto correspondente ao botão acionado. |
| `lan-accept` | Processar o código de resposta recebido pelo anfitrião. |
| `lan-join` | Tentar entrar na sala com o código informado. |
| `lan-start` | Iniciar partida LAN quando as condições forem satisfeitas. |
| `modal-cancel` | Fechar/cancelar o diálogo ativo. |
| `modal-confirm` | Confirmar a ação apresentada no diálogo ativo. |
| `open-profile` | Abrir o resumo do perfil local, recorde e progresso disponível. |
| `open-options` | Abrir opções de interface; a redução de animações vale somente na sessão. |
| `open-customization` | Exibir o estado da personalização futura, sem fingir que ela já está disponível. |
| `toggle-motion` | Alternar a redução de animações na sessão atual. |

As alternativas **não** usam `data-action`. São os quatro botões `.bq5-option[data-index="0".."3"]` dentro de `#play-options`; delegar o clique nesse contêiner ou em ancestral estável e validar o índice.

`campaign-stage`, `modal-cancel` e `modal-confirm` começam nos templates. A ausência dessas ações fora de templates não é falha.

### Fluxo de confirmar e avançar

`#play-next` é um único botão reutilizado nos dois momentos:

1. Antes de responder, seu rótulo é **“Confirmar”** e começa desabilitado. Ao selecionar uma alternativa, a UI marca somente uma opção como `selected` e habilita o botão.
2. Ao confirmar, a UI chama a operação de resposta do motor. Só após resposta válida, revela correta/incorreta, feedback, pontos e explicação; o botão passa a **“Próxima pergunta”**.
3. Na última questão, o rótulo passa a **“Ver resultado”**.
4. O cronômetro deve tratar a expiração como resposta sem escolha segundo a assinatura real do motor; não permitir que a UI registre duas respostas para a mesma questão.

---

## 3. IDs estáticos por área

Os IDs abaixo integram o contrato e devem permanecer únicos no documento. `modal-title` é a exceção controlada dentro do template modal: só pode existir uma instância modal aberta por vez.

### Casca da aplicação

`bq5-app`, `bq5-topbar`, `bq5-back`, `bq5-topbar-aux`, `bq5-main`, `bq5-modal-root`, `bq5-toast-root`.

### Boot

`screen-boot`, `boot-title`, `boot-status`, `boot-message`, `boot-error`, `boot-error-title`, `boot-error-text`, `boot-error-details`, `boot-retry`.

### Menu

`screen-menu`, `menu-title`, `menu-record`, `menu-best-solo`, `menu-bank-info`.

`menu-bank-info` exibe a contagem devolvida pelo banco carregado (atualmente informada como 508). Nunca escrever a quantidade literal como regra permanente.

Identidade inicial e progresso local: `menu-player-name`, `menu-player-rank`, `menu-progress-text`, `menu-progress-count`, `menu-progress-bar`. O nome inicial **Explorador** é provisório: os módulos-base ainda não oferecem API de perfil/nome editável. A contagem de regiões concluídas vem de `storage.getProgress()` e a barra só é atualizada quando `config.campaignStages` está disponível.

Ferramentas do menu: `open-profile` abre um resumo; `open-options` abre `tpl-menu-options`; `open-customization` informa que a personalização está planejada. Não inventar persistência de preferências nem gravar diretamente no `localStorage`. O controle de movimento reduzido altera somente `#bq5-app[data-motion="reduced"]` durante a sessão.

### Configuração

`screen-setup`, `setup-title`, `setup-lead`, `setup-section-mode`, `setup-modes-title`, `setup-modes`, `setup-mode-hint`, `setup-section-themes`, `setup-themes-title`, `setup-themes`, `setup-section-tiers`, `setup-tiers-title`, `setup-tiers`, `setup-tier-hint`, `setup-section-count`, `setup-count-title`, `setup-count-dec`, `setup-count-value`, `setup-count-inc`, `setup-count-hint`, `setup-section-rules`, `setup-rules-title`, `setup-rules`, `setup-section-players`, `setup-players-title`, `setup-players`, `setup-players-add`, `setup-players-remove`, `setup-start`.

O Módulo 9 gera as opções a partir de `config.themes`, `config.themeLabels`, `config.tiers` e `config.tierLabels`, usando `#tpl-choice`; não duplica opções estáticas. Os cinco eixos selecionáveis são Cultura, Economia, Animais, Vegetação e Cidades, além de `all` (todos). A modalidade `solo` é a única habilitada; Campanha, grupo local e LAN aparecem como futuras/desabilitadas até seus módulos estarem implementados. A quantidade padrão vem de `config.soloQuestionCount` e é limitada à disponibilidade calculada a partir de `bank.list()` com a mesma regra de pool mínimo do motor; `engine.start()` é a validação definitiva. `#setup-rules` informa quatro alternativas, confirmação explícita, tempo, pontuação, bônus e ausência de pausa.

### Partida

`screen-play`, `play-title`, `play-index`, `play-total`, `play-score`, `play-quit`, `play-progress`, `play-cast`, `play-player-slot`, `play-player-name`, `play-bubble`, `play-pet-slot`, `play-pet-name`, `play-roster`, `play-timer`, `play-time-left`, `play-tags`, `play-tag-theme`, `play-tag-region`, `play-tag-diff`, `play-question`, `play-options`, `play-feedback`, `play-feedback-title`, `play-feedback-points`, `play-feedback-text`, `play-live`, `play-next`.

- `play-progress` é uma barra semântica visualizada como sequência de marcadores dinâmicos (um por questão), não como preenchimento contínuo.
- `play-timer` é a barra fina dentro do topo de `article.bq5-question`; `play-time-left` é o numeral ao lado dela.
- `play-tag-theme` usa um dos cinco valores de `data-theme`. Quando o conteúdo for subtópico clima, manter `data-theme="vegetacao"` e usar `data-subtopic="clima"`.

### Troca de aparelho

`screen-handoff`, `handoff-player-slot`, `handoff-pet-slot`, `handoff-title`, `handoff-player`, `handoff-info`, `handoff-ready`.

### Resultados

`screen-results`, `results-title`, `results-context`, `results-score`, `results-record`, `results-right`, `results-errors`, `results-total`, `results-pct`, `results-performance-wrap`, `results-performance-title`, `results-performance`, `results-stage`, `results-stage-title`, `results-stage-text`, `results-ranking-wrap`, `results-ranking-title`, `results-ranking`, `results-review-wrap`, `results-review-title`, `results-review`, `results-menu`, `results-campaign`, `results-replay`.

O Módulo 11 lê primeiro o resultado final de `engine.result()` e usa `result.review`/`engine.review()` para montar a revisão. Pontuação, acertos e erros não são recalculados quando o motor já os informa; a UI só deriva valores ausentes para compatibilidade. Cada cartão da revisão informa enunciado, resposta marcada, resposta correta e explicação (`q.e`/`q.explanation`). O desempenho por eixo é agregado a partir das questões efetivamente respondidas.

O histórico usa `storage.getJSON()`/`storage.setJSON()` com a chave `config.storageKeys.matchHistory` ou `config.storageKeys.history`, quando disponível; caso contrário, usa `bq5_match_history_v1`. São guardados até 60 resumos de partida (data, modo, pontuação, acertos/erros, aproveitamento, parâmetros e desempenho por eixo), sem duplicar o banco nem persistir o texto integral das questões. Recorde solo e progresso de campanha continuam responsabilidade do `engine`/`storage`.

**Contrato futuro 1x1/multiplayer (módulos 13/14):** `mode` deve ser `1v1`, `1x1`, `duel`, `multiplayer`, `local` ou `lan`; `outcome` deve indicar explicitamente `win`, `loss` ou `draw` (alternativamente, `won`/`isWinner` booleanos ou o par `playerId` + `winnerId`). `players` ou `ranking` pode ser uma lista de `{id,name,score,rank}` para a classificação. A tela só escreve **“Vitória”**, **“Você perdeu”** ou **“Empate”** para esses modos e quando houver desfecho explícito; não deduz vencedor pela pontuação de um jogador isolada. `results:replay` e `results:campaign` são eventos de integração para os módulos de modo/campanha que virão. Solo usa `setup.start()` para repetir a mesma configuração; menu retorna ao `screen-menu`.

### Campanha

`screen-campaign`, `campaign-title`, `campaign-progress-text`, `campaign-done`, `campaign-total`, `campaign-progress`, `campaign-route`, `campaign-reset`.

### Sala com amigos (LAN)

`screen-lan`, `lan-title`, `lan-lead`, `lan-role`, `lan-panel-host`, `lan-host-code`, `lan-host-copy`, `lan-host-answer`, `lan-host-accept`, `lan-panel-join`, `lan-join-offer`, `lan-join-connect`, `lan-join-code`, `lan-join-copy`, `lan-players-title`, `lan-players`, `lan-status`, `lan-start`.

### IDs em templates

`tpl-choice`, `tpl-player-field`, `tpl-roster-item`, `tpl-ranking-item`, `tpl-review-item`, `tpl-route-node`, `tpl-lan-player`, `tpl-modal`, `modal-title`, `tpl-menu-options`, `tpl-toast`.

---

## 4. Grupos de rádio e seleções exclusivas

Tema, dificuldade e papel na sala são seleções exclusivas e usam `radiogroup`/`radio`:

- O contêiner tem `role="radiogroup"` e nome acessível por `aria-labelledby` ou `aria-label`.
- Cada opção tem `role="radio"`, `aria-checked="true|false"` e nome acessível a partir do texto visível.
- Cada grupo mantém exatamente um rádio habilitado com `tabindex="0"`; os demais usam `tabindex="-1"` (roving tabindex).
- Ao entrar com Tab, o foco vai para a opção selecionada; se nenhuma estiver selecionada, vai à primeira opção habilitada.
- Setas direcionais movem foco e seleção ciclicamente. Espaço seleciona a opção focada; Enter também pode selecionar.
- A UI deve atualizar `aria-checked` e `tabindex` de modo coerente ao mover foco/seleção.
- Se uma escolha controlar um painel, deve informar `aria-controls` e atualizar a visibilidade do painel correspondente.
- Opções desabilitadas não recebem foco por setas.

No HTML estático, `#lan-role` já contém dois rádios: `host` selecionado e `join` não selecionado, cada um apontando para seu painel via `aria-controls`. `#tpl-choice` é um rádio inerte, inicialmente `aria-checked="false"` e `tabindex="-1"`; ao cloná-lo, o módulo 9 preenche texto, valor, tema e estado de foco.

---

## 5. Estados e atributos controlados pelo JavaScript

| Elemento | Atributo/variável | Valores e finalidade |
|---|---|---|
| `.bq5-screen` | `hidden` | Todas exceto a tela ativa ficam ocultas. |
| `#bq5-app` | `data-screen` | Chave da tela ativa. |
| `.bq5-option` | `data-state` | ausente, `selected`, `correct`, `wrong`, `dimmed`. |
| `.bq5-option` | `disabled` | Aplicado após resposta/revelação conforme fluxo. |
| `.bq5-choice` | `aria-checked`, `tabindex`, `data-value` | Estado e valor de rádio. `data-theme` pode colorir uma escolha de eixo. |
| `.bq5-tag` | `data-theme`, `data-subtopic`, `data-region`, `data-kind` | Contexto da questão; clima usa `data-subtopic`, não um eixo independente. |
| `.bq5-route__node` | `data-state`, `data-region` | `locked`, `available`, `done`; região define cor. |
| `.bq5-review` | `data-ok` | `true` ou `false`. |
| `.bq5-ranking__item` | `data-pos` | Posição numérica no ranking. |
| `.bq5-roster__item` | `data-active` | `true`/`false`; jogador da vez. |
| `.bq5-boot` | `data-state` | `loading` ou `error`. |
| `#play-timer` | `data-level` | `ok`, `warn`, `danger`. Normalmente >50%, atenção entre 20–50%, perigo abaixo de 20%; limites podem ser ajustados no módulo 10. |
| `.bq5-meter__fill` | `--p` | Fração de tempo/progresso entre 0 e 1, quando o componente usar preenchimento contínuo. |
| `.bq5-progress-pip` | `data-state` | `pending`, `current`, `correct`, `wrong`. Um marcador por questão. |
| `.bq5-meter--time` | `bq5-anim-pulse` opcional | Reforço no estado final; respeitar redução de movimento. |
| `.bq5-companion` | `data-filled` | `false` enquanto marcador provisório; `true` quando houver arte. |
| elenco | `data-mood` | `idle`, `happy`, `sad`. |

### Progresso por questão

`#play-progress` mantém `role="progressbar"`, `aria-valuemin`, `aria-valuemax` e `aria-valuenow`. O módulo 10 cria um `.bq5-progress-pip` por questão, cada qual com `aria-hidden="true"` e `data-state`. O contêiner também atualiza `aria-valuetext` (por exemplo, “3 de 10 perguntas concluídas”). Não usar texto visual como único indicador do progresso.

### Cronômetro

`#play-timer` fica dentro de `.bq5-question__timer`, um grupo nomeado (`role="group"`, `aria-label="Tempo da questão"`). O CSS mostra a barra com `--p` e o estado `data-level`; `#play-time-left` mostra segundos em fonte monoespaçada. O denominador de `--p` é a duração efetiva da questão. O Módulo 10 prioriza `engine.state().timeLimitMs` (M5.6). Compatibilidade com o núcleo anterior: se `config.questionTimeMs` for um único inteiro positivo, pode ser usado como duração. Se `questionTimeMs` for um objeto por dificuldade, exigir `state().timeLimitMs` positivo; sem ele, impedir o início e informar incompatibilidade de versão. Em todos os casos, o tempo restante vem de `engine.remainingMs()` e a expiração chama `engine.answer(-1)` exatamente uma vez. Não manter uma segunda fonte de tempo na UI.

### Exceções de estilo inline

- HTML estático: `style="--p:..."` somente nos componentes de barra que o CSS transforma com `scaleX()`: `#play-timer`, `#play-progress`, `#campaign-progress` e `#menu-progress-bar`.
- JS: pode atualizar `--p` e `--c` conforme este contrato. Não escrever cores, `width`, `height`, `display`, `background` ou outros estilos de apresentação diretamente no elemento.
- Para qualquer nova exceção, atualizar este contrato, o CSS e o teste antes de usar no JavaScript.

---

## 6. Elenco: personagem e companheiro animal

- Estrutura: `.bq5-companion[data-slot="player|pet"][data-filled="false|true"]` com `.bq5-companion__frame > .bq5-companion__art[data-art]`.
- Sem arte (`data-filled="false"`): marcador provisório com anel tracejado e emoji decorativo; o elemento `[data-art]` tem `aria-hidden="true"`.
- Com arte: inserir elemento local adequado em `[data-art]`, marcar `data-filled="true"` e fornecer nome acessível ao componente preenchido (`role="img"` e `aria-label`, quando aplicável).
- Humor: `data-mood="idle|happy|sad"` em `#play-cast` afeta os dois personagens; pode ser aplicado individualmente a `.bq5-companion`.
- `#play-bubble` é o balão de fala e começa com `hidden`.
- O Módulo 10 pode mudar `#play-cast[data-mood]` entre `idle`, `happy` e `sad`. Se as artes/personagens ainda não existirem, manter os marcadores provisórios; não inventar arquivos de imagem.
- Efeitos sonoros ficam preparados pelo evento `BQ5.ui.emit("sfx:play", { cue: "correct" | "wrong" | "timeout" })`. Até existir um módulo de áudio e arquivos licenciados no catálogo, o evento é apenas um ponto de integração sem reprodução de som.
- Variantes de tamanho: `--sm` para placar/lista, padrão para partida e `--lg` para handoff. Dimensões são controladas pelos tokens de avatar.
- A altura reservada por `.bq5-cast` evita deslocamento quando a arte futura for inserida.

Nenhum personagem ou companheiro ilustrado é considerado asset existente no Módulo 6; consultar `ASSET_CATALOG.md`.

---

## 7. Templates dinâmicos

Clonar com `template.content.firstElementChild.cloneNode(true)`. Não colocar IDs internos repetíveis, com exceção de `modal-title` dentro de `tpl-modal`; só uma instância de modal pode ficar aberta de cada vez.

| Template | Uso |
|---|---|
| `tpl-choice` | Rádio de tema/dificuldade/papel. |
| `tpl-player-field` | Campo de nome de jogador local. |
| `tpl-roster-item` | Participante no placar. |
| `tpl-ranking-item` | Linha de classificação. |
| `tpl-review-item` | Revisão educativa de questão. |
| `tpl-route-node` | Etapa regional na campanha. |
| `tpl-lan-player` | Jogador na sala LAN. |
| `tpl-modal` | Confirmação/diálogo. |
| `tpl-toast` | Aviso rápido. |

### Modal

- Inserir em `#bq5-modal-root`.
- Manter `role="dialog"`, `aria-modal="true"` e `aria-labelledby="modal-title"`.
- `#tpl-modal` disponibiliza `bq5-modal__extra` para conteúdo adicional clonado de templates locais; não inserir HTML recebido do banco/usuário.
- Gerenciar foco: ao abrir, focar controle adequado; prender Tab/Shift+Tab ao modal; ao fechar, devolver foco ao acionador.
- Escape/backdrop só fecha quando isso não invalidar uma operação em andamento; botões `modal-cancel`/`modal-confirm` continuam sendo o caminho explícito.

### Toasts e anúncios

- Inserir avisos visuais em `#bq5-toast-root` usando texto seguro (`textContent`).
- Mensagens de resultado da pergunta devem ser anunciadas em `#play-live` (`role="status"`); não duplicar anúncio assertivo em várias regiões live.
- `#bq5-toast-root` usa `aria-live="polite"`; erros que exigem ação podem ter tratamento mais assertivo quando necessário.

---

## 8. Classes dinâmicas previstas no CSS

As classes abaixo podem ser adicionadas pelo JavaScript mesmo quando não aparecem como classe fixa em elementos do HTML:

- `bq5-is-entering`
- `bq5-anim-pop`
- `bq5-anim-shake`
- `bq5-anim-pulse`
- `bq5-progress-pip`

Outras classes dinâmicas só podem ser introduzidas depois de documentadas aqui e declaradas no CSS. Nomes de classe devem manter o prefixo `bq5-`.

---


Classes dinâmicas do Módulo 11: `bq5-performance__item`, `bq5-performance__name`, `bq5-performance__value`.
## 9. Tokens de design e identidade visual

A identidade é provisória; os valores implementados devem seguir `docs/IDENTIDADE_VISUAL.md`. O CSS centraliza tokens de cor e dimensões reutilizáveis em `:root`.

### Tokens canônicos presentes no CSS

- **Estrutura:** `--bq5-bg`, `--bq5-surface-1`, `--bq5-surface-2`, `--bq5-border`, `--bq5-border-strong`, `--bq5-text-primary`, `--bq5-text-secondary`.
- **Marca/feedback:** `--bq5-primary`, `--bq5-primary-ink`, `--bq5-success`, `--bq5-success-bg`, `--bq5-error`, `--bq5-error-bg`, `--bq5-warning`, `--bq5-warning-bg`, `--bq5-info`, `--bq5-disabled-text`, `--bq5-disabled-surface`, `--bq5-focus`, `--bq5-overlay`, `--bq5-bg-gradient-end`, `--bq5-topographic-line`.
- **Eixos:** `--bq5-theme-cultura`, `--bq5-theme-economia`, `--bq5-theme-animais`, `--bq5-theme-vegetacao`, `--bq5-theme-cidades`.
- **Subtópico:** `--bq5-subtopic-clima` (não selecionável como eixo).
- **Regiões:** `--bq5-region-norte`, `--bq5-region-nordeste`, `--bq5-region-centro-oeste`, `--bq5-region-sudeste`, `--bq5-region-sul`.
- **Tipografia:** `--bq5-font`, `--bq5-font-mono`, `--bq5-fs-xs`, `--bq5-fs-sm`, `--bq5-fs-md`, `--bq5-fs-lg`, `--bq5-fs-xl`, `--bq5-fs-2xl`, `--bq5-fs-hero`.
- **Espaçamento/forma:** `--bq5-sp-1` a `--bq5-sp-7`, `--bq5-r-sm`, `--bq5-r-md`, `--bq5-r-lg`, `--bq5-r-pill`, `--bq5-shadow-1`, `--bq5-shadow-2`.
- **Layout/áreas seguras:** `--bq5-w-app`, `--bq5-w-question`, `--bq5-tap`, `--bq5-option-min`, tokens de avatar e `--bq5-safe-*`.
- **Movimento:** `--bq5-dur-fast`, `--bq5-dur`, `--bq5-dur-slow`, `--bq5-ease`.

### Semântica dos temas e subtópicos

Os cinco eixos selecionáveis são **Cultura, Economia, Animais, Vegetação e Cidades**, além da opção “Todos os temas”. Não existe token `--bq5-theme-clima` nem seletor `[data-theme="clima"]`. Para um item de conteúdo climático, usar o eixo `vegetacao` e opcionalmente `data-subtopic="clima"`. O subtópico nunca entra na lista de opções de eixo.

### Semântica das regiões

As cinco regiões são `norte`, `nordeste`, `centro-oeste`, `sudeste` e `sul`. Manter o hífen de `centro-oeste`.

### Contraste e acessibilidade

A paleta de texto segue AA para texto normal nos fundos de aplicação/superfície. Os tons de tema são usados principalmente em marcadores e contornos; o texto dos chips permanece `text-primary`. `border-strong` é usado em controles para fornecer contorno perceptível. `disabled-text` é reservado a controles não interativos e informação não essencial.

Qualquer alteração de cor exige recalcular contraste e atualizar `IDENTIDADE_VISUAL.md`, este contrato e `run_ui_structure.py`.

### Dimensões visuais que devem ser preservadas

- Corpo mínimo: 16 px; enunciado: 17–18 px no mobile.
- Alvo de toque: `--bq5-tap: 3rem` (48 px).
- Alternativa: `--bq5-option-min: 3.5rem` (56 px).
- Aplicação/menu/campanha: até 960 px; fluxo de questão: até 720 px.
- Raio: botão 10 px, cartão 14 px, modal 16 px.
- Espaçamento: escala de 4 a 48 px, tokens `sp-1` a `sp-7`.

---

## 10. Acessibilidade, segurança e responsividade

1. Documento `lang="pt-BR"`; viewport inclui `viewport-fit=cover`.
2. Link `.bq5-skip` aponta para `#bq5-main`.
3. Botões estáticos e clonados declaram `type="button"`, salvo formulário futuro que especifique explicitamente `submit`.
4. Inputs/textarea têm nome acessível por `<label>` associado, rótulo envolvente ou atributo ARIA adequado.
5. Referências `aria-labelledby`, `aria-describedby`, `aria-controls`, `for` e âncoras apontam para elementos existentes no contexto correto. `modal-title` é único dentro da instância modal.
6. Texto do banco, nomes de jogadores e códigos entram por `textContent`/`value`. Não usar `innerHTML` com dados do banco ou do usuário.
7. CSS não carrega fontes/imagens de terceiros. Assets futuros devem ser locais e registrados no catálogo antes do uso.
8. Não reduzir `--bq5-tap` abaixo de 3rem (48 px); alternativas têm no mínimo 3.5rem (56 px).
9. Respeitar safe areas e breakpoints: estreito até 22.5rem; landscape de baixa altura sem forçar duas colunas; opções em duas colunas apenas a partir de 40rem (640 px); tablet/desktop a partir de 48rem.
10. Respeitar `prefers-reduced-motion: reduce`.
11. Feedback de acerto/erro deve usar cor + ícone/sinal + texto. Ao confirmar resposta, atualizar as quatro alternativas, `#play-feedback`, `#play-live` e o botão `#play-next`.
12. Em grupo local, mostrar `#play-roster` e usar `screen-handoff`; em solo/campanha, mantê-lo oculto.

---

## 11. Carregamento de scripts e ambiente

Scripts-base são clássicos (não ES modules) e preservam esta ordem:

1. `js/config.js`
2. `js/util.js`
3. `js/storage.js`
4. `js/bank.js`
5. `js/engine.js`

Módulos de interface ativos:

1. `js/ui.js` (módulo 7) — camada central, eventos delegados, navegação, foco, templates, modal, toast e preferência de movimento reduzido da sessão.
2. `js/screens/menu.js` (módulo 8) — identidade inicial, recorde, progresso e entradas do menu.
3. `js/screens/setup.js` (módulo 9) — configuração solo por tema/eixo, dificuldade, modalidade e quantidade disponível; regras apresentadas antes de iniciar.
4. `js/screens/play.js` (módulo 10) — fluxo de pergunta, seleção + confirmação, timer, progresso, pontos, revelação, timeout e abandono.
5. `js/screens/results.js` (módulo 11) — resultado, revisão educativa, desempenho por eixo e histórico resumido.

Ainda pendentes, e mantidos sem `<script src>` ativo até existirem:
6. `js/screens/campaign.js` (módulo 12)
7. `js/multiplayer/local.js` (módulo 13)
8. `js/multiplayer/lan.js` (módulo 14)
9. `js/main.js` (módulo 15)

O Módulo 8 registra intenções (`intent:solo`, `intent:campaign`, `intent:local`, `intent:lan`) no barramento da UI. O Módulo 9 assina `intent:solo` e abre a configuração; as outras modalidades permanecem futuras/desabilitadas. `BQ5.screens.menu.show()` continua sendo chamado pelo bootstrap do Módulo 15 após o carregamento válido do banco; M7–M11 não contornam a tela de boot nem iniciam o menu automaticamente.

Não usar `async` nos scripts dependentes. Se `defer` for introduzido, validar novamente a ordem e o momento de inicialização. `../dev/ui-preview.js` é provisório de desenvolvimento e deve ser removido no Módulo 15 antes da distribuição. O carregamento de `data/questions.json` depende de HTTP local; não assumir que `fetch()` funcionará via `file://`.

---

## 11.1 API pública da camada central (`BQ5.ui`)

O Módulo 7 publica uma única API em `BQ5.ui`:

- DOM: `init()`, `el()`, `all()`, `text()`, `hidden()`, `cloneTemplate()`.
- Eventos: `on()`, `emit()`, `onAction()`, `hasListeners()`; ações `data-action` são delegadas a partir de `#bq5-app`.
- Navegação: `showScreen(name, options)`, `back()`, `currentScreen()`; a navegação mantém uma pilha simples e foca o título da tela.
- Componentes globais: `openModal()`, `closeModal()`, `toast()`.
- Preferência da sessão: `setReducedMotion()` e `isReducedMotion()`.

O módulo coordena DOM e eventos, mas não consulta ou altera diretamente `engine` para produzir regras de jogo, não carrega banco, não grava recordes e não acessa `localStorage` por conta própria. Os módulos de tela podem ouvir intenções da UI e delegar as ações aos módulos de domínio apropriados.

## 12. Pendências que precisam ser confirmadas nos módulos-base

1. **Cronômetro:** confirmar como `engine.js` e `config.js` expõem a duração efetiva da questão. A UI não pode presumir `engine.state().timeLimitMs` sem encontrar essa propriedade na API real.
2. **Configuração:** conferir os nomes reais de temas, rótulos, tiers, quantidade e tempo em `config.js` antes de gerar opções.
3. **Banco:** confirmar a assinatura real de `BQ5.bank` para obter lista e contagem. O menu usa o valor retornado, não 508 fixo.
4. **Modos:** confirmar quais modos `engine.js` efetivamente aceita. A existência de telas solo/campanha/grupo/LAN não significa que todos já estejam funcionais.
5. **Persistência:** usar somente operações existentes de `storage.js` para recordes e campanha; não duplicar persistência diretamente na UI.
6. **Assets:** B1–B3 e F6–F9 continuam pendentes no catálogo; não referenciar arquivos que ainda não existem. B4–B6 estão provisoriamente resolvidos em CSS.
7. **Game feel:** feedback de acerto/erro usa estados CSS existentes, animações curtas respeitam movimento reduzido, personagem usa apenas `data-mood` no placeholder, e o evento de som é no-op até integrar assets licenciados.
8. **Sem pausa:** requisito imutável. Nenhum LLM deve adicionar pausa, retomada, estado `paused`, timer congelado, ação/evento de pausa ou suspensão por visibilidade/foco. Modal de saída não pausa o relógio; abandonar chama `engine.abort()`.

Divergências são registradas como incompatibilidades entre contrato e implementação e devem ser resolvidas no módulo responsável antes de avançar.

---

## 13. Critérios mínimos do teste estrutural

`tests/run_ui_structure.py` deve validar:

- existência do HTML, CSS, contrato, identidade visual e catálogo de assets;
- IDs únicos, presença dos IDs do contrato e referências ARIA/`for`/âncoras válidas;
- oito telas, uma tela inicial visível (`boot`) e nove templates;
- ações presentes no HTML e documentadas no contrato;
- classes do HTML e classes dinâmicas documentadas declaradas no CSS;
- tokens CSS usados definidos em `:root`, aderência da paleta e contraste dos pares essenciais;
- estilos inline limitados a `--p` no HTML e às exceções documentadas no JS;
- chaves CSS balanceadas, regras `[hidden]`, foco, toque, safe area, responsividade e redução de movimento;
- relógio dentro do cartão de questão e progresso da partida baseado em marcadores por questão;
- cinco eixos e ausência de clima como sexto tema;
- ordem e existência dos scripts-base, sem `async`/`defer` incompatível;
- referências de IDs, templates e classes pelos módulos JS de UI quando existirem;
- continuidade do catálogo M5.5: não exigir recursos marcados como planejados, mas não aceitar arquivos independentes não registrados.

As verificações devem distinguir falhas de avisos. `RESULT: OK` demonstra apenas aprovação estrutural; não prova funcionamento visual nem fluxo completo no navegador.
