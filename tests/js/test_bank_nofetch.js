// ============================================================
// Suíte MÓDULO 4 — js/bank.js (contexto SEM fetch: cenário NO_FETCH)
// Rodada por tests/run_bank.py num contexto V8 sem fetch definido.
// ============================================================

test('guarda: este contexto está sem fetch (como o ambiente de teste real)', function () {
  assert(typeof fetch === 'undefined', 'fetch inesperado neste contexto');
});

testAsync('load sem fetch disponível → code NO_FETCH, ok=false e banco não carregado', function () {
  return BQ5.bank.load('data/questions.json').then(function (res) {
    assert(res.ok === false && res.code === 'NO_FETCH', JSON.stringify(res));
    assert(BQ5.bank.loaded() === false, 'banco deveria continuar sem carga');
  });
});
