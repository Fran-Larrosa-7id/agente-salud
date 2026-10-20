# DRIVE_UPLOAD_FAILED: diagnóstico, corrección y prueba local

## Causa confirmada y alcance de la evidencia

El cliente enviaba todas las peticiones con `fetch(..., { redirect: 'error' })`. Drive responde **308 Resume Incomplete** a la consulta inicial de una sesión todavía vacía y a los fragmentos no finales. Node/Undici rechaza esa respuesta como `TypeError: fetch failed`, causa `unexpected redirect`, antes de que nuestro código pudiera comprobar `accepted: [308]`. El catch la convertía en `DRIVE_UPLOAD_FAILED` y repetía la consulta hasta agotar reintentos. Los mocks anteriores devolvían `new Response(..., {status: 308})` directamente, por lo que no ejercitaban el comportamiento real de fetch.

Se reprodujo con un servidor HTTP de loopback y Node real, sin Google ni archivos clínicos: `redirect:error` falla y `redirect:manual` devuelve status 308. La regresión del proveedor completo transmite ZIPs ficticios de 4.500.000 bytes y 9 MiB por HTTP real, verificando cabeceras, bytes finales y recuperación tras una respuesta perdida. La imagen Linux también ejecutó esas pruebas.

La inspección local del incidente fue exclusivamente de metadatos: logs operativos mostraron dos intentos de almacenamiento y posterior cancelación; SQLite tenía **1 registro de upload, 1 sesión reanudable cifrada y 0 registros de catálogo**. Esto confirma que se había creado/persistido la sesión de subida y que no se llegó al commit del estudio. No se descifraron tokens ni se consultaron nombres, estudios, URLs privadas o contenido de archivos.

El tamaño de fragmento ya era **8 MiB**, múltiplo de 256 KiB. El “1 KB” inicial provenía del formateador del frontend, que convertía incluso cero bytes en 1 KB. No demostraba fragmentos de 1 KB. El handle de lectura permanece abierto durante probes, fragmentos y reintentos, dentro de try/finally; no se encontró un cierre prematuro. No hubo evidencia de que OAuth, SQLite, cuota o el extractor causaran este fallo de protocolo. La comprobación final de la transferencia real del paciente sigue pendiente: no se usaron datos clínicos reales en pruebas.

