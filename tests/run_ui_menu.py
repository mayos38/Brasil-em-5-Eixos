# -*- coding: utf-8 -*-
"""Testes V8 dos módulos 7 e 8 (UI central + menu).

Uso, na raiz do projeto: python tests/run_ui_menu.py
Usa a mesma dependência py-mini-racer do harness já existente no projeto.
Os stubs cobrem apenas o DOM necessário a estes testes; não substituem teste real
em navegador nem validam layout, acessibilidade visual ou dispositivos.
"""
from __future__ import print_function
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
from harness import make_ctx, load_js, run_tests, check  # noqa: E402

DOM_PATCH = r"""
(function () {
  var originalQuery = document.querySelector;
  function enhance(el) {
    if (!el) return el;
    if (!el.__attrs) el.__attrs = {};
    if (!el.getAttribute) el.getAttribute = function (name) {
      if (Object.prototype.hasOwnProperty.call(this.__attrs, name)) return this.__attrs[name];
      if (name === 'data-screen' && this.id === 'bq5-app') return 'boot';
      return null;
    };
    if (!el.setAttribute) el.setAttribute = function (name, value) { this.__attrs[name] = String(value); };
    if (!el.removeAttribute) el.removeAttribute = function (name) { delete this.__attrs[name]; };
    if (!el.hasAttribute) el.hasAttribute = function (name) { return this.getAttribute(name) !== null; };
    if (!el.style.setProperty) el.style.setProperty = function (name, value) { this[name] = String(value); };
    return el;
  }
  document.querySelector = function (selector) { return enhance(originalQuery(selector)); };

  var app = document.querySelector('#bq5-app');
  var boot = document.querySelector('#screen-boot');
  var menu = document.querySelector('#screen-menu');
  boot.classList.add('bq5-screen');
  menu.classList.add('bq5-screen');
  app.querySelector = function (selector) {
    if (selector === '#screen-boot') return boot;
    if (selector === '#screen-menu') return menu;
    return null;
  };
  app.querySelectorAll = function (selector) {
    return selector === '.bq5-screen' ? [boot, menu] : [];
  };
  boot.querySelector = function () { return document.querySelector('#boot-title'); };
  menu.querySelector = function () { return document.querySelector('#menu-title'); };
})();
"""

MODULES = [
    'brasil-quiz/js/config.js',
    'brasil-quiz/js/util.js',
    'brasil-quiz/js/storage.js',
    'brasil-quiz/js/bank.js',
    'brasil-quiz/js/engine.js',
    'brasil-quiz/js/ui.js',
    'brasil-quiz/js/screens/menu.js',
]

def read(path):
    with open(os.path.join(ROOT, path.replace('/', os.sep)), encoding='utf-8') as stream:
        return stream.read()

ctx = make_ctx()
ctx.eval(DOM_PATCH)
for module in MODULES:
    load_js(ctx, module)

total, failed = run_tests(ctx, read('tests/js/test_ui_menu.js'), 'Módulos 7–8 — UI + menu')
ok = check(total, failed)
sys.exit(0 if ok else 1)
