# ============================================================
# We Ötzi · imagen de beta para el VPS (Easypanel / Docker Swarm)
#
# El CONTEXTO de build NO es la raíz del repo: es la salida de
#   node scripts/release/export-image-context.cjs --sha <sha> --out <dir>
# (la misma lista de archivos que publica el pipeline de Hostinger; nunca trae
# .env ni credenciales). Lo arma .github/workflows/publish-image.yml.
#
# Las variables secretas NO van en la imagen: el servicio monta
# /etc/weotzi/beta.env del host como /app/.env (dueño root, grupo 1000, 0440:
# «node» lo lee pero no puede escribirlo) y dotenv lo lee.
# Ver deployments/vps/README.md.
# ============================================================

# glibc (no Alpine): es la combinación con la que sharp 0.35.5 ya corre en beta.
# Base fijada por digest (índice multi-arquitectura de node:22-bookworm-slim al
# 2026-11-18). Para actualizarla: docker buildx imagetools inspect node:22-bookworm-slim
FROM node:22-bookworm-slim@sha256:e9f565d32859f0cbfb52125eafe8be39390f24dac302dc3cdf566e8ba3ab21ee AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

FROM node:22-bookworm-slim@sha256:e9f565d32859f0cbfb52125eafe8be39390f24dac302dc3cdf566e8ba3ab21ee
ARG RELEASE_COMMIT=""
ARG RELEASE_VERSION=""
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=4545 \
    TZ=UTC \
    NGROK_AUTOSTART=false \
    RELEASE_COMMIT=${RELEASE_COMMIT} \
    RELEASE_VERSION=${RELEASE_VERSION}
LABEL org.opencontainers.image.source="https://github.com/WeOtzi/betav1" \
      org.opencontainers.image.revision="${RELEASE_COMMIT}" \
      org.opencontainers.image.version="${RELEASE_VERSION}"
WORKDIR /app
# Archivos de la app y dependencias quedan de root (solo lectura para la app).
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# La app corre sin privilegios. No escribe en disco: el único intento es
# ensureCronApiToken() cuando falta CRON_API_TOKEN, y beta.env siempre lo trae.
USER node
EXPOSE 4545
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:4545/api/release').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "server.js"]