Referencia: [protocolo oficial de subida y reanudación de Drive](https://developers.google.com/workspace/drive/api/guides/manage-uploads). El 308 informa el offset confirmado mediante Range; 200/201 indican fin de transferencia, que aquí todavía debe superar verificación remota y commit de catálogo.

## Correcciones

- `src/storage/google-drive.ts`: redirect manual sin seguir Location, incluido un Location ajeno durante un 308; origen/ruta de Google siguen restringidos. Se aceptan 308 para continuar y solo 200/201 para finalizar la transferencia. Se valida Range completo. Se conserva el ID preasignado, sesión cifrada, offsets confirmados y backoff acotado para errores de red, 429 y 5xx. Un 400 definitivo no se reintenta como si fuera una caída de red; 401 refresca una vez, 403 de permisos exige reconexión, cuota llena conserva su código específico y 404/410 de sesión permiten reiniciar con el mismo ID.
- `src/storage/errors.ts`, `src/security/logger.ts`, `src/server/google-services.ts`: diagnóstico estructurado `drive_upload` con etapa, HTTP status, motivo de una lista cerrada, bytes confirmados/totales, reintentos, estado de sesión y clasificación transitoria. No se registran mensajes arbitrarios de Google, tokens, cookies, IDs de paciente, URLs de sesión, nombres o bytes clínicos. Los detalles permanecen en los logs del servidor, no en la API pública.
- `src/storage/pending-imports.ts`, `src/jobs/job-manager.ts`, `src/jobs/job.ts`, `src/jobs/file-store.ts`, `src/server/index.ts`: antes de contactar Drive se guarda una cola temporal de almacenamiento en el volumen Google, con copias atómicas de originales ya validados y manifiesto privado ligado al propietario. Solo se restaura la fase IMPORTING; nunca navegador, login institucional, cookies o contraseñas. El mismo job se retoma tras recrear el contenedor, sin descargar otra vez si el checkpoint sigue válido. Un reinicio no extiende su TTL. Se corrige además la carrera de limpieza concurrente en Windows, haciendo idempotente la promesa de cleanup.
- `portal-pacientes/js/agent.js`, `portal-pacientes/js/traer.js`: cero bytes se muestra como **0 B**; ante storageError se muestra **Guardado pendiente**, se pausa el indicador activo y el botón reintenta solo almacenamiento. Recargar conserva el error; una respuesta rápida de error no queda tapada por el accepted del retry. El catálogo y el éxito dependen de persistencia confirmada.

La cola usa `/var/lib/portal-data/pending-imports/<jobUUID>/`, directorios 700, archivos 600, sin secretos OAuth. Contiene originales temporales y metadatos mínimos de los estudios seleccionados, por lo que debe mantenerse privada como la DB. No es un archivo clínico permanente. Se elimina después de confirmar Drive+catálogo, al cancelar o al vencer el TTL original (20 minutos con la configuración Compose actual). Hay barrido periódico mientras corre Google y limpieza de vencidos al arrancar. Si el servicio está detenido, la limpieza espera al siguiente arranque. No se modificó el esquema SQLite ni se requiere migración de claves. Un backup completo del volumen ahora puede incluir originales pendientes: mantenerlo privado y aplicar la misma política de retención; no publicarlo ni adjuntarlo a soporte.

## Pruebas ejecutadas

Las regresiones agregadas son `test/unit/google-drive-http.test.ts`, `test/unit/google-drive-recovery.test.ts` y `scripts/check-drive-recovery-container.ts`. Se ampliaron `test/unit/google-drive.test.ts`, `test/e2e/google-drive.test.ts` y `scripts/test-sqlite-docker.mjs`. Este último verifica también el arranque real de index.ts entre creación y recuperación del ZIP, en contenedores nuevos sobre un volumen sintético. No se modificaron Dockerfile, Compose, dependencias, extractores ni el perfil seccomp en esta corrección.

Docker Desktop 4.80.0 / Engine 29.6.1 disponible. Se construyó una imagen **separada**, `portal-drive-upload-regression:local`, sin desplegar el servicio real ni tocar Ubuntu.

| Verificación | Resultado |
| --- | --- |
| TypeScript Windows y build Linux | Aprobado |
| Unitarias finales Windows y Linux | 112/112 aprobadas en cada entorno |
| Suite completa Linux | 213: 211 aprobadas, 0 fallidas/canceladas, 2 omitidas; salida 0 |
| noVNC real Linux, ejecución separada | 2/2 aprobadas, cubre las dos omisiones anteriores |
| E2E Google/Drive en Edge | Aprobado: error, badge pendiente, 0 B, reload, retry, éxito, sincronización segundo navegador y aislamiento A/B/A |
| HTTP real de loopback | 308 sin seguir Location; final 200/201; Content-Length/Range; fragmentos no finales múltiplos de 256 KiB; ZIP idéntico y respuesta perdida sin duplicación |
| Errores simulados | 400 definitivo, 401, 403 permisos, 429 y 503; los tests existentes cubren cuota, sesión 404/410, integridad, refresh y commit fallido |
| Recuperación Docker | SQLite/WAL/SHM y ZIP pendiente entre contenedores recreados, sin redescarga, con read_only, UID 1000, cap_drop, no-new-privileges y seccomp activos |
| Compose | `config --quiet` aprobado, sin mostrar variables privadas |

La recuperación Docker usa un volumen sintético nuevo que se conserva, no el volumen real. Los tests de reinicio comprueban dueño, mismo job, mismo ID/sesión remota, checksum del ZIP, catálogo confirmado y limpieza posterior; también vencimiento de pendientes y copias parciales huérfanas. La suite completa se ejecutó antes de los ajustes finales de diagnóstico y metadatos de recuperación; se repitieron todas las unitarias y la recuperación Docker con la imagen actualizada. noVNC se validó por separado. No se hizo un upload real a Google, ni se reanudó el estudio clínico del incidente.

## Actualizar únicamente el Docker local desde PowerShell

No cambiar `.env.google.local`, no regenerar claves y no ejecutar down -v. El piloto Ubuntu no participa en estos comandos. Si hay una importación activa en la **versión anterior**, sus temporales todavía están en tmpfs: terminarla o preservar sus originales privadamente antes de recrear. La cola nueva no puede recuperar retroactivamente un job cancelado o un original ya eliminado. En el caso inspeccionado el job ya estaba CANCELLED; para la aceptación real hay que iniciar una nueva importación.

Desde la raíz del repositorio:

```powershell
cd C:\Users\franc\Desktop\mocks-salud
docker compose --env-file .env.google.local -p portal-google-local config --quiet
docker compose --env-file .env.google.local -p portal-google-local build portal
npm.cmd --prefix portal-pacientes-agent run test:sqlite:docker
docker compose --env-file .env.google.local -p portal-google-local up -d --no-deps --wait portal
curl.exe --fail http://localhost:8888/health
```

El test usa por defecto `portal-google-local-portal`, la imagen recién construida por Compose. Si la terminal tenía definido `SQLITE_TEST_IMAGE` para otra imagen, retirarlo antes del test o abrir una nueva terminal. La prueba no lee .env ni credenciales y deja sus volúmenes sintéticos para inspección. No cambia la DB o archivos reales.

Para ver únicamente el diagnóstico seguro tras una nueva prueba:

```powershell
docker compose --env-file .env.google.local -p portal-google-local logs --since 10m --no-log-prefix portal |
  Select-String 'drive_upload|storage_failed|storage_job_restored'
```

Se esperan `session_probe` con 308, `confirmed`, `transfer_complete` con 200/201 y `catalog_commit` con `reason=stored`. Un `accepted:true` solo confirma que se programó el reintento: esperar el evento final y el estado COMPLETED.

## Aceptación visual con tu cuenta

1. Abrir http://localhost:8888 e ingresar con la cuenta Google autorizada. En Perfil comprobar Drive conectado a esa misma cuenta.
2. Importar un estudio de Centro DM. Esperar **Guardado en Drive** y la pantalla final; no cerrar ni cancelar durante la transferencia.
3. Abrir el estudio desde el Portal: el enlace privado de Drive debe mostrar un `.zip` en **Portal Pacientes**. En Drive comprobar la cuenta del avatar y el tamaño del archivo; sus nombres son opacos `estudio-<id>.zip`, sin nombre/DNI del paciente.
4. En el Portal actualizar estudios o entrar desde otro navegador con la **misma cuenta**. El ZIP debe aparecer una sola vez y permitir abrir/descargar el original. Con otra cuenta no debe aparecer.
5. Para validar recuperación, usar un archivo ficticio: si falla almacenamiento, mantener la URL con `job=...`, no cancelar; después del reinicio recargar esa URL y pulsar **Reintentar guardado** antes del vencimiento. No se vuelve al login del laboratorio. La conexión a Drive puede figurar conectada porque sincronizar el catálogo funciona, mientras un job particular sigue pendiente: son estados distintos.

## Riesgos que quedan

La deduplicación es por cuenta y SHA-256, con ID remoto reservado: una respuesta perdida o reinicio no crea otra copia del mismo original. No se promete cero duplicados si se cambia de proyecto OAuth/DB o se manipulan archivos externamente. La pérdida del volumen/clave, disco lleno durante el checkpoint, cancelación o TTL vencido pueden impedir reanudar el original; el Portal no anuncia éxito en esos casos. Copias de seguridad privadas y Drive confirmado siguen siendo necesarios. La prueba real con la cuenta del paciente queda a cargo de la aceptación manual; no se hicieron merge, push, SSH ni despliegues automáticos.
