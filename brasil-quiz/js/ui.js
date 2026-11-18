/* ============================================================
 * Brasil em 5 Eixos — Módulo 7: camada central de interface
 * Responsabilidade: DOM, navegação, eventos de interface, templates,
 * diálogos, avisos e foco/acessibilidade.
 * NÃO contém regras de pontuação, seleção de questões ou persistência.
 * Depende apenas do DOM nativo; módulos de tela dependem de BQ5.ui.
 * ============================================================ */
(function (global) {
  'use strict';

  var BQ5 = global.BQ5 = global.BQ5 || {};
  var events = Object.create(null);
  var actionBound = false;
  var root = null;
  var modalState = null;
  var history = [];

  function element(target, scope) {
    if (!target) return null;
    if (typeof target !== 'string') return target;
    var base = scope || global.document;
    return base ? base.querySelector(target) : null;
  }

  function elements(selector, scope) {
    var base = scope || global.document;
    return base ? Array.prototype.slice.call(base.querySelectorAll(selector)) : [];
  }

  function setText(target, value) {
    var node = element(target);
    if (node) node.textContent = value == null ? '' : String(value);
    return node;
  }

  function setHidden(target, hidden) {
    var node = element(target);
    if (node) node.hidden = !!hidden;
    return node;
  }

  function on(name, handler) {
    if (typeof name !== 'string' || !name || typeof handler !== 'function') return function () {};
    if (!events[name]) events[name] = [];
    events[name].push(handler);
    return function unsubscribe() {
      var list = events[name] || [];
      var index = list.indexOf(handler);
      if (index >= 0) list.splice(index, 1);
    };
  }

  function emit(name, detail) {
    var list = (events[name] || []).slice();
    list.forEach(function (handler) {
      try {
        handler(detail || {});
      } catch (error) {
        if (global.console && typeof global.console.error === 'function') global.console.error(error);
      }
    });
    return list.length;
  }

  function onAction(action, handler) {
    return on('action:' + action, handler);
  }

  function hasListeners(name) {
    return !!(events[name] && events[name].length);
  }

  function cloneTemplate(id) {
    var template = global.document && global.document.getElementById(id);
    if (!template || !template.content) return null;
    return template.content.cloneNode(true);
  }

  function focusSafely(node) {
    if (!node || typeof node.focus !== 'function') return;
    try { node.focus({ preventScroll: true }); }
    catch (error) { try { node.focus(); } catch (ignored) {} }
  }

  function updateBackButton() {
    var back = element('#bq5-back');
    if (!back) return;
    var current = root ? root.getAttribute('data-screen') : 'boot';
    back.hidden = !(history.length || (current && current !== 'menu' && current !== 'boot'));
  }

  function showScreen(name, options) {
    var opts = options || {};
    var app = root || element('#bq5-app');
    if (!app || !/^[a-z0-9-]+$/.test(String(name || ''))) {
      return { ok: false, code: 'BAD_SCREEN' };
    }

    var next = element('#screen-' + name, app);
    if (!next || !next.classList.contains('bq5-screen')) {
      return { ok: false, code: 'UNKNOWN_SCREEN', screen: name };
    }

    var previous = app.getAttribute('data-screen') || '';
    if (opts.history === false) {
      if (opts.clearHistory !== false) history.length = 0;
    } else if (previous && previous !== name) {
      history.push(previous);
    }

    elements('.bq5-screen', app).forEach(function (screen) {
      screen.hidden = screen !== next;
    });
    app.setAttribute('data-screen', name);
    updateBackButton();

    var heading = next.querySelector('h1, [role="heading"]') || element('#bq5-main');
    if (heading && !heading.hasAttribute('tabindex')) heading.setAttribute('tabindex', '-1');
    focusSafely(heading);

    emit('screen:change', { from: previous, to: name, screen: name });
    return { ok: true, screen: name };
  }

  function goBack() {
    var app = root || element('#bq5-app');
    var current = app ? app.getAttribute('data-screen') : '';
    var previous = history.length ? history.pop() : (current && current !== 'menu' ? 'menu' : null);
    if (!previous) return false;
    var result = showScreen(previous, { history: false, clearHistory: false });
    updateBackButton();
    return result.ok;
  }

  function clearNode(node) {
    if (!node) return;
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function closeModal(restoreFocus) {
    var state = modalState;
    if (!state) return false;
    var modalRoot = element('#bq5-modal-root');
    if (modalRoot) clearNode(modalRoot);
    modalState = null;
    if (restoreFocus !== false) focusSafely(state.previousFocus);
    emit('modal:close', {});
    return true;
  }

  function openModal(options) {
    var opts = options || {};
    var modalRoot = element('#bq5-modal-root');
    var fragment = cloneTemplate('tpl-modal');
    if (!modalRoot || !fragment) return { ok: false, code: 'NO_MODAL_TEMPLATE' };

    closeModal(false);
    clearNode(modalRoot);
    var modal = fragment.querySelector('.bq5-modal');
    if (!modal) return { ok: false, code: 'BAD_MODAL_TEMPLATE' };

    var title = modal.querySelector('#modal-title');
    var message = modal.querySelector('.bq5-modal__text');
    var extra = modal.querySelector('.bq5-modal__extra');
    var cancel = modal.querySelector('[data-action="modal-cancel"]');
    var confirm = modal.querySelector('[data-action="modal-confirm"]');

    if (title) title.textContent = opts.title == null ? 'Aviso' : String(opts.title);
    if (message) {
      message.textContent = opts.message == null ? '' : String(opts.message);
      message.hidden = !message.textContent;
    }
    if (cancel) {
      cancel.textContent = opts.cancelLabel == null ? 'Cancelar' : String(opts.cancelLabel);
      cancel.hidden = opts.showCancel === false;
    }
    if (confirm) confirm.textContent = opts.confirmLabel == null ? 'Confirmar' : String(opts.confirmLabel);

    if (extra && opts.contentTemplate) {
      var content = cloneTemplate(opts.contentTemplate);
      if (content) extra.appendChild(content);
    }
    if (extra) extra.hidden = !extra.firstChild;

    modalRoot.appendChild(fragment);
    modalState = {
      element: modal,
      previousFocus: global.document.activeElement || null,
      onConfirm: typeof opts.onConfirm === 'function' ? opts.onConfirm : null,
      dismissible: opts.dismissible !== false
    };

    var focusTarget = modal.querySelector('button:not([disabled]), input:not([disabled]), [tabindex="0"]');
    focusSafely(focusTarget || modal);
    emit('modal:open', { title: opts.title || 'Aviso' });
    return { ok: true };
  }

  function focusableInModal() {
    if (!modalState) return [];
    return elements('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])', modalState.element)
      .filter(function (node) { return !node.hidden && node.getAttribute('aria-hidden') !== 'true'; });
  }

  function dispatchAction(event) {
    if (!root) return;
    var target = event.target;
    if (target && target.nodeType === 3) target = target.parentElement;
    if (!target || typeof target.closest !== 'function') return;
    var control = target.closest('[data-action]');
    if (!control || !root.contains(control)) return;
    if (control.disabled || control.getAttribute('aria-disabled') === 'true') return;

    var action = control.getAttribute('data-action');
    if (!action) return;
    var handled = emit('action:' + action, {
      action: action,
      element: control,
      originalEvent: event,
      value: control.getAttribute('data-value')
    });
    if (handled) event.preventDefault();
  }

  function handleKeydown(event) {
    if (!modalState) return;
    var key = event.key || event.keyCode;
    if ((key === 'Escape' || key === 'Esc' || key === 27) && modalState.dismissible) {
      event.preventDefault();
      closeModal();
      return;
    }
    if (key !== 'Tab' && key !== 9) return;
    var focusables = focusableInModal();
    if (!focusables.length) {
      event.preventDefault();
      focusSafely(modalState.element);
      return;
    }
    var first = focusables[0];
    var last = focusables[focusables.length - 1];
    if (event.shiftKey && global.document.activeElement === first) {
      event.preventDefault();
      focusSafely(last);
    } else if (!event.shiftKey && global.document.activeElement === last) {
      event.preventDefault();
      focusSafely(first);
    }
  }

  function init() {
    var app = element('#bq5-app');
    if (!app) return { ok: false, code: 'NO_APP_ROOT' };
    if (actionBound && root === app) return { ok: true, alreadyInitialized: true };

    root = app;
    root.addEventListener('click', dispatchAction);
    root.addEventListener('keydown', handleKeydown);
    root.addEventListener('click', function (event) {
      if (modalState && event.target === modalState.element && modalState.dismissible) closeModal();
    });

    onAction('back', goBack);
    onAction('modal-cancel', function () { closeModal(); });
    onAction('modal-confirm', function () {
      if (!modalState) return;
      var state = modalState;
      var keepOpen = false;
      if (state.onConfirm) {
        try { keepOpen = state.onConfirm() === false; }
        catch (error) {
          if (global.console && typeof global.console.error === 'function') global.console.error(error);
          keepOpen = true;
        }
      }
      if (!keepOpen) closeModal();
    });

    actionBound = true;
    updateBackButton();
    return { ok: true };
  }

  function toast(message, kind) {
    var toastRoot = element('#bq5-toast-root');
    var fragment = cloneTemplate('tpl-toast');
    if (!toastRoot || !fragment) return false;
    var item = fragment.querySelector('.bq5-toast');
    if (!item) return false;
    item.textContent = message == null ? '' : String(message);
    item.setAttribute('data-kind', kind === 'success' || kind === 'error' ? kind : 'info');
    toastRoot.appendChild(fragment);
    if (typeof global.setTimeout === 'function') {
      global.setTimeout(function () {
        if (item.parentNode === toastRoot) toastRoot.removeChild(item);
      }, 4200);
    }
    return true;
  }

  function setReducedMotion(enabled) {
    var app = root || element('#bq5-app');
    if (!app) return false;
    if (enabled) app.setAttribute('data-motion', 'reduced');
    else app.removeAttribute('data-motion');
    emit('motion:change', { reduced: !!enabled });
    return true;
  }

  function isReducedMotion() {
    var app = root || element('#bq5-app');
    return !!(app && app.getAttribute('data-motion') === 'reduced');
  }

  var UI = {
    init: init,
    el: element,
    all: elements,
    text: setText,
    hidden: setHidden,
    cloneTemplate: cloneTemplate,
    on: on,
    emit: emit,
    onAction: onAction,
    hasListeners: hasListeners,
    showScreen: showScreen,
    back: goBack,
    currentScreen: function () { return root ? root.getAttribute('data-screen') : null; },
    openModal: openModal,
    closeModal: closeModal,
    toast: toast,
    setReducedMotion: setReducedMotion,
    isReducedMotion: isReducedMotion
  };

  BQ5.ui = UI;
})(globalThis);
