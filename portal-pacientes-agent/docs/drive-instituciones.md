# Google Drive: carpetas por institución

## Comportamiento

Las nuevas subidas crean cuando hace falta `Portal Pacientes/Centro DM`, `Portal Pacientes/Pérez Cambet` o `Portal Pacientes/RDC Chacabuco`. Los nombres provienen exclusivamente de los identificadores internos `centrodm`, `percamb` y `rdcchacabuco`. Los nombres de PDF y ZIP, hash SHA-256, ID de Drive y metadatos de integridad conservan su funcionamiento anterior.

La carpeta raíz existente sin `pp_role` sigue siendo válida cuando se llama `Portal Pacientes` y tiene las propiedades de la aplicación y del propietario. Las nuevas carpetas llevan `pp_app`, `pp_owner`, `pp_role` y, para instituciones, `pp_provider` y `pp_parent`; se comprueban también `ownedByMe`, que no estén compartidas ni en papelera y el padre real. La búsqueda pagina todos los resultados y no admite una subcarpeta como raíz. Se reserva un ID de Drive en SQLite antes de crear cada carpeta y se reutiliza ante concurrencia, 409, reinicios y respuestas perdidas. Las carpetas ya duplicadas antes de esta versión no se borran ni se fusionan automáticamente. Si hay varias candidatas sin una referencia local, se elige un ID estable.

La reserva protege procesos que usan **la misma base SQLite**. No coordina instalaciones independientes con bases distintas y una cuenta Drive compartida: si se pierde SQLite mientras Drive aún no indexó una carpeta recién creada, la búsqueda podría no encontrarla. En recuperación, restaurar primero una copia válida o reconectar la cuenta y ejecutar **Actualizar mis estudios**, y esperar a que aparezcan los archivos antes de iniciar nuevas importaciones. La sincronización busca originales tanto en la raíz antigua como en subcarpetas y actualiza `remoteFolderId`; solo marca ausencias tras comprobarlas con Drive.

La deduplicación sigue siendo por SHA-256 y propietario. Si los mismos bytes corresponden a estudios de dos instituciones, ambos registros pueden referenciar el **mismo ID físico**; ese único archivo permanece en la carpeta correspondiente al `pp_provider` con el que se creó. Moverlo o duplicarlo para darle dos padres rompería la deduplicación y Drive admite un único padre. Las subidas antiguas con sesión resumible mantienen la carpeta de su checkpoint, incluso si era la raíz anterior. Las carpetas se crean para archivos nuevos; leer, sincronizar o volver a importar un original existente no lo mueve.

## Migración opcional de la raíz antigua

No se ejecuta al iniciar sesión, sincronizar, actualizar ni desplegar. La vista previa solo lee Drive y guarda durante 24 horas un plan en SQLite, asociado a la cuenta; no crea carpetas remotas. Solo incluye archivos que siguen directamente en la raíz, pertenecen al usuario de Google (`ownedByMe`), no están compartidos ni en papelera, tienen las propiedades de esta aplicación, proveedor conocido y formato, tamaño y hashes válidos. Cuando existe `pp_md5`, debe coincidir con el MD5 informado por Drive. Se valida cada archivo nuevamente antes del movimiento. La vista previa indica cuántos elementos visibles con metadatos incompletos se omitieron; elementos que Drive no devuelve por la consulta o por indexación no necesariamente figuran en ese conteo.

