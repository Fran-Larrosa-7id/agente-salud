# Build the project's isolated benchmark image first; never use a running container.
FROM portal-fps-benchmark:local
USER root
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl openssl libnss3-tools ffmpeg x11-utils procps \
    && curl --fail --location --proto '=https' --tlsv1.2 \
      https://github.com/kasmtech/KasmVNC/releases/download/v1.5.2/kasmvncserver_ubuntu_noble_1.5.2_amd64.deb \
      -o /tmp/kasmvnc.deb \
    && echo '89a5d1fbe9e032b122202be158a2b25f15c97e0a5b8dcf92a5e6835c7b7b2acd  /tmp/kasmvnc.deb' | sha256sum -c - \
    && apt-get install -y --no-install-recommends /tmp/kasmvnc.deb \
    && rm /tmp/kasmvnc.deb && rm -rf /var/lib/apt/lists/*
COPY portal-pacientes-agent/scripts/remote-poc /app/portal-pacientes-agent/scripts/remote-poc
USER 1000:1000
ENTRYPOINT ["node", "--import", "tsx", "scripts/remote-poc/run.mjs"]
