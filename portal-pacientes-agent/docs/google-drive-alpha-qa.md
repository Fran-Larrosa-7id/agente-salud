# Reporte de implementación y QA — 20/10/2026

## Corrección posterior: DRIVE_UPLOAD_FAILED

Se confirmó mediante HTTP real de loopback que `redirect:error` en Node/Undici rechaza el 308 normal de Drive con `unexpected redirect`. El cliente ahora usa redirect manual sin seguir Location. Los chunks ya eran 8 MiB; el 1 KB inicial era el formateo de cero bytes. La inspección del incidente se limitó a eventos operativos y contadores SQLite: una sesión reanudable cifrada, ningún estudio confirmado. No se descifraron tokens ni se subieron archivos clínicos.

TypeScript y 112/112 unitarias aprobaron en Windows y Linux. La suite completa Linux dio 213 tests: 211 aprobados, 0 fallidos/cancelados y 2 omitidos; esas 2 pruebas noVNC aprobaron por separado. E2E Edge aprobado con error de almacenamiento, Guardado pendiente, 0 B, recarga, retry y sincronización A/B/A. La regresión Docker de SQLite ahora incluye recuperación del mismo job/ZIP en contenedores separados, arranque real de index.ts, apagado ordenado, TTL y aislamiento, sin redescarga institucional ni duplicados. Se usaron exclusivamente imágenes/volúmenes sintéticos separados y se conservaron los volúmenes de prueba.

No se desplegó la corrección ni se recreó el contenedor local activo. No se hizo merge/push, no se accedió a Ubuntu ni se modificaron extractores, seccomp, archivos .env o secretos. Falta la aceptación real contra Google Drive del usuario tras reconstruir manualmente. El diagnóstico, archivos modificados, límites de retención y comandos están en [drive-upload-fix.md](drive-upload-fix.md). Los apartados siguientes son el historial anterior.

## Corrección posterior: SQLite Docker ERR_SQLITE_ERROR (14)

Docker Desktop 4.80.0 / Engine 29.6.1 **disponible**. Se comprobó que `pwuser` es 1001:1001 en la imagen base y el volumen estaba 1001:1001/700, mientras Compose usa 1000:1000. Se alinearon propietario y usuario numéricos en Dockerfile. No se leyó ni modificó manualmente `.env.google.local`, ni se imprimió su contenido; Compose lo consumió para reconstruir/iniciar el servicio. No se regeneraron claves, borraron volúmenes, modificaron extractores o seccomp, ni ejecutaron contenedores como root.

| Comprobación posterior al fix | Resultado |
| --- | --- |
| TypeScript local y durante el build Docker | Aprobado |
| Unitarias Windows | 106/106 aprobadas |
| Suite completa dentro de Linux, mismas restricciones Docker | 207 tests: 205 aprobados, 0 fallidos/cancelados, 2 omitidos; salida 0, 239 s |
| `test:remote` real en Linux/Xvfb/noVNC | 2/2 aprobados; cubre por separado los dos omitidos de la suite general |
| `npm run test:sqlite:docker` | Aprobado: creación, escritura cifrada, lectura y persistencia entre dos contenedores eliminados/recreados, UID/GID 1000, raíz RO, seccomp, no-new-privileges y cero capabilities |
| DB/WAL/SHM en volumen de regresión | Propietario 1000:1000, permisos 600, directorio 700, journal_mode WAL |
| Servicio real Google `up --build -d --wait` | Healthy en localhost:8888 |
| Servicio real Google tras `--force-recreate` | Healthy; mismo archivo SQLite (inode), esquema versión 1 y permisos 1000:1000/600 conservados; `/health` HTTP 200 |
| Extractores y seccomp contra HEAD; whitespace | Sin cambios en esos archivos; `git diff --check` aprobado |

La regresión utilizó únicamente archivos y tokens ficticios en el volumen nuevo `portal-sqlite-regression-4974bd9f-6aa4-4f51-bb0d-6d1472c223e0`, que se conservó. La DB real solo se consultó para comprobar esquema/metadata del archivo; no se introdujeron registros ficticios. No hubo OAuth real ni acceso a Drive de pacientes. Los pasos Windows y la reparación no root opcional del directorio legado vacío están en [sqlite-docker-fix.md](sqlite-docker-fix.md). Los apartados siguientes conservan el historial de QA anterior, cuando Docker todavía no estaba disponible.

