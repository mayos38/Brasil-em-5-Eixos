# Módulo 16 — Arte

**Objetivo:** separar o catálogo e a aplicação de recursos visuais da lógica do jogo, oferecendo um laboratório de pré-visualização que pode ser usado quantas vezes forem necessárias.

## O que faz parte do M16

- Catálogo central em `brasil-quiz/js/art-catalog.js`.
- Serviço `BQ5.art` em `brasil-quiz/js/art.js`.
- Estilos de arte e temas em `brasil-quiz/css/art.css`.
- Arquivos visuais locais em `brasil-quiz/assets/art/`.
- Laboratório independente em `dev/art-lab.html`.

O módulo não altera perguntas, banco, seleção de questões, pontuação, relógio, campanha, multiplayer ou resultados. Também não cria um novo perfil nem reativa o botão Personalização do menu.

## Testar imediatamente

A partir da raiz do projeto (a pasta que contém `brasil-quiz/` e `dev/`):

```bash
python -m http.server 8000
```

Abra:

```text
http://localhost:8000/dev/art-lab.html
```

O servidor local é necessário para manter os caminhos relativos e evitar restrições do navegador ao abrir arquivos diretamente por `file://`.

## Alterar uma arte existente

1. Abra `brasil-quiz/assets/art/` e entre na pasta correspondente (`characters`, `mascots`, `backgrounds`, `branding`, `icons` ou `illustrations`).
2. Substitua o SVG/WebP/PNG pelo arquivo novo. Para o caminho continuar igual, mantenha o mesmo nome de arquivo.
3. Abra `brasil-quiz/js/art-catalog.js` e aumente o número `revision` no começo do catálogo (por exemplo, de `1` para `2`). Isso força o navegador a buscar a versão nova mesmo que o nome não tenha mudado.
4. Atualize o Laboratório de Arte. Teste retrato, paisagem e tamanhos diferentes antes de aprovar a arte.

## Adicionar uma arte nova

Copie o arquivo para a pasta correspondente e acrescente um objeto na lista do tipo correto em `art-catalog.js`. Exemplo de personagem:

```javascript
{
  id: 'arqueologo',
  name: 'Arqueólogo',
  description: 'Personagem de exploração histórica.',
  src: 'assets/art/characters/arqueologo.webp',
  alt: 'Personagem Arqueólogo com chapéu e mochila',
  fit: 'contain',
  moods: {
    idle: 'assets/art/characters/arqueologo-idle.webp',
    happy: 'assets/art/characters/arqueologo-happy.webp',
    sad: 'assets/art/characters/arqueologo-sad.webp'
  },
  origin: 'Criação interna',
  license: 'Criação interna — sem dependência externa'
}
```

Regras: `id` único, minúsculo e com hífens; caminhos relativos a `brasil-quiz/`; todos os arquivos precisam existir. Os caminhos devem começar por `assets/art/`. O módulo rejeita caminhos externos e `../` por segurança.

## Pastas e formatos sugeridos

| Pasta | Conteúdo | Formato recomendado |
|---|---|---|
| `characters/` | Personagens dos jogadores | WebP ou PNG transparente; SVG se vetorial |
| `mascots/` | Mascotes e expressões | WebP/PNG transparente; GIF/WebP animado quando necessário |
| `backgrounds/` | Fundos e cenários | WebP ou SVG |
| `branding/` | Logotipo e marcas | SVG |
| `icons/` | Ícones de eixos e navegação | SVG |
| `illustrations/` | Ilustrações gerais | SVG/WebP/PNG |

Use `fit: 'contain'` para personagens, mascotes, logotipos e ícones. Use `fit: 'cover'` para fundos. Para estados de personagem, cadastre um arquivo por expressão em `moods`. GIF e WebP animados funcionam como imagem única. Para sprites com expressões diferentes, cadastre um arquivo em cada estado (`idle`, `happy`, `sad`). O primeiro M16 ainda não faz recorte/temporização de spritesheets em grade; para esse formato, exporte os quadros em arquivos separados ou use um GIF/WebP animado pronto.

