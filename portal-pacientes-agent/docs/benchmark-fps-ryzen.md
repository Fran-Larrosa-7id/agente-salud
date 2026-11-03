# Captura experimental y benchmark aislado

El modo predeterminado sigue siendo `legacy`. `REMOTE_CAPTURE_MODE` admite exclusivamente:

| Valor | Argumentos adicionales de x11vnc |
| --- | --- |
| `legacy` o variable ausente | `-noxdamage -noshm` |
| `shm` | `-noxdamage` |
| `shm_damage` | ninguno de esos dos |

Los demás argumentos existentes, incluido el recorte móvil, no cambian. Un valor distinto falla al abrir el escritorio; no se interpreta como argumento. Habilitar una opción no demuestra que el servidor X la utilice: se debe verificar el comportamiento y los logs de x11vnc en la imagen objetivo. No activar variantes en producción antes de validar integridad y estabilidad.

## Ejecutar en Ryzen, sin usar el Portal

En una copia de trabajo revisada con estos cambios, desde la raíz, construir una imagen independiente y luego lanzar el benchmark; no utiliza Compose, credenciales, volúmenes ni red externa:

```bash
docker build -t portal-fps-benchmark:local .
BENCH_IMAGE=portal-fps-benchmark:local BENCH_SECONDS=20 BENCH_WARMUP_SECONDS=5 \
  bash portal-pacientes-agent/scripts/benchmark-remote-linux.sh "fps-ryzen-$(date +%Y%m%d-%H%M%S)"
```

El directorio de salida debe ser nuevo. Hay 18 corridas secuenciales: tres por modo y perfil, con orden alternado. Cada corrida crea un contenedor independiente con red deshabilitada, UID/GID 1000, filesystem de solo lectura, capacidades eliminadas, no-new-privileges, seccomp del repositorio y 1 GiB de `/dev/shm`; no requiere Google ni conexión a instituciones. La imagen y el perfil deben corresponder a la versión a evaluar. Registrar versión de imagen, Docker, CPU, carga y límites de recursos para interpretar resultados. Evitar ejecutar carga adicional durante las pruebas.

Cada JSON contiene dimensiones, argumentos efectivos, tiempo de calentamiento, conteo del generador, cambios observados, intervalos p50/p95/p99, bytes y mensajes WebSocket, muestras de procesos y lecturas inconsistentes del contador. Dividir bytes por segundos para tráfico aproximado. `sourceFps` es la frecuencia del generador con `requestAnimationFrame`, no mide los FPS de presentación de Chromium. `observedFps` cuenta cambios muestreados en el canvas noVNC, no frames exactos ni FPS de pantalla física. Los saltos o retrocesos pueden ser lecturas parciales; no prueban por sí solos errores de visualización. El coste de lectura del canvas afecta la medición. `ps` informa CPU promedio de vida y RSS agregado puede contar memoria compartida varias veces; Chromium fuente y visor no se separan. La cola WebSocket informada es solo de salida del cliente.

Esta prueba mide loopback directamente a websockify, no proxy ni HTTPS/ngrok. La funcionalidad de scroll, formularios y tipeo, puntero, menús, popups, superposición, reconexión, actualizaciones parciales y escritura con teclado móvil **no está cubierta** por este benchmark. Antes de recomendar un modo, ejecutar esas pruebas con contenido sintético para cada variante y perfil, revisar artefactos con distintas duraciones y confirmar MIT-SHM/XDamage bajo las restricciones reales. Evaluar el trayecto remoto mediante una instancia y túnel sintéticos separados, sin modificar ngrok productivo; esta herramienta aún no automatiza esa comparación. No interpretar una mejora local como resultado de red.

## Despliegue futuro y rollback

Pendiente hasta tener las mediciones y pruebas anteriores. Inspeccionar primero configuración efectiva y procedencia de imagen del proyecto `portal-google-ryzen`, registrar de manera segura el identificador de imagen y configuración anteriores y verificar cambios locales. Preparar y revisar una imagen candidata sin reconstruir ni reiniciar el servicio activo. Una vez autorizado el despliegue, cambiar solo la imagen y, si se ha validado, definir `REMOTE_CAPTURE_MODE` en el entorno privado del servicio; conservar proyecto, puertos, volúmenes y protecciones. No imprimir ni subir ese entorno. Para rollback, restaurar la imagen y configuración guardadas y recrear solo el servicio portal; quitar la variable o fijar `legacy` restaura la captura anterior. No usar `down -v` ni borrar volúmenes. Los comandos concretos dependen de la configuración real del Ryzen, que no se inspeccionó.
