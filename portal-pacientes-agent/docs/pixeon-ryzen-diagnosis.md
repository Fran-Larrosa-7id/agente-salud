# Pixeon en Ryzen: evidencia y diagnóstico pendiente

## Lo confirmado

En la revisión local base `7c45686`, `findPixeonFrame()` sumaba 2 por origen configurado y 2 por marca Pixeon/Aurora. Con 4 emitía readiness aunque no existiese ningún control. Un título HTML en el origen permitido bastaba. Es una causa confirmada del falso positivo; no explica por sí misma por qué la aplicación real quedó sin toolbar.

El código local de Centro DM permite `https://curie.centrodm.com.ar:8090` y fuentes Google como subrecursos. No permite jsDelivr ni Tag Manager. Los logs aportados no incluyen tipo, página solicitante ni dependencia; tampoco hay revisión/configuración o logs comparables del Athlon. No se puede afirmar que el CDN sea necesario, que Athlon lo permitiese ni que el hardware sea la causa. No se agregó ninguna excepción de dominio.

## Corrección local

- La apertura espera identidad del visor, `document.readyState` distinto de `loading` y una acción de descarga visible y habilitada. Reutiliza el finder semántico existente, incluido `.downloadToolsItem`, shadow DOM abierto y frames permitidos. El sondeo depende de esas condiciones y tiene deadline; no agrega esperas fijas para adivinar cuándo terminó la SPA.
- Un visor identificado sin acción disponible devuelve `VIEWER_INITIALIZATION_TIMEOUT`. Se conserva el código específico en la cola y se aplica la retención DEV existente, con TTL y cancelación. Una página sin identidad conserva `VIEWER_NOT_RECOGNIZED`.
- `pixeon_readiness` separa documento cargado, identidad, controles observados y disponibilidad de descarga. `toolbarBuilt` significa toolbar semántica detectada o control de descarga presente: no demuestra que todos los componentes de Pixeon estén operativos. Un DOM visible/habilitado tampoco demuestra que el listener JavaScript esté conectado. La apertura efectiva del menú después del click es la comprobación funcional siguiente; si falla, conserva `DOWNLOAD_MENU_NOT_FOUND`.
- `pixeon_resource_blocked`: tipo Chromium (`script`, `stylesheet`, etc.), contexto (`subresource`, `main_navigation`, `frame_navigation`), página (`portal`, `viewer`, `other`), host/puerto destino y host del frame solicitante. Este último identifica el frame, no una pila JavaScript de iniciadores. Los redirects de documentos del visor siguen bajo el guard específico y sus eventos existentes.
- `pixeon_script_error`: solo categoría permitida (`SyntaxError`, `ReferenceError`, `TypeError`, `other`) y página; no guarda mensaje ni stack. Un error no prueba por sí solo relación causal con un bloqueo.
- `pixeon_runtime`: versión real del navegador, headless y timeouts efectivos de la sesión. Los eventos anteriores y la validación de archivo se registran a nivel info; no requieren habilitar capturas ni logs crudos.

No se modificaron hosts permitidos, sandbox, seccomp, perfiles de aislamiento, propietario, otros extractores, OAuth, SQLite ni despliegues.

## Diagnóstico seguro a ejecutar en Ryzen

No se desplegó ni reinició Ubuntu desde este trabajo. Los eventos nuevos requieren que el operador instale esta revisión por su procedimiento autorizado; hasta entonces solo están disponibles los eventos del código anterior.

1. En el checkout realmente utilizado por el agente, registrar únicamente estos metadatos de código/runtime (no ejecutar `env`, `printenv`, `cat .env`, dumps de configuración, `docker inspect` completo ni lectura de bases de datos):

   ```sh
   git rev-parse HEAD
   git status --short -- src/browser/session.ts src/browser/pixeon-download.ts src/security/domain-policy.ts src/providers/centrodm/centrodm.provider.ts src/config.ts package-lock.json
   sha256sum src/browser/session.ts src/browser/pixeon-download.ts src/security/domain-policy.ts src/providers/centrodm/centrodm.provider.ts src/config.ts package-lock.json
   node --version
   npm ls playwright --depth=0
   ```

   Ejecutar Node/npm en el mismo runtime/contenedor del servicio, sin cambiarlo. Identificar también imagen/digest y la configuración efectiva de canal Chromium, sandbox y perfil seccomp desde los campos concretos de la definición de despliegue, sin exportar variables ni argumentos que contengan secretos. Los timeouts/headless/versión del navegador salen de `pixeon_runtime`; el origin efectivo del visor sale de `centrodm_viewer_origin` y los bloqueos del guard. No aumentar timeouts antes de observar el estado final.

