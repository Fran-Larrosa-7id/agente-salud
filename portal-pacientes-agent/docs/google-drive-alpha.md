# Google Login y Drive personal — alpha privada

Esta función se implementa sobre el Portal existente. No queda habilitada hasta configurar Google Cloud y elegir ambos flags. No requiere un proveedor de IA. Los extractores de Pérez Cambet, Centro DM y RDC Chacabuco no se modifican.

Resultados y pendientes comprobados: [reporte de QA](google-drive-alpha-qa.md).

## Diseño y migración

- `AUTH_MODE=pilot`, `STORAGE_PROVIDER=local`: conserva el acceso piloto y la persistencia en el navegador. Estos son los valores por defecto para instalaciones existentes.
- `AUTH_MODE=google`, `STORAGE_PROVIDER=google_drive`: identidad real, sesión propia, catálogo persistente y originales en el Drive personal. El endpoint de contraseña del piloto queda deshabilitado. Un fallo OAuth/red nunca habilita el piloto.
- `AUTH_MODE=google` con almacenamiento local solo se admite en desarrollo; producción exige Drive. Drive nunca se habilita con identidad piloto.
- OAuth de servidor con PKCE S256, state aleatorio de un uso ligado a cookie temporal, nonce y verificación RS256 con claves públicas de Google. Se validan firma, audiencia, emisor, vencimiento, nonce y email verificado. La identidad interna deriva de `sub`; el email solo se usa para presentación/allowlist.
- El login pide exclusivamente `openid email profile`. Conectar Drive es otra autorización con `drive.file`, acceso offline y consentimiento explícito. No se pide acceso completo al Drive ni se usan service accounts.
- No se incorporaron dependencias: OAuth usa fetch/crypto de Node y destinos fijos; SQLite usa `node:sqlite` incluido en Node >=22.13. La construcción Docker comprueba que SQLite puede arrancar. No hay un binding SQLite descargado que exija otra arquitectura/CPU. La prueba efectiva en el Athlon sigue siendo necesaria antes de habilitar datos reales.
- Tokens y URLs reanudables se cifran AES-256-GCM, con IV aleatorio y contexto por dueño y finalidad. Sesiones opacas de 8 horas se guardan como HMAC; las cookies son HttpOnly, Lax y Secure con el origen HTTPS configurado. Estados OAuth duran 10 minutos y están cifrados.
- En modo Google, `PUBLIC_BASE_URL` determina redirects, origen CSRF y WS/WSS. No se confía en Host/X-Forwarded-* para sustituirlo. El proxy/ngrok debe conservar el host público del navegador. Las mutaciones exigen el Origin exacto; API, SSE, archivo temporal, catálogo, escritorio y WebSocket comprueban dueño. Sesiones revocadas dejan de recibir eventos; sockets se revisan al conectar, tras el upgrade y periódicamente.
- Cada job tiene dueño privado. El cierre de sesión cancela solo sus jobs. Se conserva el límite global de un job; otro paciente recibe `IMPORT_BUSY`, sin ID, institución ni identidad del trabajo ocupado.

`StorageProvider` distingue persistencia local por ack del navegador de persistencia remota verificada. El runner/extractor sigue produciendo los mismos archivos temporales. En Drive, el servidor verifica el SHA-256 local mediante streaming, sube chunks de hasta 8 MiB y verifica con files.get tamaño, MIME, propiedades y MD5 cuando Google lo ofrece (no se confunde MD5 con SHA-256). Solo después del commit del catálogo el manager acusa persistencia y emite COMPLETED. El ack enviado por el navegador no puede confirmar archivos en modo Drive.

Los reintentos reutilizan un ID remoto preasignado y la sesión reanudable cifrada. Tras respuesta perdida se consulta el offset recibido antes de continuar. Hay backoff acotado para 429/5xx. `invalid_grant` exige reconexión; cuota llena y fallas temporales mantienen el job en IMPORTING con error recuperable hasta el TTL, sin anunciar éxito. No se agregan temporizadores de progreso ficticios. Se conservan los límites existentes por archivo, de descargas por job y de tmpfs; para varios ZIP grandes conviene importarlos en trabajos separados porque el tmpfs total sigue siendo 1 GiB.