La ejecución crea las carpetas requeridas solo si hacen falta y usa `files.update` con `addParents` y `removeParents`; no descarga ni vuelve a subir bytes y conserva el ID. Si se corta después de mover un archivo, repetir **el mismo plan** verifica el destino y actualiza las referencias SQLite de todos sus alias sin moverlo de nuevo. Los cambios manuales de propietario, proveedor, hash, papelera o carpeta hacen que se omita el archivo. Durante la ejecución no mover manualmente esos mismos archivos en Drive: las verificaciones de lectura y la solicitud de cambio no forman una transacción distribuida atómica. Las restricciones de Drive y el uso de [IDs generados previamente](https://developers.google.com/workspace/drive/api/guides/create-file) y [cambio de carpeta padre](https://developers.google.com/workspace/drive/api/guides/folder) corresponden a la API oficial.

Después de desplegar y verificar el servicio, el paciente debe iniciar sesión en Portal Pacientes con **su propia cuenta Google** y tener Drive conectado. Desde la consola de desarrollo de esa misma pestaña y mismo origen se puede preparar una vista previa solo de Centro DM:

```js
var respuestaPlan = await fetch('/api/drive/organization/dry-run', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ provider: 'centrodm' })
});
var planDrive = await respuestaPlan.json();
console.log('Estado HTTP:', respuestaPlan.status, 'plan:', planDrive.planId,
  'vence:', new Date(planDrive.expiresAt).toLocaleString(), 'omitidos:', planDrive.skipped);
console.table(planDrive.files?.map(({ id, name, provider, kind, bytes, destination }) =>
  ({ id, name, provider, kind, bytes, destination })));
```

Comprobar que la respuesta sea HTTP 200 y que los tres IDs y nombres correspondan a los ZIP esperados; no pegar una captura que exponga datos privados. Si faltan archivos, aparecen otros, los metadatos no coinciden o la carpeta raíz es incorrecta, **no ejecutar**; revisar Drive y repetir la vista previa. Otros proveedores se pueden revisar por separado con `percamb` o `rdcchacabuco`; omitir `provider` incluye los tres. Un plan vencido requiere una nueva vista previa.

Solo después de revisar y autorizar explícitamente ese plan, en la misma pestaña y sesión:

```js
var respuestaMover = await fetch('/api/drive/organization/execute', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ planId: planDrive.planId, confirmation: 'MOVER_ARCHIVOS_REVISADOS' })
});
var resultadoMover = await respuestaMover.json();
console.log('Estado HTTP:', respuestaMover.status);
console.table(resultadoMover.results);
```

`moved` confirma el nuevo padre y la actualización local; `already_organized` confirma que el archivo ya estaba en la subcarpeta válida y repara la referencia local si era necesario; `skipped` requiere revisión manual; `error` permite reintentar. Si hubo una interrupción o `error`, volver a ejecutar el segundo bloque con el **mismo** `planDrive` mientras no venza, sin cambiar de cuenta. Si se perdió la pestaña, el ID del plan puede recuperarse de una copia privada del resultado de vista previa y asignarse a `planDrive = { planId: 'ID_REVISADO' }`; nunca usar un ID de otro paciente. Si el plan venció, obtener otra vista previa: solo incluirá los archivos que todavía permanezcan en la raíz. Una sincronización posterior también repara referencias locales para archivos ya movidos.

## Verificaciones realizadas localmente

Las pruebas usan cuentas, tokens, carpetas y archivos sintéticos con Google Drive simulado; ninguna petición llega a Drive real. `test/unit/drive-organization.test.ts` cubre los tres proveedores y ambos formatos, raíz anterior, paginación, dos conexiones concurrentes a SQLite, reinicios, respuesta perdida al crear carpeta, sesión resumible anterior, migración e idempotencia, fallos parciales y de SQLite, cambios de propiedad/metadatos, reconstrucción y ausencias. `test/unit/google-auth.test.ts` verifica sesión, origen, confirmación y aislamiento del plan a través de HTTP. Se ejecutaron además los tests existentes de Drive y la suite completa: consultar el resultado de esta ejecución en la entrega; el acceso a Google real y el despliegue quedan pendientes de aceptación.

## Despliegue controlado en Ryzen y rollback

Estas instrucciones son para el operador; no se ejecutaron automáticamente. Mantener el mismo proyecto Compose, archivo de entorno, volúmenes, OAuth, claves y perfil seccomp que usa la instalación actual. No usar `down -v`, `prune`, `reset --hard` ni sobrescribir los cambios locales. Revisar especialmente los ajustes locales del perfil seccomp y conservar `openat2` permitido y `clone3` con ENOSYS. La copia de seguridad de SQLite y sus WAL/SHM contiene datos de pacientes y tokens cifrados: guardarla en una ubicación privada; conservar las claves existentes por separado.

1. Identificar el directorio real del repositorio en Ryzen y asignar a las siguientes variables el **mismo** proyecto y archivo que usa su contenedor. No adivinar valores ni copiar credenciales al chat. Inspeccionar `ps` para confirmar que se eligió únicamente el servicio correcto.

```bash
cd /RUTA/AL/REPOSITORIO
proyecto='PROYECTO_COMPOSE_EXISTENTE'
archivo_env='/RUTA/AL/ARCHIVO_ENV_EXISTENTE'
docker compose --env-file "$archivo_env" -p "$proyecto" ps
git status --short
git diff -- portal-pacientes-agent/docker/seccomp_profile.json
```

2. Terminar importaciones pendientes, acordar una ventana y guardar una copia privada de la revisión, diferencias locales y perfil. No actualizar si hay conflictos sin resolver. Detener solo ese `portal` y copiar el volumen mientras está detenido; si la instalación ya tiene DB Google, la copia debe ser exitosa antes de continuar.

```bash
umask 077
respaldo="$HOME/portal-backups/drive-instituciones-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$respaldo"
chmod 700 "$respaldo"
git rev-parse HEAD > "$respaldo/revision.txt"
git diff --binary > "$respaldo/cambios-locales.patch"
cp -p portal-pacientes-agent/docker/seccomp_profile.json "$respaldo/seccomp_profile.json"
contenedor=$(docker compose --env-file "$archivo_env" -p "$proyecto" ps -q portal)
test -n "$contenedor" || { echo 'No se encontró portal; detener el procedimiento'; exit 1; }
imagen_anterior=$(docker inspect --format '{{.Image}}' "$contenedor")
etiqueta_rollback="portal-pacientes-rollback:$(date +%Y%m%d-%H%M%S)"
docker image tag "$imagen_anterior" "$etiqueta_rollback"
printf '%s\n' "$etiqueta_rollback" > "$respaldo/imagen-rollback.txt"
docker compose --env-file "$archivo_env" -p "$proyecto" stop portal
docker compose --env-file "$archivo_env" -p "$proyecto" cp portal:/var/lib/portal-data "$respaldo/portal-data"
```

Si la copia falla, no continuar. Verificar que el respaldo contiene la base configurada y sus archivos auxiliares si existen; no inspeccionar ni publicar sus contenidos. Una instalación que nunca tuvo datos Google necesita una evaluación separada antes de omitir esa copia. Si el servidor tiene cambios locales, preservarlos y resolverlos de forma explícita antes de actualizar; no confiar en `git diff` para archivos nuevos o ignorados.

3. Incorporar la revisión previamente revisada sin descartar cambios locales. Tras verificar el diff, reconstruir el servicio con el mismo comando Compose y restaurar solo ese servicio:

```bash
git pull --ff-only
git diff -- portal-pacientes-agent/docker/seccomp_profile.json
docker compose --env-file "$archivo_env" -p "$proyecto" build portal
docker compose --env-file "$archivo_env" -p "$proyecto" up -d --no-deps --wait portal
docker compose --env-file "$archivo_env" -p "$proyecto" ps portal
```

`git pull --ff-only` solo es apropiado si la rama remota contiene exactamente la revisión autorizada y el árbol permite actualizar sin sobrescrituras; si falla o hay modificaciones locales, detenerse y resolverlas sin forzar. Verificar salud, dos cuentas de prueba aisladas, importaciones por cada proveedor, reinicio y actualización de la biblioteca. Usar la vista previa anterior para los ZIP solo después de revisar los resultados. Realizar una aceptación real con Drive y el permiso existente `drive.file`; las pruebas simuladas no sustituyen esa validación.

4. Para volver a la imagen anterior, terminar o conservar aparte las subidas pendientes y usar la etiqueta guardada. La base es una extensión aditiva de esquema v1; el código anterior ignorará las tablas nuevas, pero puede dejar de reanudar una subida iniciada en una subcarpeta por esta versión. No restaurar automáticamente el respaldo antiguo de SQLite: hacerlo después de nuevas importaciones descartaría referencias y requeriría reconciliación. Probar la reversión en un entorno aislado antes de necesitarla.

```bash
etiqueta_rollback=$(cat "$respaldo/imagen-rollback.txt")
cat > "$respaldo/rollback-compose.yaml" <<EOF
services:
  portal:
    image: $etiqueta_rollback
EOF
docker compose --env-file "$archivo_env" -p "$proyecto" -f compose.yaml -f "$respaldo/rollback-compose.yaml" up -d --no-build --no-deps --wait portal
docker compose --env-file "$archivo_env" -p "$proyecto" ps portal
```

El rollback de código no mueve archivos hacia atrás. Para volver a ponerlos en la raíz se requiere un procedimiento separado, revisión y autorización explícita; nunca borrar carpetas ni originales para revertir la aplicación.
