# Registro de implementação — Módulo 16: Arte

## Escopo entregue

O M16 cria uma camada visual independente da lógica de jogo e um laboratório de edição/pré-visualização:

- `brasil-quiz/js/art-catalog.js`: catálogo editável, com itens, caminhos, textos alternativos, estados visuais e temas.
- `brasil-quiz/js/art.js`: API `BQ5.art` para listar, selecionar, aplicar, validar e persistir preferências visuais.
- `brasil-quiz/css/art.css`: estilos de apresentação e paletas temáticas.
- `brasil-quiz/assets/art/`: artes SVG provisórias para que o laboratório abra com conteúdo demonstrativo.
- `dev/art-lab.html`, `dev/art-lab.js`, `dev/art-lab.css`: laboratório independente com biblioteca, composição, preview individual, troca de tema, upload temporário e restauração de padrões.
- `docs/ART_GUIDE.md`: instruções para substituir/adicionar imagens e integrar a API posteriormente.

## Regras de arquitetura

- O módulo não altera `engine.js`, banco de questões, pontuação, cronômetro, seleção de questões, resultados ou fluxo de partida.
- Preferências usam `BQ5.storage.getJSON/setJSON`, em chave própria `bq5_art_selection_v1`.
- Caminhos de assets devem ser locais e começar por `assets/art/`; URLs externas e caminhos com `../` são rejeitados.
- O catálogo `art-catalog.js` é o ponto de edição cotidiano. Ao substituir um arquivo pelo mesmo caminho, aumente `revision` para evitar cache antigo.
- A seleção no laboratório é rascunho até clicar em **Salvar seleção local**. A imagem carregada pelo seletor do aparelho é apenas temporária; para mantê-la, copie-a para `assets/art/` e cadastre-a no catálogo.
- O módulo oferece estados `idle`, `happy` e `sad` por arquivos separados ou mídia animada GIF/WebP. Recorte/linha do tempo de spritesheets em grade não faz parte desta primeira entrega.

## Integração com a aplicação principal

O laboratório funciona isoladamente. A conexão com a interface principal foi deixada como etapa separada porque os arquivos públicos consultados e o checkpoint M15 disponível não correspondiam integralmente à árvore mais recente após Alpha 2. Não presumir que o bootstrap, a ordem dos scripts ou o HTML atual sejam idênticos aos do checkpoint.

Antes de ativar no jogo, confirmar a árvore de trabalho atual e então:

1. carregar `css/art.css` depois de `css/style.css`;
2. carregar `js/art-catalog.js` e `js/art.js` depois de `storage.js` e `ui.js`;
3. chamar `BQ5.art.init()` depois da inicialização da UI;
4. conectar os espaços visuais via `data-bq5-art-slot` e reaplicar `BQ5.art.apply()` após renderizações dinâmicas.

Não reativar automaticamente o botão Personalização nem criar um Perfil no escopo deste módulo.

## Testes e limites da validação

- `python tests/run_art_structure.py`: **85 verificações estruturais aprovadas, 0 falhas**.
- `node tests/test_art_runtime.js`: **11 assertions aprovadas** para a API e persistência simulada.
- `node --check` aprovado para `art.js`, `art-catalog.js` e `art-lab.js`.
- A validação visual em navegador real não foi concluída neste ambiente. Executar localmente pelo servidor HTTP e conferir desktop, celular, retrato/paisagem, troca de arquivos, temas e salvamento.

Portanto, o pacote está pronto para ser aplicado e testado localmente, mas o M16 só deve ser marcado como concluído após a validação visual na árvore real do projeto e, se desejado, após a integração com o bootstrap principal.

## Numeração

Esta entrega atribui o número **M16** a Arte. Havia uma proposta anterior de usar M16 para um motor compartilhado de desafios/chefes, ainda tratada como planejamento. Caso essa proposta continue, renumerá-la para um módulo posterior e atualizar o mapa de módulos; não manter dois M16 distintos no mesmo `PROGRESS.md`.