La deduplicación de bytes es por paciente y SHA-256. Dos referencias de estudios pueden compartir un original remoto conservando su proveedor y clave de origen. Una versión con bytes distintos conserva su propia referencia. Las propiedades privadas de Drive solo contienen identificadores opacos, formato, hash, clave de origen y proveedor; no nombres personales, protocolos, diagnósticos ni resultados. Los nombres son `estudio-<id>.pdf/.zip`. Nunca se crean permisos públicos. Si la carpeta anterior está compartida o eliminada se utiliza/crea otra carpeta privada en Mi unidad.

## Google Cloud: configuración manual

1. Usar el proyecto existente **AGENTE-SALUD-7ID**. No es necesario modificar DNS ni contratar almacenamiento administrado. Para la primera prueba en `http://localhost:8888` seguir [la guía de prueba aislada](google-local-8888.md), que conserva el piloto actual y sus modificaciones locales.
2. En Google Auth Platform, configurar Branding (nombre y contacto) y Audience **External / Testing**. No publicar como producto general.
3. Agregar las cuentas autorizadas en Test users. Esta lista es de Google; `GOOGLE_ALLOWED_EMAILS` / `GOOGLE_ALLOWED_SUBS` son filtros adicionales del backend. Si se configuran ambos, deben cumplirse ambos. Una allowlist vacía permite las cuentas admitidas por el proyecto OAuth; para esta alpha privada conviene definirla explícitamente.
4. Habilitar **Google Drive API** en el proyecto.
5. Crear un OAuth Client ID de tipo **Web application**. Registrar exactamente `https://DOMINIO-ASIGNADO.ngrok-free.dev/api/auth/google/callback` como Authorized redirect URI. No lleva fragmento `#`, parámetros ni slash final. El flujo de servidor no requiere un cliente JavaScript ni secretos en HTML.
6. Configurar los scopes básicos y `https://www.googleapis.com/auth/drive.file`. El login no pide Drive. El botón del perfil agrega Drive con consentimiento separado.
7. Guardar Client ID/Secret en el Ubuntu mediante un archivo privado. No pegarlos en un chat, commit, captura o salida de logs. No copiar el .env de `agent-openai` ni credenciales del laboratorio.
8. Con datos ficticios, probar cuenta A, conectar Drive, PDF, ZIP, segundo navegador, cuenta B sin acceso a A, logout, desconexión y reconexión. Verificar la carpeta en el Drive personal de A y el hash de los originales descargados.

Google Testing puede hacer vencer la autorización con Drive y su refresh token a los siete días; la aplicación mostrará Reconectar Drive. No se promete autorización permanente mientras el proyecto permanezca en Testing. Si cambia la URL de ngrok hay que actualizar PUBLIC_BASE_URL, GOOGLE_REDIRECT_URI y la URI autorizada en Google Cloud, y recrear solo portal. Los jobs interactivos anteriores no se trasladan a otro origen.

