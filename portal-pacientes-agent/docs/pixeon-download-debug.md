# Pixeon: búsqueda de Descargar y retención DEV

La detección del visor, los dominios permitidos y el discovery no se modifican.
La evidencia DOM compartida identifica el control de descarga como `<div class="… downloadToolsItem">`; las clases de styled-components generadas no se usan.
El finder enumera frames permitidos y primero espera `.downloadToolsItem` hasta `PIXEON_TOOLBAR_TIMEOUT_MS` (30 s por defecto). Así `VIEWER_READY` puede preceder al render de la toolbar sin provocar un `DOWNLOAD_ACTION_NOT_FOUND` prematuro. Si vence el timeout, siguen los finders genéricos: roles, texto, atributos, clases/ids y DOM acotado, incluido el fallback estructural. El locator CSS soporta shadow DOM abierto y mantiene la política de navegación.
Los eventos `centrodm_find_document_enter`, `find_document_dispatch`, `pixeon_download_probe_start/end`, `pixeon_download_fastpath`, los frames y los conteos estructurales se escriben siempre a nivel info, aunque las flags de estructura estén apagadas.

Cuando no hay coincidencias semánticas ni por atributos, se ejecuta un fallback de discovery estructural de elementos visibles del viewport superior (hasta 160 px o el 25% de la altura). Registra clases genéricas sanitizadas, tag/role, presencia de `onclick`/`tabindex`, cursor, cantidad de hijos e iconos SVG/IMG, y buckets gruesos de posición/tamaño. Detecta toolbars por cinco o más hijos visibles en una fila, con alturas y coordenadas verticales parecidas. Un wrapper de toolbar se conserva como contexto, no se trata como control accionable.

La geometría y el orden nunca autorizan un click. Solo una señal semántica explícita (por ejemplo `data-action=download` o una clase/atributo/icono SVG con indicio de descarga) puede producir un locator estructural; no se usan clicks por coordenadas ni por índice. Los atributos de evento se inspeccionan solo como señal booleana/clasificación y jamás se registran sus valores.

## Evidencia reproducida, no evidencia del portal real

En los fixtures, el fast path encuentra el DOM realista `.downloadToolsItem` sin exigir `role`, `onclick` declarativo ni `tabindex`, y el click normal de Playwright activa un listener delegado. Otro fixture lo agrega con 1,5 s de demora: el finder espera y lo resuelve antes del timeout. También siguen funcionando los casos de `span` dentro de ancestros interactivos, `div[role=button]`, aria-label, tabindex y shadow DOM abierto.
Otro fixture tenía un consentimiento cookie identificado por el contexto del diálogo: se aceptó y se esperó su desaparición. Se probó también un overlay que aparece después de resolver el botón y obliga a reintentar el click.

Después del click se buscan opciones visibles primero en el frame del botón y después en los demás. Se cuentan las opciones Descargar PNG/ZIP/DCM, incluso si son `div` sin roles/handlers declarativos; entre cinco opciones se selecciona solo todas + series + ZIP + DCM, excluyendo viewer/actual/PNG. Si hace falta, el fallback usa texto solo en memoria para clasificar, y registra estructura sanitizada sin copiar labels.
El listener interno que recibe descargas se arma antes del click del menú; el ZIP se valida por tamaño y magic bytes, no por extensión. Un click interceptado produce únicamente `pixeon_download_click intercepted=true`; luego se aplica el manejo de consentimiento existente, sin `force`.

Todavía no se verificó el DOM de una sesión real autenticada de Centro DM: frame, nodo, ancestro y cookies reales deben confirmarse en la próxima ejecución; no se infieren a partir de la captura.

## Activación para diagnóstico

En el `.env` local y fuera de NODE_ENV=production:

```env
PIXEON_DEBUG_KEEP_VIEWER_OPEN=true
PIXEON_DEBUG_KEEP_VIEWER_OPEN_MS=120000
PIXEON_TOOLBAR_TIMEOUT_MS=30000
PROVIDER_DEBUG_STRUCTURE=true
LOG_LEVEL=debug
```