Implementación en el repositorio local. La configuración del servidor Ubuntu y Google Cloud no se modificó. La función permanece bajo flags; el piloto sigue siendo el valor predeterminado si no hay Google configurado. Con credenciales Google y sin AUTH_MODE explícito el arranque falla, evitando un piloto implícito por mala configuración.

## Ejecuciones finales

Continuación para el cliente OAuth del proyecto AGENTE-SALUD-7ID y callback `http://localhost:8888/api/auth/google/callback`: typecheck aprobado, **106/106 unitarias** aprobadas y E2E Google/Drive en Edge aprobado de nuevo. La nueva regresión verifica redirect exacto, login y consentimiento bajo HTTP loopback, cookies HttpOnly/Lax sin Secure solo para ese origen y rechazo de HTTP en producción o para hosts remotos. Compose se validó sin iniciar Docker: puerto 8888 ligado a 127.0.0.1, `read_only` conservado y volumen `portal-google-local_portal-data` separado. El generador produjo `.env.google.local` privado, ignorado por Git, con claves aleatorias y campos OAuth vacíos; se validó esa configuración sin imprimirla. Docker Engine continúa apagado: no se construyó ni desplegó el contenedor, y aún falta OAuth real con las credenciales privadas. Los pasos exactos están en [google-local-8888.md](google-local-8888.md). Los resultados de la suite completa anterior se conservan abajo.

Entorno: Windows x64, Node 24.16.0, Playwright 1.55.1, Edge instalado (`BROWSER_CHANNEL=msedge`).

| Comprobación | Resultado |
| --- | --- |
| `npm run typecheck` | Aprobada, incluido el script de rotación y tests nuevos |
| `BROWSER_CHANNEL=msedge npm test` | 206 tests: 204 aprobados, 0 fallidos, 0 cancelados, 2 omitidos; salida 0 |
| `npm run test:unit` tras el último ajuste de configuración | 105/105 aprobados |
| Sintaxis de todos los JS del frontend (`node --check`) | Aprobada |
| `git diff --check` | Sin errores de whitespace |
| Seccomp JSON: openat2 ALLOW y clone3 ERRNO 38 | Aprobada; el archivo no fue modificado |
| Smoke con servidor piloto sintético aislado en loopback | Salud API aprobada; servidor de prueba detenido al finalizar |
| Navegación pública del smoke | example.com, Pérez Cambet, Centro DM y RDC Chacabuco: HTTP 200 |

Las dos omisiones son los tests de escritorio noVNC real, habilitados solo en Linux con TEST_REMOTE_DESKTOP=true/Xvfb/VNC. Las verificaciones nuevas de aislamiento del handshake y revocación del WebSocket sí corrieron, con un upstream sintético, y aprobaron.

La última ejecución completa incluyó la regresión de las tres instituciones: login automático, descubrimiento, asociación de estudio/archivo, PDF, ZIP DICOM, visores, integridad, errores y limpieza. Después se agregó una guarda adicional que exige AUTH_MODE explícito si hay credenciales Google; se volvió a ejecutar typecheck y la suite unitaria completa.

## Cobertura nueva

- OAuth/OIDC con firma RSA y JWKS simulados: audiencia, emisor, expiración, nonce, email verificado, sub, allowlists y rechazo de firmas alteradas.
- PKCE S256; state ligado a cookie, un solo uso, expiración, cancelación y redirects internos. El login no solicita Drive y el consentimiento posterior sí solicita drive.file/offline.
- A/B: consulta, SSE, selección, archivos, ack, retry, cancelación, HTML de escritorio y WebSocket ajenos rechazados; IMPORT_BUSY sin datos del dueño; logout de A conserva el job de B.
- Sesión revocada durante consentimiento no resucita credenciales. Sesión vencida deja de recibir eventos y un socket ya actualizado se cierra.
- Cifrado AES-GCM por contexto; token anterior conservado al refrescar; invalid_grant sin reintentos infinitos; desconexión sin borrar originales y aviso veraz si no se pudo revocar.
- PDF/ZIP originales en el Drive simulado, carpeta privada, streaming en chunks de hasta 8 MiB, respuesta perdida, offset recibido, interrupción, sesión de upload vencida, 429/5xx/backoff y paginación con páginas vacías.
- Cuota agotada, checksum local incorrecto, metadata remota inconsistente y fallo del commit nunca producen COMPLETED. El temporal permanece para retry dentro del TTL.
- Deduplicación por paciente sin duplicar bytes; referencias de estudios diferentes conservadas; archivo remoto modificado/eliminado pasa a no disponible.
- DB cerrada/reabierta conserva sesiones y catálogo; reconstrucción mínima desde appProperties después de pérdida de DB; la rotación offline de clave es transaccional y hace rollback si la clave anterior es incorrecta.
- Interfaz completa con OAuth/Drive simulados: login, consentimiento separado, importación sin descargar primero el archivo al navegador, segundo navegador, A→B→A y preservación de datos legacy. Se comprobó además que el navegador no pide archivos temporales ni envía ack en modo Drive.

