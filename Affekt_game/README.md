# Affekt Game

Pueblo RPG en PixiJS que usa **Affekt_core (Affekt)** para hablar con los NPC.

```bash
npm install
npm run server   # puente Python <-> Affekt_core, puerto 8765
npm run dev      # juego en http://localhost:5173  (editor de mapas: /editor.html)
```

## Conversación con el core
- `E` junto a un NPC abre el diálogo; se **escribe texto libre en inglés** (el parser del core entiende inglés) y `Enter` lo envía.
- `server/server.py` llama a `AffektEngine.process_action(npc_id, texto)`: el core calcula emoción 4D, memoria y
  contexto, y redacta la línea (LLM si está disponible; si no, una línea fija según el humor).
- El panel de la derecha muestra el vector 4D, intención, si se usó el LLM, el chequeo de precio, el payload y la memoria.

## Clave propia (BYOK) y sesiones guardadas
Por defecto el servidor no tiene ninguna clave de modelo: la pantalla de inicio pide la clave de AMD Token Factory del jugador,
que solo vive en la memoria de la pestana y viaja en la cabecera `X-AMD-Key`. Con `AFFEKT_BYOK=0` el servidor usa su propia
`AMD_API_KEY` (demo en vivo, desarrollo). Los botones "Save session" / "Load session" descargan y restauran el estado de los
personajes (nunca la clave).

## LLM
El modelo es **Gemma 4 (Gemma-4-31B-IT) en AMD Token Factory**. Si falla o tarda mas de `AFFEKT_LLM_TIMEOUT` segundos, el NPC
responde con su linea fija segun el humor. El panel indica que proveedor escribio
cada linea (`LLM: AMD Token Factory · Gemma-4-31B-IT`).

| Variable | Efecto |
|---|---|
| `AFFEKT_LLM_TIMEOUT=25` | segundos que se espera al modelo en cada intento |
| `AFFEKT_AMD_MODEL=<modelo>` | modelo de AMD Token Factory (por defecto `Gemma-4-31B-IT`) |
