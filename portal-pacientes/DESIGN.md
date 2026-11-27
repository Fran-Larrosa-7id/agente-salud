# Portal de Pacientes · Sistema visual

Referencia para cualquier cambio visual en `portal-pacientes/`. Describe lo que está implementado en `css/portal.css`, `css/screens.css` y los constructores de `js/ui.js`. Si el código y este documento no coinciden, manda el código; después actualizá este archivo.

> Este documento es solo del Portal de Pacientes. El `DESIGN.md` de la raíz del repositorio corresponde a Onboarding de Pacientes y no aplica acá.

## Principios

1. **Herramienta, no vidriera.** El paciente viene a encontrar un estudio, verlo y compartirlo. La jerarquía sirve a esa tarea; no hay métricas decorativas ni tarjetas de "dashboard".
2. **Marca Vertical Salud.** Inter, navy y teal, íconos de línea, fondos claros (ver `MANUAL_MARCA_VERTICAL_SALUD.md`). El diseño se apoya en la composición, el detalle y el movimiento, no en colores nuevos.
3. **Marcar solo lo que pide atención.** Los badges se usan para estados excepcionales (por ejemplo "No disponible en Drive"), no para repetir lo normal. "Guardado en Drive" aparece solo en el detalle del estudio.
4. **Sin muletillas de IA.** No se usan eyebrows sobre los títulos, tarjetas con número grande, bloques con degradé oscuro, glow, contadores en 0 ni la misma animación escalonada en todos los bloques.
5. **Accesible por defecto.** Los usuarios incluyen personas mayores y con baja visión: texto base de 16px, objetivos táctiles de 44px o más, contraste AA y movimiento opcional.

## Tipografía

| Rol | Estilo |
|---|---|
| Familia | `--font`: Inter, con fallback a system-ui. Roboto aparece solo en el botón de Google del login, por las normas de marca de Google. |
| Título de página `.page-title` | 2rem / 1.15, peso 700, tracking −0.026em, navy, `text-wrap: balance`. En mobile baja a 1.875rem. |
| Subtítulo `.page-sub` | 1.0625rem, `--text-muted`, máximo 62ch. |
| Título de sección `.sec-title` | 1.0625rem, peso 650, tracking −0.01em. |
| Título de bloque o estado vacío | 1.1875rem, peso 650. |
| Cuerpo | 1rem / 1.5. |
| Secundario (fechas, institución, nav) | 0.9375rem. |
| Mínimo (badges) | 0.875rem, peso 600. No se usa nada más chico. |

La preferencia "Aa Grande" (Mi cuenta) agrega `html.text-lg`, que lleva la base a 112.5%. Todo está en `rem`, así que escala completo.

## Color

Los tokens están en `:root` de `css/portal.css`. No se escriben hex sueltos en componentes nuevos.

| Token | Uso |
|---|---|
| `--navy` #102a43 / `--navy-strong` | Títulos, botón primario, ítem activo. |
| `--teal-ink` #087477 / `--teal-deep` | Acento: botón `.btn-accent`, links, foco. |
| `--teal` #0f8b8d | Ilustraciones y anillo de foco (`--focus`). |
| `--mint` / `--mint-soft` | Fondo del ítem activo, chip activo, badge "Nuevo". |
| `--frame` #eef2f6 | Marco del shell detrás de la sidebar. |
| `--surface` #fff | Panel principal y superficies. |
| `--tint` / `--surface-alt` | Fondos suaves de filas o bloques secundarios. |
| `--line` / `--border` / `--border-strong` | Separadores, bordes de controles, bordes de inputs. |
| `--text` / `--text-muted` / `--text-subtle` | Texto principal, secundario y terciario (`--text-subtle` no se usa para texto esencial). |
| `success`, `warning`, `danger`, `info` | Cada uno con `-ink` (texto) y `-soft` (fondo). Siempre se acompañan de un ícono, nunca se depende solo del color. |

Los tipos de estudio tienen tiles de 40px con fondo suave y un ícono (`.ty-*`). Las categorías de Mi salud usan `.ty-alergias`, `.ty-vacunas`, etc.

## Forma, sombra y espaciado

