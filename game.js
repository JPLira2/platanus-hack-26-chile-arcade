// LA CASA PIERDE \u2014 Platanus Hack 26 Santiago
// Cada ronda: PLINKO (60 s) -> JACKPOT (3 tiradas) -> RULETA (1 giro) -> BOSS.
// Cada ficha que tengas al final es 1 punto de da\u00f1o contra el boss. Si lo matas, sigue otra ronda
// con pagos m\u00e1s altos y un boss m\u00e1s duro. El ranking guarda el da\u00f1o total.

const W = 800, H = 600, STORE = 'la-casa-pierde-v1';

// ---------- plinko: geometr\u00eda ----------
const BX0 = 166, BX1 = 634, BW = BX1 - BX0, NS = 13, SW = BW / NS, CX = 400;
const LY = 106, ROW0 = 142, ROWS = 12, RSP = 29, SLOT_Y = 492, FLOOR_Y = 562;
const LASTY = ROW0 + (ROWS - 1) * RSP;
const WOFF = 0; // muro pasa por los pegs de los bordes
const PHY = { bi: 0.2, e: 0.3, h: 40, j: 10, gs: 420 }; // rebote estilo Galton (distribuci\u00f3n ~binomial)
const TS = 1.3; // acelera la simulaci\u00f3n de las bolas
const BR = 7, PR = 4, UR = 16; // radios: bola, peg, cursor
const MULT = [15, 5, 2, 1, 0.75, 0.2, 0, 0.2, 0.75, 1, 2, 5, 15];
const PLINKO_T = 30, BALL_COST = 10;

// ---------- jackpot / ruleta / boss ----------
const SYM_W = [3, 3, 2, 1, 1]; // cereza, lim\u00f3n, diamante, estrella, siete
const SYM_PAY = [4, 6, 10, 20, 40]; // pago por 3 iguales (2 iguales = x1)
const SLOT_BETS = [0, 0.1, 0.25, 0.5];
const ROUL_BETS = [0, 0.1, 0.25, 0.5, 1];
const RN = 15, RSA = (Math.PI * 2) / RN; // sectores ruleta
const BOSSES = [
  ['EL CRUPIER', 0xff3fa4], ['FRANK', 0xe8e4ff], ['SR. FORTUNA', 0xffc400],
  ['LA TRAGAMONEDAS', 0x7dffb0], ['EL DUE\u00d1O', 0xff6b3d], ['LA CASA', 0xb36bff],
];
const START_CHIPS = 100, ROUND_BONUS = 100;
const bossHP = (r) => Math.round((200 * Math.pow(1.8, r - 1)) / 10) * 10;
const rMult = (r) => 1 + 0.5 * (r - 1);

const C = { neon: 0xe1ff00, pink: 0xff3fa4, cyan: 0x2ef2ff, white: 0xf5f7ff, gold: 0xffc400, red: 0xff4d4d, gray: 0x8a88a8, bg: 0x0b0a18 };
const BCOL = [0xf5f7ff, 0xffe066, 0x7dffb0, 0xff9de0, 0x9dd8ff];
const HEX = (n) => '#' + n.toString(16).padStart(6, '0');

// DO NOT replace existing keys \u2014 they match the physical arcade cabinet wiring.
// To add local testing shortcuts, append extra keys to any array.
const CABINET_KEYS = {
  P1_U: ['w'],
  P1_D: ['s'],
  P1_L: ['a'],
  P1_R: ['d'],
  P1_1: ['u'],
  P1_2: ['i'],
  P1_3: ['o'],
  P1_4: ['j'],
  P1_5: ['k'],
  P1_6: ['l'],
  P2_U: ['ArrowUp'],
  P2_D: ['ArrowDown'],
  P2_L: ['ArrowLeft'],
  P2_R: ['ArrowRight'],
  P2_1: ['r'],
  P2_2: ['t'],
  P2_3: ['y'],
  P2_4: ['f'],
  P2_5: ['g'],
  P2_6: ['h'],
  START1: ['Enter'],
  START2: ['2'],
};

const KEYBOARD_TO_ARCADE = {};
for (const [code, keys] of Object.entries(CABINET_KEYS)) {
  for (const k of keys) KEYBOARD_TO_ARCADE[normalizeIncomingKey(k)] = code;
}

function normalizeIncomingKey(key) {
  if (typeof key !== 'string' || key.length === 0) return '';
  if (key === ' ') return 'space';
  return key.toLowerCase();
}

new Phaser.Game({
  type: Phaser.AUTO,
  width: W,
  height: H,
  parent: 'game-root',
  backgroundColor: '#07060f',
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH, width: W, height: H },
  scene: { create, update },
});

// ---------- input (un jugador: sirven los controles de P1 y P2) ----------
let held = {}, pressed = {};
const hd = (c) => held[c] === true;
const pr = (c) => { if (pressed[c]) { pressed[c] = false; return true; } return false; };
const tap = (k) => pr('P1_' + k) | pr('P2_' + k);
const hold = (k) => hd('P1_' + k) || hd('P2_' + k);
const okP = () => tap('1') | pr('START1') | pr('START2');

// ---------- geometr\u00eda del tri\u00e1ngulo ----------
const halfW = (y) => ((y - ROW0) / RSP + 2) / 2 * SW + WOFF;
const WALL_SLOPE = SW / 2 / RSP;
const WALL_NL = 1 / Math.hypot(1, WALL_SLOPE);
function xBounds(y, r) {
  if (y > LASTY) return [BX0 + r, BX1 - r];
  const h = halfW(Math.max(y, ROW0 - RSP)) - r / WALL_NL;
  return [Math.max(BX0 + r, CX - h), Math.min(BX1 - r, CX + h)];
}

// ---------- pixel art procedural ----------
// Grid de N x N; cada capa pinta \u00edndices de paleta. Post-proceso: luz arriba-izq, sombra abajo-der, contorno.
const SPN = 32;
function pixGrid(draw, f) {
  const g = new Array(SPN * SPN).fill(0);
  const P = (x, y, c) => { x = Math.round(x); y = Math.round(y); if (x >= 0 && y >= 0 && x < SPN && y < SPN) g[y * SPN + x] = c; };
  const A = {
    p: P,
    r: (x, y, w, h, c) => { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) P(x + i, y + j, c); },
    e: (cx, cy, rx, ry, c) => {
      for (let y = Math.floor(-ry); y <= ry; y++) for (let x = Math.floor(-rx); x <= rx; x++)
        if ((x * x) / (rx * rx + 0.3) + (y * y) / (ry * ry + 0.3) <= 1) P(cx + x, cy + y, c);
    },
    t: (pts, c) => { // pol\u00edgono
      let x0 = 99, x1 = -1, y0 = 99, y1 = -1;
      for (let i = 0; i < pts.length; i += 2) { x0 = Math.min(x0, pts[i]); x1 = Math.max(x1, pts[i]); y0 = Math.min(y0, pts[i + 1]); y1 = Math.max(y1, pts[i + 1]); }
      for (let y = Math.floor(y0); y <= y1; y++) for (let x = Math.floor(x0); x <= x1; x++) {
        let ins = false;
        for (let i = 0, j = pts.length - 2; i < pts.length; j = i, i += 2) {
          const xi = pts[i], yi = pts[i + 1], xj = pts[j], yj = pts[j + 1];
          if (yi > y + 0.5 !== yj > y + 0.5 && x + 0.5 < ((xj - xi) * (y + 0.5 - yi)) / (yj - yi) + xi) ins = !ins;
        }
        if (ins) P(x, y, c);
      }
    },
    m: (x, y, w, h, c) => { A.r(x, y, w, h, c); A.r(SPN - x - w, y, w, h, c); }, // rect espejado
  };
  draw(A, f);
  return g;
}

const mixc = (c, k) => { // k>0 aclara, k<0 oscurece
  const ch = (s) => { const v = (c >> s) & 255; return Math.round(k > 0 ? v + (255 - v) * k : v * (1 + k)); };
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
};

function pixTexture(scene, key, draw, pal, f) {
  const g = pixGrid(draw, f), N = SPN;
  const tex = scene.textures.createCanvas(key, N, N), ctx = tex.getContext();
  const at = (x, y) => (x < 0 || y < 0 || x >= N || y >= N ? 0 : g[y * N + x]);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const c = at(x, y);
    let col;
    if (c) {
      const pc = pal[c];
      col = typeof pc === 'string' ? parseInt(pc, 16) : pc;
      if (typeof pc !== 'string') {
        if (at(x, y - 1) !== c || at(x - 1, y) !== c) col = mixc(col, 0.35);
        else if (at(x, y + 1) !== c || at(x + 1, y) !== c) col = mixc(col, -0.35);
        else if (at(x, y + 2) !== c || at(x + 2, y) !== c) col = mixc(col, -0.15);
      }
    } else if (at(x - 1, y) || at(x + 1, y) || at(x, y - 1) || at(x, y + 1)) col = 0x120818;
    else continue;
    ctx.fillStyle = '#' + col.toString(16).padStart(6, '0');
    ctx.fillRect(x, y, 1, 1);
  }
  tex.refresh();
  tex.setFilter(Phaser.Textures.FilterMode.NEAREST);
}

// paleta: 1 piel 2 negro 3 blanco 4 rojo 5 oro 6 gris 7 marr\u00f3n 8 escler\u00f3tica(flat) 9 oscuro(flat) 10/11 propios 12 rosado 13 rojo brillante(flat)
const BPAL = (a, b, sk) => [0, sk || 0xf2b48a, 0x2a2438, 0xeeeaf6, 0xe0283c, 0xffc21a, 0x8a8aa0, 0x7a4424, 'fff0b0', '120818', a, b, 0xff7fb0, 'ff2020'];

// ojos amenazantes: escler\u00f3tica amarilla, pupila roja, ceja en V
function eyes(A, x, y, w, h, f, lid) {
  if (f) { A.m(x, y + h - 1, w, 1, 9); A.m(x, y, w, h - 1, lid); return; }
  A.m(x, y, w, h, 8);
  A.m(x + w - 2, y + 1, 2, h - 1, 13);
  A.m(x + w - 1, y + 1, 1, h - 1, 9);
  A.t([x - 1, y - 2, x + w + 1, y, x + w + 1, y + 1, x - 1, y - 1], 9);
  A.t([31 - x + 1, y - 2, 31 - x - w - 1, y, 31 - x - w - 1, y + 1, 31 - x + 1, y - 1], 9);
}
const fangs = (A, x, y, n, h) => { for (let i = 0; i < n; i++) A.t([x + i * 2, y, x + i * 2 + 2, y, x + i * 2 + 1, y + h], 3); };

