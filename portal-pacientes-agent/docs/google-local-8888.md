# Primera prueba Google: AGENTE-SALUD-7ID, localhost:8888

Si apareció `ERR_SQLITE_ERROR (14)`, ver [la corrección de UID/GID y los comandos de reconstrucción](sqlite-docker-fix.md). No regenerar `.env.google.local` ni eliminar volúmenes para corregirlo.

El backend implementa `GET /api/auth/google/start` y `GET /api/auth/google/callback`: código de autorización, PKCE S256, state de un solo uso ligado al navegador y nonce OIDC. Client Secret y tokens permanecen en el servidor; los tokens se cifran en SQLite. Login y consentimiento `drive.file` son pasos separados. No hay acceso piloto de respaldo dentro del modo Google.

Esta prueba usa otro proyecto Compose (`portal-google-local`), otro contenedor, otra imagen y otro volumen. El piloto conserva `.env.docker`, su contenedor y su volumen. No ejecutar estas instrucciones con el nombre del proyecto piloto. Las cuentas Google tienen catálogos, sesiones y cachés independientes; los datos anteriores del piloto no se asignan a ninguna cuenta.

## 1. Google Cloud

En el proyecto existente **AGENTE-SALUD-7ID**:

1. Google Auth Platform → Clients → seleccionar el cliente **Aplicación web** ya creado.
2. Agregar a **Authorized redirect URIs** exactamente `http://localhost:8888/api/auth/google/callback`. Guardar. No usar `0.0.0.0`, `127.0.0.1`, `/#/`, slash final ni el puerto interno 8787. No hace falta agregar un origen JavaScript para este flujo de servidor.
3. En Audience mantener Testing y agregar las dos cuentas de prueba a Test users.
4. En Data Access configurar `openid`, `email`, `profile` y `https://www.googleapis.com/auth/drive.file`. Drive API debe seguir habilitada. No solicitar acceso a todo Drive.
5. Guardar ID y secreto exclusivamente en el archivo privado que se prepara abajo. No poner el JSON descargado en el repositorio.

