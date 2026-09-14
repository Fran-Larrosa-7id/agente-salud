# Handoff — Onboarding de Pacientes (mockup HealthTech)

Contexto para retomar este proyecto o para arrancar mockups nuevos de la misma Vertical Salud en otra conversación.

## Qué es esto

Prototipo frontend navegable (HTML/CSS/JS puro, sin build, sin backend) de "Onboarding de Pacientes" — pre-admisión digital para clínicas/consultorios. Proyecto independiente de Horus, pensado para mostrarle a clínicas como demo comercial, no como MVP funcional.

Brief original completo: `SUPER_PROMPT_ONBOARDING_PACIENTES_CLAUDE_CODE.md` (si sigue en el repo) — ahí está toda la especificación de pantallas, usuarios, propuesta de valor.

## Estructura de archivos

```
index.html          → selector "Demo paciente" / "Demo institución"
paciente.html        → flujo mobile de 9 pantallas (SPA de una sola página, secciones toggled por JS)
institucion.html      → dashboard desktop + drawer de detalle de paciente
css/tokens.css        → design tokens (color, tipografía, spacing, radius, shadow, motion)
css/base.css          → reset + utilidades (.num para cifras tabulares, focus-visible, skip-link)
css/components.css    → sistema de componentes (Button, Input, Badge, Progress, Drawer, Toast, etc.)
css/paciente.css       → estilos específicos del flujo paciente
css/institucion.css    → estilos específicos del dashboard
js/data.js            → datos mock (8 pacientes argentinos realistas, profesionales, obras sociales)
js/paciente.js        → navegación entre pantallas, progreso, uploads simulados, toasts
js/institucion.js     → tabla filtrable, drawer de detalle, acciones simuladas
PRODUCT.md            → contexto de producto (escrito con /impeccable init)
DESIGN.md             → sistema de diseño documentado (escrito con /impeccable, formato spec oficial)
.impeccable/surfaces/app.md → contrato de dirección visual (THESIS/OWN-WORLD/STORY/FIRST VIEWPORT/FORM/FINISH)
```

## Proceso de diseño usado (repetible para el próximo mock)

Se seguyó `/impeccable` como dirección principal — **no** `/design-taste-frontend`, porque esto es producto/dashboard (Operate), no landing. Pasos que se ejecutaron en orden:

1. `impeccable context` (setup, detecta que no había PRODUCT.md).
2. `impeccable init` → escribí `PRODUCT.md` a mano siguiendo la plantilla del skill (Platform, Stack, Users, Product Purpose, Positioning, Operating Context, Capabilities and Constraints, Product Principles, Accessibility).
3. `impeccable concept-seed --scope direction --mode operate` → tira un dado sobre un índice de una lista de 7 direcciones visuales que yo mismo derivé del "mundo cultural" del dominio (no del catálogo genérico). Para este proyecto la lista fue: boarding pass/check-in aéreo, banking KYC onboarding, carnet de obra social, etiqueta de medicación, señalética hospitalaria, **hoja de resultados de laboratorio clínico** (elegida, índice 6), centro de comando/ops. El script también devuelve 6 "challengers" de un catálogo genérico (temas rarísimos tipo teatro/CRT retro/nixie tubes) que hay que fusionar y casi siempre declinar por chocar con el brief, pero cada declinado dona una idea a la dirección ganadora (ver `.impeccable/surfaces/app.md` para el detalle completo de qué se donó y por qué).
4. Escribí el contrato de dirección (THESIS/OWN-WORLD/STORY/FIRST VIEWPORT/FORM/FINISH) con `impeccable surface-brief write app <archivo>`.
5. Sin generación de imágenes disponible en este entorno → build **code-led** directo (sin comps/plates/build-phase state machine). Si en una sesión futura SÍ hay generación de imágenes disponible, el flujo cambia: hay que pasar por `visualize.md` (comps) antes de construir.
6. Construí HTML/CSS/JS directamente, sirviendo con `npx serve` + capturas con Playwright (instalado en el scratchpad de la sesión, no en el proyecto) para inspección visual real en mobile/tablet/desktop.
7. Corrí `impeccable detect --json <archivos>` (el detector mecánico de slop/contraste/antipatrones) dos rondas, corrigiendo lo que salió: contraste bajo AA, `[hidden]` pisado por una regla CSS con la misma especificidad, overflow horizontal de toda la página en mobile por un grid sin `minmax(0,1fr)`, transición de `width` cambiada a `transform:scaleX()`, line-height apretado, un "kicker" suelto sobre un título (antipatrón explícitamente prohibido por el skill), y saqué la dependencia de Google Fonts (ahora corre 100% offline con system font stack).
8. Documenté el sistema final en `DESIGN.md` siguiendo el spec oficial (frontmatter YAML + 8 secciones canónicas).