// [paleta, dibujo, ojo izq (x, y) para el brillo]
const BOSS_ART = [
  // 0 EL CRUPIER: p\u00e1lido, sonrisa de dientes afilados
  [BPAL(0x3a3150, 0xc01830, 0xd6c8ae), (A, f) => {
    A.r(5, 26, 22, 6, 10); A.t([12, 26, 20, 26, 16, 32], 3);
    A.t([16, 28, 10, 25, 10, 31], 4); A.t([16, 28, 22, 25, 22, 31], 4); A.r(15, 27, 2, 2, 11);
    A.e(16, 17, 9, 9, 1); A.m(7, 11, 3, 6, 7); A.m(9, 18, 2, 3, 7);
    A.r(9, 1, 14, 9, 2); A.r(9, 7, 14, 2, 11); A.r(5, 9, 22, 2, 2);
    eyes(A, 10, 14, 4, 3, f, 1);
    A.t([9, 19, 16, 20, 23, 19, 22, 21, 16, 20.5, 10, 21], 7);
    A.t([10, 21, 22, 21, 20, 25, 12, 25], 9); fangs(A, 11, 21, 5, 2); A.r(13, 24, 6, 1, 4);
  }, 12.5, 15.5],
  // 1 FRANK: pug blanco con traje
  [BPAL(0xf4f0e8, 0x2e262c, 0xcdc3b4), (A, f) => {
    A.r(4, 25, 24, 7, 2); A.t([11, 25, 21, 25, 16, 32], 3); A.t([15, 26, 17, 26, 18, 30, 16, 32, 14, 30], 9);
    A.e(16, 15, 11, 10, 10);
    A.t([4, 5, 11, 4, 10, 12, 5, 11], 11); A.t([28, 5, 21, 4, 22, 12, 27, 11], 11);
    A.r(13, 7, 6, 1, 1); A.r(12, 9, 8, 1, 1); A.p(16, 10, 1);
    A.e(16, 19.5, 5.5, 4, 11); A.e(10, 15, 3, 2.5, 11); A.e(22, 15, 3, 2.5, 11);
    if (f) A.m(8, 15, 4, 1, 9);
    else { A.m(8, 14, 4, 3, 9); A.m(10, 14, 2, 2, 13); A.m(9, 14, 1, 1, 3); }
    A.t([6, 11, 13, 13, 13, 14, 6, 12], 9); A.t([26, 11, 19, 13, 19, 14, 26, 12], 9);
    A.r(14, 17, 4, 2, 9); A.p(15, 17, 6);
    A.r(12, 21, 8, 2, 9); fangs(A, 12, 21, 1, 2); fangs(A, 18, 21, 1, 2); A.r(14, 22, 4, 1, 4);
  }, 10.5, 15],
  // 2 SR. FORTUNA: dado agrietado
  [BPAL(0xf4f0ff, 0xb8b0d8), (A, f) => {
    A.t([6, 8, 12, 3, 30, 3, 26, 8], 11); A.t([26, 8, 30, 3, 30, 24, 26, 29], 11);
    A.r(4, 8, 22, 22, 10);
    A.e(9, 27, 1.5, 1.5, 4); A.e(21, 27, 1.5, 1.5, 4); A.e(28, 12, 1, 1, 4); A.e(20, 5, 1.5, 1, 4);
    eyes(A, 7, 13, 5, 4, f, 10);
    A.t([9, 20, 21, 20, 19, 25, 11, 25], 9); fangs(A, 9, 20, 6, 3); A.r(12, 24, 6, 1, 4);
    A.p(22, 9, 9); A.p(23, 10, 9); A.p(23, 11, 9); A.p(24, 12, 9); A.p(5, 22, 9); A.p(6, 23, 9);
  }, 10.5, 15],
  // 3 LA TRAGAMONEDAS
  [BPAL(0xd01c3c, 0x7a0c22), (A, f) => {
    A.r(27, 9, 2, 11, 6); A.e(28, 7, 2.5, 2.5, 4); A.r(25, 18, 3, 3, 6);
    A.r(5, 6, 21, 25, 10); A.r(4, 28, 23, 3, 11);
    A.e(15.5, 6, 7, 4, 5); A.e(15.5, 3, 1.5, 1.5, 4);
    A.r(8, 10, 15, 9, 9);
    if (f) { A.r(10, 15, 4, 1, 13); A.r(17, 15, 4, 1, 13); }
    else { A.t([9, 12, 14, 14, 14, 17, 9, 16], 13); A.t([22, 12, 17, 14, 17, 17, 22, 16], 13); }
    A.r(9, 21, 13, 6, 9); fangs(A, 9, 21, 6, 3); A.r(11, 25, 9, 1, 5);
    A.m(6, 8, 1, 1, 5); A.m(6, 12, 1, 1, 5); A.m(6, 16, 1, 1, 5); A.m(6, 20, 1, 1, 5); A.m(6, 24, 1, 1, 5);
  }, 12, 15],
  // 4 EL DUE\u00d1O: mafioso con cicatriz
  [BPAL(0x4a4458, 0xd8a01a, 0xd8a888), (A, f) => {
    A.r(4, 26, 24, 6, 10); A.t([13, 26, 19, 26, 16, 32], 3); A.r(15, 27, 2, 5, 4);
    A.r(8, 27, 16, 1, 11);
    A.e(16, 17, 9, 9, 1);
    A.t([3, 11, 29, 11, 25, 8, 22, 3, 10, 3, 7, 8], 10); A.r(8, 8, 16, 2, 2);
    A.r(8, 14, 16, 4, 2); A.m(9, 14, 6, 3, 9);
    if (!f) A.m(10, 15, 2, 1, 13);
    A.r(20, 12, 1, 9, 4); A.p(19, 14, 4); A.p(21, 17, 4);
    A.t([11, 23, 19, 22, 19, 24, 11, 24], 9); A.r(18, 22, 9, 2, 7); A.r(27, 22, 1, 2, 13); A.p(28, 20, 6); A.p(29, 18, 6);
  }, 11, 15],
  // 5 LA CASA: calavera coronada
  [BPAL(0xeee6d0, 0x9c2cff), (A, f) => {
    A.r(10, 22, 12, 7, 10);
    A.e(16, 15, 11, 10, 10);
    A.t([5, 9, 5, 1, 10, 6, 16, 0, 22, 6, 27, 1, 27, 9], 5); A.e(16, 4, 1.5, 1.5, 11); A.m(7, 5, 2, 2, 4);
    A.m(8, 12, 6, 7, 9);
    if (!f) A.m(10, 14, 3, 3, 13);
    A.t([16, 19, 14, 22, 18, 22], 9);
    for (let i = 0; i < 5; i++) A.r(11 + i * 2, 25, 1, 3, 9);
    A.r(10, 24, 12, 1, 9);
    A.p(21, 6, 9); A.p(22, 7, 9); A.p(22, 8, 9); A.p(23, 9, 9);
  }, 11.5, 15.5],
];

// ---------- estado ----------
let DT = 0.016, S, G, FX, PB, T = {}, pegs = [], scores = [], scene, slotLabels = [];
const parts = [];

function create() {
  scene = this;
  window.addEventListener('keydown', (e) => {
    const c = KEYBOARD_TO_ARCADE[normalizeIncomingKey(e.key)];
    if (!c) return;
    if (!held[c]) pressed[c] = true;
    held[c] = true;
  });
  window.addEventListener('keyup', (e) => {
    const c = KEYBOARD_TO_ARCADE[normalizeIncomingKey(e.key)];
    if (c) held[c] = false;
  });

  for (let r = 0; r < ROWS; r++) {
    const y = ROW0 + r * RSP;
    for (let j = 0; j < r + 3; j++) pegs.push({ x: CX + (j - (r + 2) / 2) * SW, y, f: 0 });
  }
  for (let i = 1; i < NS; i++) pegs.push({ x: BX0 + SW * i, y: SLOT_Y, f: 0, d: 1 });

  makeTextures(this);
  T.carpet = this.add.tileSprite(400, 300, W, H, 'carpet').setDepth(-2);
  drawStatic();
  T.bg2 = this.add.graphics().setDepth(0.5);
  T.felt = this.add.tileSprite(400, 311, 474, 498, 'felt').setDepth(0.6);
  G = this.add.graphics().setDepth(2);
  FX = this.add.graphics().setBlendMode(Phaser.BlendModes.ADD).setDepth(3);
  T.bImg = this.add.image(400, 200, 'b0').setScale(6).setDepth(3.5);
  T.bMini = this.add.image(719, 116, 'b0').setScale(2).setDepth(5);
  T.bIntro = this.add.image(400, 262, 'b0').setScale(4).setDepth(22);
  T.fxi = this.add.graphics().setBlendMode(Phaser.BlendModes.ADD).setDepth(23);
  T.lineup = BOSS_ART.map((_, i) => this.add.image(195 + i * 82, 238, 'b' + i).setScale(2.2).setDepth(22));
  // CRT: scanlines + vi\u00f1eta
  const sl = this.add.graphics().setDepth(40);
  sl.fillStyle(0x000000, 0.12);
  for (let y = 0; y < H; y += 3) sl.fillRect(0, y, W, 1);
  this.add.image(400, 300, 'vig').setDisplaySize(W, H).setDepth(41);

  const txt = (x, y, s, sz, col, o) =>
    this.add.text(x, y, s, { fontFamily: 'monospace', fontSize: sz + 'px', color: HEX(col || C.white), fontStyle: 'bold', align: 'center', lineSpacing: 4, ...o }).setOrigin(0.5).setDepth(5);
  T.txt = txt;

  slotLabels = MULT.map((m, i) => txt(BX0 + SW * (i + 0.5), 540, 'x' + (m < 1 ? String(m).slice(1) || '0' : m), 12, m >= 5 ? C.gold : m >= 1 ? C.cyan : C.red));

  // panel izquierdo
  txt(81, 60, 'FICHAS', 14, C.gray);
  T.chips = txt(81, 88, '0', 28, C.neon);
  txt(81, 128, 'RONDA', 14, C.gray);
  T.round = txt(81, 151, '1', 22);
  txt(81, 190, 'PAGOS', 14, C.gray);
  T.mult = txt(81, 213, 'x1', 22, C.gold);
  T.l4a = txt(81, 252, '', 14, C.gray);
  T.l4 = txt(81, 277, '', 22, C.cyan);
  txt(81, 318, 'DA\u00d1O TOTAL', 13, C.gray);
  T.score = txt(81, 341, '0', 20, C.pink);
  T.help = txt(81, 470, '', 12, 0xb8b6d8);

  // panel derecho
  txt(719, 60, 'BOSS', 14, C.gray);
  T.bname = txt(719, 178, '', 13, C.white, { wordWrap: { width: 140 } });
  T.bhp = txt(719, 204, '', 18, C.red);
  T.ctrlL = txt(719, 255, 'CONTROLES', 14, C.gray);
  T.ctrl = txt(719, 282, '', 14, C.neon).setOrigin(0.5, 0);

  T.head = txt(400, 26, 'LA CASA PIERDE', 28, C.gold, { stroke: '#3a0a2a', strokeThickness: 6 }).setShadow(0, 3, '#ff3fa4', 0, true, false);
  T.info = txt(400, 450, '', 16, C.white);
  T.info2 = txt(400, 545, '', 14, C.gray);
  T.rc = [0, 1, 2].map((c) => txt(400 + (c - 1) * 150, 502, RNAME[c] + ' x' + RPAY[c], 15));
  T.pt = [0, 1, 2, 3, 4].map((i) => txt(220 + i * 90, 535, 'x' + SYM_PAY[4 - i], 15, C.gold));
  T.ray = this.add.graphics().setDepth(20.5);
  T.pg = this.add.graphics().setDepth(24);
  T.pf = this.add.graphics().setBlendMode(Phaser.BlendModes.ADD).setDepth(25);
  T.say = txt(0, 0, '', 13, 0x120818, { backgroundColor: '#fff6d0', padding: { x: 8, y: 6 }, wordWrap: { width: 150 } }).setDepth(24.5).setVisible(false);
  T.combo = txt(400, 425, '', 22, C.gold, { stroke: '#3a0a2a', strokeThickness: 6 }).setDepth(9);
  T.msg = txt(400, 300, '', 32, C.white, { stroke: '#000', strokeThickness: 6 }).setDepth(10);

  // overlay (t\u00edtulo / intro / fin)
  T.ov = this.add.rectangle(400, 300, W, H, 0x05040b, 0.9).setDepth(20);
  T.big = txt(400, 95, '', 52, C.neon, { stroke: '#3a0a2a', strokeThickness: 8 }).setDepth(21).setShadow(0, 6, '#ff3fa4', 0, true, false);
  T.sub = txt(400, 155, '', 16, C.cyan).setDepth(21);
  T.body = txt(400, 330, '', 16, C.white).setDepth(21);
  T.foot = txt(400, 550, '', 18, C.neon).setDepth(21);

  S = { ph: 'title', t: 0, demo: [], demoT: 0 };
  showTitle();
  try {
    window.platanusArcadeStorage.get(STORE).then((r) => {
      if (r && r.found && Array.isArray(r.value)) scores = r.value;
      if (S.ph === 'title') showTitle();
    }).catch(() => {});
  } catch (e) {}
}

function makeTextures(sc) {
  BOSS_ART.forEach(([pal, d], i) => { pixTexture(sc, 'b' + i, d, pal, 0); pixTexture(sc, 'bb' + i, d, pal, 1); });
  const cv = (k, w, h, fn) => { const t = sc.textures.createCanvas(k, w, h); fn(t.getContext(), w, h); t.refresh(); };
  cv('carpet', 48, 48, (c) => { // alfombra de casino
    c.fillStyle = '#140c26'; c.fillRect(0, 0, 48, 48);
    c.strokeStyle = '#2a1a48'; c.lineWidth = 2;
    c.beginPath(); c.moveTo(24, 0); c.lineTo(48, 24); c.lineTo(24, 48); c.lineTo(0, 24); c.closePath(); c.stroke();
    c.fillStyle = '#3a1f3a'; c.beginPath(); c.arc(24, 24, 4, 0, 7); c.fill();
    c.fillStyle = '#4a3410'; for (const [x, y] of [[0, 0], [48, 0], [0, 48], [48, 48]]) { c.beginPath(); c.arc(x, y, 3, 0, 7); c.fill(); }
  });
  cv('felt', 96, 96, (c) => { // pa\u00f1o verde
    c.fillStyle = '#0b4a2c'; c.fillRect(0, 0, 96, 96);
    for (let i = 0; i < 900; i++) { c.fillStyle = Math.random() < 0.5 ? 'rgba(0,0,0,.18)' : 'rgba(120,255,170,.06)'; c.fillRect(Math.random() * 96 | 0, Math.random() * 96 | 0, 1, 1); }
  });
  cv('vig', 200, 150, (c) => {
    const g = c.createRadialGradient(100, 75, 40, 100, 75, 130);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,.55)');
    c.fillStyle = g; c.fillRect(0, 0, 200, 150);
  });
}