Reiniciar el agente y seleccionar solamente un estudio. El flag keep-open es false por defecto y se ignora en producción.
Al arrancar, `pixeon_debug_config keepViewerOpen=true ttlMs=120000` confirma la configuración efectiva. El TTL se puede reducir mediante `PIXEON_DEBUG_KEEP_VIEWER_OPEN_MS` (máximo 120000 ms en desarrollo; deshabilitado en producción). Ante `VIEWER_NOT_RECOGNIZED`, `DOWNLOAD_ACTION_NOT_FOUND`, `DOWNLOAD_ACTION_NOT_CLICKABLE` o `DOWNLOAD_MENU_NOT_FOUND`, se conserva el contexto autenticado y el visor durante ese intervalo, sujeto al TTL del job. Se registra `pixeon_debug_hold viewer=true reason=... ttlMs=...`. El evento `job_closed` se emite recién después de terminar la retención y cerrar el browser/context; `pixeon_debug_viewer_closed` marca ese cierre. Cancelar o apagar el servidor cierra inmediatamente. Si la persona elige “Volver a intentar”, la UI cancela el job anterior y luego inicia el flujo de nuevo; no se vuelve a ejecutar el job terminal sobre la misma sesión.
Fuera del modo debug continúa el cleanup normal al terminar el job. Los archivos temporales de jobs fallidos se eliminan aunque el visor se conserve.

## Logs esperados (ejemplo sintético)

```text
centrodm_find_document_enter
find_document_dispatch provider=centrodm strategy=pixeon
pixeon_download_probe_start
pixeon_download_fastpath selector=downloadToolsItem started=true
pixeon_download_fastpath selector=downloadToolsItem count=1 visible=true elapsedMs=<ms>
pixeon_download_button found=true strategy=class_fastpath
pixeon_download_menu_options found=true count=5
pixeon_download_menu opened=true
pixeon_download_options count=5
pixeon_download_choice found=true kind=full_dicom_zip
DOWNLOADING
centrodm_archive_valid found=true count=<bytes>
IMPORTING
COMPLETED
```

Si el control no aparece, después del timeout se registra `pixeon_download_fastpath count=0 visible=false`, y recién entonces comienzan las estrategias genéricas. Si aparece tarde, `elapsedMs` da el tiempo observado de esa ejecución.

Si falla en modo debug, el fallback puede emitir `pixeon_structural_fallback`, `pixeon_toolbar_candidates`, uno o más `toolbar_candidate` y `pixeon_toolbar_detected`. Ejemplo de reporte: cantidad total de candidatos; tags/clases genéricas sanitizadas; presencia de señales de acción; bucket horizontal aproximado; y si se detectó un grupo repetitivo. Si no existe señal semántica de descarga, el resultado sigue siendo `pixeon_download_button found=false`, aunque se haya reconocido la toolbar. Estos valores deben tomarse de la ejecución real; no se infieren desde los fixtures.

Si falla en modo debug también aparecen `pixeon_download_probe_end found=false` y `pixeon_debug_hold viewer=true reason=... ttlMs=120000`, luego cierre automático tras el TTL. Los logs no incluyen URLs completas, labels, HTML, handlers ni datos clínicos.

## Verificación

`npm run typecheck` y las pruebas focalizadas incluyen frames, ancestros, data-label, data-tooltip, shadow DOM, consentimiento e interceptación, selector realista `.downloadToolsItem`, aparición tardía, menú de cinco `div`, elección exclusiva de full ZIP DCM, validación ZIP, discovery estructural, ausencia de click por geometría sola, retención TTL/cancelación y cleanup. No se usan force-clicks, XPath ni Qwen para resolver Descargar. Los fixtures son evidencia sintética: todavía hace falta una ejecución autenticada para confirmar cuánto tarda y qué menú real abre Centro DM.
