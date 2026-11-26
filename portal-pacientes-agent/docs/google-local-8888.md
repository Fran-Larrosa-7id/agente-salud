# Portal Pacientes local con Google y Drive

Si apareció `ERR_SQLITE_ERROR (14)`, ver [la corrección de UID/GID y los comandos de reconstrucción](sqlite-docker-fix.md). No regenerar `.env.google.local` ni eliminar volúmenes para corregirlo.

El backend implementa `GET /api/auth/google/start` y `GET /api/auth/google/callback`: código de autorización, PKCE S256, state de un solo uso ligado al navegador y nonce OIDC. Client Secret y tokens permanecen en el servidor; los tokens se cifran en SQLite. Login y consentimiento `drive.file` son pasos separados. No hay acceso piloto de respaldo dentro del modo Google.

Esta prueba usa otro proyecto Compose (`portal-google-local`), otro contenedor, otra imagen y otro volumen. El piloto conserva `.env.docker`, su contenedor y su volumen. No ejecutar estas instrucciones con el nombre del proyecto piloto. Las cuentas Google tienen catálogos, sesiones y cachés independientes; los datos anteriores del piloto no se asignan a ninguna cuenta.

## 1. Google Cloud

Para la primera configuración, verificá estos valores en el cliente de pruebas de **AGENTE-SALUD-7ID**.

1. Google Auth Platform → Clients → seleccionar el cliente **Aplicación web** ya creado.
2. Verificar que **Authorized redirect URIs** contenga exactamente `http://localhost:8888/api/auth/google/callback`. El callback debe coincidir con el origen, el puerto y la ruta que usa el Portal.
3. En Audience mantener Testing y agregar las dos cuentas de prueba a Test users.
4. En Data Access configurar `openid`, `email`, `profile` y `https://www.googleapis.com/auth/drive.file`. Drive API debe seguir habilitada. No solicitar acceso a todo Drive.
5. Guardar ID y secreto exclusivamente en el archivo privado que se prepara abajo. No poner el JSON descargado en el repositorio.

Google admite callbacks HTTP de localhost para pruebas. [Documentación del flujo de servidor](https://developers.google.com/identity/protocols/oauth2/web-server)

## 2. Windows: preparar sin reemplazar el piloto

Desde la raíz de este repositorio, con Node >=22.13 y Docker Desktop iniciado:

```powershell
if (!(Test-Path .env.google.local)) {
    node portal-pacientes-agent/scripts/init-google-local.mjs
    notepad .env.google.local
}
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

## 3. Primera importación de Pérez Cambet

1. En **http://localhost:8888**, elegí «Continuar con Google» con una cuenta de prueba autorizada.
2. En «Perfil», seleccioná «Conectar mi Google Drive» y completá el permiso. Confirmá que figure «Conectado».
3. En «Traer mis estudios», elegí Pérez Cambet, completá «Usuario o DNI» y «Contraseña», marcá la autorización y pulsá «Conectar y buscar estudios». Si aparece un desafío, elegí «Abrir navegador seguro» y completalo en el sitio del laboratorio.
4. Elegí un estudio autorizado. Cuando figure «Estudios guardados», comprobá el PDF en la biblioteca y en Google Drive. Una segunda búsqueda debe identificar el estudio como ya guardado.

El acceso de Google identifica al paciente. El permiso de Drive se concede por separado. El backend confirma la importación después de verificar la subida.

## 4. Pruebas sintéticas en el contenedor Linux

Usá la imagen construida en el paso 2. El contenedor de pruebas usa su propia red de loopback, omite el archivo privado y carece de acceso al volumen de pacientes.

```powershell
docker run --rm --network none --shm-size 1g --security-opt seccomp=portal-pacientes-agent/docker/seccomp_profile.json --entrypoint npm portal-google-local-portal run test:remote
```

## 5. Detener la prueba local

Para detener solo la prueba:

```powershell
docker compose --env-file .env.google.local -p portal-google-local stop portal
```

No usar `down -v`: el volumen contiene catálogo y credenciales cifradas. Respaldar el archivo privado y, con el contenedor detenido, copiar su DB con `docker compose --env-file .env.google.local -p portal-google-local cp portal:/var/lib/portal-data RUTA_PRIVADA_BACKUP`. Conservar claves y DB de la misma generación.
