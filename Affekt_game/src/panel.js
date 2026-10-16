// Panel de depuración (DOM): vector 4D, payload para el LLM y memoria del NPC.
const $ = (id) => document.getElementById(id);

function bar(id, valueId, v, signed) {
  $(valueId).textContent = v.toFixed(2);
  const el = $(id);
  if (signed) {
    el.style.left = `${50 + Math.min(0, v) * 50}%`;
    el.style.width = `${Math.abs(v) * 50}%`;
  } else {
    el.style.left = '0';
    el.style.width = `${v * 100}%`;
  }
}

export function updatePanel(npc, payload, meta) {
  const v = npc.vector;
  $('npcname').textContent = `${npc.name} · mood: ${npc.mood}`;
  bar('bx', 'vx', v.affective_valence, true);
  bar('by', 'vy', v.initiative_dominance, true);
  bar('bz', 'vz', v.stress_tension, false);
  bar('bw', 'vw', v.temporal_inertia, false);
  if (meta) {
    const bits = [`intent: ${meta.intent}`, meta.offer != null ? `offer: ${meta.offer}` : '',
      `LLM: ${meta.provider ?? (meta.llm_used ? 'yes' : 'no (canned line)')}`, meta.price_guard !== 'not_checked' ? `price: ${meta.price_guard}` : ''];
    $('meta').textContent = bits.filter(Boolean).join(' · ');
  }
  if (payload) $('payload').textContent = payload.join('\n');
  $('memory').textContent = npc.memory.length ? npc.memory.map((m) => `• ${m}`).join('\n') : '—';
}

export function setOnline(on) {
  const s = $('status');
  s.textContent = on ? 'online' : 'offline';
  s.className = on ? 'on' : 'off';
}
