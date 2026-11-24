# -*- coding: utf-8 -*-
"""Teste estrutural da interface dos Módulos 6–11 — Brasil em 5 Eixos.

Uso:
    python tests/run_ui_structure.py [raiz_do_projeto]

Aceita a raiz do repositório (contém brasil-quiz/) ou a pasta brasil-quiz.
Usa somente a biblioteca padrão do Python. O teste avalia estrutura estática e
continuidade documental; NÃO substitui testes funcionais em navegador.
"""
from __future__ import print_function

import re
import sys
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlparse

SCREENS = (
    'boot', 'menu', 'setup', 'play', 'handoff', 'results', 'campaign', 'lan',
    'mp-mode', 'mp-setup', 'mp-theme', 'mp-wait', 'mp-play',
    'mp-alt-pick', 'mp-alt-play', 'mp-alt-end', 'mp-alt-msg'
)
BASE_SCRIPTS = (
    'js/config.js', 'js/util.js', 'js/storage.js', 'js/bank.js', 'js/engine.js'
)
ACTIVE_UI_SCRIPTS = ('js/ui.js', 'js/screens/menu.js', 'js/screens/setup.js', 'js/screens/play.js', 'js/screens/results.js')
MP_SCRIPTS = ('js/hp.js', 'js/multiplayer/lan.js', 'js/multiplayer/qr.js', 'js/multiplayer/qr-reader.js', 'js/multiplayer/local.js', 'js/multiplayer/alt.js')  # M18 (HP) + M13 (+ transporte e QR suplementar)
PENDING_UI_SCRIPTS = (
    'js/screens/campaign.js', 'js/main.js'
)
TEMPLATES = (
    'tpl-choice', 'tpl-player-field', 'tpl-roster-item', 'tpl-ranking-item',
    'tpl-review-item', 'tpl-route-node', 'tpl-lan-player', 'tpl-modal',
    'tpl-menu-options', 'tpl-toast'
)
DYNAMIC_CLASSES = (
    'bq5-is-entering', 'bq5-anim-pop', 'bq5-anim-shake', 'bq5-anim-pulse',
    'bq5-progress-pip'
)
ASSET_EXTENSIONS = {
    '.svg', '.png', '.webp', '.avif', '.jpg', '.jpeg', '.gif',
    '.woff', '.woff2', '.ttf', '.otf', '.mp3', '.ogg', '.wav', '.m4a'
}
VOID_TAGS = {
    'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
    'link', 'meta', 'param', 'source', 'track', 'wbr'
}
ID_RE = re.compile(
    r'^(?:bq5|screen|boot|menu|setup|play|handoff|results|campaign|lan|mp|alt|tpl)-[a-z0-9-]+$|^modal-title$'
)

passed = 0
failed = 0
warnings = 0


def check(name, condition, detail=''):
    global passed, failed
    if condition:
        passed += 1
    else:
        failed += 1
        print('FAIL:', name, ('-> ' + str(detail)) if detail != '' else '')


def warn(message):
    global warnings
    warnings += 1
    print('WARN:', message)


def info(message):
    print('INFO:', message)


def section_between(text, start_heading, end_heading=None):
    start = text.find(start_heading)
    if start < 0:
        return ''
    start += len(start_heading)
    end = text.find(end_heading, start) if end_heading else -1
    return text[start:end] if end >= 0 else text[start:]


def locate_layout(argument=None):
    supplied = Path(argument).expanduser().resolve() if argument else Path(__file__).resolve().parent.parent
    if supplied.name == 'tests':
        supplied = supplied.parent

    if supplied.name == 'brasil-quiz' and (supplied / 'index.html').is_file():
        game = supplied
        repo = supplied.parent
    elif (supplied / 'brasil-quiz' / 'index.html').is_file():
        repo = supplied
        game = supplied / 'brasil-quiz'
    elif (supplied / 'index.html').is_file() and (supplied / 'css' / 'style.css').is_file():
        game = supplied
        repo = supplied.parent
    else:
        repo = supplied
        game = supplied / 'brasil-quiz'

    docs_candidates = [repo / 'docs', game / 'docs']
    docs = next((candidate for candidate in docs_candidates if candidate.is_dir()), repo / 'docs')
    return {
        'repo': repo,
        'game': game,
        'html': game / 'index.html',
        'css': game / 'css' / 'style.css',
        'js': game / 'js',
        'docs': docs,
        'contract': docs / 'UI_CONTRACT.md',
        'identity': docs / 'IDENTIDADE_VISUAL.md',
        'catalog': docs / 'ASSET_CATALOG.md',
        'assets': repo / 'assets',
    }


class Tag(object):
    def __init__(self, tag, attrs, in_template, template_id, ancestors):
        self.tag = tag
        self.attrs_list = attrs or []
        self.attrs = dict(self.attrs_list)
        self.in_template = in_template
        self.template_id = template_id
        self.ancestors = tuple(ancestors)


