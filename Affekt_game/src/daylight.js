// Hora local del jugador y filtro de luz del pueblo: noche oscura, amanecer y atardecer anaranjados.
// ?hour=22 (o 6.5) fuerza la hora, util para probar y para grabar el video a cualquier "hora".

const forced = Number(new URLSearchParams(location.search).get('hour'));
const HAS_FORCED = new URLSearchParams(location.search).has('hour') && Number.isFinite(forced);

/** Hora local en horas decimales (0 a 24), o la forzada con ?hour= */
export function currentHour() {
  if (HAS_FORCED) return ((forced % 24) + 24) % 24;
  const d = new Date();
  return d.getHours() + d.getMinutes() / 60;
}

export function partOfDay(h) {
  if (h < 5 || h >= 22) return 'night';
  return h < 12 ? 'morning' : h < 18 ? 'afternoon' : 'evening';
}

// [hora, [r, g, b], opacidad]: se interpola entre puntos; 24 repite la medianoche
const KEYS = [
  [0, [12, 16, 48], 0.55],
  [4.5, [12, 16, 48], 0.55],
  [5.5, [255, 120, 30], 0.42],  // amanecer
  [7.5, [255, 150, 50], 0.26],
  [9, [255, 190, 100], 0],      // dia
  [16, [255, 190, 100], 0],
  [17.5, [255, 130, 30], 0.34], // atardecer
  [19, [255, 100, 20], 0.44],
  [20.5, [30, 20, 70], 0.5],
  [22, [12, 16, 48], 0.55],
  [24, [12, 16, 48], 0.55],
];

/** Color (0xRRGGBB) y opacidad del filtro para una hora */
export function lightAt(h) {
  h = ((h % 24) + 24) % 24;
  for (let i = 1; i < KEYS.length; i++) {
    const [h1, c1, a1] = KEYS[i];
    if (h <= h1) {
      const [h0, c0, a0] = KEYS[i - 1];
      const t = h1 === h0 ? 0 : (h - h0) / (h1 - h0);
      const mix = (k) => Math.round(c0[k] + (c1[k] - c0[k]) * t);
      return { color: (mix(0) << 16) | (mix(1) << 8) | mix(2), alpha: a0 + (a1 - a0) * t };
    }
  }
  return { color: 0x0c1030, alpha: 0.55 };
}

export function clockLabel(h) {
  const hh = Math.floor(h), mm = Math.floor((h - hh) * 60);
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')} · ${partOfDay(h)}`;
}
