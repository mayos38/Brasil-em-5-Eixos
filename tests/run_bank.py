# -*- coding: utf-8 -*-
"""Suíte do MÓDULO 4 — js/bank.js. Uso (a partir da raiz do projeto):
    python tests/run_bank.py
Roda em V8 real via py-mini-racer: parte síncrona, load() com fetch fake e
contexto sem fetch. O banco oficial data/questions.json é injetado como fixture.
"""
import sys, os, json
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
from harness import make_ctx, load_js, run_tests, run_tests_async, check  # noqa: E402

MODULES = ['brasil-quiz/js/config.js', 'brasil-quiz/js/util.js',
           'brasil-quiz/js/storage.js', 'brasil-quiz/js/bank.js']

def read(p):
    return open(os.path.join(ROOT, p.replace('/', os.sep)), encoding='utf-8').read()

ctx = make_ctx()
for m in MODULES:
    load_js(ctx, m)

# injeta o banco oficial do projeto como string JSON (fixture de integridade)
bank_file = read('brasil-quiz/data/questions.json')
ctx.eval("window.__BANK_FILE = " + json.dumps(bank_file))  # dumps => literal JS seguro (ASCII)

total1, failed1 = run_tests(ctx, read('tests/js/test_bank.js'), 'bank — síncrono (validate/adopt/fromText)')
total2, failed2 = run_tests_async(ctx, read('tests/js/test_bank_async.js'), 'bank.load — fetch fake')

ctx2 = make_ctx()  # contexto SEM fetch (como o ambiente real de teste)
for m in MODULES:
    load_js(ctx2, m)
total3, failed3 = run_tests_async(ctx2, read('tests/js/test_bank_nofetch.js'), 'bank.load — sem fetch')

ok = check(total1 + total2 + total3, failed1 + failed2 + failed3)
sys.exit(0 if ok else 1)