- **Radios:** `--r-xs` 6 (badges), `--r-sm` 8 (inputs chicos), `--r-md` 10 (botones, filas, controles), `--r-lg` 12 y `--r-xl` 16 (paneles). El panel principal `.main` usa 18px.
- **Sombras:** azuladas, nunca negras (`rgba(15, 42, 67, …)`). Hay tres: `--shadow-sm`, `--shadow-md` y `--shadow-lg`. Los botones llevan una sombra de 1px y un brillo interior.
- **Agrupación:** se prefieren las listas con separadores (`.list`, `divide`) antes que las tarjetas. `.panel` se reserva para bloques laterales con identidad propia, como "Traé tus estudios" o el contacto de ayuda.
- **Espaciado:** múltiplos de 4. La vista tiene padding de 44/56/72px en desktop, 36px en tablet y 16px de margen lateral en mobile. Las secciones se separan con 32 a 48px.

## Shell

- **Desktop (más de 1100px):** una sidebar clara de 248px (`--sidebar-w`) sobre `--frame`. El contenido va en `.main`, un panel blanco redondeado e inset 10px, y `.view` tiene un ancho máximo de 1120px.
  - La sidebar tiene, en orden: la marca; la navegación principal (`.nav-main`, 5 ítems con íconos de 20px); y abajo, Ayuda, la cuenta y el endoso "Una solución de 7Ideas". La cuenta (`.side-account`) muestra el avatar con iniciales y el email, y tiene un botón para cerrar sesión.
  - **Indicador activo `.nav-ind`:** hay una sola pieza, que se desliza con `transform` hasta el ítem que tiene `aria-current="page"`. Lo posiciona `moveNavIndicator()` en `js/app.js`, que corre al navegar, al cambiar el tamaño de la ventana y al cambiar el tamaño del texto. La primera vez se coloca sin transición.
- **Tablet (761 a 1100px):** la sidebar queda en 92px, con ícono arriba y etiqueta abajo. Se ocultan el texto de la marca y el de la cuenta.
- **Mobile (760px o menos):** una topbar blanca con la marca y el avatar, y una `bottomnav` fija con blur y 5 destinos. El ícono activo va dentro de una píldora `.bn-ic`. "Más" abre un diálogo con Historial, Mi cuenta y Ayuda.

## Componentes

| Componente | Notas |
|---|---|
| `.btn` | 48px de alto; `.btn-sm` 44px y `.btn-lg` 56px. Variantes `primary` (navy), `accent` (teal), `secondary` y `ghost`. `:active` escala a 0.97. El texto no se parte en dos líneas. |
| `.icon-btn` | 44×44. Siempre lleva `aria-label`. |
| `.study` (`P.studyRow`) | Grilla de tile, título, institución, fecha, estado y chevron. Si el estado está vacío, la columna desaparece con `:has(.study-status:empty)`. En Inicio se ocultan la fecha y el estado. |
| `.hrow` | Filas del resumen de Mi salud: tile, título, resumen real o texto de vacío, cantidad y chevron. |
| `.chip` / `.tabs` / `.seg` | Filtros: el chip activo es mint. Las pestañas tienen un subrayado con `scaleX` y muestran el conteo solo si es mayor que 0. El segmentado es estilo iOS, con botones de 44px. |
| `.badge` | 28px. Variantes `b-success`, `b-warning`, `b-neutral` y `b-new`. Llevan ícono de 15px. |
| `details.disclosure` / `.qa` | Contenido desplegable ("Estudios no disponibles", preguntas de Ayuda). El "+" de Ayuda gira 45° al abrir. Todo arranca cerrado. |
| `.settings` / `.set-row` | Filas de ajustes de Mi cuenta: tamaño de texto y Google Drive, con badge de estado. |
| `.manage` | Bloque "Biblioteca y Drive" del detalle: ocultar o mostrar, y enviar a la papelera. |
| `.sync` | Línea de estado de Drive al pie de Estudios: "Sincronizado…", Actualizar y Administrar Drive. |
| `P.avatar(size)` | Iniciales del usuario, o un ícono de usuario si no hay nombre. Tamaños por defecto y `lg` (64px; 52px en mobile). |
| `P.empty` | Estado vacío con ilustración (`P.art.empty(icon)`), título, texto y acción para cargar contenido. |
| Skeletons `.sk-*` | Reproducen la forma final de la pantalla. No se usan spinners genéricos para cargar vistas. |

Las acciones se conectan por `data-action` con delegación de eventos. Los componentes nuevos siguen ese patrón y mantienen los `data-action` e `id` existentes.

## Ilustraciones