2. Con la política intacta y sin debug de artefactos ni `AGENT_DEBUG_ERRORS`, iniciar sesión manualmente y seleccionar **un solo estudio**. Registrar únicamente eventos sanitizados de esa ejecución: `pixeon_runtime`, `centrodm_viewer_origin`, `navigation_guard`, `pixeon_resource_blocked`, `pixeon_script_error`, `pixeon_readiness`, resultado del finder/menú, código final y, si avanza, `centrodm_archive_valid`, importación/confirmación de Drive. No guardar HAR, trace, screenshot, HTML, consola cruda, solicitudes/respuestas, headers, credenciales, tokens ni metadata clínica.

3. Si jsDelivr queda bloqueado, distinguir primero `pageContext=portal` de `viewer` y `resourceType=script` de `stylesheet`/otros. En una sesión DEV autorizada, se puede usar la retención temporal documentada para inspeccionar **localmente** Network/Initiator en DevTools. No exportar Network/HAR ni copiar URLs completas, mensajes o stacks. Identificar manualmente solo paquete público, versión fija y archivo estático; descartar query, fragmento, identificadores de estudio/paciente y cualquier URL no demostrablemente pública. Si no puede sanitizarse con certeza, reportar solo tipo y contexto.

4. Para atribuir causalidad hace falta revisar esa dependencia pública y su iniciador, y reproducir con un fixture sintético cuya toolbar dependa del recurso exacto. El fixture actual prueba que el guard bloquea scripts/CSS externos y que no se declara readiness con un contenedor incompleto; no prueba qué dependencia usa el portal real. No desactivar el guard ni probar una allowlist global sobre una sesión de paciente. Si se confirma una dependencia necesaria y confiable, una futura excepción debe limitar proveedor, frame iniciador permitido, HTTPS/origin/puerto, método GET, tipo script/CSS y ruta pública versionada revisada; bloquear documentos, fetch/XHR arbitrarios, archivos descargables y redirects externos. Agregar tests positivos/negativos antes de probarla.

5. Comparar con evidencia **ya disponible** del Athlon (commit, hashes, versiones y logs sanitizados históricos). No acceder a él, reiniciarlo ni modificarlo. Si esa evidencia no existe, la comparación sigue pendiente; dos CPUs distintas no establecen causalidad.

## Criterio de aceptación real

En Ryzen, repetir con un estudio autorizado desde desktop y desde móvil: visor abierto en origin permitido → readiness con descarga → click semántico → menú visible → opción exclusivamente todas las series ZIP DCM sin viewer → descarga del archivo original → tamaño y magic ZIP válidos → recepción/confirmación de guardado en Drive por el propietario correcto → estado final de importación. Comprobar el archivo dentro del entorno autorizado; no adjuntarlo ni registrar contenido, nombres o metadatos médicos. Si el proceso queda antes de Drive, no declarar una importación completa.

Los tests de esta revisión usan datos sintéticos: contenedor con branding, toolbar sin descarga, control oculto/deshabilitado, script y CSS bloqueados, error de script sin mensaje, render tardío en shadow DOM, apertura de menú y conservación byte a byte del artefacto de fixture en desktop/móvil. El fixture ZIP es mínimo, con firma ZIP: no es un estudio DICOM real ni prueba la integridad interna de un ZIP clínico. Se mantienen pruebas de consentimiento, frames, navegación/redirects, estudio seleccionado, cola, cleanup/TTL y sandbox. No se ejecutan cuentas reales de Drive ni se modifican SQLite/OAuth para esta validación.

## Validación local ejecutada

`npm run typecheck`: correcto. La siguiente selección dio **85 tests pasados, 0 fallidos**, en Windows con Edge instalado (`BROWSER_CHANNEL=msedge`) y las opciones de sandbox del helper existente, sin cambios de configuración del proyecto. No constituye una prueba de Chromium/seccomp en Ubuntu.

```sh
node --import tsx --test --test-concurrency=1 test/e2e/centrodm-provider.test.ts test/e2e/pixeon-download.test.ts test/e2e/centrodm-mobile-login.test.ts test/unit/centrodm.test.ts test/unit/centrodm-import-queue.test.ts test/unit/privacy.test.ts test/unit/manager-sse.test.ts test/unit/pixeon-debug-config.test.ts test/unit/browser-host.test.ts
```

Pendientes: dependencia pública exacta y causalidad del bloqueo, evidencia histórica comparable del Athlon y aceptación autenticada completa hasta Drive en Ryzen. No se verificaron con sesiones reales en este workspace.
