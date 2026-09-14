# Roadmap de mockups — Vertical Salud

Contexto: trabajo en paralelo a Horus (no relacionado, prioridad menor), para ir armando una base de mockups de productos/aplicaciones ofrecibles a clientes de la Vertical Salud. Se hace en los huecos de tiempo mientras se espera disponibilidad de los servicios back de Horus. No se sube a repositorio ni se busca desarrollo funcional — el objetivo es explorar ideas, definir qué se puede ofrecer y generar mockups visuales/funcionales mockeados.

Fuente: card de Trello con la lista oficial de productos a considerar.

## Ya hecho

- **Onboarding de pacientes** (`paciente.html` + `institucion.html`, este mismo repo) — alta de pacientes, formularios, carga de documentación, datos previos a la atención. Ver `HANDOFF.md`, `PRODUCT.md`, `DESIGN.md` para proceso y sistema de diseño ("The Lab Report": navy `#0b2545` + teal `#0c7f74`/`#0f9b8e`).
- **Llamador de pacientes** (`llamador-pacientes/`) — pantalla pública tipo TV para sala de espera, panel de control (recepción/consultorio) y vista mobile del profesional. Estado sincronizado en vivo entre pestañas vía `localStorage` (sin backend): llamar a un paciente desde el Panel actualiza la Pantalla automáticamente.
- **Gestor de turnos por WhatsApp** (`whatsapp-turnos/`) — vista de conversación (chat simulado dentro de un frame de teléfono) con 4 escenarios ramificados: solicitar, recordatorio automático, cancelar y reprogramar turno; más un panel de automatizaciones institucional con métricas, flujos configurables (on/off) y actividad reciente.
- **App mobile de pacientes** (`app-mobile-pacientes/`) — app de una sola pantalla con tab bar (Inicio, Turnos, Estudios, Avisos, Perfil): próximo turno, pedir turno nuevo (drawer con especialidades), cancelar/reprogramar, ver y "descargar" estudios, notificaciones con contador de no leídas, y documentación del paciente. Reusa María González como paciente de referencia para mantener continuidad narrativa con el resto de la vertical.

## Descartados

- **Sistema de gestión de turnos** → ya es Horus, no corresponde mockear.
- **Gestor de estudios** → ya es Osiris, no corresponde mockear.
- **Sitio web informativo/administrable** → poco diferenciado (lo hace cualquier agencia), no muestra expertise específico de la vertical salud. Baja prioridad.
- **Gestor de procesos** (tareas/estados/responsables/automatizaciones) → genérico, no específico de salud, bajo valor como showcase de vertical.

## Prioridad 1 — arrancar por acá (rápidos, alto impacto de demo, reusan el sistema de diseño ya definido)

1. ~~**Llamador de pacientes**~~ ✅ hecho (`llamador-pacientes/`).
2. ~~**Gestor de turnos por WhatsApp**~~ ✅ hecho (`whatsapp-turnos/`).
3. ~~**App mobile de pacientes**~~ ✅ hecho (`app-mobile-pacientes/`).

## Prioridad 2 — más valor, más esfuerzo/lógica

4. **Sistema de triage / evaluador de riesgo** — formularios de evaluación, clasificación de riesgo, priorización y derivación según resultado. Muy diferenciador para clínicas de guardia/urgencias, pero requiere diseñar lógica de formulario condicional.
5. **Analista/Agente de IA** — investigación, búsqueda y análisis de información, generación de información o asistencia al usuario. En vez de producto standalone, mockear como panel/copiloto embebido en `institucion.html` (dashboard ya existente). Barato de mockear como UI de chat lateral, alto factor "wow" por ser IA.

## Evaluar con cuidado / dejar para más adelante

- **Gestor de consultas** (gestión de atención, evolución, antecedentes, historia clínica) — alcance grande, casi un EHR completo.
- **Gestor de cirugías** (programación, planificación, seguimiento, estados y procesos asociados) — el brief mismo dice "puede tomar Horus como referencia pero pensando en un producto más general", lo que sugiere riesgo de pisarse con el roadmap futuro de Horus.

Ambos se harían solo si hay bastante tiempo libre acumulado, no como próximo paso — alcance grande y riesgo de duplicar trabajo con Horus.

## Próximo paso

Prioridad 1 completa. Seguir con prioridad 2: **Triage / evaluador de riesgo** o **Analista/Agente de IA** (como panel embebido en `institucion.html`).