## Temas e cores

Os temas são listados em `art-catalog.js`, na propriedade `themes`. As cores ficam em `brasil-quiz/css/art.css`, usando seletores `:root[data-bq5-theme="id-do-tema"]` para sobrescrever os tokens existentes do `style.css`.

Para criar um tema:

1. Adicione um item à lista `themes` no catálogo.
2. Crie um bloco CSS para o mesmo ID em `art.css`.
3. Altere os tokens existentes (`--bq5-bg`, `--bq5-surface-1`, `--bq5-text-primary`, `--bq5-primary` etc.).
4. Teste contraste e legibilidade. Não coloque valores de cor diretamente em `art.js`.

## API pública

Carregue `art-catalog.js` antes de `art.js`. O módulo deve ser carregado depois de `storage.js`; para receber eventos de troca de tela, carregue também depois de `ui.js`.

- `BQ5.art.init()` — recupera a seleção salva e aplica o tema.
- `BQ5.art.list(tipo)` — lista itens de `characters`, `mascots`, `backgrounds`, `logos`, `icons` ou `illustrations`.
- `BQ5.art.get(tipo, id)` — obtém um item.
- `BQ5.art.themes()` — lista temas.
- `BQ5.art.selection()` — retorna a seleção local atual.
- `BQ5.art.select(tipo, id)` — seleciona um item e salva localmente.
- `BQ5.art.selectTheme(id)` — troca e salva o tema.
- `BQ5.art.setSelection(objeto)` — atualiza várias escolhas em uma única operação.
- `BQ5.art.reset()` — restaura os padrões.
- `BQ5.art.render(elementoOuSeletor, tipo, id, estado, opções)` — desenha uma imagem em um contêiner.
- `BQ5.art.apply(raiz)` — procura espaços marcados com `data-bq5-art-slot` e preenche-os.
- `BQ5.art.onChange(callback)` — observa mudanças; retorna uma função para cancelar a inscrição.
- `BQ5.art.check()` — valida IDs e caminhos do catálogo.

A preferência é persistida por `BQ5.storage.getJSON/setJSON`, usando a chave independente `bq5_art_selection_v1`. O módulo não grava diretamente no `localStorage` e não modifica as chaves de progresso/recorde.

## Conectar à interface principal (etapa de integração)

O laboratório já funciona sem tocar no jogo. Para exibir as escolhas na interface real, faça a integração em uma alteração separada e pequena:

1. Carregue `css/art.css` depois de `css/style.css`.
2. Carregue `js/art-catalog.js` e depois `js/art.js`, após `storage.js` e `ui.js`.
3. Depois da inicialização do DOM/UI e do carregamento dos módulos, execute `BQ5.art.init()`.
4. Marque os elementos visuais com atributos, por exemplo:

```html
<span class="bq5-player-card__avatar" data-bq5-art-slot="character"></span>
<span class="bq5-companion__art" data-bq5-art-slot="mascot"></span>
```

5. Depois de montar telas ou componentes dinamicamente, chame `BQ5.art.apply(document)` novamente.

O serviço também reconhece os espaços legados `.bq5-player-card__avatar` e `.bq5-companion__art` quando o atributo `data-slot` do contêiner pai identifica `player`, `companion` ou `mascot`. Não altere `engine.js` para isso.

**Importante:** a integração principal não é ativada automaticamente por este patch, pois a árvore pública consultada e o checkpoint disponível não correspondem integralmente à versão Alpha 2 mais recente. O laboratório é independente e não quebra o fluxo atual. Faça a ligação à inicialização que realmente existir no seu projeto ativo, não copie às cegas os números de linha desta documentação.

## Escopo futuro (não implementado neste M16)

- Editor gráfico de paleta dentro do jogo.
- Recorte avançado de spritesheets e timeline de animação.
- Loja, desbloqueios, conquistas ou inventário de cosméticos.
- Sincronização em nuvem entre dispositivos.
- Tela de Perfil/Personalização para o jogador final.

Esses recursos podem consumir `BQ5.art` mais tarde, sem misturar a arte com o motor do jogo.
