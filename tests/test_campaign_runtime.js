'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const events = Object.create(null);
const actions = Object.create(null);
const notices = [];
const store = new Map();
const cfg = {
  themes: ['cultura', 'economia', 'animais', 'vegetacao', 'cidades'],
  themeLabels: { cultura:'Cultura', economia:'Economia', animais:'Animais', vegetacao:'Vegetação', cidades:'Cidades', all:'Todos os eixos' },
  regions: ['norte','nordeste','centro-oeste','sudeste','sul'],
  campaignStages: ['norte','nordeste','centro-oeste','sudeste','sul'],
  regionLabels: { norte:'Norte', nordeste:'Nordeste', 'centro-oeste':'Centro-Oeste', sudeste:'Sudeste', sul:'Sul' },
  tierLabels: { edu:'Fácil (Educativo)', normal:'Normal', medio:'Médio', dificil:'Difícil', geografo:'Geógrafo' },
  tiers: { edu:[1], normal:[1,2], medio:[2,3], dificil:[3], geografo:[4] },
  questionTimeMs: { edu:30000, normal:20000, medio:18000, dificil:17000, geografo:20000 },
  questionTimeDefaultMs:15000,
  campaignQuestionsPerStage:6
};

let questions = [];
let id = 0;
for (const region of cfg.regions) {
  for (const theme of cfg.themes) {
    // Tier mix creates enough questions for Normal, but forces fallback in
    // Educativo/Médio/Difícil while retaining the exact region+theme boundary.
    for (const difficulty of [1,1,1,1,1,2,2,2,2,2,3,3,3,4,4]) {
      id++;
      questions.push({
        id:'q'+id, region, theme, difficulty,
        question:'Pergunta '+id,
        options:['A','B','C','D'], answer:0,
        explanation:'Explicação '+id
      });
    }
  }
}

let legacyCompleted = [];
let engineCapture = null;
let fakeState = null;
const bank = {
  loaded: () => true,
  count: () => questions.length,
  list: () => questions.slice()
};
const storage = {
  getJSON(key, fallback) { return store.has(key) ? JSON.parse(JSON.stringify(store.get(key))) : fallback; },
  setJSON(key, value) { store.set(key, JSON.parse(JSON.stringify(value))); return true; },
  completeStage(region, score) {
    legacyCompleted.push({region, score});
    return {progress:{done:{[region]:true},best:{[region]:score}}, allDone:false};
  },
  resetCampaign() { legacyCompleted = []; return {done:{},best:{}}; }
};
const engine = {
  start(opts) {
    const list = bank.list();
    engineCapture = {
      opts: JSON.parse(JSON.stringify(opts)),
      pool: list.slice(),
      count: cfg.campaignQuestionsPerStage,
      time: cfg.questionTimeMs.normal
    };
    fakeState = {mode:'campaign',theme:'all',diff:'normal',region:opts.region,index:0,total:cfg.campaignQuestionsPerStage,score:0,right:0,locked:false,finished:false,timeLimitMs:cfg.questionTimeMs.normal};
    return {ok:true,game:this.state()};
  },
  state() { return fakeState ? {...fakeState} : null; },
  abort() { fakeState = null; return {ok:true}; },
  result() { return null; }
};
const play = { show: () => ({ok:true}) };
const ui = {
  on(name, fn) { (events[name] ||= []).push(fn); return () => {}; },
  onAction(name, fn) { (actions[name] ||= []).push(fn); return () => {}; },
  emit(name, detail) { const list=(events[name]||[]).slice(); list.forEach(fn=>fn(detail||{})); return list.length; },
  trigger(name, detail) { const list=(actions[name]||[]).slice(); list.forEach(fn=>fn(detail||{})); return list.length; },
  showScreen(name) { ui.lastScreen=name; return {ok:true}; },
  toast(message, kind) { notices.push({message,kind}); },
  text() {}, hidden() {}, el() { return null; }, cloneTemplate() { return null; },
  openModal() { return {ok:true}; }, closeModal() { return true; }
};

const context = {
  BQ5:{config:cfg,bank,storage,engine,ui,screens:{play}},
  console,
  Date,
  Math,
  JSON,
  Object,
  Array,
  String,
  Number,
  isFinite,
  parseInt
};
context.globalThis = context;
vm.createContext(context);
vm.runInContext(fs.readFileSync(__dirname + '/../brasil-quiz/js/screens/campaign.js','utf8'), context, {filename:'campaign.js'});
const campaign = context.BQ5.screens.campaign;
assert.ok(campaign, 'M12 deve registrar BQ5.screens.campaign');
assert.equal(campaign.init().ok, true, 'M12 inicializa com UI e módulos públicos');

// O M12 disponibiliza todas as dificuldades declaradas pelo config.
for (const diff of Object.keys(cfg.tiers)) {
  assert.equal(campaign.selectDifficulty(diff), true, 'deve aceitar dificuldade '+diff);
}
assert.equal(campaign.getStops('normal').length, 5, 'dificuldade normal usa cinco pontos temáticos');
assert.equal(campaign.getStops('geografo').length, 3, 'Geógrafo usa três pontos mistos');
assert.equal(campaign.getStops('geografo').every(x=>x.theme==='all'), true, 'pontos Geógrafo misturam os cinco temas');
assert.deepEqual([50,60,60,70,70], ['edu','normal','medio','dificil','geografo'].map(campaign.thresholdFor));