- Son SVG en línea, generados en `js/ui.js` (`P.art.*`). No se cargan imágenes externas para la UI.
- **`P.art.gather()`** (Inicio, bloque "Traé tus estudios"): los documentos de 3 instituciones vuelan hacia una carpeta. Es la única ilustración que se repite, porque explica qué hace el producto.
- **`P.art.empty(icon)`:** dos hojas y un badge con ícono. Se anima una sola vez al aparecer.
- **Miniatura de imágenes (`P.paper`):** una hoja de informe con un abanico de ecografía (`svg.paper-plate`). Reemplaza las miniaturas borrosas.
- La paleta de las ilustraciones sale solo de los tokens: navy, teal, mint y `--line`. Los trazos son de 1.5 a 2px.
- `acceso-fondo.webp` (en `css/img/`) es el fondo de la pantalla de acceso. Es el único recurso raster de la UI y se copia a la imagen Docker junto con `css/`.

## Movimiento

| Qué | Valores |
|---|---|
| Curvas | `--ease-out` cubic-bezier(0.23, 1, 0.32, 1) para entradas e interacción; `--ease-in-out` para lo que se mueve en pantalla (indicador, vuelo de documentos); `--ease-drawer` para hojas y diálogos. |
| Duraciones | `--t-fast` 180ms (hover, color), `--t-base` 240ms, `--t-slow` 300ms. La interfaz no supera los 300ms. |
| Entrada de vista | `.view.is-entering`: 280ms de opacidad más 6px de subida. Se aplica una vez por navegación, no por bloque. |
| Press | `scale(0.97)` en 120ms. |
| Ilustración gather | Ciclo de 3.9s con 3 documentos desfasados 1.3s. Se reproduce solo mientras está visible: `P.mountArt()` usa un IntersectionObserver que alterna `.is-playing` en `[data-art]`, y fuera de pantalla queda en pausa. |
| Propiedades | Solo `transform` y `opacity`. No se animan `height`, `width` ni márgenes. |
| Hover | Solo con `@media (hover: hover) and (pointer: fine)`. |

**`prefers-reduced-motion: reduce`:** las ilustraciones quedan quietas y los documentos en vuelo se ocultan. El indicador salta sin transición y las entradas se desactivan. La verificación automática comprueba que ningún elemento de `.art` tenga animación activa.

## Accesibilidad

- Hay un solo `h1` por vista. Un skip link lleva el foco a `#main`.
- Todos los objetivos táctiles miden 44px o más, incluidos los links sueltos, los segmentados y los ítems de la bottomnav.
- Foco visible: `--focus`, un anillo teal de 3px. Nunca se quita el outline sin reemplazo.
- La navegación marca la sección con `aria-current="page"`. Los botones de ícono llevan `aria-label` y los íconos decorativos `aria-hidden`.
- Los estados de color siempre se acompañan de texto e ícono.
- Las ilustraciones son decorativas (`aria-hidden="true"`). El texto de al lado explica lo mismo.
- El tamaño de texto se puede agrandar desde Mi cuenta sin romper el layout.

## Responsive

| Breakpoint | Cambios |
|---|---|
| Más de 1100px | Shell completo. Inicio, Mi salud, detalle, perfil y ayuda en dos columnas (contenido y aside). |
| 1100px o menos | Una columna. Los asides pasan a una grilla `auto-fit` de 280px. |
| 761 a 1100px | Sidebar de 92px. La fila de estudio pierde la columna de estado si no hay badge. |
| 900px o menos | El encabezado del detalle se apila. El bloque "Traé tus estudios" pone la ilustración arriba. |
| 760px o menos | Topbar y bottomnav. Los chips y las pestañas tienen scroll horizontal sin barra, las tablas de resultados pasan a filas y los documentos a 2 columnas. Los botones principales ocupan el ancho completo. |
| 380px o menos | Documentos en 1 columna. |

El layout no debe generar scroll horizontal en ningún ancho. Se verifica en 1440, 1024 y 390px.

## Verificación antes de publicar cambios visuales

1. Recorrer las 9 rutas (Inicio, Mi salud, una pestaña de Mi salud, Estudios, un detalle, Historial, Documentos, Ayuda y Mi cuenta) en 1440×900, 1024×768 y 390×844. En cada una se revisa que no haya overflow horizontal, que haya un solo `h1`, que no haya objetivos de menos de 44px y que no haya errores de JS.
2. Revisar los estados vacíos de Inicio, Estudios, Documentos y Mi salud.
3. Probar con movimiento reducido.
4. Probar con el tamaño de texto "Grande".
5. Usar solo datos ficticios. Nunca cuentas médicas reales.
6. Al cambiar CSS o JS, subir el `?v=` correspondiente en `index.html`.