function goldText(o) {
  const g = o.context.createLinearGradient(0, 0, 0, o.height);
  g.addColorStop(0, '#fff6b0'); g.addColorStop(0.45, '#ffc21a'); g.addColorStop(0.55, '#e08a00'); g.addColorStop(1, '#ffdd55');
  o.setFill(g);
  return o;
}

function drawStatic() {
  const g = scene.add.graphics();
  g.fillStyle(0x000000, 0.5).fillRect(0, 0, W, 48);
  for (const px of [8, 646]) {
    g.fillStyle(0x000000, 0.5).fillRoundedRect(px + 4, 50, 146, 525, 10);
    g.fillStyle(0x110d22, 0.97).fillRoundedRect(px, 45, 146, 525, 10);
    g.lineStyle(3, 0x8a6a1a, 1).strokeRoundedRect(px, 45, 146, 525, 10);
    g.lineStyle(1, C.gold, 0.6).strokeRoundedRect(px + 5, 50, 136, 515, 7);
    for (const [cx, cy] of [[px + 10, 55], [px + 136, 55], [px + 10, 560], [px + 136, 560]]) g.fillStyle(C.gold, 1).fillCircle(cx, cy, 3).fillStyle(0xfff3b0, 1).fillCircle(cx - 1, cy - 1, 1);
    for (const y of [112, 177, 240, 305]) g.lineStyle(1, 0x3a3060, 1).lineBetween(px + 18, y, px + 128, y);
  }
  g.fillStyle(C.bg, 1).fillRect(BX0 - 6, 60, BW + 12, FLOOR_Y - 50);
  g.lineStyle(6, 0x5a3a08, 1).strokeRect(BX0 - 9, 57, BW + 18, FLOOR_Y - 44);
  g.lineStyle(2, C.gold, 1).strokeRect(BX0 - 6, 60, BW + 12, FLOOR_Y - 50);

  // tablero plinko (solo visible en plinko / t\u00edtulo)
  const p = (PB = scene.add.graphics().setDepth(1));
  const yT = ROW0 - RSP, yB = LASTY;
  const pts = [
    [CX - halfW(yT), yT], [CX + halfW(yT), yT],
    [Math.min(BX1, CX + halfW(yB)), yB], [BX1, yB], [BX1, SLOT_Y],
    [BX0, SLOT_Y], [BX0, yB], [Math.max(BX0, CX - halfW(yB)), yB],
  ];
  p.fillStyle(0x12102a, 0.82).fillPoints(pts.map((q) => ({ x: q[0], y: q[1] })), true);
  p.lineStyle(3, C.pink, 0.8);
  p.lineBetween(CX - halfW(yT), yT, Math.max(BX0, CX - halfW(yB)), yB);
  p.lineBetween(CX + halfW(yT), yT, Math.min(BX1, CX + halfW(yB)), yB);
  for (let i = 0; i < NS; i++) {
    const m = MULT[i];
    for (let k = 0; k < 7; k++) p.fillStyle(m >= 5 ? C.gold : m >= 1 ? C.cyan : C.red, (m ? 0.05 : 0.1) + k * 0.025).fillRect(BX0 + SW * i + 2, SLOT_Y + k * 10, SW - 4, 10);
  }
  p.lineStyle(3, 0x8a88c8, 1);
  for (let i = 1; i < NS; i++) p.lineBetween(BX0 + SW * i, SLOT_Y, BX0 + SW * i, FLOOR_Y);
}

// ---------- audio ----------
let actx, master, musG, padG, noiseBuf;
function audio() {
  if (!actx) {
    try {
      actx = (scene.sound && scene.sound.context) || new AudioContext();
      master = actx.createGain();
      master.gain.value = 0.8;
      master.connect(actx.destination);
      musG = actx.createGain();
      musG.gain.value = 0.55;
      musG.connect(master);
      padG = actx.createGain();
      padG.connect(musG);
      noiseBuf = actx.createBuffer(1, actx.sampleRate, actx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    } catch (e) { return null; }
  }
  if (actx.state === 'suspended') actx.resume().catch(() => {});
  return actx;
}
function tone(f, d, type, v, f2, delay, dest, at) {
  const a = audio();
  if (!a) return;
  try {
    const t = at || a.currentTime + (delay || 0);
    const o = a.createOscillator(), g = a.createGain();
    o.type = type || 'square';
    o.frequency.setValueAtTime(f, t);
    if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + d);
    g.gain.setValueAtTime(v || 0.08, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + d);
    o.connect(g).connect(dest || master);
    o.start(t);
    o.stop(t + d + 0.02);
  } catch (e) {}
}
function noise(d, v, fq, delay, dest, at, lp) {
  const a = audio();
  if (!a) return;
  try {
    const t = at || a.currentTime + (delay || 0);
    const s = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain();
    s.buffer = noiseBuf;
    s.loop = true;
    f.type = lp ? 'lowpass' : 'highpass';
    f.frequency.setValueAtTime(fq || 1000, t);
    if (lp) f.frequency.exponentialRampToValueAtTime(60, t + d);
    g.gain.setValueAtTime(v, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + d);
    s.connect(f).connect(g).connect(dest || master);
    s.start(t, Math.random() * 0.5);
    s.stop(t + d + 0.02);
  } catch (e) {}
}
const arp = (ns, step, type, v) => ns.forEach((n, i) => tone(n, step * 1.6, type || 'square', v || 0.07, 0, i * step));
const coin = (d) => { tone(1568, 0.06, 'square', 0.05, 0, d || 0); tone(2093, 0.15, 'square', 0.05, 0, (d || 0) + 0.06); };

// m\u00fasica: [bpm, acordes [ra\u00edz (semitonos desde La), menor], melod\u00eda (a = La4, '.' = silencio), boss]
const NF = (n) => 110 * Math.pow(2, n / 12);
const SONGS = {
  main: [128, [[3, 0], [-2, 0], [0, 1], [-4, 0]], 'h.k.p.mkf.k.o.mkh.m.p.tpm.p.m.kh', 0],
  boss: [172, [[0, 1], [0, 1], [-4, 0], [-5, 0]], 'h.h.i.hfh.d.a.dhi.i.m.ihl.h.l.ml', 1],
};
const MUS = { s: 0, nt: 0, song: 'main' };
function setSong(n) { if (MUS.song !== n) { MUS.song = n; MUS.s = 0; } }
function riser(t, d, v) { // barrido de ruido ascendente
  try {
    const a = actx, s = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain();
    s.buffer = noiseBuf; s.loop = true; f.type = 'bandpass'; f.Q.value = 3;
    f.frequency.setValueAtTime(400, t); f.frequency.exponentialRampToValueAtTime(9000, t + d);
    g.gain.setValueAtTime(0.001, t); g.gain.exponentialRampToValueAtTime(v, t + d);
    s.connect(f).connect(g).connect(musG); s.start(t); s.stop(t + d);
  } catch (e) {}
}
function music() {
  const a = actx;
  if (!a || a.state !== 'running') return;
  const [bpm, ch, mel, boss] = SONGS[MUS.song], st = 60 / bpm / 4;
  if (MUS.nt < a.currentTime) MUS.nt = a.currentTime + 0.05;
  while (MUS.nt < a.currentTime + 0.12) {
    const s = MUS.s, t = MUS.nt, bar = (s >> 4) % 4, i = s & 15, [r, mn] = ch[bar];
    const tri = mn ? [0, 3, 7, 12, 15, 19] : [0, 4, 7, 12, 16, 19];
    if (boss ? i % 4 === 0 || i === 14 : i % 4 === 0) {
      tone(170, 0.16, 'sine', 0.7, 38, 0, musG, t);
      padG.gain.setValueAtTime(0.2, t);
      padG.gain.linearRampToValueAtTime(1, t + st * 3);
    }
    if (s % 64 === 0) noise(1.4, 0.14, 5000, 0, musG, t); // platillo
    if (i === 0) for (const k of [0, 2, 4]) tone(NF(r + 12 + tri[k]), st * 15, 'sawtooth', 0.016, 0, 0, padG, t); // pad
    if (boss) tone(NF(r - 12 + (i % 2 ? 12 : 0)), st * 0.9, 'sawtooth', 0.11, 0, 0, musG, t);
    else if (i % 4 === 2 || i === 7 || i === 15) tone(NF(r + (i % 4 === 2 ? 0 : 12)), st * 1.6, 'sawtooth', 0.1, 0, 0, musG, t);
    tone(NF(r + 24 + tri[[0, 1, 2, 3, 4, 5, 4, 3][i % 8]]), st * 0.8, 'square', boss ? 0.03 : 0.035, 0, 0, padG, t); // arpegio
    const m = mel.charCodeAt(bar * 8 + (i >> 1)) - 97;
    if (i % 2 === 0 && m >= 0) {
      tone(NF(m + 24), st * 1.9, boss ? 'sawtooth' : 'square', 0.05, 0, 0, musG, t);
      tone(NF(m + 12), st * 1.9, 'triangle', 0.06, 0, 0, musG, t);
    }
    if (i % 8 === 4) { noise(0.16, 0.3, 1200, 0, musG, t); noise(0.1, 0.15, 2500, 0, musG, t + 0.012); } // aplauso
    noise(i % 4 === 2 ? 0.12 : 0.03, i % 4 === 2 ? 0.08 : 0.04, 8000, 0, musG, t); // hi-hats
    if (bar === 3 && i >= (boss ? 8 : 12)) noise(0.06, 0.08 + (i - 8) * 0.02, 1500, 0, musG, t); // redoble
    if (bar === 3 && i === 0) riser(t, st * 16, boss ? 0.12 : 0.08);
    MUS.s++;
    MUS.nt += st;
  }
}

// voces de boss: 0 rugido + risa, 1 golpe (propio de cada boss), 2 muerte
const BOSS_P = [1, 1.2, 0.85, 1.6, 0.6, 0.45];
function bossVoice(k) {
  const p = BOSS_P[S.bi] || 1, b = S.bi;
  if (k === 0) {
    noise(1, 0.35, 1600, 0, 0, 0, 1);
    tone(95 * p, 0.9, 'sawtooth', 0.14, 45 * p);
    tone(100 * p, 0.9, 'square', 0.06, 50 * p);
    for (let i = 0; i < 4; i++) { tone(330 * p, 0.12, 'square', 0.08, 200 * p, 0.7 + i * 0.15); tone(336 * p, 0.12, 'sawtooth', 0.05, 204 * p, 0.7 + i * 0.15); }
  } else if (k === 1) {
    if (b === 1) { noise(0.09, 0.2, 700, 0, 0, 0, 1); tone(420, 0.08, 'square', 0.07, 230); } // Frank: \u00a1guau!
    else if (b === 2) for (let i = 0; i < 3; i++) noise(0.025, 0.15, 3000, i * 0.04); // dado: traqueteo
    else if (b === 3) { tone(1760, 0.18, 'sine', 0.07); tone(2640, 0.12, 'sine', 0.04); } // m\u00e1quina: campana
    else if (b === 5) { noise(0.03, 0.2, 2500); tone(700, 0.25, 'sine', 0.05, 300); } // calavera: hueso + eco
    else { tone(200 * p, 0.1, 'square', 0.08, 90 * p); noise(0.06, 0.1, 900); }
  } else {
    noise(1.6, 0.5, 3000, 0, 0, 0, 1);
    tone(120 * p, 1.2, 'sawtooth', 0.15, 30);
    for (let i = 0; i < 10; i++) tone((600 - i * 45) * p, 0.14, 'square', 0.07, (500 - i * 45) * p, i * 0.08);
  }
}
const PENT = [0, 2, 4, 7, 9];
const comboNote = (c) => 523 * Math.pow(2, (PENT[c % 5] + 12 * (Math.floor(c / 5) % 3)) / 12);

