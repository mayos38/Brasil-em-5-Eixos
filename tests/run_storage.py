# -*- coding: utf-8 -*-
"""Suíte do MÓDULO 3 — js/storage.js (regressão). Uso (a partir da raiz):
    python tests/run_storage.py
Criada na sessão de validação do módulo 5: os arquivos JS da suíte existiam em
tests/js/ mas não havia runner persistido. Roda em V8 real via py-mini-racer:
 - contexto A com localStorage funcional (shim em memória) => test_storage.js;
 - contexto B sem localStorage (estado real do mini_racer) => fallback em memória.
"""
import sys, os
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
from harness import make_ctx, load_js, run_tests, check  # noqa: E402

MODULES = ['brasil-quiz/js/config.js', 'brasil-quiz/js/util.js',
           'brasil-quiz/js/storage.js']

def read(p):
    return open(os.path.join(ROOT, p.replace('/', os.sep)), encoding='utf-8').read()

LOCALSTORAGE_SHIM = """
window.localStorage = {
  _d: {},
  getItem: function (k) { return Object.prototype.hasOwnProperty.call(this._d, k) ? this._d[k] : null; },
  setItem: function (k, v) { this._d[k] = String(v); },
  removeItem: function (k) { delete this._d[k]; }
};
"""

ctxA = make_ctx()
for m in MODULES:
    load_js(ctxA, m)
ctxA.eval(LOCALSTORAGE_SHIM)  # "storage OK": caminho real do localStorage
total1, failed1 = run_tests(ctxA, read('tests/js/test_storage.js'),
                             'storage — localStorage funcional')

ctxB = make_ctx()  # sem localStorage (estado real do mini_racer) => fallback em memória
for m in MODULES:
    load_js(ctxB, m)
total2, failed2 = run_tests(ctxB, read('tests/js/test_storage_fallback.js'),
                            'storage — fallback em memória')

ok = check(total1 + total2, failed1 + failed2)
sys.exit(0 if ok else 1)
