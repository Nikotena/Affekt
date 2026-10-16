import { Assets, Container, Rectangle, Sprite, Texture } from 'pixi.js';

// public/textbox/font.png (240x144): fuente en celdas de 8 px de ancho + caja de diálogo.
//  - letras: celdas 8x16, pares Aa Bb ... Mm (fila 0) y Nn ... Zz (fila 1)
//  - signos: fila y=32, celdas 8x16: . , ! ¡ ? ¿ # _ - ♥ : ; ' "
//  - dígitos: celdas 8x8 en las columnas 27-29 (0 1 2 / 3 4 5 / 6 7 8 / 9 en la col. 28)
// No tiene tildes ni ñ: se dibujan sin acento (á -> a, ñ -> n).
const CELL = 8;
export const BOX = { x: 0, y: 48, w: 240, h: 72 };
const PUNCT = ['.', ',', '!', '¡', '?', '¿', '#', '_', '-', '♥', ':', ';', "'", '"'];

let glyphs = null; // char -> { tex, w }
let boxTexture = null;

export async function loadTextbox() {
  if (glyphs) return;
  const sheet = await Assets.load('/textbox/font.png');
  sheet.source.scaleMode = 'nearest';

  // lee los píxeles para medir el ancho real de cada glifo (fuente proporcional)
  const img = sheet.source.resource;
  const cv = document.createElement('canvas');
  cv.width = img.width;
  cv.height = img.height;
  const cx = cv.getContext('2d', { willReadFrequently: true });
  cx.drawImage(img, 0, 0);
  const data = cx.getImageData(0, 0, cv.width, cv.height).data;

  glyphs = new Map();
  const add = (ch, col, y, h) => {
    let min = CELL, max = -1;
    for (let x = 0; x < CELL; x++) {
      for (let yy = 0; yy < h; yy++) {
        if (data[((y + yy) * cv.width + col * CELL + x) * 4 + 3] > 0) { min = Math.min(min, x); max = Math.max(max, x); }
      }
    }
    if (max < 0) return;
    const w = max - min + 1;
    glyphs.set(ch, { w, tex: new Texture({ source: sheet.source, frame: new Rectangle(col * CELL + min, y, w, h) }) });
  };
  for (let i = 0; i < 26; i++) {
    const y = (i < 13 ? 0 : 1) * 16;
    const col = (i % 13) * 2;
    add(String.fromCharCode(65 + i), col, y, 16);
    add(String.fromCharCode(97 + i), col + 1, y, 16);
  }
  PUNCT.forEach((ch, i) => add(ch, i, 32, 16));
  for (let d = 0; d <= 8; d++) add(String(d), 27 + (d % 3), Math.floor(d / 3) * 8, 8);
  add('9', 28, 24, 8);

  boxTexture = new Texture({ source: sheet.source, frame: new Rectangle(BOX.x, BOX.y, BOX.w, BOX.h) });
}

export const makeBox = () => new Sprite(boxTexture);

function normalize(s) {
  return s
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[—–]/g, '-').replace(/…/g, '...').replace(/[“”«»]/g, '"').replace(/[‘’]/g, "'");
}

// Texto con la fuente del PNG. `reveal(n)` muestra los primeros n caracteres (efecto máquina de escribir).
export class PixelText extends Container {
  constructor({ scale = 2, maxWidth = Infinity, lineHeight = 12 } = {}) {
    super();
    this.scale_ = scale;
    this.maxWidth = maxWidth;
    this.lineHeight = lineHeight;
    this.length = 0;
    this.lines = 0;
  }

  setText(text) {
    for (const c of this.removeChildren()) c.destroy();
    const s = normalize(text);
    const k = this.scale_;
    const adv = (ch) => (ch === ' ' ? 4 : (glyphs.get(ch)?.w ?? 0) + 1) * k;
    let x = 0, line = 0, idx = 0;
    const newline = () => { x = 0; line++; };

    for (const para of s.split('\n')) {
      for (const word of para.split(/(?<= )/)) { // palabras con su espacio final
        const w = [...word].reduce((a, ch) => a + adv(ch), 0);
        if (x > 0 && x + w - adv(' ') > this.maxWidth) newline();
        for (const ch of word) {
          const g = glyphs.get(ch);
          if (g) {
            const sp = new Sprite(g.tex);
            sp.scale.set(k);
            sp.position.set(x, line * this.lineHeight * k);
            sp.charIdx = idx;
            this.addChild(sp);
          }
          x += adv(ch);
          idx++;
        }
      }
      newline();
      idx++;
    }
    this.length = idx;
    this.lines = line;
    return this;
  }

  reveal(n) {
    for (const sp of this.children) sp.visible = sp.charIdx < n;
  }
}