// Normal: dez questões, pool estrito por tema/região e tempo normal.
campaign.selectDifficulty('normal');
const started = campaign.startStop('norte','cultura');
assert.equal(started.ok, true);
assert.equal(engineCapture.count, 10, 'o engine deve capturar 10 perguntas por ponto');
assert.equal(engineCapture.pool.length, 10, 'pool normal deve conter apenas questões do tier selecionado');
assert.ok(engineCapture.pool.every(q=>q.region==='norte' && q.theme==='cultura'), 'pool deve ficar na região e no tema');
assert.equal(engineCapture.time, 20000, 'tempo selecionado deve ser capturado pelo engine');
assert.equal(started.game.diff, 'normal', 'o adaptador deve expor a dificuldade real para M10');
assert.equal(started.game.timeLimitMs, 20000, 'o estado do M5.6 deve preservar o tempo injetado');
assert.equal(cfg.campaignQuestionsPerStage, 6, 'configuração temporária de quantidade precisa ser restaurada');
assert.equal(cfg.questionTimeMs.normal, 20000, 'configuração temporária de tempo precisa ser restaurada');
assert.equal(storage.completeStage('norte',50).allDone, false, 'durante um ponto ativo, a guarda impede a conclusão regional prematura');
assert.equal(legacyCompleted.length,0, 'a chamada legada não deve persistir conclusão durante um ponto');

function finishCurrent(right, score) {
  // Simula o finalize() M5, que chama completeStage() durante a partida.
  const guarded = storage.completeStage('norte', score);
  assert.equal(guarded.allDone, false, 'o engine legado não pode concluir a região prematuramente');
  const result={mode:'campaign',score,right,total:10,review:[]};
  ui.emit('game:finished', result);
  return result;
}
finishCurrent(6,500);
assert.equal(storage.completeStage('norte',50).progress.done.norte, true, 'fora do ponto ativo, a API original do storage continua funcionando');
legacyCompleted = [];
let rec = campaign.getRegionSummary('norte','normal');
assert.equal(rec.completedStops,1);
assert.equal(rec.right,6);
// Pontuação maior substitui o registro inteiro do ponto, inclusive os acertos daquela tentativa.
campaign.startStop('norte','cultura');
finishCurrent(5,600);
let progress = campaign.getProgress();
assert.equal(progress.difficulties.normal.regions.norte.stops.cultura.bestScore,600);
assert.equal(progress.difficulties.normal.regions.norte.stops.cultura.bestRight,5, 'acertos devem corresponder à tentativa que gerou a maior pontuação');
assert.equal(progress.difficulties.normal.regions.norte.stops.cultura.attempts,2);

// Complete os outros quatro temas com 7/10; o conjunto coerente chega a 65% e libera o Nordeste.
for (const stop of campaign.getStops('normal').filter(s=>s.id!=='cultura')) {
  campaign.startStop('norte',stop.id);
  finishCurrent(7,500);
}
rec=campaign.getRegionSummary('norte','normal');
assert.equal(rec.pct,66);
assert.equal(rec.completed,true);
assert.equal(campaign.isRegionUnlocked('nordeste','normal'),true);
assert.equal(campaign.isRegionUnlocked('centro-oeste','normal'),false);
assert.equal(legacyCompleted.length,1,'storage legado só deve ser sincronizado após atingir a meta regional');

// A ponte deve injetar o tempo escolhido em cada tier e restaurar a configuração.
for (const [diff, expectedTime] of [['edu',30000],['medio',18000],['dificil',17000],['geografo',20000]]) {
  campaign.selectDifficulty(diff);
  const run=campaign.startStop('norte',campaign.getStops(diff)[0].id);
  assert.equal(run.ok,true,'deve iniciar a campanha na dificuldade '+diff);
  assert.equal(engineCapture.time,expectedTime,'tempo de '+diff+' deve chegar ao motor');
  assert.equal(run.game.diff,diff,'M10 deve receber dificuldade '+diff+' no snapshot');
  assert.equal(cfg.questionTimeMs.normal,20000,'tempo base deve ser restaurado após '+diff);
  finishCurrent(0,0);
}

// Geógrafo: 3 pontos mistos de 10 questões, sem cruzar para outra região.
campaign.selectDifficulty('geografo');
for (const stop of campaign.getStops('geografo')) {
  const started=campaign.startStop('norte',stop.id);
  assert.equal(started.ok,true);
  assert.equal(engineCapture.count,10);
  assert.ok(engineCapture.pool.every(q=>q.region==='norte' && q.difficulty===4), 'Geógrafo deve privilegiar o tier 4 da própria região');
  finishCurrent(7,700);
}
rec=campaign.getRegionSummary('norte','geografo');
assert.equal(rec.stopCount,3);
assert.equal(rec.total,30);
assert.equal(rec.pct,70);
assert.equal(rec.completed,true);
assert.equal(campaign.isRegionUnlocked('nordeste','geografo'),true);

// Fallback mantém região/tema, não completa com perguntas de outras regiões.
campaign.selectDifficulty('dificil');
const fallback=campaign.startStop('norte','cultura');
assert.equal(fallback.ok,true);
assert.equal(fallback.fallback,true);
assert.ok(engineCapture.pool.length>=10);
assert.ok(engineCapture.pool.every(q=>q.region==='norte' && q.theme==='cultura'));

console.log('M12 campaign runtime: checks passed');
