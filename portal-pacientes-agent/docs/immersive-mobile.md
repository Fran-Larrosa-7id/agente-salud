# Modo móvil inmersivo — implementación local

## Aclaración visual incorporada

### Corrección posterior: listado móvil y controles

Centro DM oculta las acciones de cada estudio dentro de un menú en móvil y puede ocultar la bienvenida/logout y la columna Modalidad. El detector anterior dependía de esas acciones visibles o de la tabla de escritorio: el listado quedaba esperando hasta pulsar PC. La nueva evidencia de login, separada del extractor, reconoce tablas HTML y la grilla propia `ns-table`. Exige encabezados visibles específicos de estudios, fechas calendario válidas y destinos de apertura del mismo origen, aunque el menú esté cerrado. En tablas verifica fecha y destino por fila; en la variante `ns-table` exige los nodos de fecha propios del proveedor y cantidades coincidentes de fechas visibles/destinos únicos. No ejecuta los atributos onclick: solo verifica estáticamente su destino. Solo devuelve un booleano. No abre menús, lee valores de campos ni cambia URLs; mantiene bloqueo por contraseña visible, MFA/CAPTCHA/modal y las dos confirmaciones consecutivas. Tras confirmar el acceso se restaura automáticamente la geometría de extracción en el mismo contexto. Los extractores no se modifican.

La barra del visor ahora usa iconos SVG y cuatro controles principales: atrás, adelante, teclado y opciones. Zoom, ajustar, escritorio/móvil y ampliar se agrupan en un panel accesible; las etiquetas y estados del teclado conservan los iconos. El diseño inmersivo se activa también con ancho de hasta 600 px y mouse, cubriendo ventanas angostas/emulación que antes mantenían tarjetas y botones apilados. Se adapta sin recargar y conserva el modo compacto durante la rotación de una ventana de tamaño teléfono. Tablet y PC anchos conservan su presentación. Las regresiones comprueban 320 px, rotación, teclado, Chromium/WebKit, puntero táctil y mouse; se revisaron visualmente la barra y el panel con contenido sintético.

Regresiones adicionales del arreglo: **124 pruebas unitarias Windows aprobadas**, **3 pruebas de Centro DM móvil aprobadas** (tabla, `ns-table` en iframe y casos negativos), las **4 pruebas de UI Chromium/WebKit con touch/mouse aprobadas**, y las pruebas existentes de login automático y teclado. La prueba de recuperabilidad del visor ahora comprueba «Salir» en el encabezado compacto en lugar del botón «Cancelar» del diseño anterior.

**Resultado final de este arreglo:** suite completa de la imagen Docker Linux final, con Xvfb/noVNC y protecciones habilitadas: **239 aprobados, 0 omitidos, 0 fallos** (279 segundos). Typecheck aprobado durante el build. Las ejecuciones intermedias detectaron una expectativa de Cancelar correspondiente al diseño anterior y un caso de enlace onclick que faltaba; ambos se corrigieron y quedaron cubiertos en la ejecución final. No se hicieron pruebas con cuentas reales de instituciones ni despliegues. Continúa pendiente la aceptación física en Android/iPhone.

Las capturas móviles de deMartino, Pérez Cambet y RDC aportadas por el usuario son la referencia de aceptación: debe mostrarse **el formulario responsive real del sitio externo**, con inputs legibles, scroll con un dedo y teclado nativo. Ampliar un canvas de escritorio no cumple este criterio. No se utilizaron ni transcribieron los datos personales visibles en esas capturas.

Se conservó la implementación existente y se ajustaron tres puntos: el contexto móvil nace con **390×844 antes de la primera navegación**, la calibración reconoce formularios dentro de iframes (Centro DM) y los arrastres de un dedo se convierten en scroll de la página remota cuando la vista móvil está ajustada. Toques, pulsación larga, gestos múltiples y escritorio conservan el comportamiento noVNC; con zoom manual se conserva su arrastre habitual.

## Diagnóstico confirmado