class DocumentParser(HTMLParser):
    def __init__(self):
        super(DocumentParser, self).__init__(convert_charrefs=True)
        self.tags = []
        self.comments = []
        self.stack = []
        self.errors = []

    def handle_starttag(self, tag, attrs):
        attrs = attrs or []
        names = [name for name, _ in attrs]
        duplicates = sorted(set(name for name in names if names.count(name) > 1))
        if duplicates:
            self.errors.append('atributos duplicados em <{}>: {}'.format(tag, duplicates))

        template_ancestors = [item for item in self.stack if item[0] == 'template']
        template_id = template_ancestors[-1][1].get('id') if template_ancestors else None
        item = Tag(tag, attrs, bool(template_ancestors), template_id, self.stack)
        self.tags.append(item)
        attrs_dict = dict(attrs)
        if tag not in VOID_TAGS:
            self.stack.append((tag, attrs_dict))

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if tag not in VOID_TAGS:
            self.handle_endtag(tag)

    def handle_endtag(self, tag):
        for index in range(len(self.stack) - 1, -1, -1):
            if self.stack[index][0] == tag:
                del self.stack[index:]
                return
        self.errors.append('tag de fechamento sem abertura: </{}>'.format(tag))

    def handle_comment(self, data):
        self.comments.append(data)


def parse_root_tokens(css):
    match = re.search(r':root\s*\{([^}]*)\}', css, re.S)
    if not match:
        return {}
    return {
        name: value.strip()
        for name, value in re.findall(r'--bq5-([\w-]+)\s*:\s*([^;]+);', match.group(1))
    }


def luminance(hex_color):
    value = hex_color.strip().lstrip('#')
    if len(value) == 3:
        value = ''.join(ch * 2 for ch in value)
    if len(value) != 6 or not re.fullmatch(r'[0-9a-fA-F]{6}', value):
        raise ValueError('cor não é hex RGB de 3/6 dígitos: ' + hex_color)
    channels = [int(value[index:index + 2], 16) / 255.0 for index in (0, 2, 4)]

    def linear(channel):
        return channel / 12.92 if channel <= 0.04045 else ((channel + 0.055) / 1.055) ** 2.4

    red, green, blue = [linear(channel) for channel in channels]
    return 0.2126 * red + 0.7152 * green + 0.0722 * blue


def contrast_ratio(color_a, color_b):
    light, dark = sorted((luminance(color_a), luminance(color_b)), reverse=True)
    return (light + 0.05) / (dark + 0.05)


def contract_id_set(contract):
    block = section_between(contract, '## 3. IDs estáticos por área', '## 4.')
    return {value for value in re.findall(r'`([^`]+)`', block) if ID_RE.fullmatch(value)}


def contract_action_set(contract):
    block = section_between(contract, '## 2. Ações', '## 3.')
    actions = set()
    for line in block.splitlines():
        if line.strip().startswith('| `'):
            match = re.match(r'^\|\s*`([a-z][a-z0-9-]*)`\s*\|', line.strip())
            if match:
                actions.add(match.group(1))
    return actions


def contract_dynamic_class_set(contract):
    block = section_between(contract, '## 8. Classes dinâmicas', '## 9.')
    return set(re.findall(r'`(bq5-[\w-]+)`', block))


def css_class_set(css):
    without_comments = re.sub(r'/\*.*?\*/', '', css, flags=re.S)
    return set(re.findall(r'\.((?:bq5-)[\w-]+)', without_comments)), without_comments


def resolve_local(base, value):
    clean = value.strip().split('#', 1)[0].split('?', 1)[0]
    if not clean or clean.startswith('data:'):
        return None
    return (base / clean).resolve()


def is_external(value):
    parsed = urlparse(value.strip())
    return bool(parsed.scheme or value.strip().startswith('//'))


