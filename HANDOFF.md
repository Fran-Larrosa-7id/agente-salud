# Handoff — Catálogo de mockups Vertical Salud

Contexto para retomar el proyecto. Ver también `README.md` (uso y pruebas) y `ROADMAP_PRODUCTOS.md` (estado por producto).

## Qué es
Colección de mockups navegables (HTML/CSS/JS puros, sin build ni backend) de posibles soluciones de la Vertical Salud. Independiente de Horus y Osiris. Objetivo: demo comercial e interna, no MVP.

## Arquitectura general
Cada producto es una carpeta o par de páginas con su propio JS; comparten `css/tokens.css`, `css/base.css` y `css/components.css`. No hay framework. Los estados compartidos entre páginas usan `localStorage` y el evento `storage`.

```
index.html                 catálogo (punto de entrada)
onboarding.html            selector del producto Onboarding
paciente.html              flujo mobile del paciente (lee la configuración)
institucion.html           panel institucional + configuración + Asistente IA embebido
js/onboarding-config.js    plantillas y configuración compartida (institución ↔ paciente)
js/data.js, institucion.js, paciente.js, asistente-ia.js
whatsapp-turnos/           index, chat, panel + js/escenarios.js
llamador-pacientes/        index, pantalla, panel, mobile, configuracion + js/llamador.js
app-mobile-pacientes/      Portal del paciente (index + js/app.js, data.js)
triage-riesgo/             index, evaluacion, panel + js/triage-*.js, evaluacion.js
turnos-online/             agenda de reserva y panel institucional (runtime DC de la demo)
prescripcion-ordenes/      index (portada), demo (paralelo), profesional, consulta (Horus ilustrativo)
                           js/rx-store.js (estado + semilla, compartido con el Portal), js/rx-sheet.js (hoja del documento), js/profesional.js
                           css/rx-sheet.css (hoja, compartida con el Portal), css/rx.css (panel, portada, atención)
css/                       tokens, base, components, institucion, paciente (+ css por carpeta)
PRODUCT.md, DESIGN.md      contexto de producto y sistema de diseño ("The Lab Report")
```

## Persistencia local y sincronización

| Clave | Contenido | Quién la usa |
| --- | --- | --- |
| `onboarding_config_v1` | plantilla + secciones + documentos | `institucion.html` escribe, `paciente.html` lee al cargar |
| `llamador_pacientes_state_v1` | colas, atendiendo, llamados | pantalla, panel, mobile (evento `storage`) |
| `llamador_config_v1` | formato de llamado, visibilidad, sonido, nombre de pantalla | `configuracion.html` escribe, pantalla lee |
| `wa-flujos`, `wa-actividad-extra` | automatizaciones y actividad | panel y chat de WhatsApp |
| `triage_riesgo_state_v1` | cola de guardia | evaluación y panel |
| `triage_contacto_v1` | contacto de emergencia | panel escribe, evaluación lee |
| `vertical-salud-turnos-online-v2` | turnos, coberturas, políticas y actividad | Turnos Online y Portal del Paciente comparten estado por `storage` |
| `vertical-salud-portal-session-v1` | sesión demo (nombre, email/DNI, cobertura) | Portal; Turnos Online lee el perfil para precompletar el formulario |
| `salud_prescripciones_v1` | documentos (receta/orden), contadores demo, canales de aviso | panel profesional y atención escriben; el Portal lee y marca «visto» (evento `storage`) |

Las claves no llevan prefijo común (`salud:*`) para no romper lo ya sincronizado. Cada demo tiene su reinicio, que solo borra sus claves (nunca `localStorage.clear()`). Detalle de cada reinicio en `README.md`.

