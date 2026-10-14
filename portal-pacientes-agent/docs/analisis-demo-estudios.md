# Análisis de QA: demo de importación de estudios

Fecha: 13/10/2026. Fuentes: `QA_PORTAL_PACIENTES_DEMO_ESTUDIOS.md`, `demo-estudios.mp4` en Descargas y código actual del repositorio. Video de 56,13 s, 1876 × 890, 30 fps.

Alcance: análisis de la grabación y revisión de implementación/cobertura de tests. Las instrucciones de implementación del documento se consideran propuestas para la siguiente etapa. En esta revisión no se ejecutaron nuevas importaciones ni pruebas con credenciales reales. El informe omite identificadores personales y contenido clínico.

## Resultado

El video muestra un recorrido funcional de Centro DM: ingreso manual en el navegador remoto, listado de tres estudios, selección de uno, importación presentada como ZIP DICOM y acceso a su ficha/descarga. La principal fricción se concentra en la preparación del acceso y el regreso al Portal. El documento está bien orientado al priorizar P0/P1, conservar Playwright/noVNC y evitar cambios innecesarios en las integraciones.

No hay evidencia en esta grabación de pérdida del ZIP al limpiar los temporales. Tampoco alcanza para demostrar integridad del archivo descargado, validez DICOM o persistencia a largo plazo. La duración del video es menor que el período de retención de cinco minutos.

## Hallazgos y nivel de certeza

| Prioridad | Momento aproximado | Evidencia | Conclusión |
| --- | --- | --- | --- |
| P0 | 04–10 s; JSON visible a los 07 s | La pestaña muestra `DESKTOP_NOT_AVAILABLE` antes de que aparezca el navegador | Fallo de experiencia confirmado. La carrera de preparación es una causa probable, pendiente de reproducir/instrumentar; el video no distingue 409 de 503. |
| P1 | 10–26 s | Cabecera mínima, navegador pequeño y amplio fondo oscuro | Falta contexto visual e instrucciones coherentes con «Traer mis estudios». El ingreso manual sí funciona en la grabación. |
| P1 | 26–28 s; comprobado a los 27 s | El escritorio desaparece y queda el mensaje de volver al Portal sobre una superficie oscura | Falta una pantalla de confirmación y un regreso guiado. Es el estado posterior a desconectar noVNC, diferente del fallo de CSP de imagen corregido anteriormente. |
| P1 | 46–55 s | Se presenta el archivo como guardado y se inicia su descarga | Se debe demostrar durabilidad e integridad, sin asumir pérdida ni permanencia indefinida. |
| P2 | 32–45 s | La fase de descarga mantiene el spinner durante varios segundos | Faltan explicación de la demora y claridad de fases. No se puede inferir que la descarga esté detenida. |
| P2 | 46–55 s; tres CTAs visibles a los 52 s | «Descargar» arriba y dos «Descargar estudio original» | Redundancia confirmada. Conviene una acción principal y conservar formato/tamaño/procedencia. |

## Lo que el código permite confirmar

### Preparación del acceso

[app.ts](../src/server/app.ts) devuelve JSON con 409 si el job no es interactivo y 503 si falla la preparación del escritorio. [traer.js](../../portal-pacientes/js/traer.js) muestra el enlace remoto desde `liveBegin`, aunque el estado todavía sea `CREATED` o `OPENING_PROVIDER`: calcula `opened`, pero la rama remota no condiciona el enlace a ese valor.

Esto respalda la hipótesis de una apertura prematura. No demuestra que ese sea el único motivo del error visto. El test remoto existente espera explícitamente `WAITING_FOR_USER_LOGIN` antes de abrir la página, por lo que no cubre la carrera que puede encontrar un usuario al hacer clic inmediatamente.

La solución debe cubrir dos puntos: readiness confirmada en la pestaña principal y una página HTML de preparación/error en `/remote/:jobId`. Ocultar el enlace durante la apertura no alcanza para proteger recargas, enlaces directos o errores de inicialización. Los reintentos deben depender del estado autorizado del job, tener límite y tratar 401/403/expiración de manera diferenciada.

El logger admite `durationMs`, pero el controlador de escritorio no registra actualmente una secuencia completa de preparación y conexión WebSocket. Conviene medir esa secuencia con ID técnico, estado y duración, sin texto del sitio, teclas ni imágenes.

