# Diagnóstico de fluidez del escritorio remoto

## Lo que está comprobado en el código

Chromium pinta en Xvfb (1280 × 1000 × 24); x11vnc captura esa pantalla, websockify transporta RFB por WebSocket y el backend retransmite el socket mediante streams con backpressure. noVNC decodifica y dibuja en el cliente. El perfil escritorio transmite el framebuffer completo: 1.280.000 píxeles. En móvil se configura el viewport de Playwright y se recorta con `-clip` al contenido calibrado, por ejemplo 390 × 720: 280.800 píxeles. No es correcto inferir que Xvfb o Chromium procesan únicamente el área recortada.

x11vnc arranca con `-noxdamage -noshm`: desactiva, respectivamente, el uso de eventos XDamage y de memoria compartida X para capturar. Esto puede elevar el costo de captura, pero el efecto sobre fluidez, carga y estabilidad depende de las versiones y del entorno. El cliente usa `scaleViewport=true` y `resizeSession=false`. El canvas se escala sin cambiar por sí solo el framebuffer del servidor; el coste de escala y decodificación depende también del dispositivo cliente. La configuración RFB de compresión y calidad es la predeterminada de la versión instalada de noVNC; no hay una tasa de FPS configurada en la aplicación.

El `pipe` del proxy aplica backpressure; eso no permite concluir que no haya colas en TCP, websockify, RFB o noVNC. Tampoco existen contadores de FPS, tráfico o CPU en esta ruta. `requestAnimationFrame` del visor mide oportunidades de muestreo locales, no cuadros remotos. Sin mediciones no es posible atribuir la lentitud a captura, compresión, red ni dibujo, ni prometer 30–60 FPS.

## Medición local inicial

Docker Desktop disponible: se ejecutó Xvfb, Chromium, x11vnc, websockify y noVNC en un contenedor Linux aislado sin red externa ni cuentas. El video aportado, `lag-demo.mp4`, dura 15,1 segundos y está codificado a 30 FPS; esa frecuencia no mide los cuadros recibidos por noVNC. No se analizaron ni almacenaron imágenes de sesiones médicas. El Ryzen, ngrok y teléfonos físicos no se midieron. No se modificaron los parámetros productivos.

En una corrida sintética de 8 s por variante, con generador a ~60 FPS:

| Variante | Móvil 390×720, FPS observados / p95 | Escritorio 1280×1000, FPS / p95 |
| --- | --- | --- |
| Actual: `-noxdamage -noshm` | 20,8 / 83 ms | 12,1 / 150 ms |
| XDamage habilitado, `-noshm` conservado | 21,5 / 83 ms | 14,5 / 100 ms |
| SHM habilitado, `-noxdamage` conservado | 32,7 / 50 ms | 12,5 / 133 ms |
| XDamage y SHM habilitados | 33,5 / 50 ms | 15,7 / 100 ms |
| Actual y `-wait 10` | 22,0 / 83 ms | 12,2 / 167 ms |

Dos repeticiones móviles alternadas posteriores dieron 21,6 y 21,7 FPS con la configuración actual, y 32,9 y 32,8 FPS con SHM. Las demás variantes de la tabla tienen una sola medición; no se extrapolan al servidor.

Las cuatro pruebas E2E existentes de escritorio remoto y modo inmersivo pasaron en la imagen local `portal-immersive-regression:local`, con Xvfb y las restricciones del contenedor. Ejercitan la configuración actual, no validan la variante SHM. También pasaron `node --check` del benchmark y `npm run typecheck` local.

Esta prueba no aísla el costo de escalado, decodificación o captura y no mide internet; son resultados preliminares locales, no una promesa de FPS en Ryzen. En la primera comparación móvil, x11vnc mostró `ps %CPU` medio de 26,5% en base y 18,1% con SHM; recibió 216.821 y 258.279 bytes WebSocket, respectivamente. El %CPU de `ps` representa promedio de vida del proceso, no CPU instantánea de cada intervalo; RSS suma procesos y puede contar memoria compartida más de una vez. El cliente y la fuente Chromium se contabilizan juntos. SHM es candidato prometedor para móvil, pero requiere comprobar estabilidad, imágenes parciales, recursos y seguridad bajo las condiciones reales antes de activarlo.

