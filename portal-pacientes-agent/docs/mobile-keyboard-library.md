# Biblioteca y teclado móvil — cambios locales

## Diagnóstico y comportamiento

El visor integraba únicamente `RFB` y su canvas. Un toque remoto no enfoca un campo HTML del teléfono. Se consultó el [fallback de teclado de noVNC](https://github.com/novnc/noVNC/blob/v1.3.0/app/ui.js) y su [API RFB](https://github.com/novnc/noVNC/blob/v1.3.0/core/rfb.js): se reutilizan `sendKey`, la conversión Unicode de noVNC, `focusOnClick` y los gestos que ya maneja RFB. No se incorpora un teclado dibujado ni otro transporte.

**Abrir teclado** enfoca sin esperas un textarea local desde el toque del usuario. `beforeinput` maneja borrado/Enter, `input` transmite texto confirmado y los eventos de composición difieren el envío hasta terminar IME. No se reenvía además el `keydown` de caracteres, para evitar duplicación. Tab, Borrar y Enter también tienen botones accesibles. Se conserva el foco al tocar otro campo remoto y se restaura el comportamiento de escritorio al cerrar. El contenido confirmado se sustituye inmediatamente por un marcador sin información; la composición transitoria se descarta al cerrar, perder foco, desconectar o abandonar la página. No se agregan logs, almacenamiento ni endpoints para credenciales, ni acceso al portapapeles.

`visualViewport` adapta la altura cuando aparece el teclado. La barra queda accesible, se puede desplazar la página y se conserva la interacción táctil de noVNC. Ampliar incluye los controles; si el navegador no permite pantalla completa, amplía el diseño dentro de la página.

El listado principal, Documentos y los contadores excluyen originales ausentes y estudios ocultos. **Estudios no disponibles (N)** y **Estudios ocultos (N)** son secciones plegables. Ocultar exige confirmación y no llama a Drive; volver a mostrar tampoco modifica sus archivos. El Historial mantiene todos los estudios y sus metadatos, con su estado, y los detalles siguen accesibles.

La preferencia vive en `study_preferences`, con dueño y estudio verificados por el backend. Actualizar o volver a enfocar el Portal sincroniza el catálogo desde SQLite. No hay difusión en tiempo real. Se agregan transaccionalmente dos tablas compatibles con el esquema v1; no se reescriben registros, credenciales ni claves existentes. `study_originals` conserva las referencias anteriores cuando una reimportación reemplaza el original de un mismo estudio.

Una restauración en Drive vuelve a habilitar el archivo durante la sincronización, incluso cuando su índice de búsqueda demora. Un 404 o archivo en papelera confirma la ausencia; errores temporales, cuota o autorización no provocan una subida sustituta. Reimportar comprueba primero el original: si existe, reutiliza su ID/hash; si falta, reserva una nueva generación con reintentos idempotentes. Conserva el ID del estudio, SHA-256, fecha inicial de importación, metadatos y preferencia. Restaurar después una generación antigua no desplaza la copia actual. No se restaura, renombra ni borra automáticamente ningún archivo de Drive.

## Pruebas

Se agregaron casos para migración aditiva de un catálogo v1 sintético, preferencias después de reabrir SQLite, aislamiento A/B, sincronización entre navegadores, ocultar/mostrar con confirmación y protección de origen, restauración, reimportación tras papelera, retry de la nueva generación y errores temporales. El chequeo Docker de persistencia ahora exige conservar también la preferencia.

Las pruebas móviles de `remote-keyboard.test.ts` ejecutan eventos de navegador e IME y diseños vertical/horizontal/teclado abierto con un **RFB simulado**. No prueban la aparición del teclado del sistema operativo. La variante WebKit en esta máquina usa el ejecutable ya instalado indicado por `TEST_WEBKIT_EXECUTABLE`; no equivale a Safari iOS. `remote-desktop.test.ts` agrega escritura de caracteres especiales, borrado y Tab a través de **VNC real**, además del login de escritorio y controles de acceso existentes; necesita Linux/Xvfb/noVNC.

Resultado en Windows (2026-10-21): `typecheck` aprobado; suite completa **225 casos: 223 aprobados, 2 omitidos, 0 fallos** (416 segundos). Los dos omitidos son los E2E Linux/noVNC real. Las **122 pruebas unitarias** también se ejecutaron aparte, sin fallos; después de los últimos ajustes del teclado se repitieron sus dos E2E Chromium/WebKit, ambos aprobados. El E2E Google/Drive usa archivos y OAuth ficticios, no cuentas reales.

Docker Desktop está instalado pero su motor no está disponible (no existe la tubería `docker_engine`). El intento de `test:sqlite:docker` falló en la comprobación inicial de Docker, antes de crear un volumen; no hubo reconstrucción, VNC real ni verificación de persistencia dentro del contenedor. No se inició Docker ni se tocaron contenedores existentes. **Pendiente aceptación física Android Chrome e iPhone Safari**: no afirmar compatibilidad nativa hasta completarla.

## Archivos modificados

| Área | Archivos |
| --- | --- |
| Visor y teclado | `src/server/remote-client.js`, `remote-desktop.ts`, nuevo `remote-keyboard.js` |
| API y persistencia | `src/server/app.ts`, `src/storage/database.ts`, `google-drive.ts` |
| Biblioteca e historial | `../portal-pacientes/js/data.js`, `cloud.js`, `screens.js`, `../portal-pacientes/css/screens.css` |
| Pruebas | `test/unit/google-drive.test.ts`, `google-frontend.test.ts`, `test/e2e/google-drive.test.ts`, `remote-desktop.test.ts`, nuevo `remote-keyboard.test.ts`, `scripts/check-sqlite-container.ts` |
| Documentación | Esta guía y `google-drive-alpha.md` |

Las rutas `src`, `test`, `scripts` y `docs` parten de `portal-pacientes-agent/`. Los extractores, Compose, Dockerfile, seccomp, OAuth, archivos env y bases existentes no se modificaron. No hubo deploy, push ni merge.

## Repetir en Windows

No regenerar `.env.google.local`. Desde PowerShell:

```powershell
Set-Location C:\Users\franc\Desktop\mocks-salud\portal-pacientes-agent
$env:BROWSER_CHANNEL = 'msedge'
npm.cmd run typecheck
npm.cmd test
```

Si Playwright no tiene su WebKit esperado, esa variante informa `skip`. Opcionalmente, para repetir con el motor ya instalado en este equipo:

```powershell
$env:TEST_WEBKIT_EXECUTABLE = "$env:LOCALAPPDATA\ms-playwright\webkit-2287\Playwright.exe"
node --import tsx --test test/e2e/remote-keyboard.test.ts
Remove-Item Env:TEST_WEBKIT_EXECUTABLE
```

Con Docker Desktop iniciado, crear **otra imagen para tests**, sin usar configuraciones, puertos ni volúmenes reales:

```powershell
Set-Location C:\Users\franc\Desktop\mocks-salud
docker build -t portal-ux-regression:local .
$seccomp = (Resolve-Path portal-pacientes-agent/docker/seccomp_profile.json).Path
$testRun = @('run', '--rm', '--init', '--read-only', '--user', '1000:1000', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true', '--security-opt', "seccomp=$seccomp", '--shm-size', '1g', '--tmpfs', '/tmp:size=1g,mode=1777', '--tmpfs', '/home/pwuser:size=128m,uid=1000,gid=1000,mode=0700', '--tmpfs', '/var/lib/portal:size=1g,uid=1000,gid=1000,mode=0700', '--entrypoint', 'npm')
docker @testRun portal-ux-regression:local test
docker @testRun portal-ux-regression:local run test:remote
Set-Location portal-pacientes-agent
$env:SQLITE_TEST_IMAGE = 'portal-ux-regression:local'
npm.cmd run test:sqlite:docker
Remove-Item Env:SQLITE_TEST_IMAGE
```

El último comando crea un volumen nuevo con datos ficticios y lo conserva. No monta bases reales ni elimina volúmenes.

**Solo cuando quieras actualizar tu prueba local Google de Windows**, y después de las pruebas anteriores:

```powershell
Set-Location C:\Users\franc\Desktop\mocks-salud
docker compose --env-file .env.google.local -p portal-google-local config --quiet
docker compose --env-file .env.google.local -p portal-google-local up --build -d --no-deps --wait portal
curl.exe --fail http://localhost:8888/health
```

No ejecutar esa actualización si el nombre del proyecto no corresponde a tu prueba local Google. No ejecutarla por SSH en Ubuntu. El proyecto piloto de 8787 queda separado.

## Aceptación manual y celulares

Usar únicamente archivos y credenciales ficticios. En Windows, entrar a `http://localhost:8888`. En teléfonos se necesita un origen HTTPS **ya autorizado** y encaminado a la instancia de pruebas actualizada; `localhost` del celular no es la PC. Esta entrega no cambia ngrok, OAuth ni DNS. Si no hay una instancia HTTPS de pruebas disponible, la aceptación física queda pendiente.

1. Android Chrome e iPhone Safari: abrir una institución, tocar su campo y **Abrir teclado**. Comprobar que aparece el teclado nativo. Escribir números, `ñ`, acentos, `@`, signos, borrar con teclado y con Borrar, pasar con Tab y enviar con Enter. Repetir tocando el campo de contraseña mientras el teclado está abierto.
2. Rotar vertical/horizontal, cerrar con el botón del sistema y del visor, desplazar el sitio, ampliar/reducir y repetir. Comprobar foco, escala y controles sin quedar tapados.
3. Interrumpir brevemente la conexión y reconectar a la misma importación. El texto anterior no debe reaparecer ni enviarse. Completar un login ficticio y comprobar la detección automática. Repetir en escritorio y en las tres instituciones.
4. Con la cuenta A, importar un original ficticio y mandarlo manualmente a la papelera en Drive. Actualizar: desaparece del listado principal y aparece en No disponibles. Ocultar, confirmar y verificar desde otro navegador A; B no debe ver ni operar el registro. Volver a mostrar mantiene su estado ausente.
5. Restaurar el original en Drive y actualizar: vuelve a estar disponible. Volver a eliminarlo e importarlo desde la institución: nueva copia, mismo estudio, sin duplicar por retry. Verificar que permanecen su historial/metadatos. Un corte de conexión a Google no debe marcar otros estudios como eliminados.

Registrar equipo, OS, navegador, origen de prueba y resultado. No guardar capturas de credenciales ni documentos médicos.

## Ubuntu: actualización manual y rollback

**No ejecutado.** No cambiar el piloto 8787. No hacer `pull`, `reset`, `clean`, `prune`, `down -v`, regeneración de secretos ni cambio de seguridad para aplicar esta mejora.

1. Identificar con `docker ps` el nombre de proyecto Compose del contenedor **8888**, su directorio/archivo Compose, env privado, volumen persistente e ID de imagen. No deducirlos del piloto. Verificar que su puerto esté ligado a loopback y conservar el origen HTTPS actual.
2. Con `umask 077`, crear una carpeta privada de backup. Guardar revisión anterior, cambios locales, copia privada del env y perfil seccomp local. Retener la imagen anterior con una etiqueta propia de rollback. No imprimir el env. No sobrescribir el perfil seccomp del servidor: esta entrega no lo modifica.
3. Preparar la revisión revisada en un checkout separado, conservando Compose/env/volumen y el perfil efectivo del servicio Google. Revisar los cambios antes de construir. Validar `config --quiet` con el **mismo proyecto Google**, nunca con el del piloto. Construir y ejecutar los tests aislados anteriores (en Linux usar arrays Bash equivalentes); los tests no necesitan el env ni la base de producción. Exigir `test:remote` y el chequeo de persistencia antes de actualizar.
4. Sin importaciones activas, detener **solo** el servicio Google 8888. Copiar en frío `/var/lib/portal-data` desde su contenedor detenido al backup privado, incluyendo DB/WAL/SHM y posibles pendientes. Conservar el env y claves de la misma generación. Si falla el backup, no actualizar; arrancar la versión previa. No detener Docker ni el piloto.
5. Recrear exclusivamente el servicio Google con el proyecto/env/volumen originales y la imagen revisada. Mantener UID 1000, root read-only, seccomp, capacidades eliminadas, no-new-privileges y puertos loopback. Verificar `/health` en 8888, login, dos cuentas aisladas, preferencias, restauración, importación y aceptación móvil HTTPS. Comprobar que 8787 sigue operativo.

Patrón de comandos, después de identificar los valores reales y preparar el checkout:

```bash
GOOGLE_PROJECT='PROYECTO_REAL_DEL_8888'
GOOGLE_ENV='/ruta/privada/al/env-google-existente'
dcg() { docker compose -f /ruta/al/compose.yaml --env-file "$GOOGLE_ENV" -p "$GOOGLE_PROJECT" "$@"; }
dcg config --quiet
# Guardar imagen anterior y backups privados ANTES de recrear el contenedor.
dcg build portal
# Ejecutar los tests aislados con la imagen recién construida, sin montar el volumen real.
dcg stop portal
dcg cp portal:/var/lib/portal-data /ruta/privada/backup-nuevo/portal-data
# Continuar solo si la copia terminó correctamente.
dcg up -d --no-deps --wait portal
curl --fail http://127.0.0.1:8888/health
```

Rollback de código: detener solo Google; conservar una copia fría adicional del estado nuevo; usar un override Compose privado que seleccione la imagen anterior retenida (`image: ETIQUETA_ROLLBACK`) y recrear con `--no-build`, mismo env/volumen/proyecto. Esta extensión mantiene esquema v1 y tablas aditivas, por lo que la versión inmediatamente anterior puede abrir el catálogo; la UI antigua no respeta la preferencia de ocultar y vuelve al comportamiento previo de archivos ausentes. No retirar las tablas nuevas ni restaurar una DB antigua sobre registros nuevos. Verificar previamente que la versión elegida sea exactamente esa versión compatible.

Si fuera imprescindible recuperar DB, restaurar la pareja DB/claves **en otro volumen**, conservando intacto el volumen nuevo y las importaciones posteriores. Reconciliar antes de volver a dar acceso; las preferencias/metadatos posteriores al backup no se reconstruyen desde Drive. No hay borrado ni rollback de archivos médicos en Drive como parte de esta operación.
