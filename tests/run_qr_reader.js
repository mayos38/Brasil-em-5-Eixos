'use strict';
// Testa a lógica do leitor (motores, tentativas, liberação) com DOM simulado.
const fs = require('fs'), vm = require('vm'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, '../brasil-quiz/js/multiplayer/qr-reader.js'), 'utf8');
let passed = 0, failed = 0;
const check = (n, c) => { c ? passed++ : failed++; console.log((c ? 'PASS ' : 'FAIL ') + n); };

function makeEnv(opts) {
  const log = { draws: [], created: 0, released: 0 };
  const canvas = { width: 0, height: 0, getContext() { return { drawImage: (i, x, y, w, h) => log.draws.push([w, h]), getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(4), width: w, height: h }) }; } };
  const g = {
    Promise, Math, String, Number, Uint8ClampedArray, setTimeout, clearTimeout, Error,
    isSecureContext: !!opts.secure,
    navigator: opts.secure ? { mediaDevices: { getUserMedia() {} } } : {},
    document: { hidden: false, createElement: (t) => { log.created++; return t === 'canvas' ? canvas : {}; },
      head: { appendChild(tag) { setTimeout(() => { if (opts.vendor) { g.jsQR = opts.vendor; tag.onload(); } else tag.onerror(); }, 0); } } },
    URL: { createObjectURL: () => 'blob:x', revokeObjectURL() {} },
    Image: function () { const o = this; Object.defineProperty(o, 'src', { set(v) { if (v && v !== '') setTimeout(() => { o.naturalWidth = opts.w; o.naturalHeight = opts.h; o.onload(); }, 0); } }); },
  };
  if (opts.native) g.BarcodeDetector = opts.native;
  g.globalThis = g; vm.createContext(g); g.BQ5 = {};
  vm.runInContext(src, g);
  return { r: g.BQ5.qrReader, log, g };
}

(async () => {
  let e = makeEnv({ secure: false, w: 4000, h: 3000 });
  check('liveSupported falso em contexto inseguro (HTTP)', e.r.liveSupported() === false);
  check('liveSupported verdadeiro em HTTPS com câmera', makeEnv({ secure: true }).r.liveSupported() === true);

  // sem BarcodeDetector e sem jsQR -> NO_ENGINE
  let err = await e.r.decodeFile({}).then(() => null, (x) => x);
  check('sem motor: rejeita com NO_ENGINE', err && err.code === 'NO_ENGINE');

  // com jsQR: reduz foto 4000x3000 para 1600 e devolve o texto
  e = makeEnv({ secure: false, w: 4000, h: 3000, vendor: () => ({ data: 'BQ5-A-OK' }) });
  const text = await e.r.decodeFile({});
  check('jsQR: devolve o texto decodificado', text === 'BQ5-A-OK');
  check('foto grande reduzida a no máx. 1600 px', e.log.draws[0][0] === 1600 && e.log.draws[0][1] === 1200);

  // jsQR nunca acha: tenta 3 tamanhos e rejeita NOT_FOUND
  e = makeEnv({ secure: false, w: 4000, h: 3000, vendor: () => null });
  err = await e.r.decodeFile({}).then(() => null, (x) => x);
  check('sem QR na imagem: tenta 3 tamanhos e rejeita NOT_FOUND', err && err.code === 'NOT_FOUND' && e.log.draws.length === 3);

  // foto pequena não repete o mesmo tamanho
  e = makeEnv({ secure: false, w: 800, h: 600, vendor: () => null });
  await e.r.decodeFile({}).catch(() => {});
  check('foto pequena não repete tentativas idênticas', e.log.draws.length === 1);

  // nativo achando: jsQR nem é carregado
  const Native = function () {}; Native.getSupportedFormats = () => Promise.resolve(['qr_code']);
  Native.prototype.detect = () => Promise.resolve([{ rawValue: 'BQ5-O-NATIVO' }]);
  e = makeEnv({ secure: false, w: 1000, h: 1000, native: Native });
  check('BarcodeDetector nativo é preferido', (await e.r.decodeFile({})) === 'BQ5-O-NATIVO' && e.g.jsQR === undefined);
  // export { default } e erro de script são tratados e explicados
  e = makeEnv({ secure: false, w: 800, h: 600, vendor: { default: () => ({ data: 'DEFAULT-OK' }) } });
  check('aceita jsQR exportado como { default }', (await e.r.decodeFile({})) === 'DEFAULT-OK');
  e = makeEnv({ secure: false, w: 800, h: 600 });
  await e.r.decodeFile({}).catch(() => {});
  check('falha de carga registra o motivo', /não carregou/.test(e.r.lastIssue()));
  console.log('\nQR reader tests: ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