def check_asset_continuity(paths, catalog_text, identity_text, parser, css):
    check('catálogo registra inventário E1/E2/E3', 'E1' in catalog_text and 'E2' in catalog_text and 'E3' in catalog_text and '## 2.' in catalog_text)
    check('catálogo distingue recursos embutidos e arquivos independentes', 'Existe, porém embutida' in catalog_text and 'Nenhum existe' in catalog_text)
    check('catálogo documenta implementação CSS B4–B6', all(token in catalog_text for token in ('B4', 'B5', 'B6', 'Implementado')))
    check('identidade visual reconhece planejamento 5.5 e materialização M6', 'Módulo 5.5' in identity_text and 'Módulo 6' in identity_text and 'materializada' in identity_text.lower())
    check('catálogo referencia identidade visual', 'IDENTIDADE_VISUAL.md' in catalog_text)

    asset_root = paths['assets']
    independent_assets = []
    if asset_root.is_dir():
        independent_assets = sorted(
            path for path in asset_root.rglob('*')
            if path.is_file() and path.suffix.lower() in ASSET_EXTENSIONS
        )

    inventory = section_between(catalog_text, '## 2.', '## 3.')
    no_assets_claim = bool(re.search(r'\bNenhum existe\b', inventory, re.I))
    check('inventário E3 coerente com arquivos independentes atuais', not (no_assets_claim and independent_assets), [p.relative_to(asset_root).as_posix() for p in independent_assets])

    unregistered = []
    for asset in independent_assets:
        relative = 'assets/' + asset.relative_to(asset_root).as_posix()
        if relative not in catalog_text:
            unregistered.append(relative)
    check('arquivos independentes em assets/ aparecem no catálogo', not unregistered, unregistered)

    invalid_names = [
        asset.relative_to(asset_root).as_posix() for asset in independent_assets
        if not re.fullmatch(r'[a-z0-9]+(?:-[a-z0-9]+)*\.[a-z0-9]+', asset.name)
    ]
    check('nomes de assets seguem minúsculas/números/hífens', not invalid_names, invalid_names)

    # O inventário diz que E1/E2 são embutidos no protótipo, não no jogo modular.
    # O teste só exige arquivos independentes quando o catálogo os marca como existentes.
    missing_existing = []
    for line in inventory.splitlines():
        if not line.strip().startswith('|'):
            continue
        cells = [cell.strip() for cell in line.strip().strip('|').split('|')]
        if len(cells) < 6:
            continue
        location, status = cells[2], cells[4]
        if 'Existe' not in status or 'embutida' in status.lower():
            continue
        for file_ref in re.findall(r'assets/[A-Za-z0-9_./-]+', location):
            if not (paths['repo'] / file_ref).is_file():
                missing_existing.append(file_ref)
    check('assets independentes marcados existentes estão em disco', not missing_existing, missing_existing)

    # Assets previstos/aguardando criação não são obrigatórios e .gitkeep não é asset.
    if not asset_root.is_dir():
        warn('pasta assets/ não encontrada; o catálogo não exige arquivos independentes nesta etapa.')

    # Offline-first resources in active HTML.
    external_html, missing_html = [], []
    for item in parser.tags:
        attrs = item.attrs
        resource = None
        if item.tag in ('script', 'img', 'audio', 'video', 'source', 'iframe'):
            resource = attrs.get('src')
            if item.tag == 'video' and not resource:
                resource = attrs.get('poster')
        elif item.tag == 'link':
            resource = attrs.get('href')
        if not resource:
            continue
        if is_external(resource) or resource.startswith('data:'):
            external_html.append('{}: {}'.format(item.tag, resource))
            continue
        if item.tag == 'script' and resource.startswith('../dev/'):
            continue  # desenvolvimento: opcional; módulo 15 remove.
        candidate = resolve_local(paths['html'].parent, resource)
        if candidate and not candidate.is_file():
            missing_html.append('{}: {}'.format(item.tag, resource))
    check('HTML não usa recursos remotos/data URI', not external_html, external_html)
    check('recursos locais referenciados no HTML existem', not missing_html, missing_html)

    css_clean = re.sub(r'/\*.*?\*/', '', css, flags=re.S)
    external_css, missing_css = [], []
    if re.search(r'@import\s+', css_clean, re.I):
        external_css.append('@import')
    for raw_url in re.findall(r'url\(\s*["\']?([^\)"\']+)["\']?\s*\)', css_clean, re.I):
        value = raw_url.strip()
        if is_external(value) or value.startswith('data:'):
            external_css.append(value)
        else:
            candidate = resolve_local(paths['css'].parent, value)
            if candidate and not candidate.is_file():
                missing_css.append(value)
    check('CSS não importa recursos remotos/data URI', not external_css, external_css)
    check('referências locais url() do CSS existem', not missing_css, missing_css)


