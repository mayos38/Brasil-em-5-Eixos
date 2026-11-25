'use strict';
const fs = require('fs');
const vm = require('vm');
const crypto = require('crypto');
const source = fs.readFileSync(require('path').join(__dirname, '../brasil-quiz/js/multiplayer/qr.js'), 'utf8');
const context = { Uint8Array, Array, Math, String, Number, Infinity };
context.globalThis = context;
vm.createContext(context);
vm.runInContext(source, context, { timeout: 5000 });
const qr = context.BQ5 && context.BQ5.qr;
let passed = 0, failed = 0;
function check(label, condition) {
  if (condition) { passed++; console.log('PASS ' + label); }
  else { failed++; console.log('FAIL ' + label); }
}
const sample = qr.encode('BQ5-O-THIS_IS_A_TEST_STRING_1234567890', { level: 'M' });
const matrixString = sample.matrix.map(row => row.map(cell => cell ? '1' : '0').join('')).join('\n');
const digest = crypto.createHash('sha256').update(matrixString).digest('hex');
check('QR sample: version and matrix size', sample.version === 3 && sample.matrix.length === 29);
check('QR sample: stable matrix matches reference vector', digest === 'a485ea5d35eb37a255fbd68dfaefd607f674995d0f0e141251b20ba78304df91');
check('QR sample: matrix contains only boolean modules', sample.matrix.every(row => row.length === 29 && row.every(v => typeof v === 'boolean')));
const large = qr.encode('BQ5-A-' + 'A'.repeat(900), { level: 'M' });
const lowL = qr.encode('BQ5-A-' + 'A'.repeat(900));
check('QR nível L (padrão): versão menor ou igual à do nível M', lowL.correction === 'L' && lowL.version <= large.version && lowL.version < large.version);
check('QR long payload: larger version generated', large.version > sample.version && large.matrix.length === large.version * 4 + 17);
let unicodeRejected = false;
try { qr.encode('BQ5-ç'); } catch (e) { unicodeRejected = /caracteres/.test(e.message); }
check('QR rejects unsupported non-ASCII input clearly', unicodeRejected);
let oversizedRejected = false;
try { qr.encode('X'.repeat(3000)); } catch (e) { oversizedRejected = /grande demais/.test(e.message); }
check('QR oversized payload falls back with clear error', oversizedRejected);
console.log('\nQR tests: ' + passed + ' passed, ' + failed + ' failed');
if (failed) process.exit(1);