La configuración previa tenía tres tamaños diferentes: viewport Playwright **1180×820**, Xvfb **1280×900** y un canvas noVNC escalado al espacio restante entre encabezados, tarjetas y márgenes. `scaleViewport=true` achicaba los píxeles del escritorio; `resizeSession=false` conservaba su tamaño remoto.

La medición en Docker Linux (`scripts/probe-remote-geometry.ts`) produjo:

| Viewport solicitado | Ventana Chromium | Posición |
| --- | --- | --- |
| 1180×820 | 1188×905 | 10,10 |
| 390×844 | 500×929 | 10,10 |
| 844×390 | 852×475 | 10,10 |

Chromium impone un ancho mínimo de ventana de 500 px. Reducir el viewport a 390 px no reduce por sí solo el framebuffer ni permite deducir el origen del contenido dividiendo la diferencia de tamaños. Además, el alto móvil más la interfaz de Chromium excedía los 900 px de Xvfb.

La prueba de protocolo con noVNC real confirmó que esta imagen de x11vnc **anuncia ExtendedDesktopSize**, pero devuelve **reason=1/status=1**, resize solicitado por el cliente y administrativamente prohibido. El viewport Playwright permanece independiente. Por eso `resizeSession` continúa desactivado; no se lo presenta como solución automática. Se contrastó con el [manejo del protocolo en noVNC](https://github.com/novnc/noVNC/blob/v1.3.0/core/rfb.js).

## Implementación incremental

### 1. Interfaz inmersiva

En teléfonos con puntero táctil y lado corto de hasta 600 px, el visor ocupa el viewport disponible. Desaparecen encabezados explicativos, tarjetas y márgenes del login. Una barra compacta conserva la institución, el **origen externo real** informado por el backend y Salir. No se copian formularios del laboratorio.

La barra inferior incluye teclado, acercar/alejar, ajustar, atrás/adelante, cambio móvil/escritorio y ampliar. El zoom ajusta el contenedor de noVNC y utiliza su escala interna; no transforma el canvas por separado, lo que desalinearía los toques. `visualViewport` adapta altura, ancho y desplazamiento cuando aparece el teclado. El campo temporal y los controles de teclado existentes mantienen limpieza e IME.

Fullscreen incluye también la barra de identidad. Si el API no existe o rechaza la operación, se utiliza el diseño CSS inmersivo. Tablet y escritorio conservan la presentación convencional y pueden ampliarla manualmente. Salir cancela el job; reconectar recupera el mismo job mientras siga vigente.

### 2. Geometría remota

Xvfb pasa a **1280×1000×24**, sin abrir puertos ni cambiar permisos. El viewport remoto se ajusta al visor: ancho entre 320 y 960, alto entre 240 y 844; en un teléfono vertical habitual es aproximadamente 390×732, o menor con el teclado abierto. El ejemplo 390×844 también cabe sin recortar su parte inferior.

El backend calibra la relación entre el contenido renderizado y la pantalla X11, ajusta el viewport de la página y aplica `x11vnc -clip WxH+X+Y`. El framebuffer transmitido tiene esas dimensiones reales, aunque la ventana nativa siga siendo más ancha. Xvfb mantiene un tamaño fijo suficiente; no depende de cambiar modos XRANDR. Se reutiliza el soporte de [recorte de x11vnc](https://github.com/LibVNC/x11vnc/blob/master/src/help.c).

Para calibrar se agrega la pequeña utilidad X11 **xdotool**. Solo genera movimientos del puntero, sin clicks ni teclas. Un listener transitorio lee exclusivamente coordenadas de pantalla/cliente; no consulta texto, valores, cookies, almacenamiento ni capturas. El listener y su handle se liberan, y solo se conserva el desplazamiento geométrico por página. CDP sintetiza `screenX/screenY` relativos al viewport emulado, de modo que sus movimientos no sirven para medir la posición física X11. Las pruebas headless no tienen ventana X11 y usan la geometría del viewport.

La pantalla, la ventana y la calibración se mantienen dentro de límites. Si no puede obtenerse una geometría válida, el backend conserva el contexto, vuelve al viewport escritorio y avisa en la interfaz. Los cambios se serializan para no superponer rotación, teclado y reconexión. Mientras llega el framebuffer nuevo se bloquean los toques sobre la imagen; el teclado y los controles siguen disponibles. Se esperan dimensiones confirmadas y tres frames de render antes de reactivar los toques. Los ajustes pendientes se aplican después, y no deshacen un zoom elegido mientras se ajustaba la altura.

### 3. Compatibilidad por institución

| Institución | Estrategia habilitada | UA móvil / `isMobile=true` |
| --- | --- | --- |
| Centro DM | Viewport responsive, contexto con `hasTouch=true` cuando el job nace en móvil | No habilitado |
| Pérez Cambet | Igual; conserva el flujo LW Cloud conocido | No habilitado |
| RDC Chacabuco | Igual; conserva el flujo VisualMedica conocido | No habilitado |

La política está centralizada en `src/browser/display-profile.ts`. Una institución desconocida cae en escritorio. Para desactivar responsive en una institución se cambia únicamente su entrada revisada de la política; no se alteran extractores.

Se contrastó la [emulación de Playwright](https://playwright.dev/docs/emulation) con los formularios públicos reales de las tres instituciones. El perfil `mobile-emulation` prueba 390×844, `isMobile`, `hasTouch` y UA Android del descriptor Pixel 7. A igual ancho produce la misma distribución responsive que el perfil habilitado, conservando tipos y tamaños de letra de los campos. En Linux hay diferencias menores de reflujo por el espacio de 15 px que reserva la barra de scroll desktop; no se trata de otro formulario ni de un escritorio escalado. Por eso se mantiene el UA probado, con viewport móvil real, `hasTouch=true` y DPR 1, sin activar otra variante de DOM/visor durante una sesión autenticada. Los gestos noVNC se traducen a eventos X11; esto no convierte Ubuntu en Android ni garantiza eventos táctiles nativos en el sitio remoto.

La comprobación manual reproducible es `scripts/probe-public-mobile.ts`. Abre contextos nuevos, aplica la allowlist del proveedor, compara escritorio/responsive/emulación móvil y solo informa geometría, tipos de inputs y metadatos de viewport. En Centro DM elige el enlace público «Portal Paciente»; nunca completa ni envía formularios, usa estado guardado, captura pantallas ni lee valores. Falla si no encuentra el formulario o si cambia su geometría más allá del margen de scroll. No forma parte del CI: depende de disponibilidad y cambios externos. `PROBE_HEADED=true` permite comprobar también la calibración X11 real bajo Xvfb.

Medición pública del 2026-10-26, Chromium Linux con ventana/Xvfb, viewport 390×844:

| Institución | Campo de acceso: ancho × alto | Fuente del campo | Viewport / recorte VNC |
| --- | --- | --- | --- |
| Centro DM (iframe) | 311×42 px | 16 px | 390×844, origen físico 10,97 |
| Pérez Cambet | 189×24 px | 14 px | 390×844, origen físico 10,97 |
| RDC Chacabuco | 359×32 px | 15 px | 390×844, origen físico 10,97 |

Los tamaños propios del laboratorio se conservan: no se inyectaron estilos ni reemplazos de sus formularios. Los nueve casos públicos (tres perfiles por institución) aprobaron con la política de dominios del portal, sin autenticación. La comparación inicial en Edge Windows también confirmó sus breakpoints responsive. Esto valida la portada/login actual; no sustituye probar MFA, navegación y extracción autenticada con cuentas de prueba.

El botón **PC/Móvil** cambia el viewport y recorte de la **misma página y BrowserContext**, sin navegar, recrear contexto, transferir cookies ni reiniciar el login. Se conserva el contenido de los campos. Al detectar la autenticación, se restaura 1180×820 antes de iniciar discovery, manteniendo contexto y cookies. Popups activos se recalibran durante el polling autorizado. El origen mostrado excluye ruta y query, y se actualiza periódicamente desde la página activa.

No se cambió código de extracción de ninguna institución. `browser/session.ts` solo recibe el perfil de contexto al abrir; `agent-runner.ts` conecta el perfil y restaura el viewport de extracción. Los detectores de login permanecen intactos.

## Seguridad

- Se mantienen propietario, sesión HttpOnly, origen permitido y revocación de WebSocket. Los nuevos endpoints de geometría/navegación verifican dueño y estado interactivo. El endpoint de navegación solo admite atrás/adelante, nunca URLs arbitrarias.
- El WebSocket sigue usando el origen actual, `wss:` bajo HTTPS. No se publican 5900/6080 ni nuevos puertos.
- UID/GID 1000, raíz read-only, seccomp, capacidades eliminadas, no-new-privileges y sandbox de Chromium no cambian. xdotool usa la misma autorización X11 local del proceso.
- No hay nuevos endpoints para credenciales, lectura de formularios, logs de teclas, persistencia de texto o copias al portapapeles. No se agregan modelos ni dependencias de IA.
- No se modificaron secretos, OAuth, bases, volúmenes, ngrok ni DNS. No hubo push, deploy ni acceso a los contenedores Ubuntu 8787/8888.

## Validación y límites

Validación previa a la aclaración visual, del 2026-10-26: suite completa Windows **229 aprobados, 3 omitidos, 0 fallos**; suite completa Docker Linux con Xvfb y noVNC habilitado **232 aprobados, 0 omitidos, 0 fallos** (274 segundos). Los omitidos de Windows corresponden a los E2E Linux. Typecheck aprobado en Windows y durante la construcción de la imagen. Se repitieron las **123 pruebas unitarias** y **7 pruebas focalizadas** de proveedores, teclado y diseño Chromium/WebKit, sin fallos. Los últimos ajustes de sincronización/zoom y las comprobaciones de toque horizontal se volvieron a verificar con el E2E Linux específico.

Docker Desktop local está disponible. Se construyó `portal-immersive-regression:local` sin usar env, datos ni puertos reales. La suite noVNC real verificó escritorio, errores recuperables, framebuffer móvil, zoom, teclado, rotación, reconexión y continuidad hasta extracción. La comprobación adicional de precisión aprobó la diferencia entre el centro objetivo y el evento recibido en la página remota, con tolerancia de 1,5 píxeles CSS por redondeo, también con zoom/desplazamiento y toque en horizontal.

Las pruebas de compatibilidad de los tres proveedores usan fixtures locales con sus extractores reales y comparan referencias de estudios en vertical, horizontal y escritorio. La prueba Linux usa credenciales ficticias y controles humanos de prueba para OTP/verificación; no automatiza ni resuelve desafíos reales. Se verificaron los formularios públicos en vivo, sin acceder a cuentas de instituciones. La medición geométrica separa los toques simples: noVNC interpreta dos toques cercanos dentro de aproximadamente un segundo como doble toque, con su anclaje propio; se conserva ese comportamiento de gestos. Para pasar de campo también se dispone de Tab.

Tras incorporar la referencia visual se reconstruyó la imagen local. Typecheck aprobado; **59 regresiones Windows aprobadas** (perfiles, los tres proveedores con fixtures, teclado y UI Chromium/WebKit) y **4 E2E Linux/noVNC aprobados**, incluyendo scroll real de un dedo sin arrastre del mouse, viewport móvil desde la primera navegación y calibración de iframe completo/con bordes. El diagnóstico inicial de reconexión reveló que desconectar una sesión CDP adicional de la prueba reiniciaba la emulación táctil del teléfono simulado; se conserva hasta el cierre del contexto y la reconexión pasó sin modificar el flujo de producción.

**Resultado final con la aclaración incorporada:** suite completa en la imagen Docker Linux, Xvfb/noVNC habilitados y restricciones reales: **233 aprobados, 0 omitidos, 0 fallos** (282 segundos). Incluye el nuevo caso de calibración de iframes. Se inspeccionaron visualmente los tres formularios públicos vacíos en contextos aislados de Edge a 390×844: composición responsive coherente con las referencias aportadas. La aceptación con cuentas reales y teléfonos físicos sigue pendiente; las pruebas de motor WebKit no equivalen a Safari iOS físico.

**Pendientes físicos:** Android Chrome e iPhone Safari, aparición/cierre real del teclado, safe areas, pinch/pan del dispositivo, latencia, portales institucionales reales, MFA y CAPTCHA reales. WebKit en Windows es emulación de motor/layout, no Safari iOS. Portales sin diseño responsive pueden requerir desplazamiento horizontal, zoom o la vista PC. No se reescribe su contenido para simular un login móvil. El autocompletado/gestor de contraseñas del teléfono no reconoce los campos dentro del canvas: se escribe en el sitio remoto con el teclado del teléfono.

## Repetir en Windows

Desde PowerShell, sin regenerar el env privado:

```powershell
Set-Location C:\Users\franc\Desktop\mocks-salud\portal-pacientes-agent
$env:BROWSER_CHANNEL = 'msedge'
npm.cmd run typecheck
npm.cmd test
```

Para repetir únicamente el diagnóstico de los formularios públicos, sin iniciar sesión ni guardar contenido:

```powershell
node --import tsx scripts/probe-public-mobile.ts
```

Este diagnóstico requiere red y verifica tres perfiles por institución. No ejecutar sobre una página ni un perfil personal: el script crea sus propios contextos vacíos. En Linux/Xvfb puede usarse `PROBE_HEADED=true` para medir además el recorte físico.

WebKit se omite si no está instalado. Para repetir con el motor ya presente en esta máquina:

```powershell
$env:TEST_WEBKIT_EXECUTABLE = "$env:LOCALAPPDATA\ms-playwright\webkit-2287\Playwright.exe"
node --import tsx --test test/e2e/remote-view.test.ts test/e2e/remote-keyboard.test.ts
Remove-Item Env:TEST_WEBKIT_EXECUTABLE
```

Docker Desktop debe estar iniciado. Estos comandos construyen y prueban una imagen aislada, sin montar datos de pacientes ni publicar puertos:

```powershell
Set-Location C:\Users\franc\Desktop\mocks-salud
docker build -t portal-immersive-regression:local .
$seccomp = (Resolve-Path portal-pacientes-agent/docker/seccomp_profile.json).Path
$testRun = @('run', '--rm', '--init', '--read-only', '--user', '1000:1000', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true', '--security-opt', "seccomp=$seccomp", '--shm-size', '1g', '--tmpfs', '/tmp:size=1g,mode=1777', '--tmpfs', '/home/pwuser:size=128m,uid=1000,gid=1000,mode=0700', '--tmpfs', '/var/lib/portal:size=1g,uid=1000,gid=1000,mode=0700', '-e', 'XDG_CONFIG_HOME=/home/pwuser/.config', '-e', 'XDG_CACHE_HOME=/home/pwuser/.cache', '--entrypoint', 'npm')
docker @testRun portal-immersive-regression:local run test:remote
docker @testRun portal-immersive-regression:local test
```

Cuando decidas actualizar **tu prueba Windows Google**, verificar primero el proyecto correcto y que no haya importaciones en curso:

```powershell
docker compose --env-file .env.google.local -p portal-google-local config --quiet
docker compose --env-file .env.google.local -p portal-google-local up --build -d --no-deps --wait portal
curl.exe --fail http://localhost:8888/health
```

No se ejecutó esa actualización automáticamente. Para celulares usar el origen HTTPS de pruebas ya autorizado, encaminado a la versión revisada. `localhost` del teléfono no es la PC. Esta guía no cambia OAuth, DNS ni ngrok; si no hay un origen de pruebas adecuado, la aceptación física queda pendiente.

## Aceptación manual

En cada institución y en ambos teléfonos: verificar institución/dominio visible, legibilidad de campos, teclado, acentos y signos, Tab/Borrar/Enter, scroll, zoom/Ajustar, portrait/landscape y cierre del teclado del sistema. Completar manualmente OTP/CAPTCHA cuando corresponda. Cambiar a PC y volver a Móvil con un campo ficticio escrito: no debe vaciarse ni reiniciarse el login. Cortar brevemente la red, reconectar y verificar el mismo job. Completar login y comprobar selección de estudios y descarga del formato original. Repetir en desktop/tablet. Registrar OS/navegador/origen y resultados, sin capturar credenciales ni documentos médicos.

## Ubuntu: procedimiento manual y rollback

**No ejecutado.** Mantener intacto el piloto 8787. Actualizar primero una instancia de pruebas revisada; no reemplazar automáticamente el experimental 8888.

1. Identificar proyecto Compose, env privado, volumen e imagen del servicio que se decida actualizar. Revisar overrides de `command`: el Xvfb efectivo debe usar 1280×1000, como el nuevo CMD de la imagen. Guardar revisión y modificaciones locales, perfil seccomp efectivo, env y etiqueta/ID de imagen anterior en un backup privado. No mostrar secretos ni sobrescribir el seccomp modificado del servidor.
2. Preparar la revisión revisada en otro checkout. Verificar `config --quiet` con el proyecto/env originales. Construir una imagen distinta y ejecutar las pruebas aisladas de arriba con el perfil seccomp efectivo. Mantener XDG_CONFIG_HOME/XDG_CACHE_HOME escribibles como ya define Compose. No usar volúmenes de producción para tests.
3. Esperar a que no haya jobs activos: una recreación del servidor pierde las ventanas/contextos Playwright de login. El fallback móvil/PC sí conserva sesión; un reinicio de contenedor no puede conservar ese proceso.
4. Detener solamente el servicio autorizado. Copiar en frío `/var/lib/portal-data`, incluido WAL/SHM y posibles pendientes, y conservar la pareja DB/claves original. Si falla el backup, no actualizar. Esta mejora no migra la DB ni cambia claves.
5. Recrear exclusivamente ese servicio con la imagen revisada, mismo env/volumen/proyecto, y comprobar health, aislamiento A/B, login, aceptación móvil HTTPS y extracción de las tres instituciones. Verificar también que 8787 continúa operativo.

Ejemplo con valores que deben identificarse antes, sin ejecutar sobre un proyecto inferido:

```bash
GOOGLE_PROJECT='PROYECTO_AUTORIZADO_REAL'
GOOGLE_ENV='/ruta/privada/env-google-existente'
dcg() { docker compose -f /ruta/al/compose.yaml --env-file "$GOOGLE_ENV" -p "$GOOGLE_PROJECT" "$@"; }
dcg config --quiet
# Guardar ID/etiqueta de la imagen anterior y ejecutar los tests aislados.
dcg build portal
# Solo sin jobs activos y con el backup privado preparado:
dcg stop portal
dcg cp portal:/var/lib/portal-data /ruta/privada/backup-nuevo/portal-data
# Continuar únicamente si la copia terminó correctamente.
dcg up -d --no-deps --wait portal
curl --fail http://127.0.0.1:8888/health
```

Rollback: sin jobs activos, conservar una copia fría adicional; usar un override Compose privado con `services.portal.image: ETIQUETA_ANTERIOR_RETENIDA` y recrear **solo ese servicio** con `--no-build`, mismo proyecto/env/volumen. No restaurar una DB antigua sobre registros nuevos: esta mejora no necesita revertir datos. No ejecutar `down -v`, borrar volúmenes, regenerar secretos, reiniciar Docker ni cambiar OAuth/ngrok/DNS. Conservar el perfil seccomp efectivo y los archivos privados del servidor.

## Archivos

Producción: `Dockerfile`, `src/browser/{browser-host.ts,session.ts,display-profile.ts}`, `src/jobs/{job.ts,job-manager.ts,runner.ts,agent-runner.ts}`, `src/server/{app.ts,remote-client.js,remote-desktop.ts,remote-keyboard.js,remote-view.css}`, `../portal-pacientes/js/agent.js`.

Verificación: `package.json` (`test:remote`), `scripts/{probe-remote-geometry.ts,probe-public-mobile.ts}`, nuevos `test/unit/display-profile.test.ts`, `test/e2e/{remote-immersive.test.ts,remote-view.test.ts}`, y ajustes de tests existentes de noVNC, teclado, propietarios y proveedores. No se modificaron archivos `src/providers/` ni lógica de extracción.
