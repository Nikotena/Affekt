# --- 1) compila el juego (PixiJS + Vite) ---
FROM node:20-slim AS web
WORKDIR /app/Affekt_game
COPY Affekt_game/package.json Affekt_game/package-lock.json ./
RUN npm ci
COPY Affekt_game/ ./
RUN npx vite build

# --- 2) servidor: Python (solo libreria estandar) sirve el juego y /api ---
FROM python:3.12-slim
RUN useradd -m -u 1000 user
WORKDIR /app
COPY --chown=user Affekt_core/ ./Affekt_core/
COPY --chown=user Affekt_game/server/ ./Affekt_game/server/
COPY --from=web --chown=user /app/Affekt_game/dist ./Affekt_game/dist
USER user
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 \
    AFFEKT_HOST=0.0.0.0 PORT=7860 AFFEKT_TRUST_PROXY=1 \
    AFFEKT_FRAME_ANCESTORS="'self' https://affeck-demo.vercel.app http://localhost:* http://127.0.0.1:*" \
    AFFEKT_DAILY_LLM_CAP=1500 AFFEKT_SESSION_LLM_MAX=100 AFFEKT_IP_PER_MIN=120
# Modo por defecto: cada jugador pega su propia clave de AMD Token Factory (el servidor no guarda ninguna).
# Modo demo en vivo: en el panel de Render pon AFFEKT_BYOK=0 y AMD_API_KEY; vuelve a 1 para cerrarlo.
# Las claves son variables de entorno del servicio, nunca van en este archivo ni en el repositorio.
# Para incrustar el juego en la landing: AFFEKT_FRAME_ANCESTORS="'self' https://<dominio-de-la-landing>" en el panel de Render.
EXPOSE 7860
CMD ["python", "Affekt_game/server/server.py"]
