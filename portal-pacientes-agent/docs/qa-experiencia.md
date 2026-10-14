# Cambios de experiencia y persistencia — 14/10/2026

Implementación del QA de `QA_PORTAL_PACIENTES_DEMO_ESTUDIOS.md` y la grabación analizada en `analisis-demo-estudios.md`. Las pruebas usan cuentas y archivos sintéticos.

## Cambios

- `/remote/:jobId` entrega HTML desde la primera apertura. El escritorio comienza únicamente después de confirmar el estado interactivo por snapshot/SSE. Los errores 409 tienen reintentos acotados; 503 ofrece recuperación; 401/403 detienen los reintentos.
- Cabecera, institución, paso, instrucciones y privacidad coherentes con el Portal. Cancelación y reconexión visibles; diseño angosto y ampliación del escritorio. Al verificar el ingreso, se reemplaza el escritorio por confirmación y regreso al mismo job.
- El botón de continuar queda deshabilitado durante la verificación. El backend verifica que la institución haya autenticado al usuario antes de entregar el control al agente.
- El enlace conserva el job; recargar o volver desde la pestaña remota recupera la importación existente. El aviso de importación activa permite continuarla o cancelarla.
- Progreso respaldado por fases reales: buscar archivo, descargar, verificar y guardar. No hay porcentajes ni tiempos estimados inventados.
- SHA-256 y tamaño verificados antes del guardado y al descargar desde IndexedDB. Éxito solo después de persistir Blob, ficha y acuse positivo. Errores de cuota, metadata e integridad no dejan éxito ni fichas nuevas falsas.
- La lista comprueba que exista el Blob antes de deshabilitar un estudio como ya importado. Permite recuperar un archivo borrado sin duplicar la ficha.
- Una descarga principal en el detalle DICOM; acceso directo al estudio desde el éxito y salida secundaria a Estudios. Textos de importación guiada sin presentar reglas deterministas como IA.
- Tiempos operativos de creación, login, escritorio y WebSocket registrados sin credenciales, pantallas ni contenido médico.

## Política del piloto

La copia final vive en IndexedDB y las fichas en localStorage, en el mismo navegador, perfil y origen. Reiniciar el backend no debe borrar esa copia. Incógnito, borrar datos, cambiar navegador/equipo/origen o la eliminación de almacenamiento por el navegador pueden perderla. No existe sincronización entre dispositivos ni una promesa de guardado permanente. Los temporales del worker se eliminan al finalizar o por retención.

## Verificación

La suite general ejecutó 166 pruebas sin fallos y omitió la prueba remota que requiere Xvfb. Tras los cambios finales de almacenamiento y recuperación, pasaron los siete E2E específicos de frontend/importación activa. Los dos E2E remotos verifican login mediante mouse/teclado en el mismo contexto, rechazo del ingreso incompleto, viewport angosto, revocación, cancelación, apertura inmediata y manejo de 409/503/401/403.

Resultado final: la prueba de durabilidad terminó con código 0 y `PASS` después de la espera de 305 segundos y un `docker compose down/up` real. El navegador permaneció vivo con el mismo origen localhost. Se comprobó la eliminación previa del temporal, descarga íntegra en las tres vistas, separación de una nueva sesión privada y error al borrar el Blob. La prueba adicional de borrar y reimportar el ZIP también pasó: recuperó el archivo conservando dos fichas sin duplicarlas. TypeScript y `git diff --check` pasaron. El portal habitual se reconstruyó y quedó saludable, con acceso `1234 / 1234` y Chromium disponible.

`scripts/durability-client.ts` mantiene un Chromium independiente. El backend aislado usa `docker/qa-durability.yaml`. La prueba exige acuse final, eliminación efectiva del temporal, espera real de 305 segundos, navegación por Estudios/Documentos/Historial, descarga de bytes, tamaño y SHA-256 iguales al original, ZIP íntegro con CRC y miembro DICOM sintético. Luego espera `docker compose down/up` y repite la descarga en el mismo navegador y origen localhost. También comprueba separación de una nueva sesión privada y error al borrar el Blob.

Comandos de la prueba remota y general requieren el perfil `docker/seccomp_profile.json` del proyecto para que Chromium ejecute su sandbox. El backend de QA no publica puertos; la prueba usa una red Docker independiente. No se usaron cuentas ni estudios reales. La aceptación con una institución real y un despliegue externo HTTPS requieren una prueba propia.

Para repetir la durabilidad, desde la raíz del repositorio y con la imagen construida:

```powershell
docker network create portal-qa-durability
docker compose -p portal-qa -f portal-pacientes-agent/docker/qa-durability.yaml up -d
docker run --rm --init --name portal-qa-client --network portal-qa-durability --shm-size=1g mocks-salud-portal node --import tsx scripts/durability-client.ts
```

El último comando sigue ejecutándose. En otra terminal, después de que `docker exec portal-qa-client test -f /tmp/ready-for-restart` devuelva código 0:

```powershell
docker compose -p portal-qa -f portal-pacientes-agent/docker/qa-durability.yaml down
# Esperar código 0: el mismo cliente tiene que haber observado la caída.
docker exec portal-qa-client test -f /tmp/saw-offline
docker compose -p portal-qa -f portal-pacientes-agent/docker/qa-durability.yaml up -d
```

El cliente debe terminar con `PASS` y código 0. Limpiar el backend de QA con el mismo comando `down` y retirar la red con `docker network rm portal-qa-durability`. El proyecto habitual `mocks-salud` queda independiente.