// ---------- fiesta: confeti y fuegos artificiales ----------
const FP = [], PCOL = [0xff3fa4, 0xffc21a, 0x2ef2ff, 0x7dffb0, 0xffffff, 0xff6b3d, 0xb36bff];
const rnd = (a, b) => a + Math.random() * (b - a);
function confetti(n) {
  for (let i = 0; i < n; i++) FP.push({ k: 1, x: rnd(0, W), y: rnd(-220, -10), vx: rnd(-60, 60), vy: rnd(60, 180), r: rnd(0, 6), vr: rnd(-12, 12), l: 4, c: PCOL[i % 7] });
}
function fireworks(n) {
  for (let i = 0; i < n; i++) FP.push({ k: 2, x: rnd(220, 580), y: 610, vx: rnd(-40, 40), vy: rnd(-520, -420), d: i * 0.35 + 0.01, l: 1, c: PCOL[i % 7] });
}
function updFP(dt, t) {
  const g = T.pg, f = T.pf;
  g.clear();
  f.clear();
  for (let i = FP.length - 1; i >= 0; i--) {
    const p = FP[i];
    if (p.d > 0) { p.d -= dt; if (p.d <= 0) tone(500, 0.6, 'sawtooth', 0.03, 1800); continue; }
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    if (p.k === 1) {
      p.vx += Math.sin(t * 3 + i) * 40 * dt;
      p.r += p.vr * dt;
      p.l -= dt * (p.y > H ? 9 : 0.3);
      const w = 8 * Math.abs(Math.cos(p.r));
      g.fillStyle(p.c, 1).fillRect(p.x - w / 2, p.y - 2, w + 1, 4);
    } else if (p.k === 2) {
      p.vy += 300 * dt;
      f.fillStyle(p.c, 1).fillCircle(p.x, p.y, 3).fillStyle(0xfff0c0, 0.5).fillCircle(p.x, p.y + 8, 2);
      if (p.vy > -50) {
        p.l = 0;
        noise(0.9, 0.35, 900, 0, 0, 0, 1);
        noise(0.4, 0.08, 6000, 0.25);
        const c2 = PCOL[(Math.random() * 7) | 0];
        for (let k = 0; k < 48; k++) { const a = (k / 48) * 6.28, v = rnd(90, 230); FP.push({ k: 3, x: p.x, y: p.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, l: 1, c: k % 2 ? p.c : c2 }); }
      }
    } else {
      if (p.k === 3) { p.vy += 110 * dt; p.vx *= 0.97; p.vy *= 0.97; p.l -= dt * 0.65; } else p.l -= dt * 0.5;
      f.fillStyle(p.c, p.l).fillCircle(p.x, p.y, 2.5 * p.l + 0.6);
    }
    if (p.l <= 0) FP.splice(i, 1);
  }
  if (FP.length > 1200) FP.splice(0, FP.length - 1200);
  // globo de di\u00e1logo
  if (S.sayT > 0) {
    S.sayT -= dt;
    T.say.setVisible(S.sayT > 0);
    g.fillStyle(0xfff6d0, 1).fillTriangle(...S.tail);
  }
}

// ---------- los bosses hablan ----------
const TAUNT = [
  ['\u00a1HAGAN SUS APUESTAS!', 'LA CASA SIEMPRE GANA', 'JE JE JE...'],
  ['GRRR... SOY FRANK', '\u00bfESO ES TODO? \u00a1GUAU!', 'PAGA O MUERDO'],
  ['\u00a1TIRA LOS DADOS!', 'LA SUERTE ES M\u00cdA', 'SIETE... \u00a1PERDISTE!'],
  ['\u00a1INSERTE FICHA!', 'BZZT... JA JA JA', 'TILT... TILT...'],
  ['NADIE LE GANA AL DUE\u00d1O', 'TE HAR\u00c9 UNA OFERTA...', 'JE JE. PAGA.'],
  ['TODO TERMINA EN LA CASA', 'JA JA JA JA JA', 'TU ALMA ES MI FICHA'],
];
const pick = (a) => a[(Math.random() * a.length) | 0];
// d: 0 = globo a la derecha (punta a la izq), 1 = a la izquierda (punta a la der)
function say(txt, x, y, d) {
  T.say.setText(txt).setOrigin(d, 0.5).setPosition(x + (d ? -10 : 10), y).setVisible(true).setScale(0.3);
  scene.tweens.add({ targets: T.say, scale: 1, duration: 250, ease: 'Back.Out' });
  S.sayT = 2.6;
  S.tail = d ? [x - 11, y - 6, x - 11, y + 6, x, y] : [x + 11, y - 6, x + 11, y + 6, x, y];
  const p = BOSS_P[S.bi] || 1;
  for (let i = 0; i < Math.min(8, txt.length / 2); i++) tone(rnd(220, 420) * p, 0.06, 'square', 0.045, 0, i * 0.075);
}
const sayMini = (a) => { if (S.round && (S.sayT || 0) <= 0.5) say(pick(a), 642, 100, 1); };

// animaci\u00f3n propia de cada boss: [dx, dy, escalaX, escalaY, \u00e1ngulo]
function bossAnim(i, t, k) {
  const s = Math.sin, j = Math.abs(s(t * 4)), q = j < 0.25 ? 0.08 : 0;
  return [
    [s(t * 1.5) * 10, s(t * 3) * 4, 1, 1, s(t * 1.5) * 5], // crupier: vaiv\u00e9n elegante
    [0, -j * 16, 1 + q, 1 - q, s(t * 8) * 3], // Frank: saltitos
    [s(t * 0.9) * 24, -Math.abs(s(t * 3)) * 12, 1, 1, s(t * 2.2) * 22], // dado: rueda y rebota
    [s(t * 47) * 2, 0, 1 + s(t * 9) * 0.04, 1 - s(t * 9) * 0.04, 0], // m\u00e1quina: vibra
    [s(t * 0.8) * 14, s(t * 1.6) * 3, 1 + s(t * 1.6) * 0.04, 1 + s(t * 1.6) * 0.04, -s(t * 0.8) * 6], // due\u00f1o: balanceo amenazante
    [s(t * 1.3) * 8, s(t * 2) * 14, 1, 1, s(t * 1.1) * 6], // calavera: flota
  ][i].map((v, n) => (n === 2 || n === 3 ? 1 + (v - 1) * k : v * k));
}

// fondos animados
function rays(g, x, y, n, rot, col, a, R) {
  for (let i = 0; i < n; i++) {
    const a0 = rot + (i * 6.283) / n;
    g.fillStyle(col, i % 2 ? a : a * 0.35).fillTriangle(x, y, x + Math.cos(a0) * R, y + Math.sin(a0) * R, x + Math.cos(a0 + 3.1416 / n) * R, y + Math.sin(a0 + 3.1416 / n) * R);
  }
}

// ---------- feedback ----------
function flash(s, col, hold) {
  T.msg.setText(s).setColor(HEX(col || C.white)).setScale(0.6).setAlpha(1);
  scene.tweens.killTweensOf(T.msg);
  scene.tweens.add({ targets: T.msg, scale: 1, duration: 220, ease: 'Back.Out' });
  scene.tweens.add({ targets: T.msg, alpha: 0, delay: hold || 1100, duration: 400 });
}

function floatText(x, y, s, col, sz) {
  const t = scene.add.text(x, y, s, { fontFamily: 'monospace', fontSize: (sz || 16) + 'px', fontStyle: 'bold', color: HEX(col), stroke: '#000', strokeThickness: 4 }).setOrigin(0.5).setDepth(9);
  scene.tweens.add({ targets: t, y: y - 50, alpha: 0, duration: 1100, onComplete: () => t.destroy() });
}

function burst(x, y, col, n, sp) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, v = (0.3 + Math.random()) * (sp || 200);
    parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 60, l: 1, c: col });
  }
}

function addChips(n, x, y) {
  S.chips += n;
  if (n > 0) floatText(x, y, '+' + n, C.neon);
}

// ---------- pantallas ----------
function overlay(on) {
  [T.ov, T.big, T.sub, T.body, T.foot].forEach((o) => o.setVisible(on));
}

function boardText(n) {
  if (!scores.length) return 'A\u00daN NO HAY R\u00c9CORDS\n\u00a1S\u00c9 EL PRIMERO!';
  return scores.slice(0, n).map((s, i) => `${String(i + 1).padStart(2)}. ${s.n}  ${String(s.s).padStart(7)}  R${s.r}`).join('\n');
}

function showTitle() {
  S.ph = 'title';
  S.t = 0;
  overlay(true);
  goldText(T.big.setText('LA CASA PIERDE').setFontSize(56));
  T.body.setY(410);
  setSong('main');
  T.sub.setText('PLINKO \u00b7 JACKPOT \u00b7 RULETA \u00b7 \u00a1DERROTA AL BOSS!');
  T.body.setText('\u2500\u2500 RANKING: DA\u00d1O TOTAL \u2500\u2500\n\n' + boardText(8)).setFontSize(16);
  T.foot.setText('START / BOT\u00d3N 1: JUGAR');
  T.head.setText('LA CASA PIERDE');
  T.msg.setText('');
}

function startRun() {
  Object.assign(S, { round: 0, chips: START_CHIPS, score: 0, demo: [], balls: [] });
  arp([440, 660, 880], 0.08);
  nextRound();
}

function nextRound() {
  S.round++;
  S.mult = rMult(S.round);
  if (S.round > 1) S.chips += ROUND_BONUS;
  S.maxHp = S.hp = bossHP(S.round);
  S.boss = BOSSES[(S.round - 1) % BOSSES.length];
  S.ph = 'intro';
  S.t = 0;
  T.head.setText('LA CASA PIERDE');
  overlay(true);
  goldText(T.big.setText(`RONDA ${S.round}`).setFontSize(52));
  S.bi = (S.round - 1) % BOSSES.length;
  T.body.setY(330);
  setSong('main');
  bossVoice(0);
  say(pick(TAUNT[S.bi]), 470, 225, 0);
  T.sub.setText(`PAGOS x${S.mult}   \u00b7   FICHAS: ${S.chips}`);
  T.body.setText(`\n\n\n\n\n\nBOSS: ${S.boss[0]}\nHP ${S.maxHp}\n\nJUNTA FICHAS EN LOS 3 JUEGOS:\nCADA FICHA = 1 DE DA\u00d1O`).setFontSize(18);
  T.foot.setText('BOT\u00d3N 1: \u00a1A JUGAR!');
}

// ===================== PLINKO =====================
function startPlinko() {
  overlay(false);
  Object.assign(S, { ph: 'plinko', t: 0, ptime: PLINKO_T, balls: [], fireCd: 0, endT: 0, slotFlash: {}, over: 0 });
  S.bump = { x: CX, y: 330, vx: 0, vy: 0, pulse: 0, cd: 0, hit: 0 };
  T.head.setText('PLINKO');
  flash(`\u00a1${PLINKO_T} SEGUNDOS!`, C.neon);
}

function newBall(x, i) {
  return { x, y: LY, vx: (Math.random() - 0.5) * 30, vy: 30, live: 1, trail: [], slot: -1, age: 0, c: BCOL[i % 5] };
}

function reflect(b, nx, ny, e) {
  const vn = b.vx * nx + b.vy * ny;
  if (vn >= 0) return false;
  b.vx -= (1 + e) * vn * nx;
  b.vy -= (1 + e) * vn * ny;
  return true;
}

function stepBall(b, dt, bump) {
  b.vy += 720 * dt;
  b.x += b.vx * dt;
  b.y += b.vy * dt;
  const [l, r] = xBounds(b.y, BR), tri = b.y <= LASTY;
  if (b.x < l) { b.x = l; if (tri) reflect(b, WALL_NL, WALL_SLOPE * WALL_NL, 0.5); else b.vx = Math.abs(b.vx) * 0.6; }
  if (b.x > r) { b.x = r; if (tri) reflect(b, -WALL_NL, WALL_SLOPE * WALL_NL, 0.5); else b.vx = -Math.abs(b.vx) * 0.6; }
  for (const p of pegs) {
    const dx = b.x - p.x, dy = b.y - p.y, d2 = dx * dx + dy * dy, R = BR + PR;
    if (d2 < R * R && d2 > 1e-4) {
      const d = Math.sqrt(d2), nx = dx / d, ny = dy / d;
      b.x = p.x + nx * R;
      b.y = p.y + ny * R;
      if (Math.hypot(b.vx, b.vy) < PHY.gs && b.vx * nx + b.vy * ny < 0 && ny < 0.3) {
        let sg = Math.random() < 0.5 + nx * PHY.bi ? 1 : -1;
        const [wl, wr] = xBounds(b.y, BR);
        if (b.x - wl < SW * 0.25) sg = 1;
        else if (wr - b.x < SW * 0.25) sg = -1;
        b.vx = sg * (PHY.h + Math.random() * PHY.j);
        b.vy = Math.min(b.vy, 200) * PHY.e;
        if (p.f < 0.5 && b.live === 1) tone(500 + Math.random() * 700, 0.03, 'triangle', 0.03);
        p.f = 1;
      } else if (reflect(b, nx, ny, 0.5)) b.vx += (Math.random() - 0.5) * 30;
    }
  }
  if (b.y > SLOT_Y) {
    const s = Math.max(0, Math.min(NS - 1, Math.floor((b.x - BX0) / SW)));
    const sl = BX0 + SW * s + BR + 1.5, sr = BX0 + SW * (s + 1) - BR - 1.5;
    if (b.x < sl) { b.x = sl; b.vx = Math.abs(b.vx) * 0.4; }
    if (b.x > sr) { b.x = sr; b.vx = -Math.abs(b.vx) * 0.4; }
    b.slot = s;
  }
  if (bump) {
    const dx = b.x - bump.x, dy = b.y - bump.y, d2 = dx * dx + dy * dy, R = BR + UR;
    if (d2 < R * R && d2 > 1e-4) {
      const d = Math.sqrt(d2), nx = dx / d, ny = dy / d;
      b.x = bump.x + nx * R;
      b.y = bump.y + ny * R;
      const vn = (b.vx - bump.vx) * nx + (b.vy - bump.vy) * ny;
      if (vn < 0) {
        b.vx -= 1.85 * vn * nx;
        b.vy -= 1.85 * vn * ny;
        const out = b.vx * nx + b.vy * ny;
        if (out < 160) { b.vx += nx * (160 - out); b.vy += ny * (160 - out); }
        tone(220, 0.06, 'sine', 0.08, 330);
        bump.hit = 1;
      }
    }
  }
  const sp = Math.hypot(b.vx, b.vy);
  if (sp > 750) { b.vx *= 750 / sp; b.vy *= 750 / sp; }
  if (b.y > FLOOR_Y - BR) { b.y = FLOOR_Y - BR; return true; }
  return false;
}

