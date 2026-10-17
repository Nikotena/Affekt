# Affekt: the demo of Affekt Core

This repository is the playable demo (Affekt Town) and the engine it runs on. **The product is Affekt Core**, the engine: standalone code is at [Nikotena/Affekt_core](https://github.com/Nikotena/Affekt_core/), and a copy lives here in `Affekt_core`.

**NPCs that feel and remember.** Affekt Core is a narrative engine that gives game characters an emotional state, a three-layer memory and awareness of their world, so they answer players in character without inventing facts. Built for the **AMD Developer Hackathon: ACT III** (Track 4, Vibe Generation).

- **Play it:** https://affekt-demo.vercel.app/ (opens the full game on Render)
- **Engine only:** [Nikotena/Affekt_core](https://github.com/Nikotena/Affekt_core/) (the standalone core)
- **Engine docs (in this repo):** [Affekt_core/README.md](Affekt_core/README.md), [AMD usage](Affekt_core/docs/amd.md), [evaluation](Affekt_core/docs/evaluation.md)

## How it works: 80% code, 20% model

Plain, deterministic code decides what an NPC feels, remembers, knows and offers. The language model only phrases the final line, and it never changes game state. A price guard replaces any price in the model's reply that differs from the engine's, and if the model is unreachable the NPC answers with a canned line for its mood.

- 4D emotional state per NPC (valence, initiative, stress, inertia) that decides the mood
- Short, medium and long-term memory with consolidation and forgetting
- Free-text understanding (intent, tone, offered price, item) with a rule-based parser
- Time of day: NPCs greet according to the player's local hour
- Standard library only for the engine, the tests and the AMD client

## AMD

Lines are written by **Gemma-4-31B-IT served on AMD GPUs through AMD Token Factory**. If the model fails or is slow, the character answers with a fallback line for its mood so the game keeps going.

## Bring your own key

The public demo does not ship a model key. Paste your own **AMD Token Factory API key** on the start screen:

- it lives only in that browser tab's memory, is never written to storage, logs or the session file;
- it is sent over HTTPS in the `X-AMD-Key` header, used for that one request and discarded.

You can **save your session** (every character's mood and memory, never your key) as a JSON file and **load it again** later, even from another browser.

## Run it locally

```bash
cd Affekt_game
npm ci && npm run build
python server/server.py            # http://127.0.0.1:7860 (asks for a key on the start screen)
```

For local development with a key from `Affekt_core/.env` (`AMD_API_KEY=...`), run the server with `AFFEKT_BYOK=0`.

Tests (standard library only): `cd Affekt_core && python -m unittest discover -s test -p "test_*.py"`

## Deploy

`Dockerfile` and `render.yaml` run the game and the API from a single service. Keys are environment variables of the service and never live in this repository. `AFFEKT_BYOK=1` (default) asks every player for their own key; `AFFEKT_BYOK=0` uses the server's key (`AMD_API_KEY`) for a live demo.

## Server hardening

Signed session ids, per-session and per-IP rate limits, request size caps, strict validation of session files, CSP with `frame-ancestors` and no CORS by default.

## Credits

The music, sprites and tilesets are CC0 (public domain) assets from [OpenGameArt](https://opengameart.org/).

## License

MIT, see [LICENSE](LICENSE).
