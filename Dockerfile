FROM mcr.microsoft.com/playwright:v1.55.1-noble
RUN apt-get update && apt-get install -y --no-install-recommends x11vnc novnc websockify && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
    HOST=0.0.0.0 PORT=8787 HEADLESS=false CHROMIUM_SANDBOX=true \
    LLM_PROVIDER=rules MAX_CONCURRENT_JOBS=1 TMP_DIR=/var/lib/portal/import-jobs
WORKDIR /app/portal-pacientes-agent
COPY portal-pacientes-agent/package.json portal-pacientes-agent/package-lock.json ./
# tsx es necesario para el servidor TypeScript; los tests se ejecutan en esta misma imagen.
RUN npm ci --include=dev && npm cache clean --force
COPY portal-pacientes-agent/src ./src
COPY portal-pacientes-agent/test ./test
COPY portal-pacientes-agent/scripts ./scripts
COPY portal-pacientes-agent/tsconfig.json ./
COPY portal-pacientes/index.html /app/portal-pacientes/index.html
COPY portal-pacientes/js /app/portal-pacientes/js
COPY portal-pacientes/css /app/portal-pacientes/css
RUN npm run typecheck && mkdir -p /var/lib/portal/import-jobs && chown -R pwuser:pwuser /var/lib/portal
USER pwuser
EXPOSE 8787
# El escritorio se transmite por el backend solo durante login/intervención del job autorizado.
CMD ["xvfb-run", "-a", "--server-args=-screen 0 1280x900x24 -nolisten tcp", "node", "--import", "tsx", "src/server/index.ts"]
