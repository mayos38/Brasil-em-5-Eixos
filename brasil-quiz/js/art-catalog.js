/* ============================================================
 * MÓDULO 16 — ARTE | CATÁLOGO EDITÁVEL
 *
 * ESTE É O ARQUIVO QUE VOCÊ EDITA NO DIA A DIA.
 * 1. Coloque a imagem em brasil-quiz/assets/art/...
 * 2. Altere/adicone um item abaixo, mantendo id único.
 * 3. Atualize revision quando substituir uma imagem pelo mesmo caminho
 *    para evitar que o navegador mostre uma versão antiga em cache.
 *
 * Caminhos sempre relativos à pasta brasil-quiz/.
 * Não use URL remota, caminho absoluto ou ../.
 * ============================================================ */
(function (global) {
  'use strict';

  global.BQ5_ART_CATALOG = {
    version: 1,
    revision: 1,
    defaults: {
      characterId: 'explorador',
      mascotId: 'capivara-cartografica',
      backgroundId: 'noite-cartografica',
      logoId: 'marca-base',
      themeId: 'noite-cartografica'
    },

    /* Personagens do jogador. Para trocar a arte, substitua o arquivo
       mantendo o mesmo caminho OU altere src e revision. */
    characters: [
      {
        id: 'explorador',
        name: 'Explorador',
        description: 'Personagem provisório para testar a área de avatar.',
        src: 'assets/art/characters/explorador.svg',
        alt: 'Personagem ilustrado Explorador',
        fit: 'contain',
        moods: {
          idle: 'assets/art/characters/explorador.svg',
          happy: 'assets/art/characters/explorador.svg',
          sad: 'assets/art/characters/explorador.svg'
        },
        origin: 'Arte provisória original do projeto',
        license: 'Criação interna — sem dependência externa'
      }
    ],

    /* Mascotes. Estados diferentes podem apontar para imagens diferentes.
       GIF/WebP animado também funciona: basta usar o arquivo animado em src. */
    mascots: [
      {
        id: 'capivara-cartografica',
        name: 'Capivara cartográfica',
        description: 'Mascote provisório. Substitua pela arte definitiva quando quiser.',
        src: 'assets/art/mascots/capivara-cartografica.svg',
        alt: 'Capivara ilustrada com pequeno mapa',
        fit: 'contain',
        moods: {
          idle: 'assets/art/mascots/capivara-cartografica.svg',
          happy: 'assets/art/mascots/capivara-cartografica.svg',
          sad: 'assets/art/mascots/capivara-cartografica.svg'
        },
        origin: 'Arte provisória original do projeto',
        license: 'Criação interna — sem dependência externa'
      }
    ],

    backgrounds: [
      {
        id: 'noite-cartografica',
        name: 'Noite cartográfica',
        description: 'Fundo vetorial provisório para testar composição e contraste.',
        src: 'assets/art/backgrounds/noite-cartografica.svg',
        alt: 'Fundo azul-escuro com linhas topográficas',
        fit: 'cover',
        origin: 'Arte provisória original do projeto',
        license: 'Criação interna — sem dependência externa'
      }
    ],

    logos: [
      {
        id: 'marca-base',
        name: 'Marca provisória',
        description: 'Logotipo vetorial de demonstração.',
        src: 'assets/art/branding/logo-brasil5eixos.svg',
        alt: 'Logotipo Brasil em 5 Eixos',
        fit: 'contain',
        origin: 'Arte provisória original do projeto',
        license: 'Criação interna — sem dependência externa'
      }
    ],

    icons: [
      { id: 'cultura', name: 'Ícone — Cultura', description: 'Ícone de exemplo para o eixo Cultura.', src: 'assets/art/icons/icone-cultura.svg', alt: 'Ícone de Cultura', fit: 'contain' },
      { id: 'economia', name: 'Ícone — Economia', description: 'Ícone de exemplo para o eixo Economia.', src: 'assets/art/icons/icone-economia.svg', alt: 'Ícone de Economia', fit: 'contain' },
      { id: 'animais', name: 'Ícone — Animais', description: 'Ícone de exemplo para o eixo Animais.', src: 'assets/art/icons/icone-animais.svg', alt: 'Ícone de Animais', fit: 'contain' },
      { id: 'vegetacao', name: 'Ícone — Vegetação', description: 'Ícone de exemplo para o eixo Vegetação.', src: 'assets/art/icons/icone-vegetacao.svg', alt: 'Ícone de Vegetação', fit: 'contain' },
      { id: 'cidades', name: 'Ícone — Cidades', description: 'Ícone de exemplo para o eixo Cidades.', src: 'assets/art/icons/icone-cidades.svg', alt: 'Ícone de Cidades', fit: 'contain' }
    ],

    illustrations: [
      {
        id: 'mapa-brasil-esquematico',
        name: 'Mapa esquemático do Brasil',
        description: 'Ilustração demonstrativa; não representa limites oficiais.',
        src: 'assets/art/illustrations/mapa-brasil-esquematico.svg',
        alt: 'Silhueta esquemática do Brasil',
        fit: 'contain',
        origin: 'Arte provisória original do projeto',
        license: 'Criação interna — sem dependência externa'
      }
    ],

    /* O nome (id) do tema precisa ter uma regra correspondente em css/art.css.
       As cores ficam no CSS, nunca espalhadas pelo JavaScript. */
    themes: [
      { id: 'noite-cartografica', name: 'Noite cartográfica', description: 'Paleta escura original do projeto.' },
      { id: 'cerrado', name: 'Cerrado', description: 'Variação quente, inspirada em terra e vegetação.' },
      { id: 'oceano', name: 'Oceano', description: 'Variação azul e fria.' }
    ]
  };
})(typeof window !== 'undefined' ? window : globalThis);
