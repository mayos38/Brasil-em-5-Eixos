(function () {
  'use strict';
  var api = window.BQ5 && window.BQ5.art;
  var $ = function (id) { return document.getElementById(id); };
  var category = $('asset-category');
  var mood = $('asset-mood');
  var moodField = $('mood-field');
  var themeSelect = $('theme-select');
  var assetList = $('asset-list');
  var selectedId = null;
  var draft = null;
  var temporaryUrl = null;
  var temporaryTarget = null;
  var GROUP_KEY = { characters: 'characterId', mascots: 'mascotId', backgrounds: 'backgroundId', logos: 'logoId', icons: 'iconId', illustrations: 'illustrationId' };
  var BASE = '../brasil-quiz/';

  function text(node, value) { if (node) node.textContent = value == null ? '' : String(value); }
  function make(tag, className, content) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (content != null) node.textContent = content;
    return node;
  }
  function labelFor(type) {
    return ({ characters: 'personagem', mascots: 'mascote', backgrounds: 'fundo', logos: 'logotipo', icons: 'ícone', illustrations: 'ilustração' })[type] || 'arte';
  }
  function itemById(type, id) {
    var items = api.list(type);
    for (var i = 0; i < items.length; i++) if (items[i].id === id) return items[i];
    return null;
  }
  function selectedFor(type) { return draft && draft[GROUP_KEY[type]]; }
  function drawPreview() {
    if (!draft) return;
    document.documentElement.setAttribute('data-bq5-theme', draft.themeId || 'noite-cartografica');
    api.render($('preview-background'), 'backgrounds', draft.backgroundId, 'idle', { basePath: BASE });
    api.render($('preview-logo'), 'logos', draft.logoId, 'idle', { basePath: BASE });
    api.render($('preview-character'), 'characters', draft.characterId, mood.value, { basePath: BASE });
    api.render($('preview-mascot'), 'mascots', draft.mascotId, mood.value, { basePath: BASE });
    if (temporaryUrl && temporaryTarget) {
      var selectedPreview = $('preview-current-art');
      var selectedImage = selectedPreview && selectedPreview.querySelector('img');
      if (selectedImage) selectedImage.src = temporaryUrl;
      if (temporaryTarget === 'characters' || temporaryTarget === 'mascots') {
        var target = temporaryTarget === 'characters' ? $('preview-character') : $('preview-mascot');
        var image = target && target.querySelector('img');
        if (image) image.src = temporaryUrl;
      }
    }
  }
  function showSelectedItem() {
    var type = category.value;
    var item = itemById(type, selectedId);
    if (!item) {
      text($('selected-name'), 'Nenhum item cadastrado nesta categoria.');
      text($('selected-description'), 'Adicione um item ao catálogo para visualizar aqui.');
      text($('selected-path'), '—');
      $('preview-current-art').replaceChildren();
      return;
    }
    text($('selected-name'), item.name);
    text($('selected-description'), item.description || 'Sem descrição.');
    var statePath = item.moods && item.moods[mood.value];
    if (statePath && typeof statePath === 'object') statePath = statePath.src || statePath.image;
    text($('selected-path'), typeof statePath === 'string' ? statePath : item.src);
    api.render($('preview-current-art'), type, item.id, mood.value, { basePath: BASE });
    drawPreview();
  }
  function renderLibrary() {
    var type = category.value;
    var items = api.list(type);
    assetList.replaceChildren();
    text($('asset-count'), items.length + (items.length === 1 ? ' item' : ' itens'));
    moodField.hidden = type !== 'characters' && type !== 'mascots';
    if (!items.length) {
      assetList.appendChild(make('p', 'art-lab__helper', 'Ainda não há itens cadastrados nesta categoria. Edite art-catalog.js para adicionar o primeiro.'));
      selectedId = null;
      showSelectedItem();
      return;
    }
    if (!itemById(type, selectedId)) selectedId = selectedFor(type) || items[0].id;
    items.forEach(function (item) {
      var button = make('button', 'art-lab__asset');
      button.type = 'button';
      button.setAttribute('aria-pressed', item.id === selectedId ? 'true' : 'false');
      button.setAttribute('data-asset-id', item.id);
      var picture = make('span', 'art-lab__asset-art');
      api.render(picture, type, item.id, mood.value, { basePath: BASE });
      var copy = make('span', 'art-lab__asset-copy');
      copy.appendChild(make('span', 'art-lab__asset-name', item.name));
      copy.appendChild(make('span', 'art-lab__asset-desc', item.description || 'Sem descrição.'));
      button.appendChild(picture);
      button.appendChild(copy);
      button.addEventListener('click', function () {
        selectedId = item.id;
        /* Atualiza a composição como rascunho; só persiste ao clicar em Salvar. */
        if (draft && GROUP_KEY[type]) draft[GROUP_KEY[type]] = item.id;
        if (temporaryUrl) clearTemporary();
        renderLibrary();
        showSelectedItem();
      });
      assetList.appendChild(button);
    });
    showSelectedItem();
  }
  function renderThemes() {
    themeSelect.replaceChildren();
    api.themes().forEach(function (theme) {
      var option = make('option', '', theme.name);
      option.value = theme.id;
      themeSelect.appendChild(option);
    });
    themeSelect.value = draft.themeId;
  }
  function clearTemporary() {
    if (temporaryUrl) URL.revokeObjectURL(temporaryUrl);
    temporaryUrl = null;
    temporaryTarget = null;
    $('local-image').value = '';
    $('clear-local-image').disabled = true;
    text($('upload-status'), 'Nenhum arquivo temporário carregado.');
    showSelectedItem();
  }
  function setStatus(message, ok) {
    var node = $('lab-status');
    text(node, message);
    node.style.borderColor = ok ? '#2fbf71' : '#385071';
    node.style.color = ok ? '#a6efc5' : '#b8c8df';
  }
  function saveDraft() {
    var result = api.setSelection(draft);
    if (!result.ok) {
      text($('save-status'), 'Não foi possível salvar: ' + result.code);
      return;
    }
    draft = api.selection();
    renderThemes();
    drawPreview();
    text($('save-status'), 'Seleção salva no armazenamento local deste navegador. O jogo precisa chamar BQ5.art.apply() para exibi-la nos espaços conectados.');
  }
  function restoreDefaults() {
    api.reset();
    draft = api.selection();
    selectedId = selectedFor(category.value) || (api.list(category.value)[0] || {}).id || null;
    renderThemes();
    renderLibrary();
    drawPreview();
    text($('save-status'), 'Padrões restaurados e salvos localmente.');
    clearTemporary();
  }

  if (!api) {
    setStatus('Módulo de Arte não carregado', false);
    text($('save-status'), 'Verifique se art-catalog.js e art.js foram carregados.');
    return;
  }
  var integrity = api.check();
  if (!integrity.ok) {
    setStatus('Catálogo com problemas', false);
    text($('save-status'), integrity.errors.join(' · '));
    return;
  }
  api.init();
  draft = api.selection();
  renderThemes();
  selectedId = selectedFor(category.value) || (api.list(category.value)[0] || {}).id || null;
  renderLibrary();
  drawPreview();
  setStatus('Catálogo validado · ' + integrity.revision, true);

  category.addEventListener('change', function () {
    selectedId = selectedFor(category.value) || (api.list(category.value)[0] || {}).id || null;
    if (temporaryUrl) clearTemporary();
    renderLibrary();
  });
  mood.addEventListener('change', function () { renderLibrary(); });
  themeSelect.addEventListener('change', function () {
    draft.themeId = themeSelect.value;
    drawPreview();
  });
  $('save-selection').addEventListener('click', saveDraft);
  $('reset-selection').addEventListener('click', restoreDefaults);
  $('clear-local-image').addEventListener('click', clearTemporary);
  $('local-image').addEventListener('change', function () {
    var file = this.files && this.files[0];
    if (!file) return;
    if (!/^image\/(png|jpeg|webp|gif|svg\+xml)$/.test(file.type)) {
      text($('upload-status'), 'Formato não aceito. Use PNG, JPG, WebP, GIF ou SVG.');
      this.value = '';
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      text($('upload-status'), 'Arquivo acima de 8 MB. Reduza o tamanho antes de testar.');
      this.value = '';
      return;
    }
    if (!GROUP_KEY[category.value]) {
      text($('upload-status'), 'Selecione uma categoria válida antes de testar a imagem.');
      this.value = '';
      return;
    }
    if (temporaryUrl) URL.revokeObjectURL(temporaryUrl);
    temporaryUrl = URL.createObjectURL(file);
    temporaryTarget = category.value;
    $('clear-local-image').disabled = false;
    text($('upload-status'), file.name + ' — prévia temporária de ' + labelFor(temporaryTarget) + ', não salva no projeto.');
    drawPreview();
    var target = temporaryTarget === 'characters' ? $('preview-character') : $('preview-mascot');
    var image = target && target.querySelector('img');
    if (image) image.src = temporaryUrl;
  });
  window.addEventListener('beforeunload', function () { if (temporaryUrl) URL.revokeObjectURL(temporaryUrl); });
})();
