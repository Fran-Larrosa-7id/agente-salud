# PoC de transmisión: KasmVNC y referencia noVNC

Preparada el 6 de noviembre de 2026. **No ejecutada todavía en Docker Linux desde este entorno:** Docker Desktop no respondió. No hay resultados nuevos del Ryzen ni una conclusión demostrada sobre el cuello de botella. Los +51 % / +22 % informados por el usuario pertenecen al experimento anterior y no equivalen a una mejora perceptible ni se comparan directamente con esta nueva escena.

## Qué se investigó

La versión estable consultada es [KasmVNC 1.5.2](https://github.com/kasmtech/KasmVNC/releases/tag/v1.5.2), con una corrección del parser de handshake WebSocket. La imagen usa el paquete oficial Ubuntu Noble amd64 y su [SHA-256 publicado](https://github.com/kasmtech/KasmVNC/releases/expanded_assets/v1.5.2). No usa una etiqueta `latest` de Kasm ni una imagen de Workspaces con privilegios adicionales.

Según su [configuración oficial](https://docs.kasmvnc.com/docs/configuration/), KasmVNC sirve su propio cliente y usa un protocolo distinto del RFB de noVNC. En esta PoC Xkasmvnc sustituye a Xvfb y x11vnc para las variantes Kasm. Playwright sigue controlando Chromium por su canal habitual. No se sustituyen selectores, extractores ni autenticación de instituciones.

El [modo streaming](https://docs.kasmvnc.com/docs/video_streaming_mode) admite H.264, H.265 y AV1, con codificación software o hardware según disponibilidad. Aquí se prueba software: no se monta GPU ni se agregan permisos. H.264 es la primera candidata; las otras dos tienen una serie opcional. La selección solicitada no basta: el programa exige más de 30 entregas del decodificador correspondiente después del calentamiento, excluyendo las pruebas iniciales de capacidad del cliente. Si el servidor o Chromium empaquetado no soportan el codec, la corrida falla; un fallback a imágenes no se presenta como éxito de video.

La [documentación de autenticación](https://docs.kasmvnc.com/docs/serverside) advierte una limitación de Basic Auth por WebSocket en Safari directo. Por ello la PoC directa no demuestra compatibilidad iPhone ni constituye un adaptador de autenticación para pacientes.

## Archivos y límites

Todo el código nuevo está en `scripts/remote-poc/`; el Dockerfile productivo, Compose, seccomp y el servidor del Portal no se modifican. La imagen parte de una imagen independiente del proyecto, agrega KasmVNC, FFmpeg y herramientas de diagnóstico. Las ejecuciones automáticas usan UID/GID 1000, filesystem de solo lectura, capacidades eliminadas, `no-new-privileges`, seccomp existente, `/dev/shm` de 1 GiB y **red deshabilitada**. Solo el directorio nuevo de resultados se monta para escritura. No hay env-files, SQLite, volúmenes del Portal, cuentas ni datos médicos.

Las variantes noVNC llaman al lanzador `RemoteDesktop` real con un job sintético en memoria. La opción `portal_proxy` pasa por su manejador real de upgrade, con cookie temporal de propietario, token y validación de origen. Solo se adapta la resolución del propietario para esta sesión aislada. No se inicia Express, OAuth ni almacenamiento. Kasm va directo a su HTTPS/WSS interno: todavía no se implementa su adaptador al proxy del Portal.

El X11 interno tiene Xauthority. Kasm conserva Basic Auth y TLS con una credencial aleatoria temporal. Se genera un certificado exclusivo del contenedor y se confía en él solo en su almacén NSS efímero. No se usa `ignoreHTTPSErrors`, no se permite autenticación Basic desactivada y se verifica rechazo 401 tanto del HTTP sin credencial como del upgrade WebSocket observado. `SecurityTypes None` se refiere al desafío VNC tradicional interior; el control de acceso sigue en HTTPS Basic de Kasm. Si esas comprobaciones fallan, no se acepta el resultado.

## Ejecutar en Ryzen

Desde una copia revisada de esta versión, como el usuario UID 1000, en la raíz del repo:

```bash
docker build -t portal-fps-benchmark:local .
docker build -f portal-pacientes-agent/scripts/remote-poc/Dockerfile -t portal-stream-poc:1.5.2 .

node --test portal-pacientes-agent/scripts/remote-poc/metrics.test.mjs portal-pacientes-agent/scripts/remote-poc/summarize.test.mjs

bash portal-pacientes-agent/scripts/remote-poc/run-linux.sh "poc-smoke-$(date +%Y%m%d-%H%M%S)" smoke
```

La última orden verifica primero los tests de métricas y de la escena con Chromium dentro de Docker (`unit-tests.log`); luego ejecuta cinco comprobaciones de escritorio. Un fallo queda en el `diagnostics.log` de su caso y las demás corridas continúan; la serie termina con código distinto de cero si hubo fallos. El estado de un codec no soportado debe revisarse explícitamente, sin confundirlo con un fallo de red ni con inviabilidad general de Kasm.

En Windows se omite únicamente la prueba de navegador cuando Chromium empaquetado no está instalado. En esta sesión pasaron cuatro tests nuevos de métricas/sintaxis y 146 tests unitarios existentes, además de typecheck y comprobaciones de sintaxis. La prueba de escena en navegador quedó omitida por ausencia del ejecutable local; Docker/smoke y pruebas funcionales permanecen pendientes.

Después del smoke, ejecutar por separado, sin otras cargas simultáneas:

```bash
# 36 corridas: tres por variante y perfil, con orden rotado.
bash portal-pacientes-agent/scripts/remote-poc/run-linux.sh "poc-compare-$(date +%Y%m%d-%H%M%S)" compare

# Escalado nativo/mitad; para noVNC también directo/proxy real del Portal.
bash portal-pacientes-agent/scripts/remote-poc/run-linux.sh "poc-effects-$(date +%Y%m%d-%H%M%S)" effects

# Scroll de 30 s, texto, puntero, menús, dialog, ventana X11, píxeles y reconexión.
bash portal-pacientes-agent/scripts/remote-poc/run-linux.sh "poc-functional-$(date +%Y%m%d-%H%M%S)" functional

# Opcional: compatibilidad y coste software de H.265/AV1, además de H.264/imágenes.
bash portal-pacientes-agent/scripts/remote-poc/run-linux.sh "poc-codecs-$(date +%Y%m%d-%H%M%S)" codecs

# Resumen: indicar el directorio real generado por una suite, no mezclar versiones.
node portal-pacientes-agent/scripts/remote-poc/summarize.mjs DIRECTORIO_DE_RESULTADOS
```

`POC_SECONDS=30` y `POC_WARMUP=5` permiten modificar las ventanas. Las pruebas de 30 segundos de scroll se añaden fuera de la medición de rendimiento y CPU. `POC_TRACE=1` agrega una traza sintética CDP a cada caso; usar una serie aparte por su sobrecarga. `POC_RECORD_VIDEO=1` guarda WebM del visor para revisar contenido, también en una serie aparte. La grabación de Playwright tiene su propia frecuencia de captura y no demuestra 60 FPS ni reproduce la pantalla de un teléfono físico.

## Qué mide y cómo decidir

| Medida | Significado y límite |
| --- | --- |
| `generatedCallbacksPerSecond` | Ciclos del generador; no demuestra presentación de Chromium. |
| `nativeX11.changesPerSecond` | Contadores coherentes leídos del framebuffer por FFmpeg x11grab a 60 muestras/s. Es una observación de memoria X11, limitada por su muestreo; no es un monitor físico. |
| `client.changesPerSecond` | Cambios coherentes del marcador en el canvas visible. Su lectura con rAF puede perturbar el visor. |
| `intervalMs` | Intervalos p50, p95, p99 y máximo entre cambios aceptados. Importa la regularidad y los congelamientos. |
| `invalidMarkers` / `backwards` | Copias distintas, contraste ambiguo o secuencia regresiva. Ayudan a investigar lecturas parciales; por sí solas no prueban ni descartan artefactos. |
| CPU / RSS por proceso | CPU por diferencias de ticks de `/proc` y RSS por grupo; fuente y visor Chromium separados por árbol de procesos. CPU de procesos que ya salieron puede perderse; RSS puede contar páginas compartidas varias veces. |
| `payloadBytesPerSecond` | Carga de datos WebSocket recibidos; excluye overhead TLS/TCP y no mide cola entrante. |
| `decoderCodecs` | Codecs que entregaron frames después del calentamiento; revisar junto a logs y modo seleccionado. |

La lectura X11 se ejecuta solo en `source_xvfb`/`source_kasm` por defecto. FFmpeg lee el framebuffer completo y recorta únicamente la salida del marcador: consume CPU y memoria. Las corridas cliente no incluyen esa captura, para no atribuir su sobrecarga a VNC. Las trazas CDP permiten inspeccionar trabajo de pintura/composición; no traducir el número de eventos `Paint` o de callbacks en FPS reales sin comprobar qué representa cada evento.

Si X11 ya presenta largos intervalos, investigar Chromium/Xserver antes de atribuir el problema al transporte. Si X11 mantiene intervalos cortos y el cliente agrupa cambios, comparar captura/codificación, CPU del servidor, decodificación del visor y regularidad. En x11vnc captura y codificación comparten proceso: su CPU no separa ambos costes. Xkasmvnc combina Xserver y codificación, por lo que tampoco es comparable proceso a proceso con Xvfb aislado. Para atribución más fina hacen falta las trazas y logs; esta PoC no inventa tiempos separados de encode/capture.

Escritorio compara framebuffer 1280×1000 y profundidad X de 24 bits en todas las variantes. La profundidad no implica necesariamente almacenamiento de tres bytes por píxel: registrar también el formato real de X11. Móvil usa un framebuffer nativo 390×844 y viewport responsive 390×720 para ambas tecnologías. **Es una serie distinta del recorte móvil productivo** de una pantalla Xvfb grande; no extrapolar sus cifras sin validar esa integración. `half` solo reduce el tamaño CSS del visor, conserva los píxeles del framebuffer y permite observar el coste del escalado. No se baja la profundidad ni la resolución para inflar cifras de escritorio.

La escena contiene texto, scroll, menús, diálogo y un bloque cambiante; el test funcional contrasta una cuadrícula de píxeles del canvas con el viewport sintético de origen ya detenido. Añade superposición de una ventana Chromium nativa y comprueba restauración. Puede perder artefactos pequeños entre muestras o diferencias dentro del umbral. El scroll automatizado usa rueda, no inercia de dedo física. Los codecs tienen valores de calidad distintos y no se asume equivalencia perceptiva por sus números: comparar nitidez durante movimiento y texto detenido.

La suite `effects` usa el proxy Node real únicamente en bucle local y en noVNC. No mide Internet, ngrok, TLS de producción ni Kasm detrás de ese proxy. El Ryzen remoto y los clientes físicos deben medirse después; la CPU del visor headless en el mismo servidor añade carga que un cliente externo no produciría.

## Revisión humana opcional de Kasm

Primero debe pasar el smoke. La vista opcional escucha exclusivamente en `127.0.0.1:8899` del host; no usa ni reconfigura ngrok ni los puertos 8787/8888. A diferencia de las suites sin red, utiliza la red bridge normal de Docker para permitir el acceso por loopback. El origen Chromium sigue limitado por rutas Playwright a la escena interna. No se deben introducir datos reales.

El script de preview exige Docker Engine 28 o posterior por el comportamiento de publicación en localhost documentado por [Docker](https://docs.docker.com/engine/network/port-publishing/). Las suites automáticas no publican ningún puerto.

```bash
bash portal-pacientes-agent/scripts/remote-poc/preview-linux.sh kasm_h264
# O comparar el cliente de imágenes, con el mismo contenido:
# bash portal-pacientes-agent/scripts/remote-poc/preview-linux.sh kasm_image
# Usar POC_PROFILE=mobile para crear la sesión de tamaño móvil.
```

El script imprime el nombre exacto del contenedor, URL, credencial efímera y comandos para exportar su certificado público, detenerlo y eliminarlo. La sesión expira a los 20 minutos. Conservar los logs de fallos antes de eliminar su contenedor. El puerto ocupado hace fallar el inicio; no se detiene ningún servicio para liberarlo.

Para observar desde otro equipo usar un forward **local** de la conexión SSH existente: `ssh -N -L 127.0.0.1:8899:127.0.0.1:8899 USUARIO@RYZEN`. Requiere que el puerto local esté libre. El certificado generado cubre localhost y 127.0.0.1; debe confiarse explícitamente en él en un perfil de prueba, sin omitir validación ni ignorar avisos del navegador. El script no instala confianza en el host ni en el teléfono. La revisión física móvil exige preparar un acceso privado equivalente y certificado válido; Safari directo tiene además la limitación de Basic Auth indicada arriba.

Probar texto pequeño, lectura durante scroll y movimiento lento, teclas especiales, teclado nativo, zoom, orientación, reconexión y campos conservados. Pausar la animación con el botón de la escena para navegar manualmente. Un video grabado o el FPS de la interfaz no sustituyen estas pruebas. Revisar el codec seleccionado en el cliente: si cambia a imágenes, anotarlo.

## Coste de integración y recomendación actual

Mantener noVNC hasta ejecutar la PoC y demostrar mejora perceptiva reproducible. Kasm es una candidata viable para investigar, no una migración validada. El posible beneficio es codificar movimiento como video y evitar el escaneo separado de x11vnc; su magnitud y el coste de CPU software en Ryzen están pendientes de medir.

Una integración requiere gestión del ciclo de vida Xkasmvnc por sesión, coordinación de viewport/tamaño X11, assets del cliente, métricas y teardown, además de un adaptador HTTPS/WSS por propietario/job. Debe preservar origen, tokens y caducidad del Portal e inyectar la credencial interna de Kasm sin exponerla al paciente. Requiere probar Safari mediante ese adaptador, cabeceras COOP/COEP, teclado y reconexión. No se debe conectar simplemente el cliente Kasm al endpoint RFB actual ni montar dispositivos GPU para superar una prueba fallida bajo seccomp. Si hay incompatibilidad con las restricciones, registrar el syscall/error y detener esa variante.

Como alternativa siguiente, [Xpra HTML5](https://xpra-org.github.io/xpra/Usage/Clients.html) dispone de transporte HTTPS/WSS y decodificación de video en el navegador. También exige cambiar el servidor de sesión y el adaptador de protocolo/autenticación, y probar entrada móvil. No se implementa una segunda PoC antes de saber si Kasm falla por protocolo, recursos, codec del cliente o sandbox. No hay motivo demostrado todavía para declarar ninguna de las dos opciones superior.

Rollback del experimento: detener/eliminar únicamente los contenedores de preview con los nombres que imprime el script. Las suites ya eliminan sus contenedores al terminar. No se ejecuta Compose, no se cambia ninguna variable de captura del Portal y no hay volúmenes de pacientes que revertir. No se hizo push, merge ni despliegue.
