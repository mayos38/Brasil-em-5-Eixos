
test('fallback: grava e lê via memória com localStorage quebrado', function(){
  BQ5.storage.setJSON('__fb__', {x:9});
  assert(BQ5.storage.getJSON('__fb__', null).x === 9, 'fallback leitura falhou');
});

test('fallback: completeStage funciona mesmo sem storage persistente', function(){
  const r = BQ5.storage.completeStage('norte', 70);
  assert(r.progress.done.norte === true && r.progress.best.norte === 70, 'stage não funcionou no fallback');
});

test('fallback: recordSoloScore funciona sem storage persistente', function(){
  const b = BQ5.storage.recordSoloScore(150);
  assert(b.best === 150, 'recorde não gravado no fallback');
});