function collideBalls(list) {
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    if (!a.live) continue;
    for (let j = i + 1; j < list.length; j++) {
      const b = list[j];
      if (!b.live) continue;
      const dx = b.x - a.x, dy = b.y - a.y, d2 = dx * dx + dy * dy, R = BR * 2;
      if (d2 < R * R && d2 > 1e-4) {
        const d = Math.sqrt(d2), nx = dx / d, ny = dy / d, o = (R - d) / 2;
        a.x -= nx * o; a.y -= ny * o; b.x += nx * o; b.y += ny * o;
        const vn = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
        if (vn < 0) { const k = -0.9 * vn; a.vx -= nx * k; a.vy -= ny * k; b.vx += nx * k; b.vy += ny * k; }
      }
    }
  }
}

function stepAll(list, dt, bump, onLand) {
  dt *= TS;
  for (let s = 0; s < 5; s++) {
    for (const b of list) if (b.live && stepBall(b, dt / 5, bump)) { b.live = 0; onLand(b); }
    collideBalls(list);
  }
  for (const b of list) {
    if (!b.live) continue;
    b.age += dt;
    b.trail.push({ x: b.x, y: b.y });
    if (b.trail.length > 10) b.trail.shift();
  }
}

function moveCursor(dt) {
  const b = S.bump;
  if (S.over > 5) return; // 5 s despu\u00e9s del tiempo el cursor desaparece
  const ax = (hold('R') ? 1 : 0) - (hold('L') ? 1 : 0), ay = (hold('D') ? 1 : 0) - (hold('U') ? 1 : 0);
  const sp = 260;
  const ny = Phaser.Math.Clamp(b.y + ay * sp * dt, ROW0 + 10, SLOT_Y - UR - 8);
  const [l, r] = xBounds(ny, UR);
  const nx = l > r ? CX : Phaser.Math.Clamp(b.x + ax * sp * dt, l, r);
  b.vx = (nx - b.x) / Math.max(dt, 1e-3);
  b.vy = (ny - b.y) / Math.max(dt, 1e-3);
  b.x = nx;
  b.y = ny;
  b.cd -= dt;
  b.pulse = Math.max(0, b.pulse - dt * 3);
  if (tap('2') && b.cd <= 0) {
    b.cd = 1;
    b.pulse = 1;
    tone(120, 0.2, 'sawtooth', 0.1, 600);
    for (const ball of S.balls) {
      if (!ball.live) continue;
      const dx = ball.x - b.x, dy = ball.y - b.y, d = Math.hypot(dx, dy);
      if (d < 80) {
        const k = 480 * (1 - d / 115);
        ball.vx += (dx / (d || 1)) * k;
        ball.vy += (dy / (d || 1)) * k;
        burst(ball.x, ball.y, C.cyan, 8, 200);
      }
    }
  }
}

function plinkoLand(b) {
  const s = b.slot < 0 ? Math.max(0, Math.min(NS - 1, Math.floor((b.x - BX0) / SW))) : b.slot;
  const win = Math.round(BALL_COST * MULT[s] * S.mult), x = BX0 + SW * (s + 0.5);
  S.chips += win;
  S.slotFlash[s] = 1;
  if (MULT[s] >= 15) { confetti(60); sayMini(['\u00a1TRAMPA!', '\u00bf\u00a1QU\u00c9!?', 'GRRR...']); flash('\u00a1x15!', C.gold, 500); scene.cameras.main.flash(120, 255, 210, 80); S.party = 2; for (let i = 0; i < 5; i++) coin(i * 0.08); }
  if (MULT[s] >= 5) { S.party = Math.max(S.party || 0, 1); coin(); arp([660, 880, 1100], 0.05); burst(x, FLOOR_Y - 20, C.gold, 24, 260); scene.cameras.main.shake(100, 0.004); }
  else if (MULT[s] >= 1) { tone(660, 0.08, 'square', 0.05); burst(x, FLOOR_Y - 20, C.cyan, 8, 150); }
  else tone(200, 0.12, 'sawtooth', 0.05, 90);
  floatText(x, FLOOR_Y - 45, win ? '+' + win : '0', win > BALL_COST * S.mult ? C.gold : win >= BALL_COST ? C.neon : C.red, MULT[s] >= 5 ? 20 : 14);
}

function updatePlinko(dt) {
  moveCursor(dt);
  S.ptime = Math.max(0, S.ptime - dt);
  if (S.ptime <= 0) S.over += dt;
  S.fireCd -= dt;
  const live = S.balls.some((b) => b.live);
  if (S.ptime > 0 && S.t > 0.3 && hold('1') && S.fireCd <= 0 && S.chips >= BALL_COST) {
    S.chips -= BALL_COST;
    S.balls.push(newBall(CX + (Math.random() - 0.5) * 10, S.balls.length));
    S.fireCd = 0.3;
    tone(300, 0.08, 'square', 0.05, 800);
  }
  stepAll(S.balls, dt, S.over > 5 ? null : S.bump, plinkoLand);
  for (const b of S.balls) if (b.live && b.age > 15) { b.live = 0; plinkoLand(b); }
  if (S.balls.length > 40) S.balls = S.balls.filter((b) => b.live);
  const broke = S.chips < BALL_COST && !live;
  if ((S.ptime <= 0 || broke) && !live) {
    if (!S.endT) { S.endT = S.t; flash(broke && S.ptime > 0 ? 'SIN FICHAS' : '\u00a1TIEMPO!', C.pink); }
    if (S.t - S.endT > 1.5) startSlots();
  }
}

// ===================== JACKPOT =====================
function makeStrip() {
  const a = [];
  SYM_W.forEach((w, i) => { for (let k = 0; k < w; k++) a.push(i); });
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

function startSlots() {
  Object.assign(S, { ph: 'slotsBet', t: 0, betI: S.betI || 1, roll: 0, rs: 'ready', balls: [] });
  const spd = 1 + 0.08 * (S.round - 1);
  S.reels = [8, 10, 12].map((v) => ({ strip: makeStrip(), pos: Math.random() * 10, v: v * spd, st: 0, tgt: 0, bo: 0 }));
  T.head.setText('JACKPOT');
}

const betOf = (opts, i) => (opts[i] ? Math.max(1, Math.floor(S.chips * opts[i])) : 0);

function updateSlots(dt) {
  const R = S.reels;
  R.forEach((r, k) => {
    const pv = Math.floor(r.pos);
    if (r.st) {
      r.pos += r.v * dt * (S.tease && k === 2 ? 0.6 : 1);
      if (Math.floor(r.pos) !== pv) tone(1000 + k * 260, 0.025, 'square', 0.035);
      if (r.st === 2 && r.pos >= r.tgt) {
        r.pos = r.tgt; r.st = 0; r.bo = 1;
        noise(0.12, 0.25, 600, 0, 0, 0, 1);
        tone(523 * [1, 1.26, 1.5][k], 0.18, 'square', 0.07);
      }
    } else if (S.ph === 'slotsBet') r.pos += 0.6 * dt;
    r.bo = Math.max(0, r.bo - dt * 6);
  });
  if (S.ph === 'slotsBet') {
    if (tap('U')) { S.betI = Math.min(SLOT_BETS.length - 1, S.betI + 1); tone(700, 0.04); }
    if (tap('D')) { S.betI = Math.max(0, S.betI - 1); tone(500, 0.04); }
    if (okP()) {
      S.sbet = betOf(SLOT_BETS, S.betI);
      if (!S.sbet) return startRoulette();
      R.forEach((r) => { r.pos = Math.round(r.pos); });
      S.ph = 'slots';
      S.t = 0;
      tone(880, 0.06);
    }
    return;
  }
  if (S.rs === 'ready') {
    if (S.chips < S.sbet) { if (S.t > 0.5) { flash('SIN FICHAS', C.red); S.rs = 'out'; S.t = 0; } return; }
    if (okP() || S.t > 6) {
      S.chips -= S.sbet;
      R.forEach((r) => { r.st = 1; });
      S.stopI = 0;
      S.tease = 0;
      S.rs = 'spin';
      S.t = 0;
      tone(200, 0.4, 'sawtooth', 0.08, 1200);
      noise(0.4, 0.15, 2000);
    }
  } else if (S.rs === 'spin') {
    if (S.stopI < 3 && (okP() || S.t > 3 + S.stopI)) {
      const r = R[S.stopI++];
      r.tgt = Math.ceil(r.pos);
      r.st = 2;
    }
    if (!S.tease && R[0].st === 0 && R[1].st === 0 && S.stopI >= 2 && reelSym(R[0]) === reelSym(R[1])) {
      S.tease = 1;
      S.party = 2;
      flash('\u00a1\u00a1UNO M\u00c1S!!', C.gold, 900);
      tone(200, 1.6, 'sawtooth', 0.07, 1600);
      tone(203, 1.6, 'square', 0.04, 1610);
    }
    if (S.stopI === 3 && R.every((r) => r.st === 0)) slotResult();
  } else if (S.rs === 'res') {
    if (S.t > 1.6) {
      S.roll++;
      S.t = 0;
      if (S.roll >= 3) startRoulette();
      else S.rs = 'ready';
    }
  } else if (S.rs === 'out' && S.t > 1.4) startRoulette();
}

const reelSym = (r) => r.strip[((r.tgt % r.strip.length) + r.strip.length) % r.strip.length];

function slotResult() {
  const s = S.reels.map(reelSym);
  let pay = 0, three = s[0] === s[1] && s[1] === s[2];
  if (three) pay = SYM_PAY[s[0]];
  else if (s[0] === s[1] || s[1] === s[2] || s[0] === s[2]) pay = 1;
  const win = Math.round(S.sbet * pay * S.mult);
  S.chips += win;
  S.lastWin = pay;
  if (three) {
    flash(s[0] === 4 ? `\u00a1\u00a1JACKPOT!! +${win}` : `\u00a1TRIPLE! +${win}`, C.gold, 1300);
    confetti(140);
    fireworks(s[0] >= 3 ? 5 : 2);
    sayMini(['\u00a1IMPOSIBLE!', '\u00a1ESA M\u00c1QUINA EST\u00c1 ARREGLADA!', 'NO... NO...']);
    arp([523, 659, 784, 1047, 1319], 0.07);
    for (let i = 0; i < 6; i++) coin(0.4 + i * 0.12);
    S.party = 2.5;
    burst(400, 280, C.gold, s[0] >= 3 ? 70 : 35, 380);
    scene.cameras.main.shake(250, s[0] >= 3 ? 0.012 : 0.006);
  } else if (pay) { flash(`PAR \u00b7 +${win}`, C.neon); tone(660, 0.1); }
  else { flash('NADA', C.red); tone(200, 0.3, 'sawtooth', 0.07, 80); if (Math.random() < 0.5) sayMini(['JE JE JE', 'OTRA VEZ...', 'GRACIAS POR TUS FICHAS']); }
  S.rs = 'res';
  S.t = 0;
}

function drawSym(g, id, x, y, s, sy) {
  const v = s * (sy || 1);
  if (id === 0) {
    g.lineStyle(3, 0x3ddc5a, 1).lineBetween(x - s * 0.2, y + v * 0.05, x + s * 0.08, y - v * 0.35).lineBetween(x + s * 0.22, y + v * 0.1, x + s * 0.08, y - v * 0.35);
    g.fillStyle(0xff3355, 1).fillEllipse(x - s * 0.2, y + v * 0.15, s * 0.4, v * 0.4).fillEllipse(x + s * 0.22, y + v * 0.2, s * 0.4, v * 0.4);
  } else if (id === 1) {
    g.fillStyle(0xffe14d, 1).fillEllipse(x, y, s * 0.85, v * 0.6);
    g.fillStyle(0xfff6b0, 1).fillEllipse(x - s * 0.15, y - v * 0.1, s * 0.25, v * 0.12);
  } else if (id === 2) {
    g.fillStyle(0x2ef2ff, 1).fillPoints([{ x, y: y - v * 0.42 }, { x: x + s * 0.36, y }, { x, y: y + v * 0.42 }, { x: x - s * 0.36, y }], true);
    g.fillStyle(0xbffcff, 1).fillPoints([{ x, y: y - v * 0.42 }, { x: x + s * 0.12, y }, { x, y: y + v * 0.1 }, { x: x - s * 0.12, y }], true);
  } else if (id === 3) {
    const p = [];
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5, rr = i % 2 ? 0.18 : 0.44;
      p.push({ x: x + Math.cos(a) * rr * s, y: y + Math.sin(a) * rr * v });
    }
    g.fillStyle(C.gold, 1).fillPoints(p, true);
  } else {
    g.fillStyle(0xff2a4a, 1).fillRect(x - s * 0.3, y - v * 0.4, s * 0.6, v * 0.17);
    g.fillPoints([{ x: x + s * 0.3, y: y - v * 0.4 }, { x: x + s * 0.3, y: y - v * 0.23 }, { x: x - s * 0.02, y: y + v * 0.42 }, { x: x - s * 0.22, y: y + v * 0.42 }, { x: x + s * 0.1, y: y - v * 0.23 }], true);
  }
}