def main():
    paths = locate_layout(sys.argv[1] if len(sys.argv) > 1 else None)
    required = (
        ('brasil-quiz/index.html', paths['html']),
        ('brasil-quiz/css/style.css', paths['css']),
        ('docs/UI_CONTRACT.md', paths['contract']),
        ('docs/IDENTIDADE_VISUAL.md', paths['identity']),
        ('docs/ASSET_CATALOG.md', paths['catalog']),
    )
    for label, file_path in required:
        check('arquivo obrigatório existe: ' + label, file_path.is_file(), file_path)
    if failed:
        return finish()

    html = paths['html'].read_text(encoding='utf-8')
    css = paths['css'].read_text(encoding='utf-8')
    contract = paths['contract'].read_text(encoding='utf-8')
    identity = paths['identity'].read_text(encoding='utf-8')
    catalog = paths['catalog'].read_text(encoding='utf-8')

    parser = DocumentParser()
    parser.feed(html)
    parser.close()
    check('HTML sem problemas simples de estrutura/fechamento', not parser.errors, parser.errors[:12])

    # ---- IDs and templates ----
    all_id_items = [item for item in parser.tags if 'id' in item.attrs]
    all_ids = [item.attrs['id'] for item in all_id_items]
    duplicate_ids = sorted({value for value in all_ids if all_ids.count(value) > 1})
    check('IDs únicos no HTML e templates', not duplicate_ids, duplicate_ids)
    static_ids = {item.attrs['id'] for item in all_id_items if not item.in_template}
    template_ids = {item.attrs['id'] for item in all_id_items if item.in_template}
    expected_template_ids = set(TEMPLATES) | {'modal-title'}
    check('IDs internos de template limitados a modal-title', template_ids <= {'modal-title'}, sorted(template_ids - {'modal-title'}))
    check('modal-title existe uma vez dentro do tpl-modal', sum(1 for item in all_id_items if item.attrs['id'] == 'modal-title' and item.in_template and item.template_id == 'tpl-modal') == 1)
    documented_ids = contract_id_set(contract)
    check('IDs documentados presentes no HTML', documented_ids <= (static_ids | template_ids), sorted(documented_ids - (static_ids | template_ids)))
    check('todos os IDs estáticos do HTML constam no contrato', static_ids <= documented_ids, sorted(static_ids - documented_ids))

    # ---- screens ----
    screens = {}
    for item in parser.tags:
        if item.tag == 'section' and item.attrs.get('data-screen'):
            screens[item.attrs['data-screen']] = item
    check('oito telas esperadas existem', set(screens) == set(SCREENS), {'faltam': sorted(set(SCREENS)-set(screens)), 'extras': sorted(set(screens)-set(SCREENS))})
    for name in SCREENS:
        item = screens.get(name)
        check('tela {} usa id screen-{}'.format(name, name), item is not None and item.attrs.get('id') == 'screen-' + name)
    visible = sorted(name for name, item in screens.items() if 'hidden' not in item.attrs)
    check('somente boot visível na carga inicial', visible == ['boot'], visible)
    check('bq5-app começa em data-screen=boot', any(item.attrs.get('id') == 'bq5-app' and item.attrs.get('data-screen') == 'boot' for item in parser.tags))
    for name, item in screens.items():
        target = item.attrs.get('aria-labelledby', '')
        check('tela {} tem aria-labelledby válido'.format(name), bool(target) and target in static_ids, target)
    check('boot inicia em loading', screens.get('boot') is not None and screens['boot'].attrs.get('data-state') == 'loading')

    # ---- templates ----
    html_templates = {item.attrs['id'] for item in parser.tags if item.tag == 'template' and item.attrs.get('id')}
    check('dez templates obrigatórios presentes', html_templates == set(TEMPLATES), {'faltam': sorted(set(TEMPLATES)-html_templates), 'extras': sorted(html_templates-set(TEMPLATES))})

    # ---- ARIA, labels, anchors, buttons ----
    for item in parser.tags:
        attrs = item.attrs
        for attr in ('aria-labelledby', 'aria-controls', 'aria-describedby'):
            if attr in attrs:
                for ref in attrs[attr].split():
                    available = template_ids if item.in_template else static_ids
                    check('{}={} aponta para ID existente'.format(attr, ref), ref in available, item.tag)
        if item.tag == 'label' and attrs.get('for'):
            target = attrs['for']
            available = template_ids if item.in_template else static_ids
            check('label for={} aponta para controle existente'.format(target), target in available, item.template_id or 'documento')
        if item.tag == 'a' and attrs.get('href', '').startswith('#'):
            ref = attrs['href'][1:]
            check('âncora #{} aponta para ID existente'.format(ref), ref in static_ids)
        if item.tag == 'button':
            check('button declara type ({})'.format(attrs.get('id') or attrs.get('data-action') or '?'), attrs.get('type') in ('button', 'submit'))
        if item.tag in ('input', 'textarea') and attrs.get('id'):
            control_id = attrs['id']
            wrapped = any(ancestor[0] == 'label' for ancestor in item.ancestors)
            labelled = any(label.tag == 'label' and label.attrs.get('for') == control_id and label.in_template == item.in_template for label in parser.tags)
            named = bool(attrs.get('aria-label') or attrs.get('aria-labelledby'))
            check('controle #{} possui nome acessível'.format(control_id), wrapped or labelled or named)

    check('html lang pt-BR', any(item.tag == 'html' and item.attrs.get('lang') == 'pt-BR' for item in parser.tags))
    check('viewport usa viewport-fit=cover', 'viewport-fit=cover' in html)
    check('link de salto aponta para bq5-main', any(item.tag == 'a' and item.attrs.get('href') == '#bq5-main' and 'bq5-skip' in item.attrs.get('class', '').split() for item in parser.tags))
    check('nenhum onclick inline', re.search(r'\sonclick\s*=', html, re.I) is None)

    # ---- inline styles: only --p in HTML meters ----
    html_styles = []
    invalid_styles = []
    for item in parser.tags:
        if 'style' not in item.attrs:
            continue
        style = item.attrs['style'].strip()
        html_styles.append((item.tag, item.attrs.get('id'), style))
        valid = re.fullmatch(r'--p\s*:\s*(?:0(?:\.\d+)?|1(?:\.0+)?)\s*;?', style) is not None
        if not valid or item.attrs.get('id') not in ('play-timer', 'play-progress', 'campaign-progress', 'menu-progress-bar', 'mp-timer'):
            invalid_styles.append((item.tag, item.attrs.get('id'), style))
    check('HTML usa estilo inline apenas para --p nas barras autorizadas', not invalid_styles, invalid_styles)

    # ---- action contract, both directions ----
    html_actions = {item.attrs['data-action'] for item in parser.tags if 'data-action' in item.attrs}
    documented_actions = contract_action_set(contract)
    registered_actions = set()
    for module_path in ACTIVE_UI_SCRIPTS + MP_SCRIPTS:
        source = (paths['game'] / module_path).read_text(encoding='utf-8') if (paths['game'] / module_path).is_file() else ''
        registered_actions.update(re.findall(r"onAction\(['\"]([^'\"]+)['\"]", source))
    generated_actions = documented_actions & registered_actions
    check('todas as ações HTML estão documentadas', html_actions <= documented_actions, sorted(html_actions-documented_actions))
    check('ações do contrato têm ponto de entrada no HTML/template ou geração dinâmica registrada', documented_actions <= (html_actions | generated_actions), sorted(documented_actions-(html_actions | generated_actions)))

    # ---- radio patterns ----
    lan_radio_groups = [item for item in parser.tags if item.attrs.get('id') == 'lan-role']
    lan_radios = [item for item in parser.tags if item.attrs.get('role') == 'radio' and item.attrs.get('aria-controls') in ('lan-panel-host', 'lan-panel-join')]
    checked = [item for item in lan_radios if item.attrs.get('aria-checked') == 'true']
    tabbable = [item for item in lan_radios if item.attrs.get('tabindex') == '0']
    check('grupo LAN contém dois rádios com aria-controls', len(lan_radio_groups) == 1 and len(lan_radios) == 2)
    check('grupo LAN tem exatamente um rádio selecionado e focável', len(checked) == 1 and len(tabbable) == 1)
    check('painel host começa visível e join começa hidden', any(item.attrs.get('id') == 'lan-panel-host' and 'hidden' not in item.attrs for item in parser.tags) and any(item.attrs.get('id') == 'lan-panel-join' and 'hidden' in item.attrs for item in parser.tags))
    choices = [item for item in parser.tags if item.tag == 'button' and item.in_template and item.template_id == 'tpl-choice']
    check('tpl-choice é rádio não selecionado e fora da ordem de Tab até ser configurado', len(choices) == 1 and choices[0].attrs.get('role') == 'radio' and choices[0].attrs.get('aria-checked') == 'false' and choices[0].attrs.get('tabindex') == '-1')

    # ---- classes in HTML vs CSS ----
    css_classes, css_clean = css_class_set(css)
    html_classes = set()
    for item in parser.tags:
        html_classes.update(item.attrs.get('class', '').split())
    bq5_html_classes = {value for value in html_classes if value.startswith('bq5-')}
    check('todas as classes bq5-* do HTML estão no CSS', bq5_html_classes <= css_classes, sorted(bq5_html_classes-css_classes))
    non_prefixed = sorted(value for value in html_classes if not value.startswith('bq5-'))
    check('classes HTML seguem prefixo bq5-', not non_prefixed, non_prefixed)
    documented_dynamic = contract_dynamic_class_set(contract)
    check('classes dinâmicas estão documentadas no contrato', set(DYNAMIC_CLASSES) <= documented_dynamic, sorted(set(DYNAMIC_CLASSES)-documented_dynamic))
    check('classes dinâmicas documentadas estão definidas no CSS', documented_dynamic <= css_classes, sorted(documented_dynamic-css_classes))
    unused_css = sorted(css_classes - html_classes - documented_dynamic)
    if unused_css:
        warn('classes CSS ainda sem uso literal no HTML/contrato (podem ser templates dinâmicos): ' + ', '.join(unused_css[:40]))

    # ---- CSS tokens and identity palette ----
    tokens = parse_root_tokens(css)
    used_tokens = set(re.findall(r'var\(\s*--bq5-([\w-]+)', css))
    missing_tokens = sorted(used_tokens - set(tokens))
    check('todas as variáveis var(--bq5-*) estão definidas em :root', not missing_tokens, missing_tokens)
    root_match = re.search(r':root\s*\{.*?\}', css, re.S)
    css_after_root = css[root_match.end():] if root_match else css
    css_after_root = re.sub(r'/\*.*?\*/', '', css_after_root, flags=re.S)
    hardcoded = sorted(set(re.findall(r'#[0-9a-fA-F]{3,8}\b|rgba?\s*\(|hsla?\s*\(', css_after_root)))
    check('cores literais mantidas em :root (sem hardcode fora dos tokens)', not hardcoded, hardcoded)

    expected_palette = {
        'bg': '#0A1220', 'surface-1': '#182440', 'surface-2': '#233252',
        'border': '#2C3D66', 'text-primary': '#EEF2FB', 'text-secondary': '#93A1BD',
        'primary': '#FFD23F', 'primary-ink': '#0A1220', 'success': '#2FBF71',
        'error': '#FF6B6B', 'warning': '#FF9D3F', 'disabled-text': '#5E6A85',
        'disabled-surface': '#202B47', 'theme-cultura': '#C97B5A',
        'theme-economia': '#4E8FD1', 'theme-animais': '#E0A458',
        'theme-vegetacao': '#2FBF71', 'theme-cidades': '#A78BFA',
    }
    for token, expected in expected_palette.items():
        actual = tokens.get(token, '').upper()
        check('token --bq5-{} alinha à identidade M5.5'.format(token), actual == expected.upper(), actual or 'ausente')

    # Check canonical spacing, radii, sizing and local/system typography.
    exact_tokens = {
        'fs-md': '1rem', 'fs-lg': '1.125rem', 'sp-1': '0.25rem', 'sp-2': '0.5rem',
        'sp-3': '0.75rem', 'sp-4': '1rem', 'sp-5': '1.5rem', 'sp-6': '2rem', 'sp-7': '3rem',
        'r-sm': '0.625rem', 'r-md': '0.875rem', 'r-lg': '1rem', 'tap': '3rem',
        'option-min': '3.5rem', 'w-app': '60rem', 'w-question': '45rem'
    }
    for token, expected in exact_tokens.items():
        check('token --bq5-{} = {}'.format(token, expected), tokens.get(token) == expected, tokens.get(token, 'ausente'))
    check('botão usa raio de 10px', bool(re.search(r'\.bq5-btn\s*\{[^}]*border-radius:\s*var\(--bq5-r-sm\)', css_clean, re.S)))
    check('cartões e painel de questão usam raio de 14px', all(bool(re.search(pattern, css_clean, re.S)) for pattern in (
        r'\.bq5-card\s*\{[^}]*border-radius:\s*var\(--bq5-r-md\)',
        r'\.bq5-question\s*\{[^}]*border-radius:\s*var\(--bq5-r-md\)',
    )))
    check('modal usa raio de 16px', bool(re.search(r'\.bq5-modal__panel\s*\{[^}]*border-radius:\s*var\(--bq5-r-lg\)', css_clean, re.S)))
    check('font stack usa apenas fontes locais/sistema', 'system-ui' in tokens.get('font', '') and 'https:' not in tokens.get('font', ''))
    check('font mono usa stack de sistema monoespaçada', 'Consolas' in tokens.get('font-mono', '') and 'ui-monospace' in tokens.get('font-mono', ''))
    check('clima não é token de tema independente', 'theme-clima' not in tokens and 'subtopic-clima' in tokens)

    # ---- contrast checks ----
    contrast_pairs = [
        ('text-primary', 'bg', 4.5), ('text-primary', 'surface-1', 4.5),
        ('text-primary', 'surface-2', 4.5), ('text-secondary', 'bg', 4.5),
        ('text-secondary', 'surface-1', 4.5), ('text-secondary', 'surface-2', 4.5),
        ('primary', 'bg', 4.5), ('primary-ink', 'primary', 4.5),
        ('success', 'success-bg', 4.5), ('error', 'error-bg', 4.5),
        ('warning', 'warning-bg', 4.5), ('border-strong', 'surface-1', 3.0),
        ('border-strong', 'surface-2', 3.0),
    ]
    contrast_pairs += [('theme-' + value, 'bg', 4.5) for value in ('cultura', 'economia', 'animais', 'vegetacao', 'cidades')]
    contrast_pairs += [('region-' + value, 'bg', 4.5) for value in ('norte', 'nordeste', 'centro-oeste', 'sudeste', 'sul')]
    for foreground, background, minimum in contrast_pairs:
        if foreground not in tokens or background not in tokens:
            check('tokens de contraste existem: {}/{}'.format(foreground, background), False)
            continue
        try:
            measured = contrast_ratio(tokens[foreground], tokens[background])
            check('contraste {}/{} >= {:.1f}:1'.format(foreground, background, minimum), measured >= minimum, '{:.2f}:1'.format(measured))
        except ValueError as error:
            check('contraste calculável {}/{}'.format(foreground, background), False, str(error))

    # ---- CSS structure, responsiveness and states ----
    balanced = css_clean.count('{') == css_clean.count('}')
    check('chaves CSS balanceadas', balanced, '{} x {}'.format(css_clean.count('{'), css_clean.count('}')))
    check('[hidden] sempre resulta em display:none !important', re.search(r'\[hidden\]\s*\{[^}]*display\s*:\s*none\s*!important', css_clean, re.S) is not None)
    check('prefers-reduced-motion tratado', 'prefers-reduced-motion: reduce' in css_clean)
    check('foco visível usa anel de 2px', re.search(r':focus-visible\s*\{[^}]*outline\s*:\s*2px', css_clean, re.S) is not None)
    check('safe areas top/bottom/left/right declaradas', all('env(safe-area-inset-' + side in css for side in ('top', 'bottom', 'left', 'right')))
    check('breakpoint mobile estreito existe', 'max-width: 22.5rem' in css)
    check('alternativas em duas colunas só a partir de 640px', bool(re.search(r'@media\s*\(min-width:\s*40rem\)[\s\S]*?\.bq5-options\s*\{\s*grid-template-columns:\s*1fr\s+1fr', css_clean)))
    check('aplicação limita menu/campanha a 960px', 'w-app' in tokens and tokens.get('w-app') == '60rem')
    check('questão limita o fluxo a 720px', 'w-question' in tokens and 'var(--bq5-w-question)' in css_clean)
    check('alternativas mantêm altura mínima de 56px', 'min-height: var(--bq5-option-min)' in css_clean)
    check('modal possui altura limitada e rolagem interna', bool(re.search(r'\.bq5-modal__panel\s*\{[^}]*max-height:[^}]*overflow-y:\s*auto', css_clean, re.S)))
    check('controles desabilitados usam tokens próprios', all(token in css_clean for token in ('var(--bq5-disabled-surface)', 'var(--bq5-disabled-text)')) and '.bq5-stepper__btn:disabled' in css_clean and '.bq5-route__card:disabled' in css_clean)
    check('background topográfico é feito em CSS, sem imagem externa', 'repeating-radial-gradient' in css_clean and 'topographic-line' in css)
    check('progresso da partida possui marcadores por questão', '.bq5-progress-pip[data-state="correct"]' in css_clean and '.bq5-progress-pip[data-state="wrong"]' in css_clean)
    check('timer possui estados normal, warning e danger', '.bq5-meter--time .bq5-meter__fill' in css_clean and 'data-level="warn"' in css_clean and 'data-level="danger"' in css_clean)
    check('temporizador fica no topo do painel de questão', '.bq5-question__timer' in css_clean and 'position: sticky' in re.search(r'\.bq5-question__timer\s*\{([^}]*)\}', css_clean, re.S).group(1) if re.search(r'\.bq5-question__timer\s*\{([^}]*)\}', css_clean, re.S) else False)

    for state in ('selected', 'correct', 'wrong', 'dimmed'):
        check('estado de alternativa no CSS: ' + state, '.bq5-option[data-state="{}"]'.format(state) in css_clean)
    for state in ('locked', 'available', 'done'):
        check('estado de rota no CSS: ' + state, 'data-state="{}"'.format(state) in css_clean)
    for mood in ('idle', 'happy', 'sad'):
        check('humor do elenco no CSS: ' + mood, 'data-mood="{}"'.format(mood) in css_clean)
    for theme in ('cultura', 'economia', 'animais', 'vegetacao', 'cidades'):
        check('cor do eixo no CSS: ' + theme, '[data-theme="{}"]'.format(theme) in css_clean)
    check('clima é estilizado como subtópico, não eixo', '[data-subtopic="clima"]' in css_clean and '[data-theme="clima"]' not in css_clean)
    for region in ('norte', 'nordeste', 'centro-oeste', 'sudeste', 'sul'):
        check('cor de região no CSS: ' + region, '[data-region="{}"]'.format(region) in css_clean)

    # ---- play screen hierarchy ----
    play_progress = next((item for item in parser.tags if item.attrs.get('id') == 'play-progress'), None)
    play_timer = next((item for item in parser.tags if item.attrs.get('id') == 'play-timer'), None)
    play_question = next((item for item in parser.tags if item.attrs.get('class', '').split() and 'bq5-question' in item.attrs.get('class', '').split()), None)
    play_next = next((item for item in parser.tags if item.attrs.get('id') == 'play-next'), None)
    check('play-progress usa role progressbar e aria values', play_progress is not None and play_progress.attrs.get('role') == 'progressbar' and all(key in play_progress.attrs for key in ('aria-valuemin', 'aria-valuemax', 'aria-valuenow')))
    check('play-timer está dentro de article.bq5-question', play_timer is not None and any(ancestor[0] == 'article' and 'bq5-question' in ancestor[1].get('class', '').split() for ancestor in play_timer.ancestors))
    timer_group = next((item for item in parser.tags if 'bq5-question__timer' in item.attrs.get('class', '').split()), None)
    check('grupo do temporizador tem nome acessível', timer_group is not None and timer_group.attrs.get('role') == 'group' and bool(timer_group.attrs.get('aria-label')))
    check('play-time-left está disponível ao lado do timer', any(item.attrs.get('id') == 'play-time-left' for item in parser.tags))
    check('botão play-next começa desabilitado', play_next is not None and 'disabled' in play_next.attrs)
    if play_next is not None:
        # HTMLParser não preserva texto como atributo; examina o conteúdo do arquivo.
        check('rótulo inicial de play-next é Confirmar', bool(re.search(r'<button[^>]*id="play-next"[^>]*>\s*Confirmar\s*</button>', html, re.S)))

    # ---- 4 options static and screen text ----
    static_options = [item for item in parser.tags if 'bq5-option' in item.attrs.get('class', '').split() and not item.in_template]
    indexes = sorted(item.attrs.get('data-index') for item in static_options)
    # duas telas de pergunta: solo (#play-options) e duelo 1x1 (#mp-options), 4 alternativas cada
    check('exatamente quatro alternativas estáticas 0..3 por tela de pergunta (solo, 1x1 clássico e 1x1 alternativo)', indexes == ['0', '0', '0', '1', '1', '1', '2', '2', '2', '3', '3', '3'], indexes)
    check('alternativas não usam data-action', all('data-action' not in item.attrs for item in static_options))
    check('não existe controle de pausa na tela de partida', not any(item.attrs.get('data-action', '').lower() in ('pause', 'pause-game', 'resume-game') for item in parser.tags) and 'pausar partida' not in html.lower())
    check('texto de menu enumera somente os cinco eixos', 'Cultura, economia, animais, vegetação e cidades' in html and 'sexto eixo' not in html.lower())
    check('menu inclui identidade e indicadores de progresso', {'menu-player-name', 'menu-player-rank', 'menu-progress-text', 'menu-progress-count', 'menu-progress-bar'} <= static_ids)

    # ---- scripts ----
    scripts = [item for item in parser.tags if item.tag == 'script' and item.attrs.get('src')]
    active_sources = [item.attrs['src'] for item in scripts]
    active_base = [src for src in active_sources if not src.startswith('../dev/')]
    check('ordem dos cinco scripts-base preservada', tuple(active_base[:5]) == BASE_SCRIPTS, active_base)
    check('nenhum script-base usa async/defer', all(not any(flag in item.attrs for flag in ('async', 'defer')) for item in scripts if item.attrs.get('src') in BASE_SCRIPTS))
    check('scripts-base usam carregamento clássico', all(item.attrs.get('type', '').lower() != 'module' for item in scripts if item.attrs.get('src') in BASE_SCRIPTS))
    for src in BASE_SCRIPTS:
        check('script-base existe: ' + src, (paths['game'] / src).is_file())
    joined_comments = '\n'.join(parser.comments)
    active_ui = [src for src in active_sources if src in ACTIVE_UI_SCRIPTS]
    check('Módulos 7 a 11 ativos na ordem correta', tuple(active_ui) == ACTIVE_UI_SCRIPTS, active_ui)
    for src in ACTIVE_UI_SCRIPTS:
        check('script de interface ativo existe: ' + src, (paths['game'] / src).is_file())
    mp_active = [src for src in active_sources if src in MP_SCRIPTS]
    check('Módulos 18 e 13 ativos na ordem correta (HP, transporte, QR, lógica, modo alternativo)', tuple(mp_active) == MP_SCRIPTS, mp_active)
    for src in MP_SCRIPTS:
        check('script do multiplayer existe: ' + src, (paths['game'] / src).is_file())
    pending_missing = [src for src in PENDING_UI_SCRIPTS if src not in joined_comments]
    check('scripts pendentes dos módulos 12–15 listados em comentário', not pending_missing, pending_missing)
    for item in scripts:
        src = item.attrs['src']
        if src.startswith('../dev/'):
            optional = (paths['html'].parent / src).resolve()
            if not optional.is_file():
                warn('script de pré-visualização opcional não localizado: ' + src)
        elif src not in BASE_SCRIPTS and src not in ACTIVE_UI_SCRIPTS and src not in MP_SCRIPTS and src not in PENDING_UI_SCRIPTS:
            warn('script ativo fora da lista-base: ' + src)

    # ---- JavaScript references and dynamic classes ----
    if paths['js'].is_dir():
        base_names = {Path(value).name for value in BASE_SCRIPTS}
        ui_files = [file for file in paths['js'].rglob('*.js') if file.name not in base_names]
        unknown_ids, unknown_templates, unknown_classes, inline_style_ops = [], [], [], []
        for file in ui_files:
            source = file.read_text(encoding='utf-8', errors='replace')
            for pattern in (
                r'getElementById\(\s*["\']([\w-]+)["\']',
                r'querySelector(?:All)?\(\s*["\']#([\w-]+)["\']',
                r'\$\(\s*["\']#([\w-]+)["\']'
            ):
                for identifier in re.findall(pattern, source):
                    if identifier not in (static_ids | template_ids):
                        unknown_ids.append('{} -> #{}'.format(file.name, identifier))
            for template_id in re.findall(r'["\'](tpl-[\w-]+)["\']', source):
                if template_id not in html_templates:
                    unknown_templates.append('{} -> {}'.format(file.name, template_id))
            quoted_classes = set(re.findall(r'["\'](bq5-[\w-]+)["\']', source))
            for class_name in quoted_classes:
                if class_name not in css_classes:
                    unknown_classes.append('{} -> .{}'.format(file.name, class_name))
            for match in re.finditer(r'\.style\.(?:setProperty|[\w]+)\s*(?:\(|=)', source):
                context = source[match.start():match.start()+120]
                if not re.search(r"['\"]--(?:p|c)['\"]", context):
                    inline_style_ops.append('{}: {}'.format(file.name, context.replace('\n', ' ')[:100]))
        check('IDs referenciados pelos módulos de UI existem', not unknown_ids, unknown_ids)
        check('templates referenciados pelos módulos de UI existem', not unknown_templates, unknown_templates)
        check('classes adicionadas pelo JS estão no CSS', not unknown_classes, unknown_classes)
        check('JS não escreve estilos inline fora de --p/--c (heurística)', not inline_style_ops, inline_style_ops)
        if not ui_files:
            info('nenhum módulo de UI 7–15 encontrado; verificações de consumo JS ficam pendentes.')
    else:
        warn('pasta js/ não localizada; verificações de consumo JS ficam pendentes.')

    # ---- continuity with M5.5 asset catalog and visual identity ----
    check_asset_continuity(paths, catalog, identity, parser, css)

    progress_candidates = [paths['repo'] / 'PROGRESS.md', paths['repo'] / 'progress.md']
    progress_file = next((item for item in progress_candidates if item.is_file()), None)
    if progress_file:
        progress_text = progress_file.read_text(encoding='utf-8', errors='replace')
        if re.search(r'5\.5', progress_text) and re.search(r'assets?\s*/\s*\+\s*docs', progress_text, re.I):
            info('PROGRESS registra Módulo 5.5; continuidade validada com catálogo e identidade visual.')
        else:
            warn('PROGRESS existe, mas a entrada Módulo 5.5 não foi reconhecida automaticamente.')
    else:
        info('PROGRESS.md não encontrado; continuidade é verificada pelos documentos M5.5.')

    return finish()


def finish():
    total = passed + failed
    print('{} verificações OK'.format(passed) if failed == 0 else '{} verificações OK; {} falhas'.format(passed, failed))
    print('{} avisos'.format(warnings))
    print('RESULT: OK' if failed == 0 else 'RESULT: FAIL')
    return 0 if failed == 0 else 1


if __name__ == '__main__':
    sys.exit(main())