Referencias oficiales: [flujo de servidor](https://developers.google.com/identity/protocols/oauth2/web-server), [OIDC y validación](https://developers.google.com/identity/openid-connect/openid-connect), [scopes de Drive](https://developers.google.com/workspace/drive/api/guides/api-specific-auth), [uploads reanudables](https://developers.google.com/workspace/drive/api/guides/manage-uploads), [búsquedas](https://developers.google.com/workspace/drive/api/guides/search-files), [appProperties](https://developers.google.com/workspace/drive/api/guides/properties), [Testing y vencimiento](https://support.google.com/cloud/answer/15549945?hl=en), [SQLite de Node](https://nodejs.org/download/release/latest-jod/docs/api/sqlite.html).

## Variables y claves

Los nombres finales están en los dos `.env.example`. Para Ubuntu:

```dotenv
AUTH_MODE=google
STORAGE_PROVIDER=google_drive
PUBLIC_BASE_URL=https://DOMINIO-ASIGNADO.ngrok-free.dev
GOOGLE_CLIENT_ID=COMPLETAR_EN_PRIVADO
GOOGLE_CLIENT_SECRET=COMPLETAR_EN_PRIVADO
GOOGLE_REDIRECT_URI=https://DOMINIO-ASIGNADO.ngrok-free.dev/api/auth/google/callback
SESSION_SECRET=GENERAR_EN_PRIVADO
TOKEN_ENCRYPTION_KEY=GENERAR_32_BYTES_BASE64
GOOGLE_ALLOWED_EMAILS=CUENTAS_DE_PRUEBA_SEPARADAS_POR_COMA
GOOGLE_ALLOWED_SUBS=
DATABASE_PATH=/var/lib/portal-data/portal.sqlite
LLM_PROVIDER=rules
MAX_CONCURRENT_JOBS=1
REMOTE_LOGIN=true
```

La configuración inválida impide el arranque. En producción se exige HTTPS y la DB dentro de `/var/lib/portal-data/`, volumen privado separado de los documentos temporales. No debe quedar una ruta de DB en /tmp, /home/pwuser ni /var/lib/portal/import-jobs. En desarrollo local se permite HTTP exclusivamente para localhost/127.0.0.1, con redirect exacto registrado aparte, DB absoluta privada y Node >=22.13.

Para generar dos claves independientes en Ubuntu sin mostrarlas en terminal:

```bash
umask 077
python3 - <<'PY'
import os, secrets, base64
from pathlib import Path
folder = Path.home() / '.config' / 'portal-pacientes'
folder.mkdir(parents=True, exist_ok=True, mode=0o700)
target = folder / 'generated-secrets.env'
fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
with os.fdopen(fd, 'w') as out:
    out.write('SESSION_SECRET=' + secrets.token_urlsafe(48) + '\n')
    out.write('TOKEN_ENCRYPTION_KEY=' + base64.b64encode(secrets.token_bytes(32)).decode() + '\n')
print('Claves creadas en un archivo privado; no compartir su contenido.')
PY
```

Con un editor local, incorporar esas claves y los datos OAuth a `.env.docker`, conservando las demás opciones existentes. Aplicar `chmod 600 .env.docker`. Mantener copia privada del archivo de claves fuera de Git y del servidor público. El archivo generado usa creación exclusiva: no sobrescribe claves anteriores.

## DB, sesiones, recuperación y datos locales

El esquema versión 1 se crea transaccionalmente y se registra en `schema_migrations`. Las tablas son `users`, `sessions`, `oauth_states`, `google_drive_connections`, `studies` y `file_uploads`; hay claves foráneas e índices/constraints por dueño, sub, identidad de estudio y hash. SQLite usa WAL y busy_timeout. No contiene PDFs, ZIP, contraseñas de laboratorios, capturas ni resultados extraídos.

El directorio del volumen se prepara para UID 1000, modo 0700; el archivo DB usa 0600 y el proceso umask 077. La raíz read-only, cap_drop, no-new-privileges, seccomp, tmpfs, shm y el puerto loopback permanecen. No publicar puertos VNC/WebSocket auxiliares. El único volumen nuevo es `portal-data`.

Los jobs que todavía necesitan el navegador no se reanudan después de reiniciar el contenedor: el contexto Playwright desaparece. Una vez terminadas las descargas y validaciones, el guardado en Drive dispone de un checkpoint temporal privado en `pending-imports/` del volumen persistente. Conserva el mismo job, propietario y originales solo hasta su TTL original, y permite retomar almacenamiento desde la URL del job, sin restaurar credenciales institucionales ni redescargar. Los estudios confirmados y sesiones vigentes sí se conservan. Un upload interrumpido conserva su ID/sesión cifrada; si Drive la expiró se inicia otra con el mismo ID reservado. La cola se limpia al confirmar/cancelar/vencer; un backup completo del volumen puede incluir estos originales pendientes y debe protegerse como tal. No se presenta un archivo incompleto como guardado. Ver [diagnóstico y aceptación de subidas](drive-upload-fix.md).

Para reconstruir un catálogo perdido: restaurar primero una copia válida de DB si existe. Si no existe, iniciar una DB nueva con el mismo proyecto OAuth, ingresar con la cuenta del paciente, volver a conectar Drive y tocar **Actualizar mis estudios**. La consulta pagina exclusivamente archivos de esta app y de esa identidad mediante appProperties; no recorre todo el Drive. Recupera referencias mínimas, formato, tamaño y hash. No puede reconstruir títulos/fechas que solo estaban en la DB ni todas las referencias alternativas que compartían los mismos bytes. No inventa datos faltantes. La búsqueda puede retrasarse al indexar: un archivo ausente en el listado se comprueba directamente antes de marcarlo como perdido.

En Google, localStorage/IndexedDB se particionan por identidad opaca. A→B→A mantiene espacios distintos; los datos en memoria se vacían al salir/cambiar y las pestañas se revalidan. El contenido previo del piloto no se asigna a la primera cuenta Google. Se preserva en el espacio legacy y solo vuelve a consultarse al habilitar deliberadamente el modo piloto. **La migración de originales legacy a una cuenta Google queda fuera de esta versión**: requiere un flujo de titularidad/confirmación explícita. No se borran ni se suben silenciosamente.

El perfil explica que medicamentos, alergias, vacunas y preferencias siguen siendo locales por cuenta/dispositivo. Solamente se sincronizan los estudios de Drive. Abrir en Drive conduce a un enlace privado bajo sus permisos; Descargar original requiere sesión y propiedad en el backend. Para ZIP grandes se recomienda abrir/descargar desde Drive, evitando retransmitir el archivo por ngrok. No se implementa visor DICOM.

Desconectar cancela los trabajos propios, revoca cuando Google responde y elimina credenciales locales; conserva catálogo y archivos. Si Google no confirma la revocación, la UI avisa que se quite el acceso desde la cuenta Google. **Enviar a la papelera de Drive** es otra acción, con confirmación explícita, y no vuelve a crear automáticamente el original. No se implementa borrado permanente.

## Actualización segura de Ubuntu

No se ejecuta esta sección automáticamente. Sustituir REVISION_REVISADA por el commit/branch revisado; no usar reset --hard, clean ni prune. No reiniciar Docker, DNS ni otros contenedores.

```bash
cd ~/agente-salud
git status --short
git diff -- portal-pacientes-agent/docker/seccomp_profile.json
umask 077
backup_dir="$HOME/portal-backups/$(date +%Y%m%d-%H%M%S)"
mkdir -p "$backup_dir"
chmod 700 "$HOME/portal-backups" "$backup_dir"
git rev-parse HEAD > "$backup_dir/revision.txt"
cp -p .env.docker "$backup_dir/env.docker"
cp -p portal-pacientes-agent/docker/seccomp_profile.json "$backup_dir/seccomp_profile.json"
git diff --binary > "$backup_dir/local-changes.patch"
docker compose stop portal
# Si ya existe el volumen/DB Google, copiarlo en frío antes de actualizar.
docker compose cp portal:/var/lib/portal-data "$backup_dir/portal-data"
```

En una instalación anterior a esta función puede no existir `/var/lib/portal-data`; en ese caso documentar que no hay DB previa y omitir solamente esa copia. No ignorar un error de copia si ya había cuentas Google. Las copias contienen identidad y tokens cifrados: mantenerlas privadas y respaldar las claves por separado; no publicarlas ni adjuntarlas a soporte.

Si hay cambios locales, conservarlos con un commit privado revisado o stash **solo de archivos identificados**, guardando antes el perfil como arriba. La copia de `.env.docker` es necesaria porque está ignorado por Git. No hacer pull sobre conflictos sin resolver. Después de traer REVISION_REVISADA, comparar el seccomp anterior con el entrante y preservar ambos ajustes: `openat2` ALLOW y `clone3` ERRNO 38 (ENOSYS). Esta función no modifica el perfil. Si se copió temporalmente la versión del servidor para resolver un conflicto, revisar también cualquier otra actualización upstream antes de seguir.

Verificación del perfil sin imprimir secretos:

```bash
python3 - <<'PY'
import json
from pathlib import Path
p = json.loads(Path('portal-pacientes-agent/docker/seccomp_profile.json').read_text())
assert any('openat2' in s['names'] and s['action'] == 'SCMP_ACT_ALLOW' for s in p['syscalls'])
assert any('clone3' in s['names'] and s['action'] == 'SCMP_ACT_ERRNO' and s.get('errnoRet') == 38 for s in p['syscalls'])
print('seccomp OK')
PY
docker compose build portal
docker compose run --rm --no-deps --entrypoint npm portal run typecheck
docker compose run --rm --no-deps --entrypoint npm portal test
docker compose up -d --no-deps portal
curl --fail http://127.0.0.1:8787/health
docker compose exec portal npm run smoke
```

Las pruebas usan cuentas/archivos sintéticos; no hacen OAuth con cuentas reales. `test:remote` necesita Xvfb y los componentes VNC de Linux: ejecutar además en Ubuntu `docker compose run --rm --no-deps --entrypoint npm portal run test:remote` antes de declarar validado noVNC real. Tras las pruebas, abrir la URL HTTPS pública y ejecutar la aceptación manual con dos cuentas de prueba y Drive. Si la DB/volumen no es escribible por UID 1000, corregir únicamente el propietario/permisos de ese volumen privado; no ejecutar el servicio como root ni quitar read_only/seccomp. Nunca ejecutar `docker compose down -v`.

Mantener respaldos del catálogo/configuración según la política acordada (para la alpha: copia previa a cada actualización y rotación de claves; siete copias recientes en almacenamiento privado, revisando su tamaño). No se incluyen documentos originales. No borrar copias mientras no haya una restauración comprobada. Al restaurar, detener solo portal y recuperar DB y claves de la misma generación. No abrir una DB más nueva con código que desconozca su esquema.

## Rotación de claves

Cambiar SESSION_SECRET invalida sesiones/estados OAuth: los pacientes vuelven a ingresar. TOKEN_ENCRYPTION_KEY necesita una rotación de los ciphertexts, no simplemente cambiar el valor. Detener portal y respaldar DB/clave vieja como arriba. Crear en un archivo privado externo al repo `TOKEN_ENCRYPTION_KEY_NEW` con otra clave aleatoria de 32 bytes base64. Conservar la clave anterior en .env.docker durante la operación:

```bash
docker compose run --rm --no-deps --entrypoint sh \
  -v "$HOME/.config/portal-pacientes/rotation.env:/run/portal-rotation.env:ro" \
  portal -c 'set -a; . /run/portal-rotation.env; set +a; exec node --import tsx scripts/rotate-token-key.ts'
```

El script cifra nuevamente conexiones, estados OAuth y sesiones de upload en una transacción; un error hace rollback y solo informa un código genérico. Tras `KEY_ROTATED`, reemplazar privadamente TOKEN_ENCRYPTION_KEY por la nueva en .env.docker, retirar la variable NEW y recrear solo portal. Mantener la pareja DB/clave vieja en el backup privado hasta verificar reconexión/listado; no mostrar claves en la terminal ni pasarlas como argumentos de proceso. Un rollback debe recuperar la pareja de DB y clave correspondiente, no mezclar generaciones.

## Rollback funcional sin pérdida

Para desactivar Google conservando datos: guardar un backup, cambiar exclusivamente `AUTH_MODE=pilot` y `STORAGE_PROVIDER=local`, conservar DATABASE_PATH, volumen y claves privadas, y definir la contraseña del piloto en `.env.docker`. Recrear solo portal con `docker compose up -d --no-deps portal`. No borrar el volumen, IndexedDB ni archivos en Drive. El piloto vuelve a su espacio local legacy; no muestra catálogos Google como una cuenta compartida. Al volver a Google, las identidades y los archivos remotos siguen disponibles. Para rollback de código, usar la revisión guardada y conservar las copias/volúmenes; revisar compatibilidad de esquema antes de volver a habilitar Google.

## Aceptación y limitaciones

La suite verifica OAuth/JWKS y Drive con mocks, aislamiento API/SSE/WebSocket, cifrado, nonce/state, sesiones, refresh/invalid_grant, cuota, integridad, uploads reanudables y conservación de PDF/ZIP. El E2E de interfaz usa un proveedor OAuth simulado y tres contextos de navegador: no sustituye una autorización real en Google Cloud. El smoke puede verificar los límites Google sin una cuenta ni secretos adicionales; `SMOKE_SKIP_BROWSER=true` informa explícitamente que omitió navegación pública.

Para declarar la alpha habilitada faltan las comprobaciones reales de dos cuentas autorizadas, un PDF ficticio y un ZIP ficticio en sus Drives, segundo dispositivo, reinicio Docker y noVNC en el Ubuntu/Athlon. No se configuran Cloud Console, ngrok ni el servidor desde esta tarea. La cuota de Drive pertenece al paciente. Testing puede vencer a los siete días. ngrok Free y conexiones lentas pueden limitar transferencias grandes. La DB y las cuentas requieren una revisión de privacidad y operatividad antes de usar estudios reales; no se afirma cumplimiento HIPAA ni otra certificación.
