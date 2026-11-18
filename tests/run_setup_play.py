# -*- coding: utf-8 -*-
"""Testes V8 dos Módulos 9 e 10, usando o harness py-mini-racer do projeto.

Uso na raiz do projeto: python tests/run_setup_play.py
O runner usa APIs reais de config/util/storage/bank/engine e um adaptador DOM
mínimo. Não substitui teste visual/funcional em navegador.
"""
from __future__ import print_function
import os
import sys

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
load_js(ctx, 'tests/js/bootstrap_setup_play.js')
load_js(ctx, 'brasil-quiz/js/screens/setup.js')
load_js(ctx, 'brasil-quiz/js/screens/play.js')
with open(os.path.join(HERE, 'js', 'test_setup_play.js'), encoding='utf-8') as stream:
    test_code = stream.read()
total, failed = run_tests(ctx, test_code, 'Módulos 9–10 — setup + play')
sys.exit(0 if check(total, failed) else 1)
