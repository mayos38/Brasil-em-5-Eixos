/* ============================================================
 * Brasil em 5 Eixos — gerador local de QR Code para o M14.
 * Codificação QR Model 2, byte mode, correção M. Sem CDN, câmera,
 * serviço remoto ou envio do conteúdo para terceiros.
 * O conteúdo atual é ASCII (BQ5-O/BQ5-A), conforme lan.js.
 * ============================================================ */
(function (global) {
  'use strict';
  var BQ5 = global.BQ5 = global.BQ5 || {};
  var RS_BLOCK_TABLE = [[1,26,19],[1,26,16],[1,26,13],[1,26,9],[1,44,34],[1,44,28],[1,44,22],[1,44,16],[1,70,55],[1,70,44],[2,35,17],[2,35,13],[1,100,80],[2,50,32],[2,50,24],[4,25,9],[1,134,108],[2,67,43],[2,33,15,2,34,16],[2,33,11,2,34,12],[2,86,68],[4,43,27],[4,43,19],[4,43,15],[2,98,78],[4,49,31],[2,32,14,4,33,15],[4,39,13,1,40,14],[2,121,97],[2,60,38,2,61,39],[4,40,18,2,41,19],[4,40,14,2,41,15],[2,146,116],[3,58,36,2,59,37],[4,36,16,4,37,17],[4,36,12,4,37,13],[2,86,68,2,87,69],[4,69,43,1,70,44],[6,43,19,2,44,20],[6,43,15,2,44,16],[4,101,81],[1,80,50,4,81,51],[4,50,22,4,51,23],[3,36,12,8,37,13],[2,116,92,2,117,93],[6,58,36,2,59,37],[4,46,20,6,47,21],[7,42,14,4,43,15],[4,133,107],[8,59,37,1,60,38],[8,44,20,4,45,21],[12,33,11,4,34,12],[3,145,115,1,146,116],[4,64,40,5,65,41],[11,36,16,5,37,17],[11,36,12,5,37,13],[5,109,87,1,110,88],[5,65,41,5,66,42],[5,54,24,7,55,25],[11,36,12,7,37,13],[5,122,98,1,123,99],[7,73,45,3,74,46],[15,43,19,2,44,20],[3,45,15,13,46,16],[1,135,107,5,136,108],[10,74,46,1,75,47],[1,50,22,15,51,23],[2,42,14,17,43,15],[5,150,120,1,151,121],[9,69,43,4,70,44],[17,50,22,1,51,23],[2,42,14,19,43,15],[3,141,113,4,142,114],[3,70,44,11,71,45],[17,47,21,4,48,22],[9,39,13,16,40,14],[3,135,107,5,136,108],[3,67,41,13,68,42],[15,54,24,5,55,25],[15,43,15,10,44,16],[4,144,116,4,145,117],[17,68,42],[17,50,22,6,51,23],[19,46,16,6,47,17],[2,139,111,7,140,112],[17,74,46],[7,54,24,16,55,25],[34,37,13],[4,151,121,5,152,122],[4,75,47,14,76,48],[11,54,24,14,55,25],[16,45,15,14,46,16],[6,147,117,4,148,118],[6,73,45,14,74,46],[11,54,24,16,55,25],[30,46,16,2,47,17],[8,132,106,4,133,107],[8,75,47,13,76,48],[7,54,24,22,55,25],[22,45,15,13,46,16],[10,142,114,2,143,115],[19,74,46,4,75,47],[28,50,22,6,51,23],[33,46,16,4,47,17],[8,152,122,4,153,123],[22,73,45,3,74,46],[8,53,23,26,54,24],[12,45,15,28,46,16],[3,147,117,10,148,118],[3,73,45,23,74,46],[4,54,24,31,55,25],[11,45,15,31,46,16],[7,146,116,7,147,117],[21,73,45,7,74,46],[1,53,23,37,54,24],[19,45,15,26,46,16],[5,145,115,10,146,116],[19,75,47,10,76,48],[15,54,24,25,55,25],[23,45,15,25,46,16],[13,145,115,3,146,116],[2,74,46,29,75,47],[42,54,24,1,55,25],[23,45,15,28,46,16],[17,145,115],[10,74,46,23,75,47],[10,54,24,35,55,25],[19,45,15,35,46,16],[17,145,115,1,146,116],[14,74,46,21,75,47],[29,54,24,19,55,25],[11,45,15,46,46,16],[13,145,115,6,146,116],[14,74,46,23,75,47],[44,54,24,7,55,25],[59,46,16,1,47,17],[12,151,121,7,152,122],[12,75,47,26,76,48],[39,54,24,14,55,25],[22,45,15,41,46,16],[6,151,121,14,152,122],[6,75,47,34,76,48],[46,54,24,10,55,25],[2,45,15,64,46,16],[17,152,122,4,153,123],[29,74,46,14,75,47],[49,54,24,10,55,25],[24,45,15,46,46,16],[4,152,122,18,153,123],[13,74,46,32,75,47],[48,54,24,14,55,25],[42,45,15,32,46,16],[20,147,117,4,148,118],[40,75,47,7,76,48],[43,54,24,22,55,25],[10,45,15,67,46,16],[19,148,118,6,149,119],[18,75,47,31,76,48],[34,54,24,34,55,25],[20,45,15,61,46,16]];
  var ALIGNMENT = [[],[6,18],[6,22],[6,26],[6,30],[6,34],[6,22,38],[6,24,42],[6,26,46],[6,28,50],[6,30,54],[6,32,58],[6,34,62],[6,26,46,66],[6,26,48,70],[6,26,50,74],[6,30,54,78],[6,30,56,82],[6,30,58,86],[6,34,62,90],[6,28,50,72,94],[6,26,50,74,98],[6,30,54,78,102],[6,28,54,80,106],[6,32,58,84,110],[6,30,58,86,114],[6,34,62,90,118],[6,26,50,74,98,122],[6,30,54,78,102,126],[6,26,52,78,104,130],[6,30,56,82,108,134],[6,34,60,86,112,138],[6,30,58,86,114,142],[6,34,62,90,118,146],[6,30,54,78,102,126,150],[6,24,50,76,102,128,154],[6,28,54,80,106,132,158],[6,32,58,84,110,136,162],[6,26,54,82,110,138,166],[6,30,58,86,114,142,170]];
  var EXP = new Array(256), LOG = new Array(256);
  for (var i = 0; i < 8; i++) EXP[i] = 1 << i;
  for (var j = 8; j < 256; j++) EXP[j] = EXP[j - 4] ^ EXP[j - 5] ^ EXP[j - 6] ^ EXP[j - 8];
  for (var k = 0; k < 255; k++) LOG[EXP[k]] = k;

  function gfMul(x, y) {
    if (!x || !y) return 0;
    return EXP[(LOG[x] + LOG[y]) % 255];
  }
  function polynomialMultiply(a, b) {
    var out = new Array(a.length + b.length - 1).fill(0);
    for (var i = 0; i < a.length; i++) for (var j = 0; j < b.length; j++) out[i + j] ^= gfMul(a[i], b[j]);
    return out;
  }
  function rsGenerator(degree) {
    var poly = [1];
    for (var i = 0; i < degree; i++) poly = polynomialMultiply(poly, [1, EXP[i]]);
    return poly;
  }
  function rsRemainder(data, degree) {
    var generator = rsGenerator(degree);
    var work = data.concat(new Array(degree).fill(0));
    for (var i = 0; i < data.length; i++) {
      var factor = work[i];
      if (!factor) continue;
      for (var j = 0; j < generator.length; j++) work[i + j] ^= gfMul(generator[j], factor);
    }
    return work.slice(data.length);
  }
  function blocksFor(version) {
    var spec = RS_BLOCK_TABLE[(version - 1) * 4 + 1]; // correção M
    var blocks = [];
    for (var i = 0; i < spec.length; i += 3) {
      for (var n = 0; n < spec[i]; n++) blocks.push({ total: spec[i + 1], data: spec[i + 2] });
    }
    return blocks;
  }
  function putBits(target, value, length) {
    for (var i = length - 1; i >= 0; i--) target.push((value >>> i) & 1);
  }
  function makeDataBytes(text, version, blocks) {
    var dataCapacity = blocks.reduce(function (sum, block) { return sum + block.data; }, 0);
    var bitLimit = dataCapacity * 8;
    var bits = [];
    putBits(bits, 4, 4); // byte mode
    putBits(bits, text.length, version < 10 ? 8 : 16);
    for (var i = 0; i < text.length; i++) putBits(bits, text.charCodeAt(i), 8);
    for (var t = 0; t < Math.min(4, bitLimit - bits.length); t++) bits.push(0);
    while (bits.length % 8) bits.push(0);
    var bytes = [];
    for (var p = 0; p < bits.length; p += 8) {
      var value = 0;
      for (var b = 0; b < 8; b++) value = (value << 1) | bits[p + b];
      bytes.push(value);
    }
    var pad = 0;
    while (bytes.length < dataCapacity) { bytes.push(pad++ % 2 === 0 ? 0xEC : 0x11); }

    var dataBlocks = [], ecBlocks = [], offset = 0, maxData = 0, maxEc = 0;
    blocks.forEach(function (block) {
      var dataPart = bytes.slice(offset, offset + block.data);
      offset += block.data;
      var ecPart = rsRemainder(dataPart, block.total - block.data);
      dataBlocks.push(dataPart); ecBlocks.push(ecPart);
      maxData = Math.max(maxData, dataPart.length); maxEc = Math.max(maxEc, ecPart.length);
    });
    var result = [];
    for (var d = 0; d < maxData; d++) dataBlocks.forEach(function (part) { if (d < part.length) result.push(part[d]); });
    for (var e = 0; e < maxEc; e++) ecBlocks.forEach(function (part) { if (e < part.length) result.push(part[e]); });
    return result;
  }
  function bitLength(value) { var n = 0; while (value) { n++; value >>>= 1; } return n; }
  function bchTypeInfo(data) {
    var d = data << 10, poly = 0x537;
    while (bitLength(d) - bitLength(poly) >= 0) d ^= poly << (bitLength(d) - bitLength(poly));
    return ((data << 10) | d) ^ 0x5412;
  }
  function bchTypeNumber(data) {
    var d = data << 12, poly = 0x1F25;
    while (bitLength(d) - bitLength(poly) >= 0) d ^= poly << (bitLength(d) - bitLength(poly));
    return (data << 12) | d;
  }
  function blankMatrix(size) { return Array.from({ length: size }, function () { return new Array(size).fill(null); }); }
  function setupFinder(m, row, col) {
    var n = m.length;
    for (var r = -1; r <= 7; r++) {
      if (row + r < 0 || row + r >= n) continue;
      for (var c = -1; c <= 7; c++) {
        if (col + c < 0 || col + c >= n) continue;
        m[row + r][col + c] = ((r >= 0 && r <= 6 && (c === 0 || c === 6)) ||
          (c >= 0 && c <= 6 && (r === 0 || r === 6)) ||
          (r >= 2 && r <= 4 && c >= 2 && c <= 4));
      }
    }
  }
  function setupPatterns(m, version) {
    var n = m.length, positions = ALIGNMENT[version - 1];
    setupFinder(m, 0, 0); setupFinder(m, n - 7, 0); setupFinder(m, 0, n - 7);
    for (var i = 0; i < positions.length; i++) for (var j = 0; j < positions.length; j++) {
      var row = positions[i], col = positions[j];
      if (m[row][col] !== null) continue;
      for (var r = -2; r <= 2; r++) for (var c = -2; c <= 2; c++) {
        m[row + r][col + c] = r === -2 || r === 2 || c === -2 || c === 2 || (r === 0 && c === 0);
      }
    }
    for (var t = 8; t < n - 8; t++) {
      if (m[t][6] === null) m[t][6] = t % 2 === 0;
      if (m[6][t] === null) m[6][t] = t % 2 === 0;
    }
  }
  function setupType(m, version, mask, test) {
    var n = m.length, bits = bchTypeInfo(mask); // M = 00
    for (var i = 0; i < 15; i++) {
      var mod = !test && ((bits >>> i) & 1) === 1;
      if (i < 6) m[i][8] = mod;
      else if (i < 8) m[i + 1][8] = mod;
      else m[n - 15 + i][8] = mod;
    }
    for (var j = 0; j < 15; j++) {
      var modH = !test && ((bits >>> j) & 1) === 1;
      if (j < 8) m[8][n - j - 1] = modH;
      else if (j < 9) m[8][15 - j] = modH;
      else m[8][15 - j - 1] = modH;
    }
    m[n - 8][8] = !test;
    if (version >= 7) {
      var vb = bchTypeNumber(version);
      for (var v = 0; v < 18; v++) {
        var vmod = !test && ((vb >>> v) & 1) === 1;
        m[Math.floor(v / 3)][v % 3 + n - 11] = vmod;
        m[v % 3 + n - 11][Math.floor(v / 3)] = vmod;
      }
    }
  }
  function masked(mask, r, c) {
    var product = r * c;
    switch (mask) {
      case 0: return (r + c) % 2 === 0;
      case 1: return r % 2 === 0;
      case 2: return c % 3 === 0;
      case 3: return (r + c) % 3 === 0;
      case 4: return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0;
      case 5: return product % 2 + product % 3 === 0;
      case 6: return (product % 2 + product % 3) % 2 === 0;
      default: return ((product % 3) + ((r + c) % 2)) % 2 === 0;
    }
  }
  function mapData(m, data, mask) {
    var n = m.length, row = n - 1, inc = -1, byteIndex = 0, bitIndex = 7;
    for (var col = n - 1; col > 0; col -= 2) {
      var pairCol = col <= 6 ? col - 1 : col;
      while (true) {
        for (var c = 0; c < 2; c++) {
          var x = pairCol - c;
          if (m[row][x] === null) {
            var dark = byteIndex < data.length ? ((data[byteIndex] >>> bitIndex) & 1) === 1 : false;
            if (masked(mask, row, x)) dark = !dark;
            m[row][x] = dark;
            bitIndex--;
            if (bitIndex === -1) { byteIndex++; bitIndex = 7; }
          }
        }
        row += inc;
        if (row < 0 || row >= n) { row -= inc; inc = -inc; break; }
      }
    }
  }
  function penalty(m) {
    var n = m.length, score = 0;
    function lineScore(line) {
      var run = 1;
      for (var i = 1; i < line.length; i++) {
        if (line[i] === line[i - 1]) run++;
        else { if (run >= 5) score += run - 2; run = 1; }
      }
      if (run >= 5) score += run - 2;
      for (var k = 0; k <= line.length - 11; k++) {
        var s = '';
        for (var j = 0; j < 11; j++) s += line[k + j] ? '1' : '0';
        if (s === '10111010000' || s === '00001011101') score += 40;
      }
    }
    for (var r = 0; r < n; r++) {
      lineScore(m[r]);
      var col = []; for (var c = 0; c < n; c++) col.push(m[c][r]);
      lineScore(col);
    }
    for (var y = 0; y < n - 1; y++) for (var x = 0; x < n - 1; x++) {
      var v = m[y][x];
      if (v === m[y][x + 1] && v === m[y + 1][x] && v === m[y + 1][x + 1]) score += 3;
    }
    var dark = 0; for (var yy = 0; yy < n; yy++) for (var xx = 0; xx < n; xx++) if (m[yy][xx]) dark++;
    score += Math.floor(Math.abs((dark * 100 / (n * n)) - 50) / 5) * 10;
    return score;
  }
  function buildMatrix(data, version, mask, test) {
    var m = blankMatrix(version * 4 + 17);
    setupPatterns(m, version);
    setupType(m, version, mask, test);
    mapData(m, data, mask);
    return m;
  }
  function encode(text) {
    text = String(text == null ? '' : text);
    if (!text) throw new Error('Não há código para gerar o QR Code.');
    for (var i = 0; i < text.length; i++) if (text.charCodeAt(i) > 127) throw new Error('O código contém caracteres incompatíveis com o QR Code.');
    var version = 0, blocks = null;
    for (var v = 1; v <= 40; v++) {
      var candidate = blocksFor(v), capacity = candidate.reduce(function (sum, b) { return sum + b.data; }, 0) * 8;
      var required = 4 + (v < 10 ? 8 : 16) + text.length * 8;
      if (required <= capacity) { version = v; blocks = candidate; break; }
    }
    if (!version) throw new Error('Este código é grande demais para ser exibido em QR. Use “Copiar código”.');
    var data = makeDataBytes(text, version, blocks), bestMask = 0, bestScore = Infinity;
    for (var mask = 0; mask < 8; mask++) {
      var testMatrix = buildMatrix(data, version, mask, true), score = penalty(testMatrix);
      if (score < bestScore) { bestScore = score; bestMask = mask; }
    }
    return { matrix: buildMatrix(data, version, bestMask, false), version: version, correction: 'M' };
  }
  BQ5.qr = { encode: encode };
})(globalThis);
