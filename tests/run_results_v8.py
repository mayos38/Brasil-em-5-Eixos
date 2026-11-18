# -*- coding: utf-8 -*-
"""Suíte V8 do MÓDULO 11 — js/screens/results.js.
Uso (a partir da raiz do projeto):
    python tests/run_results_v8.py

O Node não está disponível no ambiente; este runner é o equivalente em V8 real
(py-mini-racer) de tests/run_results.js. Carrega os módulos REAIS
cfg/util/storage/bank/engine e as telas reais de setup (M9), play (M10) e
results (M11), com adaptador DOM mínimo (tests/js/bootstrap_results_v8.js)
que inclui os templates tpl-review-item/tpl-ranking-item do Módulo 11.
"""
import sys, os
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
from harness import make_ctx, load_js, run_tests, check  # noqa: E402

ctx = make_ctx()
for module in (
    'brasil-quiz/js/config.js',
    'brasil-quiz/js/util.js',
    'brasil-quiz/js/storage.js',
    'brasil-quiz/js/bank.js',
    'brasil-quiz/js/engine.js',
):
    load_js(ctx, module)
load_js(ctx, 'tests/js/bootstrap_results_v8.js')
for screen in (
    'brasil-quiz/js/screens/setup.js',
    'brasil-quiz/js/screens/play.js',
    'brasil-quiz/js/screens/results.js',
):
    load_js(ctx, screen)
with open(os.path.join(HERE, 'js', 'test_results_v8.js'), encoding='utf-8') as stream:
    test_code = stream.read()
total, failed = run_tests(ctx, test_code, 'M11 — resultados (V8 real via py-mini-racer)')
sys.exit(0 if check(total, failed) else 1)
