
test('getJSON/setJSON: ida e volta de objeto', function(){
  BQ5.storage.setJSON('__t1', {a:1, b:'x'});
  const v = BQ5.storage.getJSON('__t1', null);
  assert(v && v.a===1 && v.b==='x', 'ida e volta falhou: '+JSON.stringify(v));
});

test('getJSON com chave ausente devolve o padrão', function(){
  assert(BQ5.storage.getJSON('__nao_existe__', 42) === 42, 'padrão não retornado');
});

test('getJSON com JSON corrompido devolve o padrão (sem exceção)', function(){
  try { localStorage.setItem('__corrupto__', '{isso nao e json'); } catch(e){ _memSet('__corrupto__','{isso nao e json'); }
  const v = BQ5.storage.getJSON('__corrupto__', 'fallback-ok');
  assert(v === 'fallback-ok', 'esperava fallback, veio '+v);
});

test('getProgress inicial é {done:{},best:{}}', function(){
  const p = BQ5.storage.getProgress();
  assert(JSON.stringify(p) === JSON.stringify({done:{},best:{}}), 'progresso inicial errado: '+JSON.stringify(p));
});

test('completeStage marca região e guarda melhor pontuação', function(){
  const r1 = BQ5.storage.completeStage('norte', 80);
  assert(r1.progress.done.norte === true, 'norte não marcado');
  assert(r1.progress.best.norte === 80, 'best norte != 80');
  assert(r1.allDone === false, 'allDone cedo demais');
});

test('completeStage com pontuação menor NÃO reduz o melhor', function(){
  BQ5.storage.completeStage('norte', 30);
  const p = BQ5.storage.getProgress();
  assert(p.best.norte === 80, 'best foi reduzido para '+p.best.norte);
});

test('allDone só vira true após as 5 regiões concluídas', function(){
  ['nordeste','centro-oeste','sudeste'].forEach(r => BQ5.storage.completeStage(r, 10));
  assert(BQ5.storage.getProgress().done.sul === undefined, 'sul marcado indevidamente');
  const r = BQ5.storage.completeStage('sul', 5);
  assert(r.allDone === true, 'allDone não virou true no fim');
});

test('resetCampaign zera done/best mas preserva recorde solo', function(){
  BQ5.storage.recordSoloScore(120);
  const p = BQ5.storage.resetCampaign();
  assert(JSON.stringify(p) === JSON.stringify({done:{},best:{}}), 'reset incompleto');
  assert(BQ5.storage.getJSON('bq5_best_solo', 0) === 120, 'recorde solo deveria persistir');
});

test('recordSoloScore só aumenta e informa prev/best', function(){
  const a = BQ5.storage.recordSoloScore(50);
  assert(a.prev === 120 && a.best === 120, 'menor não deve subir: '+JSON.stringify(a));
  const b = BQ5.storage.recordSoloScore(200);
  assert(b.prev === 120 && b.best === 200, 'maior deve atualizar: '+JSON.stringify(b));
});

test('progresso persiste entre leituras (mesma origem de dados)', function(){
  // obs.: o teste anterior executou resetCampaign(); após re-concluir norte com 40,
  // o melhor pontuado da região volta a ser 40.
  BQ5.storage.completeStage('norte', 40);
  const p = BQ5.storage.getProgress();
  assert(p.done.norte === true && p.best.norte === 40, 'estado inconsistente: '+JSON.stringify(p));
});

function _memSet(k,v){ /* usado apenas se localStorage lançar; no contexto com stub funcional não é chamado */ }
