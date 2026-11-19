/* ============================================================
 * Brasil em 5 Eixos — Módulo 16: Arte
 * Responsabilidade: catálogo, seleção visual, renderização de artes,
 * temas visuais e preferências locais.
 *
 * NÃO contém regras de jogo, pontuação, questões, cronômetro ou fluxo de telas.
 * Depende apenas do catálogo; usa BQ5.storage quando disponível.
 * Carregar depois de storage.js e de art-catalog.js.
 * ============================================================ */
(function (global) {
  'use strict';

  var BQ5 = global.BQ5 = global.BQ5 || {};
  var CATALOG = global.BQ5_ART_CATALOG || {};
  var STORAGE_KEY = 'bq5_art_selection_v1';
  var FALLBACK = 'assets/art/fallback.svg';
  var GROUPS = {
    character: 'characters', characters: 'characters',
    mascot: 'mascots', mascots: 'mascots',
    background: 'backgrounds', backgrounds: 'backgrounds',
    logo: 'logos', logos: 'logos',
    icon: 'icons', icons: 'icons',
    illustration: 'illustrations', illustrations: 'illustrations'
  };
  var SELECTION_KEYS = {
    characters: 'characterId', mascots: 'mascotId', backgrounds: 'backgroundId',
    logos: 'logoId', icons: 'iconId', illustrations: 'illustrationId'
  };
  var DEFAULT_SELECTION = {
    characterId: 'explorador', mascotId: 'capivara-cartografica',
    backgroundId: 'noite-cartografica', logoId: 'marca-base',
    iconId: 'cultura', illustrationId: 'mapa-brasil-esquematico',
    themeId: 'noite-cartografica'
  };
  var current = null;
  var initialized = false;
  var listeners = [];

  function own(object, key) { return Object.prototype.hasOwnProperty.call(object || {}, key); }
  function copy(object) {
    var result = {};
    Object.keys(object || {}).forEach(function (key) { result[key] = object[key]; });
    return result;
  }
  function groupName(type) { return GROUPS[String(type || '').toLowerCase()] || null; }
  function entries(type) {
    var group = groupName(type);
    return group && Array.isArray(CATALOG[group]) ? CATALOG[group] : [];
  }
  function find(type, id) {
    var list = entries(type);
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].id === id) return list[i];
    return null;
  }
  function validId(value) { return typeof value === 'string' && /^[a-z0-9][a-z0-9-]{0,63}$/.test(value); }
  function validLocalPath(value) {
    return typeof value === 'string' && value.indexOf('assets/art/') === 0 &&
      value.indexOf('..') === -1 && value.indexOf('\\') === -1 &&
      value.indexOf(':') === -1 && value.indexOf('?') === -1 && value.indexOf('#') === -1;
  }
  function assetPath(item, mood) {
    if (!item) return FALLBACK;
    var source = item.src;
    if (mood && item.moods && typeof item.moods === 'object' && item.moods[mood]) {
      var state = item.moods[mood];
      source = typeof state === 'string' ? state : (state && (state.src || state.image)) || source;
    }
    if (!validLocalPath(source)) source = FALLBACK;
    var revision = Number(CATALOG.revision) || Number(CATALOG.version) || 1;
    return source + '?v=' + encodeURIComponent(String(revision));
  }
  function storage() { return BQ5.storage || null; }
  function themeExists(id) {
    var themes = Array.isArray(CATALOG.themes) ? CATALOG.themes : [];
    for (var i = 0; i < themes.length; i++) if (themes[i] && themes[i].id === id) return true;
    return false;
  }
  function defaults() {
    var result = copy(DEFAULT_SELECTION);
    Object.keys(result).forEach(function (key) {
      if (CATALOG.defaults && typeof CATALOG.defaults[key] === 'string') result[key] = CATALOG.defaults[key];
    });
    return result;
  }
  function validSelection(input) {
    var result = defaults();
    var source = input && typeof input === 'object' ? input : {};
    Object.keys(SELECTION_KEYS).forEach(function (group) {
      var key = SELECTION_KEYS[group];
      var wanted = source[key];
      if (typeof wanted === 'string' && find(group, wanted)) result[key] = wanted;
      else if (!find(group, result[key]) && entries(group).length) result[key] = entries(group)[0].id;
    });
    if (typeof source.themeId === 'string' && themeExists(source.themeId)) result.themeId = source.themeId;
    if (!themeExists(result.themeId)) result.themeId = (CATALOG.themes && CATALOG.themes[0] && CATALOG.themes[0].id) || '';
    return result;
  }
  function save() {
    var store = storage();
    if (!store || typeof store.setJSON !== 'function') return false;
    try { store.setJSON(STORAGE_KEY, copy(current || defaults())); return true; }
    catch (error) { return false; }
  }
  function emitChange(reason) {
    var detail = { selection: copy(current || defaults()), reason: reason || 'update' };
    listeners.slice().forEach(function (listener) {
      try { listener(detail); } catch (error) {
        if (global.console && global.console.error) global.console.error('[BQ5.art] listener error', error);
      }
    });
    if (BQ5.ui && typeof BQ5.ui.emit === 'function') BQ5.ui.emit('art:change', detail);
    apply(global.document);
    return detail;
  }
  function resolveTarget(target) {
    if (!target) return null;
    if (typeof target === 'string') return global.document ? global.document.querySelector(target) : null;
    return target;
  }
  function clear(node) { while (node && node.firstChild) node.removeChild(node.firstChild); }
  function render(target, type, id, mood, options) {
    var node = resolveTarget(target);
    if (!node || !global.document || typeof global.document.createElement !== 'function') return { ok: false, code: 'NO_TARGET' };
    var item = find(type, id);
    if (!item) return { ok: false, code: 'UNKNOWN_ASSET', type: type, id: id };
    var opts = options || {};
    var img = global.document.createElement('img');
    var path = assetPath(item, mood || 'idle');
    img.className = 'bq5-art__image' + ((opts.fit || item.fit) === 'cover' ? ' bq5-art__image--cover' : '');
    img.alt = item.alt || item.name || 'Arte do Brasil em 5 Eixos';
    img.loading = 'lazy';
    img.decoding = 'async';
    img.draggable = false;
    img.onerror = function () {
      if (img.getAttribute('data-fallback') === 'used') {
        img.hidden = true;
        node.setAttribute('data-art-error', 'true');
        return;
      }
      img.setAttribute('data-fallback', 'used');
      img.src = (opts.basePath || '') + FALLBACK + '?v=' + (Number(CATALOG.revision) || 1);
    };
    img.src = (opts.basePath || '') + path;
    clear(node);
    node.appendChild(img);
    node.setAttribute('data-art-rendered', groupName(type) || 'unknown');
    node.removeAttribute('data-art-error');
    node.setAttribute('aria-label', item.alt || item.name || 'Arte');
    return { ok: true, item: copy(item), src: img.src, element: img };
  }
  function selectedId(group) {
    var key = SELECTION_KEYS[group];
    return key && current ? current[key] : null;
  }
  function apply(root) {
    var base = root || global.document;
    if (!base || typeof base.querySelectorAll !== 'function') return { ok: false, code: 'NO_ROOT', applied: 0 };
    if (!current) current = validSelection(null);
    var count = 0;
    var slots = base.querySelectorAll('[data-bq5-art-slot]');
    for (var i = 0; i < slots.length; i++) {
      var node = slots[i];
      var requested = node.getAttribute('data-bq5-art-slot');
      var group = groupName(requested);
      if (!group) continue;
      var id = node.getAttribute('data-bq5-art-id') || selectedId(group);
      var mood = node.getAttribute('data-bq5-art-mood') || 'idle';
      if (render(node, group, id, mood, { basePath: '' }).ok) count++;
    }
    /* Compatibilidade com os espaços já previstos no Módulo 6/M11. */
    var legacyCharacter = base.querySelectorAll('.bq5-player-card__avatar');
    for (var c = 0; c < legacyCharacter.length; c++) {
      if (legacyCharacter[c].getAttribute('data-bq5-art-slot')) continue;
      if (render(legacyCharacter[c], 'characters', selectedId('characters'), 'idle').ok) count++;
    }
    var companions = base.querySelectorAll('.bq5-companion__art');
    for (var j = 0; j < companions.length; j++) {
      var parent = companions[j].closest ? companions[j].closest('.bq5-companion') : null;
      var slot = parent && parent.getAttribute('data-slot');
      var kind = slot === 'companion' || slot === 'mascot' ? 'mascots' : (slot === 'player' ? 'characters' : null);
      if (kind && render(companions[j], kind, selectedId(kind), parent.getAttribute('data-mood') || 'idle').ok) count++;
    }
    return { ok: true, applied: count };
  }
  function select(type, id) {
    var group = groupName(type);
    if (!group || !find(group, id)) return { ok: false, code: 'UNKNOWN_ASSET', type: type, id: id };
    if (!current) current = validSelection(null);
    current[SELECTION_KEYS[group]] = id;
    save();
    emitChange('selection');
    return { ok: true, selection: copy(current), item: copy(find(group, id)) };
  }
  function selectTheme(id) {
    if (!themeExists(id)) return { ok: false, code: 'UNKNOWN_THEME', id: id };
    if (!current) current = validSelection(null);
    current.themeId = id;
    if (global.document && global.document.documentElement) {
      global.document.documentElement.setAttribute('data-bq5-theme', id);
    }
    save();
    emitChange('theme');
    return { ok: true, themeId: id };
  }
  function setSelection(patch) {
    var source = patch && typeof patch === 'object' ? patch : {};
    var next = copy(current || defaults());
    var map = [
      ['characters', 'characterId'], ['mascots', 'mascotId'],
      ['backgrounds', 'backgroundId'], ['logos', 'logoId'],
      ['icons', 'iconId'], ['illustrations', 'illustrationId']
    ];
    for (var i = 0; i < map.length; i++) {
      var key = map[i][1];
      if (source[key] != null) {
        if (!find(map[i][0], source[key])) return { ok: false, code: 'UNKNOWN_ASSET', type: map[i][0], id: source[key] };
        next[key] = source[key];
      }
    }
    if (source.themeId != null) {
      if (!themeExists(source.themeId)) return { ok: false, code: 'UNKNOWN_THEME', id: source.themeId };
      next.themeId = source.themeId;
    }
    current = next;
    if (global.document && global.document.documentElement) global.document.documentElement.setAttribute('data-bq5-theme', current.themeId);
    save();
    emitChange('selection');
    return { ok: true, selection: selection() };
  }
  function selection() { return copy(current || defaults()); }
  function reset() {
    current = validSelection(null);
    if (global.document && global.document.documentElement) global.document.documentElement.setAttribute('data-bq5-theme', current.themeId);
    save();
    emitChange('reset');
    return { ok: true, selection: selection() };
  }
  function init(options) {
    var opts = options || {};
    if (initialized && !opts.force) return { ok: true, alreadyInitialized: true, selection: selection() };
    var store = storage();
    var saved = store && typeof store.getJSON === 'function' ? store.getJSON(STORAGE_KEY, null) : null;
    current = validSelection(saved);
    if (global.document && global.document.documentElement) global.document.documentElement.setAttribute('data-bq5-theme', current.themeId);
    initialized = true;
    if (BQ5.ui && typeof BQ5.ui.on === 'function' && !init._uiBound) {
      BQ5.ui.on('screen:change', function () { apply(global.document); });
      init._uiBound = true;
    }
    apply(global.document);
    return { ok: true, selection: selection() };
  }
  function list(type) { return entries(type).map(function (item) { return copy(item); }); }
  function get(type, id) { var item = find(type, id); return item ? copy(item) : null; }
  function themes() { return (Array.isArray(CATALOG.themes) ? CATALOG.themes : []).map(function (item) { return copy(item); }); }
  function onChange(handler) {
    if (typeof handler !== 'function') return function () {};
    listeners.push(handler);
    return function () { var index = listeners.indexOf(handler); if (index >= 0) listeners.splice(index, 1); };
  }
  function check() {
    var errors = [];
    Object.keys(GROUPS).forEach(function (key) {
      if (key !== GROUPS[key]) return;
      entries(key).forEach(function (item) {
        if (!item || !validId(item.id)) errors.push('ID inválido em ' + key);
        if (!item || !validLocalPath(item.src)) errors.push('Caminho inválido em ' + key + ': ' + (item && item.id));
        if (item && item.moods) Object.keys(item.moods).forEach(function (mood) {
          var value = item.moods[mood];
          var src = typeof value === 'string' ? value : value && (value.src || value.image);
          if (!validLocalPath(src)) errors.push('Caminho inválido no estado ' + mood + ' de ' + item.id);
        });
      });
    });
    return { ok: errors.length === 0, errors: errors, groups: Object.keys(SELECTION_KEYS).length, revision: Number(CATALOG.revision) || 1 };
  }

  BQ5.art = {
    init: init,
    list: list,
    get: get,
    themes: themes,
    selection: selection,
    select: select,
    selectTheme: selectTheme,
    setSelection: setSelection,
    reset: reset,
    render: render,
    apply: apply,
    onChange: onChange,
    check: check,
    assetPath: assetPath
  };
})(typeof window !== 'undefined' ? window : globalThis);
