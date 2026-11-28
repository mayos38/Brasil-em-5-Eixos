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
    themes: ['cultura', 'economia', 'animais', 'natureza', 'cidades'],
    regions: ['norte', 'nordeste', 'centro-oeste', 'sudeste', 'sul'],

    themeLabels: {
      all: 'Todos os temas', cultura: 'Cultura', economia: 'Economia',
      animais: 'Animais', natureza: 'Natureza', cidades: 'Cidades'
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
    // M12/GDD v1.1: a campanha v2 usa exatamente estes tempos nos pontos
    // temáticos E no ponto de desafio (sem tempo dobrado nos chefes).
    // Dificuldade sem entrada => questionTimeDefaultMs.
    questionTimeMs: { edu: 30000, normal: 30000, dificil: 40000, geografo: 50000 },
    questionTimeDefaultMs: 15000,

    // Modos e quantidades padrão
    soloQuestionCount: 10,
    localMinPlayers: 2,
    localMaxPlayers: 4,
    localDefaultQuestions: 10,
    lanDefaultQuestions: 8,
    lanMaxPlayers: 4,

    // Campanha: ordem das etapas (Norte → Sul) e perguntas por etapa.
    // campaignQuestionsPerStage pertence ao modo legado engine.start({mode:'campaign'});
    // a estrutura real da campanha v2 está em campaignV2 abaixo (M12).
    campaignStages: ['norte', 'nordeste', 'centro-oeste', 'sudeste', 'sul'],
    campaignQuestionsPerStage: 6,

    // MÓDULO 12 — Campanha v2: pontos de parada por região.
    // Estrutura por dificuldade:
    //   edu/normal/dificil : 5 pontos temáticos (um por eixo) + 1 ponto de desafio = 6;
    //   geografo           : 3 pontos misturados (todos os temas da região) + 1 desafio = 4.
    // Cada ponto temático vale questionsPerPoint questões; o % de acertos SOMADOS
    // dos pontos temáticos desbloqueia o chefe da região. Dificuldades:
    //   edu/normal sempre jogáveis; dificil após concluir normal;
    //   geografo após concluir dificil (conclusão = 5 chefes vencidos no tier).
    campaignV2: {
      themePointsPerRegion: 5,
      mixedPointsGeografo: 3,
      questionsPerPoint: 10,
      // % de acertos SOMADOS (melhor pontuação por parada) para liberar o chefe.
      unlockPct: { edu: 50, normal: 60, dificil: 70, geografo: 70 },
      boss: {
        playerHp: { edu: 1000, normal: 1000, dificil: 1500, geografo: 1750 },   // GDD v1.1 §8.5
        bossHp: { edu: 1000, normal: 1500, dificil: 2000, geografo: 2250 },
        danoBaseAoChefe: { edu: 112.5, normal: 100, dificil: 75, geografo: 60 }, // por acerto (base do strike)
        danoAoJogador:   { edu: 56.25, normal: 75, dificil: 93.75, geografo: 112.5 }, // por erro/timeout (fixo)
        checkpointPct: { edu: 75, normal: 75, dificil: 75, geografo: 67 },       // nova tentativa começa com o chefe nesse %
        revealDelayMs: 3000,   // carta revelada parada na tela antes do relógio (§6)
        systemGapMs: 2000,    // intervalo de sistema entre o desfecho e a próxima mão (~2s, §6)
        cardsPerHand: 3,       // três cartas por mão — temas e IDs de pergunta distintos
        vulnChancePct: 20,     // chance POR MÃO de conter a carta do tema vulnerável (§8.3)
        strikeMults: { 1: 1.0, 2: 1.1, 3: 1.2, 4: 1.3 }, // acertos consecutivos; ≥4 = teto (§8.4)
        vulnBonus: 0.5,        // somado ao strike na carta vulnerável (§8.3/§8.5)
        maxStrikeMult: 1.8     // teto do multiplicador resultante (strike + bônus) (§8.5)
      },
      bosses: {
        // Identidade regional do chefe — MESMA nas quatro dificuldades (§8).
        // name/problem = null => pendente de definição editorial (não inventar).
        norte:          { name: 'Tupã',    vulnTheme: 'natureza', problem: 'Desmatamento' },
        nordeste:       { name: null,      vulnTheme: 'economia',  problem: 'Pobreza e desafios de desenvolvimento regional' },
        'centro-oeste': { name: 'Boitatá', vulnTheme: 'natureza', problem: 'Expansão agrícola e queimadas' },
        sudeste:        { name: null,      vulnTheme: 'cidades',   problem: 'Planejamento urbano' },
        sul:            { name: null,      vulnTheme: 'cultura',   problem: null }
      }
    },

    // Chaves de persistência (localStorage)
    storageKeys: { progress: 'bq5_prog', bestSolo: 'bq5_best_solo', campaignV2: 'bq5_campaign_v2' }
  };

  globalThis.BQ5 = globalThis.BQ5 || {};
  BQ5.config = CONFIG;
})();
