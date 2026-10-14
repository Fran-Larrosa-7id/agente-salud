# Mismo origen y acceso HTTPS

El Portal y el agente se sirven desde Express en el mismo origen. El frontend obtiene API, SSE y descargas desde `window.location.origin`; ya no lee `pp_agent_url`. Una clave antigua se elimina sin tocar estudios, preferencias ni archivos de IndexedDB. El flujo funciona igual en `127.0.0.1:8787`, por un túnel en otro puerto y detrás de un proxy HTTPS.

Si el backend no responde, el Portal muestra el error de conexión, ofrece reintentar y limpia solamente la sesión local caducada. No habilita el ingreso de desarrollo por una falla de red. El modo sin contraseña solo existe cuando el backend responde explícitamente `enabled: false` (configuración local de desarrollo). Producción exige `PORTAL_AUTH_PASSWORD`.

## Proxy HTTPS

Configurá el proxy para:

- Enviar `Host` con el dominio público y `X-Forwarded-Proto: https`.
- Reenviar las solicitudes WebSocket y conservar el encabezado `Upgrade`.
- Permitir que las conexiones SSE permanezcan abiertas durante la importación.
- Enviar el tráfico HTTP del proxy a `http://127.0.0.1:8787` en el servidor.

El backend usa el esquema reenviado para marcar `Secure` las cookies del Portal y del navegador remoto. La comprobación de origen compara esquema y host, y la página noVNC limita su conexión WebSocket al mismo host (`wss` bajo HTTPS). El compose mantiene publicados únicamente `127.0.0.1:8787`; VNC y websockify permanecen internos.

Con un túnel SSH local no se necesita configuración extra:

```powershell
ssh -N -L 8888:127.0.0.1:8787 usuario@servidor
```

Abrí `http://localhost:8888`. Para HTTPS, usá el dominio configurado en el proxy.

## Actualizar Ubuntu conservando cambios locales de seccomp

El perfil versionado agrega `openat2` permitido y `clone3` con `SCMP_ACT_ERRNO` y `errnoRet: 38`. Antes de actualizar, hacé una copia completa del perfil local y del diff; no reemplaces el perfil a ciegas si tiene otras reglas propias.

```bash
cd ~/agente-salud
git status --short
git diff HEAD -- portal-pacientes-agent/docker/seccomp_profile.json > /tmp/seccomp_profile.local.patch
cp portal-pacientes-agent/docker/seccomp_profile.json /tmp/seccomp_profile.local.json
git fetch origin
git branch --show-current
```

Si Git informa cambios locales en ese archivo, el `pull` puede detenerse para evitar sobrescribirlos. Después de revisar que las dos copias temporales existen, restaurá solo el perfil versionado para que el avance fast-forward pueda instalar la versión nueva:

```bash
git restore --source=HEAD --staged --worktree -- portal-pacientes-agent/docker/seccomp_profile.json
git pull --ff-only
diff -u /tmp/seccomp_profile.local.json portal-pacientes-agent/docker/seccomp_profile.json || true
```

La última comparación es una revisión, no un comando para copiar el archivo viejo encima del nuevo. Confirmá que el perfil nuevo contiene una sola regla para cada llamada: `openat2` en `SCMP_ACT_ALLOW` y `clone3` en `SCMP_ACT_ERRNO` con `errnoRet: 38`. Si la copia anterior tenía otras personalizaciones, incorporá esas reglas manualmente al perfil nuevo y conservá las dos reglas anteriores. No uses `git reset --hard` ni copies el perfil viejo entero encima del nuevo.

Validá el perfil y el compose, y reconstruí solo el servicio Portal:

```bash
python3 -m json.tool portal-pacientes-agent/docker/seccomp_profile.json >/dev/null
docker compose config -q
docker compose build portal
docker compose up -d --no-deps --force-recreate portal
docker compose ps portal
curl -fsS http://127.0.0.1:8787/health
```

No hace falta editar ni compartir `.env.docker`; el puerto publicado y las demás protecciones del contenedor permanecen iguales.