**No corrí todavía** las pasadas de motion (`/emil-design-eng`, `/animate`, `/review-animations`) — el usuario pidió explícitamente hacerlas por separado, en mensajes distintos, no todas juntas.

## Dirección visual elegida — resumen rápido

**Nombre interno: "The Lab Report"**. En vez del dashboard SaaS genérico (cards anidadas, degradados, iconos decorativos), el sistema traduce el lenguaje de una hoja de resultados de laboratorio: reglas finas en vez de cards-en-cards, etiquetas en versalitas pequeñas, números con cifras tabulares alineadas, progreso como secuencia de fases nombradas (nunca solo %), estado siempre como ícono+palabra+color juntos.

Paleta: navy profundo (`#0b2545`) estructural, teal (`#0c7f74`/`#0f9b8e`) como único acento accionable, mint/celeste suaves, fondos blancos/gris muy claro. Tipografía: system font stack (no Google Fonts) — deliberado para que la demo funcione offline en una clínica sin wifi. Detalle completo de tokens y componentes en `DESIGN.md`.

## Datos mock

8 pacientes argentinos en `js/data.js` (nombres, DNI formato AR, obras sociales reales: OSDE, Swiss Medical, Galeno, Medifé, IOMA, PAMI, Unión Personal, Accord Salud) cubriendo los 5 estados posibles (Listo, Información pendiente, Documentación pendiente, Revisión requerida, No iniciado).

## Cómo correrlo

Abrir `index.html` directo en el navegador, o servir la carpeta con cualquier server estático (`npx serve .`, Live Server de VS Code, etc.). No hay build ni instalación.

## Pendiente / próxima iteración

- Pasadas de motion separadas: `/emil-design-eng` (pulido de interacción) → `/animate` (implementación) → `/review-animations` (control final).
- Estados vacío/error explícitos más desarrollados (hoy solo el EmptyState de la tabla sin resultados).
- Ícono/isotipo de marca propio en vez de emoji.
- Si se agregan más mocks para la misma Vertical Salud: reusar `PRODUCT.md` (actualizar solo si cambia el contexto de producto) y **heredar `DESIGN.md`** en vez de re-tirar el dado de dirección — una nueva pantalla dentro de un mundo visual ya establecido no es un "new-work", es una extensión (ver sección "Extender una superficie existente" en la guía de `/impeccable`).
- Si se arranca un mock para OTRO producto/vertical (no relacionado a este), sí corresponde repetir el proceso completo de `/impeccable` desde init + concept-seed de dirección, porque no hereda este mundo visual.

## Notas de entorno (Windows, sin Python)

- No hay Python instalado (solo el alias de Microsoft Store). Para servir estático se usó `npx serve` (Node). Para screenshots reales se instaló Playwright + Chromium vía `npm install playwright` en el directorio de scratchpad de la sesión (no en el proyecto) y `npx playwright install chromium`.
- El launcher del skill en Windows es `impeccable.cmd`, no `impeccable` (bash no reconoce el binario sin extensión en este setup).