function renderSlots(g, fx, t) {
  const cell = 86, cy = 270, xs = [272, 400, 528], top = cy - cell * 1.5, bot = cy + cell * 1.5;
  // gabinete
  const bg = T.bg2;
  for (let k = 0; k < 10; k++) bg.fillStyle(0x5a0c22, 0.5 + k * 0.05).fillRect(160, 60 + k * 50, 480, 50);
  rays(bg, 400, 270, 20, t * 0.3, C.gold, 0.12, 420);
  bg.fillStyle(0x2a0410, 1).fillRoundedRect(196, top - 22, 408, bot - top + 44, 18);
  bg.lineStyle(6, 0xb08a2a, 1).strokeRoundedRect(196, top - 22, 408, bot - top + 44, 18);
  bg.lineStyle(2, 0xfff0a0, 0.8).strokeRoundedRect(202, top - 16, 396, bot - top + 32, 14);
  for (let k = 0; k < 3; k++) {
    const r = S.reels[k], x = xs[k];
    g.fillStyle(0xf4f0e6, 1).fillRect(x - 56, top, 112, bot - top);
    const b = Math.floor(r.pos), RR = cell * 1.5;
    for (let i = b - 3; i <= b + 3; i++) {
      const th = ((r.pos - i) * cell) / RR + Math.sin(r.bo * 3) * r.bo * 0.08;
      if (Math.abs(th) < 1.5) drawSym(g, r.strip[((i % 10) + 10) % 10], x, cy + RR * Math.sin(th), 64, Math.cos(th));
    }
  }
  for (let k = 0; k < 3; k++) {
    const x = xs[k], on = S.ph === 'slots' && S.rs === 'spin' && k === S.stopI;
    for (let j = 0; j < 12; j++) {
      const a = 0.55 * (1 - j / 12) ** 1.6;
      g.fillStyle(0x000000, a).fillRect(x - 56, top + j * 6, 112, 6).fillRect(x - 56, bot - (j + 1) * 6, 112, 6);
    }
    g.fillStyle(0xffffff, 0.18).fillRect(x - 40, top, 10, bot - top);
    g.lineStyle(4, on ? C.pink : 0x8a6a1a, 1).strokeRect(x - 58, top - 2, 116, bot - top + 4);
    if (on) fx.lineStyle(8, C.pink, 0.25 + 0.15 * Math.sin(t * 12)).strokeRect(x - 60, top - 4, 120, bot - top + 8);
  }
  g.lineStyle(2, C.gold, 0.8).lineBetween(205, cy, 595, cy);
  g.fillStyle(C.gold, 1).fillTriangle(196, cy - 9, 196, cy + 9, 210, cy).fillTriangle(604, cy - 9, 604, cy + 9, 590, cy);
  // tabla de pagos
  for (let i = 0; i < 5; i++) {
    const x = 220 + i * 90;
    drawSym(g, 4 - i, x - 18, 500, 30);
    drawSym(g, 4 - i, x, 500, 30);
    drawSym(g, 4 - i, x + 18, 500, 30);
  }
}

// ===================== RULETA =====================
const RCOL = (i) => (i === 0 ? 0x1fbf5a : i % 2 ? 0xd62e4a : 0x22202e);
const RNAME = ['ROJO', 'NEGRO', 'VERDE'];
const RPAY = [2, 2, 14];

function startRoulette() {
  Object.assign(S, { ph: 'roulBet', t: 0, rbI: S.rbI || 1, col: S.col || 0, w: 0.6, rot: S.rot || 0, rs: '' });
  T.head.setText('RULETA');
}

