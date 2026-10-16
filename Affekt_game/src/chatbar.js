// Barra de chat para pantallas tactiles: frases rapidas + campo de texto + enviar + salir.
// En un telefono no hay teclado fisico, asi que el movil escribe aqui y main.js refleja el texto en la caja del juego.
// Solo se muestra con body.touch (puntero tactil); con teclado se usa la caja del propio juego.
const bar = document.getElementById('chatbar');
const form = document.getElementById('chatform');
const field = document.getElementById('chat');
const chips = document.getElementById('chips');
const reply = document.getElementById('reply');

const PHRASES = [
  'Hello!',
  'How much for a healing potion?',
  'Any news about the quest?',
  'Thank you, you are very kind!',
  'You are a greedy thief!',
];

const emit = (name, detail) => document.dispatchEvent(new CustomEvent(name, { detail }));

function send(text) {
  if (document.body.dataset.busy === '1' || !text.trim()) return; // una respuesta a la vez
  field.value = '';
  emit('chat-send', text);
}

for (const phrase of PHRASES) {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = phrase;
  b.addEventListener('click', () => send(phrase));
  chips.appendChild(b);
}

form.addEventListener('submit', (e) => {
  e.preventDefault();
  send(field.value);
});
field.addEventListener('input', () => emit('chat-typing', field.value));
field.addEventListener('keydown', (e) => { if (e.key === 'Escape') emit('chat-leave'); });
document.getElementById('chat-leave').addEventListener('click', () => emit('chat-leave'));

// Ultima linea del NPC, visible junto al campo de texto aunque el mapa no se vea
document.addEventListener('npc-line', (e) => {
  spin(false);
  reply.textContent = `${e.detail.name}: ${e.detail.text}`;
});

// Spinner de espera (los mismos fotogramas que usa el juego): se anima mientras el NPC piensa
const spinImg = document.getElementById('reply-spin');
let spinTimer = 0;
function spin(on) {
  spinImg.hidden = !on;
  window.clearInterval(spinTimer);
  if (on) {
    let i = 0;
    spinTimer = window.setInterval(() => { spinImg.src = `/loading/loading${(i++ % 7) + 1}.png`; }, 110);
  }
}
document.addEventListener('npc-thinking', (e) => {
  spin(e.detail.on);
  if (e.detail.on) reply.textContent = `${e.detail.name} is thinking…`;
});

document.addEventListener('talk-state', (e) => {
  reply.textContent = '';
  spin(false);
  if (!document.body.classList.contains('touch')) return;
  bar.hidden = !e.detail.open;
  if (e.detail.open) field.value = ''; // no se enfoca solo: el teclado del movil taparia el dialogo
  else field.blur();
});