### Reanudación y vuelta al Portal

[remote-desktop.ts](../src/server/remote-desktop.ts) desconecta RFB al aceptar la reanudación y cambia el texto, pero no reemplaza el área del escritorio. Tampoco deshabilita el botón durante la solicitud. Cualquier respuesta no exitosa recibe el mismo mensaje de «todavía no detectamos el ingreso», incluso si la causa es otra.

La pestaña principal ya se actualiza por SSE y el video muestra que llega a la selección. Hay que conservar esa sincronización y mejorar la salida de la pestaña remota. El botón de regreso debe recuperar el mismo job; un enlace que simplemente reinicie «Traer mis estudios» podría producir otra solicitud y el aviso de importación activa. La apertura actual usa `rel="noopener"`, por lo que enfocar automáticamente la pestaña original no puede depender directamente de `window.opener`.

### Persistencia e integridad

[agent.js](../../portal-pacientes/js/agent.js) guarda el Blob en IndexedDB y espera `transaction.oncomplete`. [traer.js](../../portal-pacientes/js/traer.js) persiste la ficha y envía el acuse positivo después de esas escrituras. El gestor elimina los temporales tras entrega/acuse y también aplica retención. Por tanto, `tmpfs` no significa por sí solo que el archivo final desaparezca.

La cobertura existente comprueba recarga del Portal, recuperación de un Blob de tamaño positivo, descarga con extensión ZIP y deduplicación. También tiene casos de fallo de IndexedDB y de persistencia de metadata que evitan mostrar éxito. Eso es una base útil, pero no cubre la combinación pedida: más de cinco minutos, reinicio de Docker, navegación por Estudios/Documentos/Historial y comparación del archivo recuperado.

Dos límites concretos del QA actual:

- El frontend toma el SHA-256 del header del backend; no recalcula allí el hash del Blob recuperado. Comparar metadata con el mismo header no demuestra igualdad de bytes después de guardar/descargar.
- [medical-archive.ts](../src/jobs/medical-archive.ts) verifica firma ZIP y tamaño, no estructura completa ni contenido DICOM. Algunos fixtures de Centro DM son ocho bytes con firma `PK`; no representan un ZIP DICOM completo. La prueba de durabilidad necesita un archivo sintético estructuralmente válido y comparación de tamaño/hash de sus bytes.

IndexedDB depende del navegador/perfil y origen exacto. Cambiar de navegador, equipo, dominio o de HTTP a HTTPS no recupera automáticamente el mismo historial. Incógnito y limpieza de datos necesitan una política/copy explícitos. No corresponde introducir un backend permanente sin definir primero esa expectativa del piloto.

## Orden recomendado para implementar

1. **P0: preparación y errores humanos.** Estado confirmado, página de preparación, reintentos acotados, recuperación/cancelación y medición de tiempos. Probar apertura inmediata, arranque frío/caliente y fallos 409/503/401/403.
2. **P1: comprobar durabilidad.** ZIP DICOM ficticio completo, acuse final, limpieza del worker, espera real superior a cinco minutos, recarga y reinicio Docker conservando el mismo perfil/origen del cliente. Comparar bytes, SHA-256 y tamaño; verificar errores de almacenamiento y reintento sin duplicados.
3. **P1: envoltura del login y regreso.** Institución/paso/instrucciones, disposición adaptable, verificación sin doble clic y confirmación que sustituya el escritorio desconectado. Recuperar el job existente al volver; mantener cancelación y revocación.
4. **P2: progreso y acciones.** Textos centrados en la tarea, fases respaldadas por eventos reales y una descarga principal. Mostrar bytes/porcentaje únicamente si son medibles. Abrir directamente el estudio importado desde el éxito, con salida secundaria a Estudios.

## Condiciones para la siguiente demostración

Debe funcionar desde el primer clic sin respuestas JSON visibles; no dejar una pantalla oscura después de continuar; permitir cancelar/reconectar sin duplicar jobs; recuperar el archivo íntegro después de limpiar temporales y reiniciar Docker, conforme a la política de almacenamiento local; y conservar las regresiones de Centro DM, Pérez Cambet y RDC.

La grabación corresponde al entorno local. No demuestra acceso desde otra computadora, despliegue HTTPS ni historia sincronizada entre dispositivos. Esos puntos siguen siendo requisitos separados del piloto externo.
