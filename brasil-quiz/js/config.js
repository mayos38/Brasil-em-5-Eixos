/* ============================================================
 * brasil-quiz v0.2 modular — js/config.js
 * Responsabilidade: constantes do domínio do jogo (fonte única).
 * Não toca DOM, storage ou rede. Deve ser carregado ANTES dos demais módulos.
 * Carregamento clássico (sem ESM) para funcionar offline via file://.
 * ============================================================ */
(function () {
  'use strict';

  const CONFIG = {
    appVersion: '0.2-modular',

    // Temas e regiões do banco de questões
    themes: ['cultura', 'economia', 'animais', 'vegetacao', 'cidades'],
    regions: ['norte', 'nordeste', 'centro-oeste', 'sudeste', 'sul'],

    themeLabels: {
      all: 'Todos os temas', cultura: 'Cultura', economia: 'Economia',
      animais: 'Animais', vegetacao: 'Vegetação', cidades: 'Cidades'
    },
    regionLabels: {
      norte: 'Norte', nordeste: 'Nordeste', 'centro-oeste': 'Centro-Oeste',
      sudeste: 'Sudeste', sul: 'Sul'
    },

    // Dificuldades disponíveis no setup e faixas do banco que cada uma usa.
    // Alpha #1 (2026-11): nomenclatura renomeada — "Fácil" (antes "Educativo")
    // e "Padrão", que substitui as opções "Normal"/"Médio"; a chave interna
    // 'normal' foi mantida para não migrar estado persistido nem regras do motor.
    tierLabels: {
      edu: 'Fácil', normal: 'Padrão', dificil: 'Difícil', geografo: 'Geógrafo'
    },
    tiers: { edu: [1], normal: [1, 2], dificil: [3], geografo: [4] },

    // Pontuação: base por dificuldade + bônus de tempo (segundos restantes, com teto)
    pointsBase: { 1: 10, 2: 20, 3: 40, 4: 80 },
    timeBonusMax: 7,
    // Tempo por questão (ms) conforme a dificuldade escolhida (chaves de tiers).
    // Alpha #1 (2026-11): balanceamento do modo solo — Fácil 30s, Padrão 30s,
    // Difícil 40s e Geógrafo 50s.
    // A campanha usa sempre 'normal'. Dificuldade sem entrada => questionTimeDefaultMs.
    questionTimeMs: { edu: 30000, normal: 30000, dificil: 40000, geografo: 50000 },
    questionTimeDefaultMs: 15000,

    // Modos e quantidades padrão
    soloQuestionCount: 10,
    localMinPlayers: 2,
    localMaxPlayers: 4,
    localDefaultQuestions: 10,
    lanDefaultQuestions: 8,
    lanMaxPlayers: 4,

    // Campanha: ordem das etapas (Norte → Sul) e perguntas por etapa
    campaignStages: ['norte', 'nordeste', 'centro-oeste', 'sudeste', 'sul'],
    campaignQuestionsPerStage: 6,

    // Chaves de persistência (localStorage)
    storageKeys: { progress: 'bq5_prog', bestSolo: 'bq5_best_solo' }
  };

  globalThis.BQ5 = globalThis.BQ5 || {};
  BQ5.config = CONFIG;
})();