El contador está codificado en píxeles sintéticos del canvas: se leen cambios mediante `requestAnimationFrame`, que solo marca el máximo de muestreo. Los saltos son cuadros no observados; no prueban pérdida de red. La lectura puede tomar un contador parcialmente actualizado (la salida incluye muestras retrocedidas) y `getImageData` agrega costo. `outboundBufferedBytes` es únicamente la cola de envíos del cliente, no la cola entrante; no hay medición de backlog de recepción ni de la sobrecarga del propio muestreo. El visor sintético se conecta directamente al websockify local, sin el proxy HTTP del Portal ni ngrok, por lo que no mide toda la cadena de producción.

Para reproducir en Windows, desde la raíz del repositorio y con Docker iniciado:

```powershell
.\portal-pacientes-agent\scripts\benchmark-remote-windows.ps1 -Profile mobile -Variant baseline -Seconds 12
.\portal-pacientes-agent\scripts\benchmark-remote-windows.ps1 -Profile mobile -Variant shm -Seconds 12
.\portal-pacientes-agent\scripts\benchmark-remote-windows.ps1 -Profile desktop -Variant baseline -Seconds 12
```

El parámetro `-Image` selecciona una imagen local del proyecto con Playwright, noVNC, x11vnc y websockify; el valor predeterminado es `portal-immersive-regression:local`. El script usa únicamente mounts de código de solo lectura, sin volumen de pacientes, `--network none`, usuario 1000, sistema de archivos de solo lectura y el perfil seccomp del repositorio. La salida JSON informa geometría, cuadros de origen/observados, intervalos, tráfico y muestras de procesos. Variantes: `baseline`, `damage`, `shm`, `both` y `wait10`. Alternar el orden y repetir; no correrlas simultáneamente.

## Validación pendiente

La prueba debe correr contra contenido sintético, con un proyecto y puertos aislados, sin conectar cuentas ni datos médicos. Usar el mismo contenedor, versión de x11vnc/noVNC, CPU y límites del entorno que se quiere evaluar, manteniendo seccomp y sandbox. El generador debe dibujar un contador de cuadros codificado en bloques de color y animación/scroll sintético; el cliente debe leer ese contador del **canvas de noVNC** y registrar los cambios observados. Un muestreo a `requestAnimationFrame` sirve únicamente para observar el canvas: su frecuencia limita la medición y los saltos del contador indican cuadros no observados, no necesariamente pérdidas de red. Reportar intervalos p50/p95/p99, FPS observados, saltos, duración y tasa del generador. El muestreo frecuente de píxeles puede afectar el rendimiento: cuantificar su sobrecarga con y sin muestreo.

Recoger CPU y RSS por proceso (Chromium y sus hijos, Xvfb, x11vnc, websockify y cliente), bytes WebSocket recibidos por segundo y muestras de colas en cada extremo; `WebSocket.bufferedAmount` mide solo envíos pendientes de ese WebSocket, no su cola de recepción. Identificar versión, resolución, escalado, dimensiones y conexión del cliente. Comparar por separado bucle local y trayecto ngrok, sin modificar configuración de ngrok. La referencia debe medir al menos tres repeticiones y separar calentamiento de ventana medida.

Matriz A/B de una sola variable, con escritorio y móvil: base actual; después habilitar solo XDamage; después solo MIT-SHM; luego ambos; después comparar ajustes de compresión/calidad de noVNC, sin alterar la calidad por defecto en otras pruebas. Verificar explícitamente texto, scroll, ventanas superpuestas, cursor, actualizaciones parciales, reconexión y teclado en cada variante. Evaluar resolución y escala en una serie separada, manteniendo correspondencia táctil. Anotar casos fallidos o artefactos, no solo el mayor FPS. Para una comparación limpia reiniciar únicamente el entorno sintético entre corridas.

La comparación en Ryzen, pruebas con proxy y calidad visual permanecen pendientes. La alternativa de otro servidor RFB debe evaluarse solo si estas mediciones muestran un límite persistente de x11vnc; exige verificar compatibilidad con X11, recorte, seguridad, teclado y comportamiento de ventanas antes de considerarse.

## Despliegue y rollback

No hay cambios de producción para desplegar. Cuando exista una variante medida y validada, preservar previamente imagen y configuración actuales, revisar cambios locales del servidor y probar una imagen candidata aislada con el mismo perfil de seguridad y datos sintéticos. Recién después actualizar el servicio acordado con sus mismos proyecto, variables y volúmenes. Para volver atrás, recrear el servicio con la imagen y configuración anteriores sin eliminar volúmenes. El detalle de los comandos depende del proyecto Compose e imagen efectivos del Ryzen, que no fueron inspeccionados en esta investigación.
