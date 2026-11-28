# ASSET CATALOG — Brasil em 5 Eixos

> Catálogo oficial dos recursos visuais, sonoros e tipográficos do projeto.
> Criado no **Módulo 5.5** (planejamento de assets e identidade visual).
> Regra: nenhum asset é marcado como "existente" sem o arquivo correspondente em disco.
> Este catálogo documenta; ele não contém imagens, fontes nem áudio. A implementação CSS dos itens B4–B6 é referenciada, não armazenada como asset.

## 1. Convenções gerais

### Formatos aceitos
| Tipo | Formato preferido | Alternativa | Observação |
|------|-------------------|-------------|------------|
| Logotipo / ícones / elementos vetoriais | **SVG** | — | editável, escala infinita, cores via `currentColor` quando possível |
| Imagens raster (ilustrações, fundos) | **WebP** ou **AVIF** | PNG | PNG só quando transparência simples ou compatibilidade justificar; sem JPEG para UI |
| Fontes locais | **WOFF2** | WOFF | licença documentada obrigatoriamente nesta tabela |
| Música de fundo / SFX offline | **MP3 (128 kbps)** ou **OGG Vorbis** | WAV curto (< 2 s) para SFX | tudo local, sem streaming; tamanhos alvo: música ≤ 1,5 MB/faixa, SFX ≤ 60 KB |
| Mapas interativos | **SVG** (regiões como `<path>` com `data-regiao`) | PNG estático para fallback | o SVG regional é a base da tela de campanha (módulo 12) |

### Nomenclatura
- Somente letras minúsculas, números e hífens.
- Nome descritivo: `<tipo>-<tema>-<variante>.<ext>`.
- Proibidos nomes genéricos (`imagem1`, `final2`, `novo-logo`).
- Exemplos válidos: `logo-brasil5eixos.svg`, `icone-tema-cultura.svg`, `mapa-regiao-norte.svg`, `sfx-acerto.ogg`, `musica-menu-ambiental.mp3`.

### Origem e licença (obrigatório por asset)
Cada linha do catálogo deve registrar: **origem** (criado internamente / fonte externa), **autoria**, **licença** e **atribuição** quando exigida. Recursos externos sem licença identificada ficam na categoria "Licença ou origem ainda não definida" e **não podem ser usados**.

### Offline-first
- Todos os assets em caminhos relativos a partir da raiz do jogo (`assets/...`).
- Sem CDNs, sem imagens remotas, sem fontes hospedadas externamente.
- Elementos decorativos simples (gradientes, formas, linhas topográficas sutis) devem ser feitos **em CSS** quando mais eficiente do que um arquivo separado — ver `docs/IDENTIDADE_VISUAL.md`, seção de padrões técnicos.

## 2. Inventário do que JÁ EXISTE (verificado em disco, Módulo 5.5)

| # | Recurso | Localização | Formato | Status | Observação |
|---|---------|-------------|---------|--------|------------|
| E1 | Rota da campanha (silhueta estilizada do Brasil + linha tracejada Norte→Sul) | embutida em `brasil-quiz-prototipo.html` (bloco `<svg viewBox="0 0 400 300">`) | SVG inline | **Existe, porém embutida** | Não é um arquivo de asset. Recomenda-se extrair para `assets/maps/` no módulo 7+; **não mover agora**. Serve de referência cartográfica da campanha |
| E2 | Paleta e tipografia do protótipo (tema escuro navy + amarelo, fonte system-ui) | embutidas em `brasil-quiz-prototipo.html` | CSS inline | **Existe, porém embutida** | Base de continuidade da identidade provisória; documentada em `docs/IDENTIDADE_VISUAL.md`. Não substituir — evoluir |
| E3 | Arquivos de imagem / ícone / fonte / mapa / áudio como arquivos | — | — | **Nenhum existe** | Verificado por varredura da árvore do projeto (sem `<img>`, `data:`, `@font-face`, `url()`, `<audio>`/`<video>` fora dos itens E1/E2) |

Conclusão do inventário: o projeto hoje **não possui nenhum arquivo de asset independente**. A identidade visual atual vive inteira dentro do protótipo HTML.

## 3. Necessários para o BETA (Módulos 6–11)

| # | Asset | Pasta-alvo | Formato | Prioridade | Status | Origem / licença |
|---|-------|-----------|---------|------------|--------|------------------|
| B1 | Logotipo provisório ("Brasil em 5 Eixos") | `assets/images/branding/` (`logo-brasil5eixos.svg`) | SVG | Alta (Beta) | **Aguardando criação** — desenhar no módulo 7 ou antes, a partir da identidade de `docs/IDENTIDADE_VISUAL.md`; sem download externo | Interna / por definir na criação |
| B2 | Ícones dos cinco temas: cultura, economia, animais, natureza, cidades (5 arquivos) | `assets/icons/` (`icone-tema-cultura.svg`, …) | SVG | Alta (Beta) | **Aguardando criação** — silhuetas simples de 1 linha, preenchimento `currentColor` para herdar a cor do tema | Interna / por definir na criação |
| B3 | Ícones básicos de navegação: início, partida/jogar, configuração, resultados, campanha (mapa), voltar | `assets/icons/` (`icone-nav-inicio.svg`, …) | SVG | Alta (Beta) | **Aguardando criação** — mesma família visual dos ícones de tema (traço 2px, cantos arredondados) | Interna / por definir na criação |
| B4 | Elementos visuais de botões e cartões (bordas, raios, sombras, estados) | — (CSS em `brasil-quiz/css/style.css`) | CSS puro | Alta (Beta) | **Implementado no Módulo 6** — sem arquivo de asset independente | n/a (código próprio) |
| B5 | Fundo principal e elementos decorativos essenciais (gradiente navy, linhas topográficas sutis) | — (CSS em `brasil-quiz/css/style.css`); textura opcional futura em `assets/images/backgrounds/` | CSS (+ WebP se necessário) | Alta (Beta) | **Implementado em CSS no Módulo 6** — arquivo raster continua opcional e não existe | Interna / código próprio |
| B6 | Indicadores de feedback de acerto/erro (check/cross) | — (pseudoelementos em `brasil-quiz/css/style.css`); SVG local é alternativa futura | CSS/SVG | Média (Beta) | **Implementado provisoriamente em CSS no Módulo 6** — não há arquivos SVG independentes | Interna / código próprio |