Se corrigieron durante la validación expectativas antiguas de tests: nuevos campos públicos de almacenamiento y pantalla de API caída sin formulario piloto. La opción de sandbox que cierra Edge en Windows se desactiva únicamente en el arnés de pruebas/smoke de Windows; los tests de Linux y la configuración real de Docker conservan el sandbox. La suite fue ejecutada nuevamente después de corregir esos casos; sus fallos anteriores no se presentan como resultados verdes.

## No ejecutado / aceptación externa pendiente

- Build/arranque de la imagen, tests dentro de Docker, reinicio real del volumen, noVNC real Linux y benchmark en AMD Athlon/2 CPU. El motor Docker local no estaba disponible (pipe docker_engine inexistente).
- OAuth con dos cuentas Google reales, autorización de drive.file real, carpeta/archivo en sus Drives y segundo dispositivo físico. No se proporcionaron credenciales del cliente OAuth ni se accedió a paneles Google.
- Configuración de ngrok/redirect público y despliegue Ubuntu. No se cambió DNS ni se actuó sobre otros contenedores.
- Evaluación legal/privacidad con estudios reales. No se declara ninguna certificación.

No se declara habilitado el MVP para pacientes reales hasta completar esa aceptación. La migración de archivos legacy a Drive es un backlog explícito: no se asigna el historial previo a una identidad Google ni se borran sus originales.

## Inventario de cambios

Backend, dentro de `portal-pacientes-agent/`:

- `src/config.ts`: flags, secretos, origen exacto, límites y validación fail-closed.
- `src/server/google-oauth.ts`, `google-services.ts`, `portal-auth.ts`: OAuth/OIDC, sesiones, consentimiento y composición de servicios.
- `src/storage/database.ts`, `errors.ts`, `provider.ts`, `google-drive.ts`: SQLite/migración v1, cifrado, contratos reales, catálogo y Drive.
- `src/jobs/job.ts`, `states.ts`, `job-manager.ts`: dueño, progreso y confirmación del servidor después de persistir.
- `src/server/app.ts`, `index.ts`, `remote-desktop.ts`, `sse.ts`: autorizaciones, catálogo/descarga/papelera, arranque/cierre y revocación de streams/sockets.
- `scripts/rotate-token-key.ts`, `scripts/smoke.ts`, `.env.example`, `package.json`, `package-lock.json`, `README.md` y esta documentación. No se añadieron paquetes.

Frontend, dentro de `portal-pacientes/`:

- `index.html`; `js/cloud.js` nuevo.
- `js/auth.js`, `data.js`, `agent.js`, `app.js`: identidad, cachés separadas, cliente y sesión real.
- `js/traer.js`, `screens.js`, `ui.js`, `share.js`: progreso Drive, catálogo, originales, papelera confirmada y acceso privado en Drive.

Operación, en la raíz: `Dockerfile`, `compose.yaml`, `.env.example`, `.gitignore`, `.dockerignore`. Solo se agrega el volumen privado de DB; los temporales de documentos siguen en tmpfs. `.env.docker` y los secretos existentes no se editaron.

Pruebas:

- Nuevos `test/google-helpers.ts`, `test/unit/google-auth.test.ts`, `google-drive.test.ts`, `google-frontend.test.ts`, `google-key-rotation.test.ts` y `test/e2e/google-drive.test.ts`.
- Actualizados `test/unit/states.test.ts`, `test/e2e/same-origin.test.ts`, `test/browser-channel.ts` y configuración del canal/sandbox del arnés en agent-browser, automatic-login, browser-lifecycle, centrodm-provider, pdf-capture, percamb-discovery, rdcchacabuco-provider y remote-desktop. No cambian los extractores institucionales.

Ver [configuración, despliegue seguro y rollback](google-drive-alpha.md).
