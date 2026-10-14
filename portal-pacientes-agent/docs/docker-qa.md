# QA de la primera fase Docker local

Fecha: 13/10/2026. Entorno: Docker Desktop, motor Linux, imagen `mcr.microsoft.com/playwright:v1.55.1-noble`, paquete Playwright 1.55.1. No se utilizaron credenciales médicas ni se accedió a estudios reales.

## Resultados públicos comprobados

| Prueba | Resultado |
| --- | --- |
| Build con `npm ci` y typecheck dentro de la imagen | Correcto |
| Compose con usuario 1000, filesystem de solo lectura y `cap_drop: ALL` | Arranca y queda healthy |
| `/health` | HTTP 200; únicamente `{ok:true}` |
| API con credenciales privadas del piloto | HTTP 200, `browserReady=true`, `modelReady=true` |
| Portal sin autenticación | HTTP 401 |
| Chromium headed bajo Xvfb con sandbox | Arranque comprobado |
| `https://example.com` en Chromium del contenedor | HTTP 200 |
| Pérez Cambet, página pública de ingreso | HTTP 200 |
| Centro DM, página pública de ingreso | HTTP 200 |
| RDC Chacabuco, página pública de ingreso | HTTP 200 |
| Smoke: cierre de contextos y proceso Chromium | Correcto |
| Procesos tras terminar la suite | Sin procesos Chromium; solo init, Xvfb, backend y esbuild |
| `down` seguido de `up -d --wait` | Detiene, elimina temporales RAM y vuelve a healthy |
| `npm audit` después del parche 1.55.1 | 0 vulnerabilidades reportadas |
| `.env` del agente y `.env.docker` en imagen | Ausentes; `.env.docker` ignorado por Git |

Registro reproducible de las navegaciones: [docker-smoke.txt](docker-smoke.txt). Los comandos completos están en [docker-mvp.md](docker-mvp.md).

## Integraciones y compatibilidad

Se conservan los selectores y mecanismos de cada integración. Los E2E usan exclusivamente portales ficticios:

- Pérez Cambet: login simulado, descubrimiento, selección, HTTP autenticado, redirects con allowlist, popups, data PDF, downloads y asociación estudio/archivo.
- Centro DM/Pixeon: toolbar tardía, consentimiento, menús DOM y shadow DOM, origen/puerto exactos, ZIP DICOM y persistencia en el Portal.
- RDC: modal único, fuentes iframe/embed/blob, HTML intermedio, respuestas por rangos, validación de PDF, cierre y deduplicación.
- Ciclo de vida: timeout, cancelación mientras se abre Chromium, cierre concurrente del contexto, cierre del proceso tras el último contexto y nuevo proceso para el siguiente job.
- API: autenticación, SSE, selección, descarga y acuses de persistencia. Se bloquean mutaciones de otro origen.

Las comprobaciones Windows iniciales no pudieron iniciar el ejecutable esperado de Chromium; no se las cuenta como exitosas. La validación objetivo se realiza dentro de Docker Linux. Chromium/Linux puede emitir downloads para PDFs embebidos o data PDF, y recuperar por HTTP el PDF de un popup antes de su response event. Las pruebas aceptan esos mecanismos legítimos, manteniendo validación de bytes y comparación exacta del fixture data PDF. Se corrigió también una carrera de hashchange del test frontend de RDC y se mantuvo vivo el timer del fetch simulado de Ollama en Node/Linux.

Resultado final de la suite general dentro del contenedor: **165 tests aprobados, 0 fallos, 0 cancelados** (157 s). El test que requiere DISPLAY se ejecuta aparte: **1 aprobado**, sin fallos; en la suite general se omite ese único test. Typecheck correcto durante el build. Ver [docker-tests.txt](docker-tests.txt) y [remote-tests.txt](remote-tests.txt).

## No probado y bloqueos

Actualización del aviso de importación activa: el error 429 devuelve el ID técnico del job y el Portal muestra «Cancelar importación en curso» dentro del recuadro. Probado el caso de recarga sin job en memoria: cancela RDC simulado y permite abrir Centro DM. Test E2E específico aprobado; 77 tests unitarios aprobados y typecheck correcto.

Corrección del escritorio negro: la CSP bloqueaba los tiles PNG/JPEG `data:` de noVNC. Se permite `img-src 'self' data:` en la página del desktop. El test remoto ahora fuerza un fondo de colores en el portal ficticio, comprueba píxeles visibles del canvas y ausencia de violaciones CSP antes de probar teclado/login/reanudación/cancelación. Falló con la política anterior y pasó tras la corrección. Solo se inspeccionan píxeles del fixture, nunca pantallas de instituciones reales.

- Login real y descarga de documentos reales de ninguna institución: **no probado**. Acceder a un login público no valida la integración autenticada.
- Login interactivo por noVNC en Docker: **implementado y probado con login ficticio**. [remote-tests.txt](remote-tests.txt) verifica escritura por VNC, mismo contexto, reanudación explícita, cancelación y rechazo de sockets sin cookie, con origen externo o cookie revocada. El test corre aislado, sin credenciales reales. Acceso desde otra computadora y HTTPS: **todavía no probado ni desplegado**.
- VPS Linux, HTTPS con dominio real y piloto privado remoto: **no desplegado**. Falta destino y QA del flujo remoto simulado antes del despliegue.
- Datos médicos reales: **no usados**. La revisión de consentimiento, retención, ubicación/transferencia y condiciones con proveedores del documento sigue pendiente antes de habilitarlos.

Esta entrega permite usar el navegador de Docker desde una pestaña del Portal local. El uso desde la casa del usuario remoto sigue pendiente del despliegue HTTPS.