function updateRoulette(dt) {
  const pv = Math.floor(S.rot / RSA);
  S.rot += S.w * dt;
  if (S.ph === 'roul' && Math.floor(S.rot / RSA) !== pv) { noise(0.02, 0.18, 3500); tone(1500 + Math.random() * 300, 0.015, 'square', 0.025); }
  if (S.ph === 'roulBet') {
    if (tap('L')) { S.col = (S.col + 2) % 3; tone(600, 0.04); }
    if (tap('R')) { S.col = (S.col + 1) % 3; tone(600, 0.04); }
    if (tap('U')) { S.rbI = Math.min(ROUL_BETS.length - 1, S.rbI + 1); tone(700, 0.04); }
    if (tap('D')) { S.rbI = Math.max(0, S.rbI - 1); tone(500, 0.04); }
    if (okP()) {
      S.rbet = betOf(ROUL_BETS, S.rbI);
      if (!S.rbet) return startBoss();
      S.chips -= S.rbet;
      S.ph = 'roul';
      S.rs = 'spin';
      S.w = 9 + S.round * 0.6;
      S.t = 0;
      tone(150, 0.6, 'sawtooth', 0.08, 1400);
      noise(0.6, 0.2, 1500);
    }
    return;
  }
  if (S.rs === 'spin') {
    if (okP() || S.t > 6) {
      // frena en ~1.25 vueltas, con algo de azar
      const D = Math.PI * 2 * 1.25 + (Math.random() - 0.5) * RSA * 1.4;
      S.dec = (S.w * S.w) / (2 * D);
      S.rs = 'brake';
      tone(500, 0.1);
    }
  } else if (S.rs === 'brake') {
    S.w = Math.max(0, S.w - S.dec * dt);
    if (S.w === 0) {
      const a = (((-Math.PI / 2 - S.rot) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
      const idx = Math.floor(a / RSA), c = idx === 0 ? 2 : idx % 2 ? 0 : 1;
      S.rIdx = idx;
      if (c === S.col) {
        const win = Math.round(S.rbet * RPAY[c] * S.mult);
        S.chips += win;
        flash(`\u00a1${RNAME[c]}! +${win}`, c === 2 ? C.gold : C.neon, 1400);
        arp(c === 2 ? [523, 659, 784, 1047, 1319, 1568] : [523, 784, 1047], 0.07);
        burst(400, 290, c === 2 ? C.gold : C.neon, c === 2 ? 80 : 30, 360);
        if (c === 2) { scene.cameras.main.shake(300, 0.012); fireworks(5); }
        confetti(c === 2 ? 200 : 90);
        sayMini(['\u00a1SUERTE DE PRINCIPIANTE!', 'GRRR...', '\u00a1ESO NO VALE!']);
      } else {
        flash(`${RNAME[c]}... PIERDES`, C.red, 1400);
        sayMini(['JA JA JA', 'LA RULETA ES M\u00cdA', 'JE JE JE']);
        tone(200, 0.4, 'sawtooth', 0.08, 70);
      }
      S.rs = 'res';
      S.t = 0;
    }
  } else if (S.rs === 'res' && S.t > 2) startBoss();
}

function renderRoulette(g, fx, t) {
  const x = 400, y = 270, R = 160;
  fx.fillStyle(C.gold, 0.12).fillCircle(x, y, R + 22);
  for (let k = 0; k < 28; k++) {
    const a = (k / 28) * 6.283, on = (k + Math.floor(t * (S.rs === 'spin' ? 18 : 6))) % 3 === 0;
    g.fillStyle(on ? 0xfff3b0 : 0x5a4a10, 1).fillCircle(x + Math.cos(a) * (R + 34), y + Math.sin(a) * (R + 34), 3);
    if (on) fx.fillStyle(C.gold, 0.4).fillCircle(x + Math.cos(a) * (R + 34), y + Math.sin(a) * (R + 34), 8);
  }
  g.fillStyle(0x000000, 0.4).fillCircle(x + 6, y + 10, R + 16);
  g.fillStyle(0x4a2a10, 1).fillCircle(x, y, R + 16);
  g.fillStyle(0x6a3c18, 1).fillCircle(x - 3, y - 3, R + 10);
  g.lineStyle(4, C.gold, 1).strokeCircle(x, y, R + 16);
  for (let k = 0; k < 8; k++) { const a = (k * Math.PI) / 4; g.fillStyle(C.gold, 1).fillCircle(x + Math.cos(a) * (R + 9), y + Math.sin(a) * (R + 9), 3); }
  for (let i = 0; i < RN; i++) {
    const a0 = S.rot + i * RSA, p = [{ x, y }];
    for (let k = 0; k <= 6; k++) { const a = a0 + (RSA * k) / 6; p.push({ x: x + Math.cos(a) * R, y: y + Math.sin(a) * R }); }
    const win = S.rs === 'res' && i === S.rIdx;
    g.fillStyle(win ? (Math.sin(t * 12) > 0 ? C.white : RCOL(i)) : RCOL(i), 1).fillPoints(p, true);
    g.lineStyle(1, C.gold, 0.6).lineBetween(x, y, x + Math.cos(a0) * R, y + Math.sin(a0) * R);
  }
  g.fillStyle(0x3a2a10, 1).fillCircle(x, y, 42);
  g.lineStyle(3, C.gold, 1).strokeCircle(x, y, 42);
  for (let k = 0; k < 4; k++) { const a = S.rot * 1 + (k * Math.PI) / 2; g.lineStyle(5, C.gold, 1).lineBetween(x, y, x + Math.cos(a) * 30, y + Math.sin(a) * 30); }
  g.fillStyle(C.gold, 1).fillCircle(x, y, 9);
  g.lineStyle(2, C.gold, 0.9).strokeCircle(x, y, R).strokeCircle(x, y, R - 26);
  if (S.rs) {
    const D = S.rs === 'brake' ? (S.w * S.w) / (2 * S.dec) : S.rs === 'res' ? 0 : 99;
    S.ballA = D < 50 ? -Math.PI / 2 + D * 1.3 : (S.ballA || 0) - S.w * 1.3 * (1 / 60);
    const br = R - 8 - 14 * Math.max(0, 1 - S.w / 4), bx = x + Math.cos(S.ballA) * br, by = y + Math.sin(S.ballA) * br;
    g.fillStyle(0x000000, 0.4).fillCircle(bx + 2, by + 3, 7);
    g.fillStyle(0xffffff, 1).fillCircle(bx, by, 7);
    g.fillStyle(0xc8c8d8, 1).fillCircle(bx + 2, by + 2, 3);
  }
  g.fillStyle(C.gold, 1).fillTriangle(x - 16, y - R - 30, x + 16, y - R - 30, x, y - R + 2);
  g.fillStyle(0xfff6b0, 1).fillTriangle(x - 8, y - R - 27, x + 4, y - R - 27, x, y - R - 8);
  // opciones de color
  for (let c = 0; c < 3; c++) {
    const bx = 400 + (c - 1) * 150, on = S.col === c;
    g.fillStyle(c === 2 ? 0x1fbf5a : c ? 0x22202e : 0xd62e4a, 1).fillRoundedRect(bx - 62, 482, 124, 40, 8);
    g.lineStyle(on ? 4 : 1, on ? C.neon : 0x8a88c8, 1).strokeRoundedRect(bx - 62, 482, 124, 40, 8);
  }
}

// ===================== BOSS =====================
function startBoss() {
  Object.assign(S, { ph: 'boss', t: 0, proj: [], pending: S.hp, throwT: 0, bossHit: 0, done: 0, combo: 0 });
  scene.cameras.main.flash(400, 255, 30, 30);
  say(TAUNT[S.bi][0], 500, 130, 0);
  scene.cameras.main.shake(500, 0.012);
  S.chunk = Math.max(1, Math.ceil(Math.min(S.chips, S.hp) / 45));
  T.head.setText('\u00a1BOSS!');
  flash(S.boss[0], S.boss[1], 900);
  setSong('boss');
  noise(0.8, 0.3, 2000, 0, 0, 0, 1);
  bossVoice(0);
}

function updateBoss(dt) {
  if (S.t < 1.2) return;
  S.throwT -= dt;
  if (S.throwT <= 0 && S.chips > 0 && S.pending > 0) {
    const d = Math.min(S.chunk, S.chips, S.pending);
    S.chips -= d;
    S.pending -= d;
    S.proj.push({ x: 400 + (Math.random() - 0.5) * 120, y: 560, sx: 400 + (Math.random() - 0.5) * 200, t: 0, d });
    S.throwT = 0.05;
    noise(0.03, 0.05, 4000);
  }
  for (const p of S.proj) {
    p.t += dt / 0.4;
    if (p.t >= 1 && !p.hit) {
      p.hit = 1;
      S.hp = Math.max(0, S.hp - p.d);
      S.score += p.d;
      S.bossHit = 1;
      burst(400 + (Math.random() - 0.5) * 60, 200 + (Math.random() - 0.5) * 60, C.gold, 5, 200);
      const f = comboNote(S.combo++);
      tone(f, 0.09, 'square', 0.05);
      tone(f * 2, 0.12, 'triangle', 0.035, 0, 0.03);
      if (S.combo % 3 === 1) bossVoice(1);
      T.combo.setText(`x${S.combo} COMBO`).setScale(1.5).setAlpha(1);
      if (S.combo % 10 === 0) { scene.cameras.main.flash(80, 255, 220, 120); S.party = 0.5; }
      if (S.combo % 15 === 0 && S.sayT <= 0.3) say(pick(['\u00a1AY!', '\u00a1MIS FICHAS!', '\u00a1BASTA!', '\u00a1AUCH!', '\u00a1TRAMPOSO!']), 500, 130, 0);
    }
  }
  S.proj = S.proj.filter((p) => !p.hit);
  S.bossHit = Math.max(0, S.bossHit - dt * 5);
  if (!S.done && !S.proj.length && (S.chips <= 0 || S.pending <= 0)) {
    S.done = S.t;
    if (S.hp <= 0) {
      flash('\u00a1BOSS DERROTADO!', C.gold, 1800);
      confetti(220);
      fireworks(7);
      say(pick(['\u00a1NOOOOO!', '\u00a1VOLVER\u00c9!', '\u00a1MIS FICHAS!']), 500, 130, 0);
      burst(400, 200, S.boss[1], 120, 450);
      burst(400, 200, C.gold, 60, 300);
      scene.cameras.main.shake(500, 0.02);
      bossVoice(2);
      arp([392, 523, 659, 784, 1047, 1319, 1568], 0.08, 'square', 0.06, 0.6);
      S.party = 3;
    } else {
      flash('LA CASA GANA', C.red, 1800);
      say('JA JA JA \u00a1LA CASA GANA!', 500, 130, 0);
      bossVoice(0);
      arp([392, 330, 262, 196], 0.18, 'sawtooth', 0.08);
    }
  }
  if (S.done && S.t - S.done > 2.6) (S.hp <= 0 ? nextRound : endGame)();
}

function renderBoss(g, fx, t) {
  const dead = S.done && S.hp <= 0, b = T.bImg, dt0 = dead ? S.t - S.done : 0;
  // arena: foco y piso
  const bg = T.bg2;
  for (let k = 0; k < 12; k++) bg.fillStyle(0x3a0618, 0.08 + k * 0.03).fillRect(160, 60 + k * 42, 480, 42);
  bg.lineStyle(1, 0xff3f6a, 0.25);
  for (let k = -6; k <= 6; k++) bg.lineBetween(400 + k * 20, 380, 400 + k * 75, 562);
  for (let k = 0; k < 5; k++) bg.lineBetween(160, 380 + k * k * 8, 640, 380 + k * k * 8);
  fx.fillStyle(0xfff2c0, 0.06).fillTriangle(330, 60, 470, 60, 600, 330).fillTriangle(330, 60, 200, 330, 600, 330);
  fx.fillStyle(S.boss[1], 0.18 + S.bossHit * 0.25).fillCircle(400, 200, 110 + Math.sin(t * 3) * 6);
  g.fillStyle(0x000000, 0.45).fillEllipse(400, 312, 170, 26);
  b.setVisible(true).setTexture((t % 3.2 < 0.15 ? 'bb' : 'b') + S.bi);
  const an = bossAnim(S.bi, t, 1);
  b.setPosition(400 + an[0] + S.bossHit * 8 * Math.sin(t * 90), 205 + an[1] - dt0 * 40);
  b.setScale(6 * an[2] + dt0 * 1.5, 6 * an[3] + dt0 * 1.5);
  b.setAngle(dead ? dt0 * 90 : an[4]).setAlpha(dead ? Math.max(0, 1 - dt0 * 0.8) : S.bi === 5 ? 0.85 + 0.15 * Math.sin(t * 13) : 1);
  // rayos y brasas
  if (Math.random() < DT / 2.5) { S.lt = 0.18; noise(0.6, 0.18, 400, 0, 0, 0, 1); S.lx = rnd(200, 600); }
  if (S.lt > 0) {
    S.lt -= DT;
    bg.fillStyle(0xffffff, S.lt).fillRect(160, 60, 480, 502);
    let x = S.lx, y = 60;
    fx.lineStyle(3, 0xd0c0ff, S.lt * 5);
    while (y < 330) { const nx = x + rnd(-25, 25), ny = y + rnd(20, 45); fx.lineBetween(x, y, nx, ny); x = nx; y = ny; }
  }
  if (Math.random() < 0.3) FP.push({ k: 4, x: rnd(170, 630), y: 560, vx: rnd(-10, 10), vy: rnd(-90, -40), l: 1, c: 0xff5020 });
  if (S.bossHit > 0.7) b.setTint((t * 20) % 2 < 1 ? 0xff8080 : 0xffffff); else b.clearTint();
  if (!dead) eyeGlow(fx, b.x, b.y, b.scaleX, t, b);
  T.combo.setScale(Math.max(1, T.combo.scaleX - 0.03)).setPosition(400 + Math.sin(t * 20) * S.bossHit * 3, 425);
  // barra de HP
  const w = 340, f = S.hp / S.maxHp;
  g.fillStyle(0x000000, 0.6).fillRect(400 - w / 2 - 4, 326, w + 8, 30);
  g.fillStyle(0x2a0a14, 1).fillRect(400 - w / 2, 330, w, 22);
  g.fillStyle(C.red, 1).fillRect(400 - w / 2, 330, w * f, 22);
  g.fillStyle(0xff9a9a, 1).fillRect(400 - w / 2, 330, w * f, 5);
  g.lineStyle(2, C.gold, 1).strokeRect(400 - w / 2, 330, w, 22);
  // fichas de casino volando
  for (const p of S.proj) {
    const u = p.t, px = (1 - u) * (1 - u) * p.x + 2 * (1 - u) * u * p.sx + u * u * 400, py = (1 - u) * (1 - u) * p.y + 2 * (1 - u) * u * 380 + u * u * 200;
    fx.fillStyle(C.gold, 0.35).fillCircle(px, py, 11);
    chip(g, px, py, 7, u * 20);
  }
  const n = Math.min(14, Math.ceil(S.chips / Math.max(1, S.chunk * 4)));
  for (let i = 0; i < n; i++) {
    const cx = 400 + ((i * 37) % 7) - 3, cy = 545 - i * 5;
    g.fillStyle(0x7a0c22, 1).fillEllipse(cx, cy + 2, 56, 16);
    g.fillStyle(i % 2 ? C.red : 0x2050d0, 1).fillEllipse(cx, cy, 56, 15);
    g.lineStyle(2, 0xffffff, 0.8).strokeEllipse(cx, cy, 40, 10);
  }
}

function eyeGlow(fx, x, y, sc, t, img) {
  if (img.texture.key[1] === 'b') return; // parpadeando
  const [, , ex, ey] = BOSS_ART[S.bi], a = 0.35 + 0.2 * Math.sin(t * 7);
  for (const dx of [ex - 16, 16 - ex]) {
    fx.fillStyle(0xff1010, a).fillCircle(x + dx * sc, y + (ey - 16) * sc, sc * 2.6);
    fx.fillStyle(0xff6040, a * 0.8).fillCircle(x + dx * sc, y + (ey - 16) * sc, sc * 1.1);
  }
}

function chip(g, x, y, r, a) {
  g.fillStyle(0xd01c3c, 1).fillCircle(x, y, r);
  g.fillStyle(0xffffff, 1);
  for (let k = 0; k < 4; k++) { const q = a + (k * Math.PI) / 2; g.fillCircle(x + Math.cos(q) * r * 0.75, y + Math.sin(q) * r * 0.75, r * 0.22); }
  g.fillStyle(0xff6070, 1).fillCircle(x, y, r * 0.45);
}

// ===================== FIN / RANKING =====================
function endGame() {
  Object.assign(S, { ph: 'name', name: [0, 0, 0], ni: 0, t: 0 });
  overlay(true);
  goldText(T.big.setText('GAME OVER').setFontSize(52));
  T.body.setY(330);
  setSong('main');
  T.sub.setText(`RONDA ${S.round}   \u00b7   DA\u00d1O TOTAL: ${S.score}`);
  T.foot.setText('JOYSTICK: LETRA  \u00b7  BOT\u00d3N 1: OK');
  T.head.setText('LA CASA PIERDE');
  refreshName();
}

function refreshName() {
  const s = S.name.map((c, i) => (i === S.ni ? `[${String.fromCharCode(65 + c)}]` : ` ${String.fromCharCode(65 + c)} `)).join('');
  T.body.setText('TU NOMBRE\n\n' + s).setFontSize(28);
}

function updateName() {
  const up = tap('U'), dn = tap('D'), lf = tap('L'), rt = tap('R');
  if (up) S.name[S.ni] = (S.name[S.ni] + 1) % 26;
  if (dn) S.name[S.ni] = (S.name[S.ni] + 25) % 26;
  if (lf) S.ni = Math.max(0, S.ni - 1);
  if (rt) S.ni = Math.min(2, S.ni + 1);
  if (up || dn || lf || rt) { tone(700, 0.04); refreshName(); }
  if (S.t > 0.5 && okP()) {
    tone(900, 0.06);
    if (S.ni < 2) { S.ni++; refreshName(); } else saveScore();
  }
}

function saveScore() {
  const n = S.name.map((c) => String.fromCharCode(65 + c)).join('');
  const e = { n, s: S.score, r: S.round };
  scores.push(e);
  scores.sort((a, b) => b.s - a.s);
  scores = scores.slice(0, 10);
  try { window.platanusArcadeStorage.set(STORE, scores).catch(() => {}); } catch (err) {}
  const rank = scores.indexOf(e) + 1;
  S.ph = 'board';
  S.t = 0;
  goldText(T.big.setText(rank === 1 ? '\u00a1NUEVO R\u00c9CORD!' : rank ? `PUESTO #${rank}` : 'RANKING').setFontSize(48));
  T.sub.setText(`${n} \u00b7 ${S.score} DE DA\u00d1O \u00b7 RONDA ${S.round}`);
  T.body.setText('\u2500\u2500 RANKING: DA\u00d1O TOTAL \u2500\u2500\n\n' + boardText(10)).setFontSize(16);
  T.foot.setText('BOT\u00d3N 1: CONTINUAR');
  if (rank === 1) arp([523, 659, 784, 1047, 1319, 1568], 0.09);
  if (rank && rank <= 3) { confetti(250); fireworks(8); }
}

// ===================== LOOP =====================
function update(time, delta) {
  if (!S) return;
  const dt = (DT = Math.min(delta, 40) / 1000);
  S.t += dt;
  const ph = S.ph;
  if (ph === 'title') {
    if (S.t > 0.4 && okP()) startRun();
    else runDemo(dt);
  } else if (ph === 'intro') { if (S.t > 0.6 && okP()) startPlinko(); }
  else if (ph === 'plinko') updatePlinko(dt);
  else if (ph === 'slotsBet' || ph === 'slots') updateSlots(dt);
  else if (ph === 'roulBet' || ph === 'roul') updateRoulette(dt);
  else if (ph === 'boss') updateBoss(dt);
  else if (ph === 'name') updateName();
  else if (ph === 'board') { if (S.t > 0.6 && okP()) showTitle(); }
  for (const k in pressed) pressed[k] = false;
  music();
  render(dt);
}

function runDemo(dt) {
  S.demoT -= dt;
  if (S.demoT <= 0 && S.demo.length < 8) { S.demo.push(newBall(CX + (Math.random() - 0.5) * 10, S.demo.length)); S.demo[S.demo.length - 1].live = 2; S.demoT = 0.35; }
  stepAll(S.demo, dt, null, (b) => burst(b.x, b.y, C.pink, 8, 140));
  S.demo = S.demo.filter((b) => b.live);
}

function render(dt) {
  const g = G, fx = FX, ph = S.ph, t = scene.time.now / 1000;
  g.clear();
  fx.clear();
  T.bg2.clear();
  T.ray.clear();
  updFP(dt, t);
  if (ph === 'title' || ph === 'intro' || ph === 'board') rays(T.ray, 400, ph === 'intro' ? 255 : 240, 18, t * 0.25, C.gold, 0.06, 700);
  if (ph === 'title' && Math.random() < dt / 2.5 && FP.length < 300) fireworks(1);
  if (ph === 'plinko') {
    for (let k = 0; k < 14; k++) { const y = 60 + ((k * 36 + t * 40) % 504); T.bg2.fillStyle(k % 2 ? C.pink : C.cyan, 0.07).fillRect(160, y, 480, 3); }
    T.bg2.fillStyle(0x7020a0, 0.12 + 0.08 * Math.sin(t * 2)).fillCircle(400, 330, 230);
  }
  T.fxi.clear();
  T.carpet.tilePositionX += dt * 10;
  T.carpet.tilePositionY += dt * 5;
  const isR = ph === 'roulBet' || ph === 'roul';
  T.felt.setVisible(isR);
  T.bImg.setVisible(false);
  T.bIntro.setVisible(ph === 'intro');
  if (ph === 'intro') {
    const an = bossAnim(S.bi, t, 0.7);
    T.bIntro.setTexture((t % 2.6 < 0.15 ? 'bb' : 'b') + S.bi).setPosition(400 + an[0], 255 + an[1]).setScale(4 * an[2], 4 * an[3]).setAngle(an[4]);
    eyeGlow(T.fxi, T.bIntro.x, T.bIntro.y, 4, t, T.bIntro);
  }
  T.lineup.forEach((o, i) => { const a = bossAnim(i, t + i, 0.3); o.setVisible(ph === 'title').setPosition(195 + i * 82 + a[0], 238 + a[1]).setAngle(a[4]).setTexture(((t + i * 0.7) % 3 < 0.12 ? 'bb' : 'b') + i); });
  const isP = ph === 'plinko' || ph === 'title' || ph === 'intro';
  PB.setVisible(isP);
  slotLabels.forEach((o) => o.setVisible(isP));

  if (isP) {
    if (S.slotFlash) for (const k in S.slotFlash) {
      S.slotFlash[k] -= dt * 1.5;
      if (S.slotFlash[k] > 0) fx.fillStyle(C.white, S.slotFlash[k] * 0.5).fillRect(BX0 + SW * k + 2, SLOT_Y, SW - 4, FLOOR_Y - SLOT_Y);
    }
    for (const p of pegs) {
      if (p.d) continue;
      p.f = Math.max(0, p.f - dt * 3);
      if (p.f > 0) fx.fillStyle(C.neon, p.f * 0.5).fillCircle(p.x, p.y, PR + 6 * p.f);
      g.fillStyle(0x000000, 0.4).fillCircle(p.x + 1, p.y + 2, PR);
      g.fillStyle(p.f > 0 ? C.white : 0x9a98d8, 1).fillCircle(p.x, p.y, PR);
      g.fillStyle(0xffffff, 0.8).fillRect(p.x - 2, p.y - 2, 1.5, 1.5);
    }
    if (ph === 'plinko' && S.over < 5) {
      g.fillStyle(C.pink, 1).fillTriangle(CX - 12, LY - 28, CX + 12, LY - 28, CX, LY - 16);
      const b = S.bump, ca = S.over > 4 ? 5 - S.over : 1;
      b.hit = Math.max(0, b.hit - dt * 4);
      fx.fillStyle(C.cyan, (0.15 + b.hit * 0.3) * ca).fillCircle(b.x, b.y, UR + 8 + b.hit * 6);
      if (b.pulse > 0) fx.lineStyle(4, C.cyan, b.pulse * ca).strokeCircle(b.x, b.y, UR + (1 - b.pulse) * 65);
      if (b.cd <= 0) fx.lineStyle(1, C.cyan, 0.2 * ca).strokeCircle(b.x, b.y, 80);
      g.fillStyle(0x07060f, ca).fillCircle(b.x, b.y, UR);
      g.lineStyle(3, C.cyan, ca).strokeCircle(b.x, b.y, UR);
      g.fillStyle(C.cyan, ca).fillCircle(b.x, b.y, 4);
    }
    for (const b of ph === 'plinko' ? S.balls : S.demo) {
      if (!b.live) continue;
      b.trail.forEach((p, i) => fx.fillStyle(b.c, (i / b.trail.length) * 0.3).fillCircle(p.x, p.y, BR * (i / b.trail.length)));
      drawBall(g, fx, b.x, b.y, b.c);
    }
  } else if (ph === 'slotsBet' || ph === 'slots') renderSlots(g, fx, t);
  else if (ph === 'roulBet' || ph === 'roul') renderRoulette(g, fx, t);
  else if (ph === 'boss') renderBoss(g, fx, t);

  // luces de marquesina alrededor del \u00e1rea central
  S.party = Math.max(0, (S.party || 0) - dt);
  const ch = Math.floor(t * (S.party ? 20 : 7));
  let bi = 0;
  const bulb = (x, y) => {
    const on = S.party ? (ch + bi) % 2 : (ch + bi) % 4 === 0;
    bi++;
    g.fillStyle(on ? 0xfff3b0 : 0x6a4a10, 1).fillCircle(x, y, 3);
    if (on) fx.fillStyle(C.gold, 0.35).fillCircle(x, y, 7);
  };
  for (let x = 166; x <= 634; x += 18) bulb(x, 57);
  for (let y = 75; y <= 561; y += 18) bulb(637, y);
  for (let x = 634; x >= 166; x -= 18) bulb(x, 565);
  for (let y = 547; y >= 75; y -= 18) bulb(163, y);

  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i];
    p.vy += 500 * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.l -= dt * 1.4;
    if (p.l <= 0) { parts.splice(i, 1); continue; }
    fx.fillStyle(p.c, p.l).fillCircle(p.x, p.y, 2.5 * p.l + 1);
  }

  renderHud(ph, g, fx, t);
}