## Decisiones conceptuales que no hay que perder
- **WhatsApp:** la IA solo interpreta; el motor de turnos valida y revalida; la agenda es la fuente de verdad. Un horario mostrado es solo una opción hasta que la reserva se confirma. Siempre existe derivación a un operador. `traza` en cada paso de `escenarios.js` alimenta el panel «Qué pasa por detrás».
- **Onboarding:** información previa a la atención, no historia clínica. Las plantillas viven en `js/onboarding-config.js`; `paciente.js` omite secciones (`INCLUDED`) y genera la lista de documentos desde la configuración.
- **Llamador:** la privacidad se aplica solo en la pantalla de sala (`llNombreSala`); recepción y profesional ven nombres completos.
- **IA:** capacidad transversal, solo información operativa; rechaza preguntas clínicas.
- **Triage:** reglas ilustrativas, prioridad orientativa, revisión profesional siempre. No mencionar protocolos clínicos reales como si estuvieran implementados.
- **Turnos Online ↔ Portal:** la reserva escribe la agenda local compartida; el portal identifica turnos por email o DNI. La reprogramación abre la reserva con el turno existente. La política de cancelación se vuelve a validar al confirmar.
- **Coberturas:** registrar un cambio no cancela turnos; los turnos futuros afectados pasan a revisión para que recepción los resuelva con cada paciente. No mostrar importes/coseguros como garantía ni prometer vigencia.
- **Estado de cobertura de un turno:** se deriva, no se copia. `apptCoverageState()` en `turnos-online.html` y `appointmentCoverageState()` en `app-mobile-pacientes/js/app.js` aplican el mismo criterio: Particular → en revisión (`coverageReview`) → validada por recepción (`coverageValidatedAt`) → estado del convenio (vigente / suspendido / pendiente). Si se cambia uno, cambiar el otro.
- **Cobertura a validar:** la política `appointmentPolicies.confirmPendingCoverage` decide si el turno queda «Confirmado · cobertura pendiente» o `pendiente` hasta que recepción valide.
- **Documentación:** `documentPolicies` tiene perfiles `consulta` y `practica` (el tipo «Estudio o práctica» usa `practica`). Valores: `none`, `optional`, `recommended`, `required`; `normalizeDocPolicies()` convierte la forma plana anterior. La selección de archivos es solo local, no hay carga a servidor.
- **Avisos:** la tabla de canales en Configuración es descriptiva; los avisos siguen siendo eventos de actividad en `localStorage`.
- **Prescripción y órdenes:** prototipo conceptual, sin lógica clínica. El catálogo (`MED_CATALOG`) usa nombres ficticios y no trae dosis. Estados guardados: `borrador`, `emitida`, `anulada`; `vencida` se deriva con `statusOf()` según `expiresISO`. Anular nunca borra; «Duplicar como nueva» crea un borrador con `duplicatedFrom`. Solo se pueden descartar borradores. El paciente del Portal se identifica por DNI o email (`patientForSession()`), igual que los turnos. Los avisos (Portal, WhatsApp, email) no llevan contenido médico. `rx-sheet.js` es la única plantilla del documento: panel, atención, Portal y la descarga HTML usan la misma. `?embed=1` oculta la barra de demo del panel dentro de `demo.html`.
- **PWA:** el Portal tiene manifest (PNG 192/512 + maskable), `apple-touch-icon` y service worker. Debe servirse por `localhost` o HTTPS; abrir con `file://` no instala ni activa modo offline. Al cambiar archivos cacheados, subir `CACHE_NAME` en `service-worker.js`.

## Datos mock
8 pacientes argentinos en `js/data.js` con los 5 estados de onboarding; María González es la paciente de referencia en WhatsApp, Portal y Llamador. Fecha narrativa: lunes 15 de septiembre de 2025.

## Limitaciones conocidas
- La configuración de onboarding no cambia los datos de los pacientes del panel, solo el flujo de `paciente.html`.
- Los llamados guardados antes de agregar `pacienteId` muestran un código de turno genérico hasta reiniciar el llamador.
- El sonido del llamador (Web Audio) puede requerir un clic previo para sonar.
- Profesionales con más de una especialidad: pendiente; cada profesional tiene una sola `specialtyId`.
- Prescripción y órdenes: el `input type="date"` muestra el formato del sistema operativo; en navegadores en español se ve dd/mm/aaaa.
- QA de la iteración de coberturas: escenarios C, E y F probados de punta a punta con Playwright (Turnos Online, panel y Portal), sin errores de consola.

## Dirección visual
"The Lab Report": navy `#0b2545` + teal `#0c7f74`/`#0f9b8e`, reglas finas y contenedores con borde en vez de tarjetas flotantes, números tabulares, estado siempre con ícono + texto + color, sistema tipográfico del sistema (sin Google Fonts). Detalle en `DESIGN.md`. Nuevas pantallas heredan este mundo visual; cada producto puede tener su personalidad.

## Cómo correrlo
`python -m http.server 8000` en la raíz y abrir `http://localhost:8000` (o `npx serve .`).