Google admite callbacks HTTP de localhost para pruebas: [documentación del flujo de servidor](https://developers.google.com/identity/protocols/oauth2/web-server). El callback público de Ubuntu debe usar HTTPS.

## 2. Windows: preparar sin reemplazar el piloto

Desde la raíz de este repositorio, con Node >=22.13 y Docker Desktop iniciado:

```powershell
node portal-pacientes-agent/scripts/init-google-local.mjs
notepad .env.google.local
```

El generador crea claves aleatorias independientes, no las imprime y rechaza sobrescribir un archivo existente. Completar en el editor `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` y `GOOGLE_ALLOWED_EMAILS` (las cuentas de prueba separadas por coma). Conservar:

```dotenv
PORTAL_HTTP_PORT=8888
PORTAL_ENV_FILE=.env.google.local
NODE_ENV=development
AUTH_MODE=google
STORAGE_PROVIDER=google_drive
PUBLIC_BASE_URL=http://localhost:8888
GOOGLE_REDIRECT_URI=http://localhost:8888/api/auth/google/callback
DATABASE_PATH=/var/lib/portal-data/portal.sqlite
```

El archivo está ignorado por Git y excluido del contexto Docker. En Windows hereda los permisos del perfil de usuario: guardarlo en una carpeta privada. No ejecutar `docker compose config` sin filtros: puede mostrar secretos.

```powershell
docker compose --env-file .env.google.local -p portal-google-local config --quiet
docker compose --env-file .env.google.local -p portal-google-local up --build -d --wait portal
curl.exe --fail http://localhost:8888/health
```

Abrir **http://localhost:8888**. El puerto interno del servicio sigue siendo 8787; solo cambia el puerto del host. Usar siempre localhost para esta prueba, ya que las cookies y el callback están ligados a ese host. `NODE_ENV=development` permite únicamente este origen HTTP loopback; no desactiva la sandbox, seccomp, read_only ni el aislamiento de cuentas.

## 3. Ubuntu: probar al lado del piloto

Primero subir los cambios revisados al repositorio sin archivos privados. Sustituir `REVISION_REVISADA` por el hash de ese commit. No hacer pull/reset sobre las modificaciones locales del servidor.

```bash
cd ~/agente-salud
git status --short
umask 077
backup_dir="$HOME/portal-backups/$(date +%Y%m%d-%H%M%S)"
mkdir -p "$backup_dir"
chmod 700 "$HOME/portal-backups" "$backup_dir"
git rev-parse HEAD > "$backup_dir/revision.txt"
git diff --binary > "$backup_dir/local-changes.patch"
cp -p .env.docker "$backup_dir/env.docker"
cp -p portal-pacientes-agent/docker/seccomp_profile.json "$backup_dir/seccomp_profile.json"
git fetch origin
git worktree add --detach ../agente-salud-google-test REVISION_REVISADA
cd ../agente-salud-google-test
diff -u "$backup_dir/seccomp_profile.json" portal-pacientes-agent/docker/seccomp_profile.json
```

`diff` sale con código 1 cuando hay diferencias. Revisarlas antes de seguir. Mantener el perfil nuevo si ya contiene las correcciones y conservar cualquier restricción adicional del servidor. Si hace falta, integrar únicamente los ajustes locales revisados en el nuevo checkout: `openat2` permitido y `clone3` con ERRNO 38. No sobrescribir ciegamente el perfil nuevo con el viejo ni usar seccomp unconfined. El checkout y contenedor piloto siguen intactos.

Comprobar el perfil que usará la prueba:

```bash
python3 - <<'PY'
import json
from pathlib import Path
p = json.loads(Path('portal-pacientes-agent/docker/seccomp_profile.json').read_text())
assert any('openat2' in s['names'] and s['action'] == 'SCMP_ACT_ALLOW' for s in p['syscalls'])
assert any('clone3' in s['names'] and s['action'] == 'SCMP_ACT_ERRNO' and s.get('errnoRet') == 38 for s in p['syscalls'])
print('seccomp OK')
PY
```

Crear el archivo privado sin depender de Node instalado en el host:

```bash
python3 - <<'PY'
import os, secrets, base64
from pathlib import Path
text = Path('google-local.env.example').read_text()
text = text.replace('GENERATE_SESSION_SECRET', secrets.token_urlsafe(48))
text = text.replace('GENERATE_TOKEN_ENCRYPTION_KEY', base64.b64encode(secrets.token_bytes(32)).decode())
fd = os.open('.env.google.local', os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
with os.fdopen(fd, 'w') as f:
    f.write(text)
print('Configuración privada creada; completar credenciales con un editor.')
PY
nano .env.google.local
chmod 600 .env.google.local
ss -ltn '( sport = :8888 )'
```

Completar los mismos tres campos que en Windows. Si el puerto 8888 está ocupado, identificar el servicio y resolver la asignación antes de continuar; no detener contenedores ajenos. No regenerar claves si ya hay una DB de prueba con cuentas.

```bash
docker compose --env-file .env.google.local -p portal-google-local config --quiet
docker compose --env-file .env.google.local -p portal-google-local build portal
docker compose --env-file .env.google.local -p portal-google-local run --rm --no-deps --entrypoint npm portal run typecheck
docker compose --env-file .env.google.local -p portal-google-local run --rm --no-deps --entrypoint npm portal test
docker compose --env-file .env.google.local -p portal-google-local run --rm --no-deps --entrypoint npm portal run test:remote
docker compose --env-file .env.google.local -p portal-google-local up -d --no-deps --wait portal
curl --fail http://127.0.0.1:8888/health
```

En Windows abrir un túnel SSH al Ubuntu y mantener esa terminal abierta:

```powershell
ssh -N -L 8888:127.0.0.1:8888 USUARIO@SERVIDOR_UBUNTU
```

Después abrir **http://localhost:8888** en el navegador de Windows. El localhost del callback es el equipo del navegador: el túnel lo lleva al backend Ubuntu. No se abre 8888 a Internet ni se publican puertos noVNC auxiliares. Si ya hay un contenedor local usando ese puerto, detener solo esa prueba local o probar desde otro equipo.

## 4. Aceptación antes de cambiar el acceso actual

Con documentos ficticios, verificar: cuenta A → Google → conectar Drive → importar PDF y ZIP → archivo privado en su Drive → mismo listado en segundo navegador con A. En un contexto separado, B debe empezar vacío y no poder consultar, descargar, cancelar ni borrar datos de A. Probar logout, reinicio de este contenedor, reconexión de Drive y detección de login de las tres instituciones. Google Testing puede exigir reconectar Drive a los siete días.

Para detener solo la prueba:

```bash
docker compose --env-file .env.google.local -p portal-google-local stop portal
```

No usar `down -v`: el volumen contiene catálogo y credenciales cifradas. Respaldar el archivo privado y, con el contenedor detenido, copiar su DB con `docker compose --env-file .env.google.local -p portal-google-local cp portal:/var/lib/portal-data RUTA_PRIVADA_BACKUP`. Conservar claves y DB de la misma generación.

Una vez aceptada, configurar un origen HTTPS público estable, registrar también `https://TU_DOMINIO/api/auth/google/callback` en ese mismo cliente Google y ajustar `PUBLIC_BASE_URL`, `GOOGLE_REDIRECT_URI` y `NODE_ENV=production`. Las cookies serán Secure y noVNC usará WSS. Mantener el proyecto/volumen de la prueba para conservar sus cuentas; recrear solo su servicio y apuntar el proxy/ngrok a su puerto loopback. Las sesiones del origen localhost no se trasladan al dominio público: volver a ingresar. Mantener disponible el piloto hasta comprobar el acceso público. La [guía de operación](google-drive-alpha.md) detalla backups, rotación, restauración y rollback.