## 4. Planejado para versões FUTURAS (pós-Beta)

| # | Asset | Pasta-alvo | Formato | Status | Origem / licença |
|---|-------|-----------|---------|--------|------------------|
| F1 | Mapas regionais ilustrados das 5 regiões (norte, nordeste, centro-oeste, sudeste, sul) para a tela de campanha | `assets/maps/` (`mapa-regiao-norte.svg`, …) | SVG com `data-regiao` | **Planejado** — módulo 12; base: extrair e evoluir o E1 | Interna / por definir na criação |
| F2 | Mapa da campanha mundial (expansão futura) | `assets/maps/` (`mapa-campanha-mundial.svg`) | SVG | **Planejado** — depende do escopo da expansão "campanha mundial" | Interna / por definir na criação |
| F3 | Ilustrações específicas de conteúdo (ex.: fauna/região em revisões educativas) | `assets/images/illustrations/` | WebP/AVIF ou SVG | **Planejado** — pós-Beta, conforme necessidade editorial do banco | Interna / por definir na criação |
| F4 | Elementos visuais para cartas (multiplayer/batalhas com cartas) | `assets/images/illustrations/` + moldura em CSS | WebP/SVG + CSS | **Planejado** — módulos 13–14 e expansão "batalhas com cartas" | Interna / por definir na criação |
| F5 | Animações (micro-interações de recompensa, transições) | — (CSS/JS no momento da implementação) | CSS keyframes | **Planejado** — respeitar `prefers-reduced-motion` | n/a (código) |
| F6 | Efeitos sonoros: acerto, erro, tempo esgotado, clique de navegação, fim de partida | `assets/audio/sfx/` (`sfx-acerto.ogg`, …) | OGG/MP3 ≤ 60 KB | **Aguardando aquisição ou criação** — somente com licença clara; sem download aleatório | Por definir (licença obrigatória antes do uso) |
| F7 | Música de fundo para menu e partida | `assets/audio/music/` (`musica-menu-ambiental.mp3`, …) | MP3/OGG ≤ 1,5 MB/faixa | **Aguardando aquisição ou criação** — somente com licença clara (ex.: CC0/BY atribuída) | Por definir (licença obrigatória antes do uso) |
| F8 | Recursos gráficos exclusivos do modo Geógrafo (dificuldade máxima) | `assets/images/themes/` / `assets/icons/` | SVG/WebP | **Planejado** — expansão "Dificuldade Geógrafo" | Interna / por definir na criação |
| F9 | Fontes locais WOFF2 (upgrade opcional da stack de sistema) | `assets/fonts/` | WOFF2 | **Aguardando aquisição ou criação** — somente OFL/SIL ou equivalente, com licença documentada aqui | Por definir (licença obrigatória antes do uso) |

## 5. Licença ou origem ainda não definida

Os itens B1–B3 e F6–F9 permanecem aguardando criação/aquisição e documentação de origem/licença. B4–B6 são implementações de código CSS do Módulo 6, não arquivos de mídia independentes e, portanto, não exigem licença de asset externo. **Nenhum asset externo foi baixado ou gerado nesta etapa.**

## 6. Organização recomendada para assets existentes fora da estrutura

- E1 e E2 permanecem no `brasil-quiz-prototipo.html` (arquivo protegido — não realocar).
- A extração de E1 para `assets/maps/` continua futura; só deve ocorrer no módulo responsável pelo mapa e precisa ser registrada aqui, mantendo o protótipo original intacto.
- A pasta `assets/` pode conter `.gitkeep` para preservar a estrutura. `.gitkeep` não é asset e não entra no inventário de mídia.
- O Módulo 6 implementa parte dos recursos B4–B6 em CSS. Isso não altera a conclusão E3 de que ainda não existem arquivos independentes de imagem, ícone, fonte, mapa ou áudio.

## 7. Manutenção deste catálogo

1. Registrar **novamente** cada asset ao ser criado/adquirido: mover a linha da categoria correspondente para "Existe", com hash SHA-256 do arquivo, autor/origem e licença.
2. Não marcar como concluído nenhum asset que ainda não exista em disco.
3. Este catálogo é lido antes de qualquer módulo que consuma assets (módulos 6–12).