function renderHud(ph, g, fx, t) {
  const inGame = S.round && ph !== 'title' && ph !== 'board' && ph !== 'name';
  [T.info, T.info2].forEach((o) => o.setText(''));
  T.rc.forEach((o) => o.setVisible(ph === 'roulBet' || ph === 'roul'));
  T.pt.forEach((o) => o.setVisible(ph === 'slotsBet' || ph === 'slots'));
  T.bMini.setVisible(!!inGame);
  T.combo.setVisible(ph === 'boss' && S.combo > 0);
  if (!inGame) {
    T.ctrlL.setVisible(false);
    T.foot.setAlpha(0.6 + 0.4 * Math.sin(t * 5));
    return;
  }
  T.foot.setAlpha(0.6 + 0.4 * Math.sin(t * 5));
  if (S.chips !== S.lc) { T.chips.setScale(S.chips > (S.lc || 0) ? 1.35 : 1.15).setColor(HEX(S.chips > (S.lc || 0) ? C.gold : C.red)); S.lc = S.chips; }
  T.chips.setScale(Math.max(1, T.chips.scaleX - 0.02));
  if (T.chips.scaleX === 1) T.chips.setColor(HEX(C.neon));
  T.chips.setText(String(S.chips));
  T.round.setText(String(S.round));
  T.mult.setText('x' + S.mult);
  T.score.setText(String(S.score));
  T.bname.setText(S.boss[0]).setColor(HEX(S.boss[1]));
  T.bhp.setText(`HP ${S.hp}`);
  const am = bossAnim(S.bi, t, 0.25);
  T.bMini.setTexture((t % 2.9 < 0.12 ? 'bb' : 'b') + S.bi).setPosition(719 + am[0], 114 + am[1]).setAngle(am[4]);
  if (ph !== 'intro' && ph !== 'boss' && Math.random() < DT / 9) sayMini(TAUNT[S.bi]);
  fx.fillStyle(S.boss[1], 0.12).fillCircle(719, 114, 40);
  eyeGlow(fx, T.bMini.x, T.bMini.y, 2, t, T.bMini);
  // \u00bfalcanza para el boss?
  const ok = S.chips >= S.hp;
  T.bhp.setColor(HEX(ok ? C.neon : C.red));

  let l4a = '', l4 = '', help = '', ctrl = '';
  if (ph === 'intro') ctrl = '';
  else if (ph === 'plinko') {
    l4a = 'TIEMPO';
    l4 = Math.ceil(S.ptime) + 's';
    T.l4.setColor(HEX(S.ptime < 10 ? C.red : C.cyan));
    help = `CADA BOLA\nCUESTA ${BALL_COST}\n\nGU\u00cdA LAS BOLAS\nCON EL CURSOR\nHACIA LOS x15\n\nEL CENTRO\nPAGA x0`;
    ctrl = 'B1 LANZAR\n(MANTENER)\n\nJOYSTICK\nCURSOR\n\nB2 PULSO';
  } else if (ph === 'slotsBet' || ph === 'slots') {
    l4a = 'TIRADA';
    l4 = `${Math.min(3, (S.roll || 0) + 1)}/3`;
    T.l4.setColor(HEX(C.cyan));
    help = '3 IGUALES:\nVER TABLA\n\n2 IGUALES = x1\n\nFRENA CADA\nRODILLO A\nTIEMPO';
    if (ph === 'slotsBet') {
      const b = betOf(SLOT_BETS, S.betI);
      T.info.setText(b ? `APUESTA ${b} POR TIRADA  (${SLOT_BETS[S.betI] * 100}%)` : 'NO APOSTAR: PASAR');
      ctrl = '\u2191\u2193 APUESTA\n\nB1 OK';
    } else {
      T.info.setText(`APUESTA ${S.sbet} \u00b7 TIRADA ${Math.min(3, S.roll + 1)} DE 3`);
      ctrl = S.rs === 'ready' ? 'B1 GIRAR' : S.rs === 'spin' ? `B1 FRENAR\nRODILLO ${S.stopI + 1}` : '';
    }
    T.info.setY(450);
  } else if (ph === 'roulBet' || ph === 'roul') {
    l4a = 'COLOR';
    l4 = RNAME[S.col];
    T.l4.setColor(HEX(S.col === 2 ? 0x1fbf5a : S.col ? C.white : C.red));
    help = 'ROJO   x2\nNEGRO  x2\nVERDE  x14\n\nAL FRENAR LA\nRUEDA DA ~1\u00bc\nVUELTAS M\u00c1S';
    if (ph === 'roulBet') {
      const b = betOf(ROUL_BETS, S.rbI);
      T.info.setText(b ? `APUESTA ${b} (${ROUL_BETS[S.rbI] === 1 ? 'TODO' : ROUL_BETS[S.rbI] * 100 + '%'})` : 'NO APOSTAR: PASAR').setY(548);
      ctrl = '\u2190\u2192 COLOR\n\u2191\u2193 APUESTA\n\nB1 GIRAR';
    } else {
      T.info.setText(`APUESTA ${S.rbet} AL ${RNAME[S.col]}`).setY(548);
      ctrl = S.rs === 'spin' ? 'B1 FRENAR' : '';
    }
  } else if (ph === 'boss') {
    l4a = 'HP BOSS';
    l4 = String(S.hp);
    T.l4.setColor(HEX(C.red));
    help = 'CADA FICHA\n= 1 DE DA\u00d1O';
    T.info.setText(`${S.boss[0]}   \u00b7   HP ${S.hp} / ${S.maxHp}`).setY(380);
    T.info2.setText(`FICHAS: ${S.chips}`).setY(586);
  }
  T.l4a.setText(l4a);
  T.l4.setText(l4);
  T.help.setText(help);
  T.ctrl.setText(ctrl);
  T.ctrlL.setVisible(!!ctrl);
}

function drawBall(g, fx, x, y, col) {
  fx.fillStyle(col, 0.22).fillCircle(x, y, BR + 6);
  g.fillStyle(col, 1).fillCircle(x, y, BR);
  g.fillStyle(0xffffff, 1).fillCircle(x - 2, y - 2, 2);
}
