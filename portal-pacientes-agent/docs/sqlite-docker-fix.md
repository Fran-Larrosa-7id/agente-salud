# SQLite en Docker: corrección de UID/GID y persistencia

## Causa comprobada

La ruta de Google Login es `/var/lib/portal-data/portal.sqlite`, definida en `google-local.env.example`. El generador copia esa ruta al crear la configuración; `loadConfig` la resuelve y `createGoogleServices` la entrega directamente a `PortalDatabase`. No hay una segunda DB en el frontend ni una ruta alternativa temporal.

La imagen base Playwright v1.55.1-noble define `pwuser` como **1001:1001**. El Dockerfile anterior hacía `chown pwuser:pwuser` del directorio y `chmod 700`, mientras Compose ejecuta el servicio como **1000:1000**. Se comprobó el volumen `portal-google-local_portal-data`: era 1001:1001, modo 700, vacío y no escribible por 1000. El montaje era persistente y RW; el problema era el propietario del directorio, no `read_only` ni la ruta de callback.

El Dockerfile ahora usa `chown 1000:1000` y `USER 1000:1000`, coincidiendo con Compose. Los volúmenes nuevos heredan un directorio 1000:1000, modo 700. En esta instalación, al recrear con la imagen corregida, Docker preparó también el volumen existente vacío con ese propietario. SQLite crea DB, WAL y SHM como 1000:1000; la DB y los auxiliares se comprobaron con modo 600.

`PortalDatabase` comprueba lectura, escritura y acceso al directorio antes de abrir; protege el archivo y cierra la conexión si la inicialización falla. Ante problemas de apertura indica `DATABASE_STORAGE_UNAVAILABLE` y el UID/GID requerido, sin mostrar secretos. No intenta hacer chown como aplicación ni recurre a una DB efímera. El perfil seccomp, cap_drop, no-new-privileges, tmpfs de documentos temporales y raíz read-only se conservan. `.env.google.local` no se modificó ni se mostró; no se regeneraron claves.

## Comandos Windows

Docker Desktop debe estar iniciado. Desde PowerShell:

```powershell
cd C:\Users\franc\Desktop\mocks-salud
docker compose --env-file .env.google.local -p portal-google-local up --build -d --wait portal
npm.cmd --prefix portal-pacientes-agent run test:sqlite:docker
docker compose --env-file .env.google.local -p portal-google-local up -d --no-deps --force-recreate --wait portal
curl.exe --fail http://localhost:8888/health
```

El test usa la imagen recién construida `portal-google-local-portal`. Crea un volumen sintético con nombre aleatorio; no lee archivos .env ni monta el volumen real. No elimina ningún volumen, ni siquiera el sintético. Conserva su nombre en la salida para inspección. Requiere Node >=22.13 en Windows para ejecutar el lanzador; la comprobación SQLite corre dentro de la imagen Linux.

El proyecto Compose y volumen del piloto existente no cambian: no usar otro `-p`, no sustituir `.env.docker` y no usar `down -v`.

## Reparación opcional del directorio legado vacío

Solo si un volumen vacío conserva el propietario 1001 tras reconstruir, con portal detenido:

```powershell
docker compose --env-file .env.google.local -p portal-google-local stop portal
docker compose --env-file .env.google.local -p portal-google-local build portal
docker compose --env-file .env.google.local -p portal-google-local run --rm --no-deps --user 1001:1000 --entrypoint node portal scripts/repair-sqlite-volume.mjs
docker compose --env-file .env.google.local -p portal-google-local up -d --wait portal
```

La reparación corre como el propietario no root 1001 con grupo primario 1000 y todas las restricciones del servicio. Si el directorio ya es 1000:1000, no hace nada. En el caso legado vacío, mantiene el dueño 1001 y otorga acceso solo al grupo de aplicación 1000 (directorio 770). Los archivos SQLite nuevos siguen siendo propiedad 1000:1000, modo 600. Nunca aplica chmod 777, recorre archivos, cambia claves ni migra o borra bytes de DB.

Si hay datos con permisos incompatibles, el script se niega a modificarlos. Mantener el servicio detenido y respaldar primero el volumen y las claves de su misma generación en almacenamiento privado; revisar ese caso antes de migrar permisos. No borrar el volumen para recuperar el arranque.

## Regresión y resultados

El lanzador `scripts/test-sqlite-docker.mjs` inicia dos contenedores sucesivos con la misma imagen y un volumen sintético exclusivo. Ambos tienen user 1000:1000, raíz read-only, cap_drop ALL, no-new-privileges, el seccomp real y los tmpfs/shm del servicio. El primero crea esquema, usuario, sesión y tokens ficticios cifrados; el segundo recupera los mismos datos tras eliminarse el primer contenedor. Verifica UID/GID, permisos de DB/WAL/SHM, modo WAL y cifrado. También comprueba restricciones efectivas en `/proc/self/status` y que la raíz rechace escritura.

En esta corrección Docker Desktop **4.80.0**, Engine **29.6.1**, estuvo disponible. Se construyó la imagen y la regresión real aprobó ambas fases. `docker compose ... up --build -d --wait portal` terminó con servicio **Healthy**. Se recreó el servicio real usando `--force-recreate`, se verificó que conserva el mismo archivo SQLite (inode y esquema versión 1), propietario 1000:1000, modo 600, y `/health` respondió HTTP 200 en localhost:8888. No se escribieron usuarios ficticios en la DB real.

TypeScript y las 106 pruebas unitarias de Windows aprobaron. La ejecución completa de Linux y su resultado final se registran en [el reporte de QA](google-drive-alpha-qa.md). La prueba no sustituye el consentimiento real en Google ni una importación real de un paciente.
