// Catálogo de decoración animada (capa 3). Cada tipo es un spritesheet en fila, un frame por celda.
// En el mapa: decor: [{ type, x, y, solid: [[dx, dy], ...] }]
//   x, y = casilla superior izquierda; solid = casillas (relativas) que bloquean el paso.
export const DECOR = {
  flags: { label: 'Flag', image: '/character/flags.png', frameW: 32, frameH: 48, frames: 5, fps: 6, solid: [[0, 2]] },
};

export const footprint = (d) => [Math.ceil(DECOR[d.type].frameW / 16), Math.ceil(DECOR[d.type].frameH / 16)];
