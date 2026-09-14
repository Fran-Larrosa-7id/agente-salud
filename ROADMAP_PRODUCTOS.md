# Roadmap de mockups — Vertical Salud

Contexto: trabajo en paralelo a Horus (no relacionado, prioridad menor), para ir armando una base de mockups de productos/aplicaciones ofrecibles a clientes de la Vertical Salud. Se hace en los huecos de tiempo mientras se espera disponibilidad de los servicios back de Horus. No se sube a repositorio ni se busca desarrollo funcional — el objetivo es explorar ideas, definir qué se puede ofrecer y generar mockups visuales/funcionales mockeados.

Fuente: card de Trello con la lista oficial de productos a considerar.

## Ya hecho

- **Onboarding de pacientes** (`paciente.html` + `institucion.html`, este mismo repo) — alta de pacientes, formularios, carga de documentación, datos previos a la atención. Ver `HANDOFF.md`, `PRODUCT.md`, `DESIGN.md` para proceso y sistema de diseño ("The Lab Report": navy `#0b2545` + teal `#0c7f74`/`#0f9b8e`).

## Descartados

- **Sistema de gestión de turnos** → ya es Horus, no corresponde mockear.
- **Gestor de estudios** → ya es Osiris, no corresponde mockear.
- **Sitio web informativo/administrable** → poco diferenciado (lo hace cualquier agencia), no muestra expertise específico de la vertical salud. Baja prioridad.
- **Gestor de procesos** (tareas/estados/responsables/automatizaciones) → genérico, no específico de salud, bajo valor como showcase de vertical.

## Prioridad 1 — arrancar por acá (rápidos, alto impacto de demo, reusan el sistema de diseño ya definido)

1. **Llamador de pacientes** — gestión de sala de espera, llamado de pacientes, visualización de llamados por pantalla (formato TV/kiosko). Mayormente visual/estado, poca lógica. Alto factor "wow" en demo a clínicas por ser una pantalla pública en la sala de espera. Reusa paleta navy/teal para look institucional.
2. **Gestor de turnos por WhatsApp** — solicitud, confirmación, cancelación y reprogramación de turnos vía chat; automatización de comunicaciones con pacientes. Canal claramente distinto del sistema de turnos de Horus (es la interfaz conversacional, no el motor de turnos). Mockup de conversación de chat, rápido de armar y muy demostrable.
3. **App mobile de pacientes** — turnos, estudios, notificaciones, información y documentación. Continuación natural del onboarding ya hecho: reusa casi literalmente componentes y flujo mobile de `paciente.html`, costo incremental bajo.

## Prioridad 2 — más valor, más esfuerzo/lógica

4. **Sistema de triage / evaluador de riesgo** — formularios de evaluación, clasificación de riesgo, priorización y derivación según resultado. Muy diferenciador para clínicas de guardia/urgencias, pero requiere diseñar lógica de formulario condicional.
5. **Analista/Agente de IA** — investigación, búsqueda y análisis de información, generación de información o asistencia al usuario. En vez de producto standalone, mockear como panel/copiloto embebido en `institucion.html` (dashboard ya existente). Barato de mockear como UI de chat lateral, alto factor "wow" por ser IA.

## Evaluar con cuidado / dejar para más adelante

- **Gestor de consultas** (gestión de atención, evolución, antecedentes, historia clínica) — alcance grande, casi un EHR completo.
- **Gestor de cirugías** (programación, planificación, seguimiento, estados y procesos asociados) — el brief mismo dice "puede tomar Horus como referencia pero pensando en un producto más general", lo que sugiere riesgo de pisarse con el roadmap futuro de Horus.

Ambos se harían solo si hay bastante tiempo libre acumulado, no como próximo paso — alcance grande y riesgo de duplicar trabajo con Horus.

## Próximo paso

Arrancar mockup de **Llamador de pacientes** (prioridad 1, ítem 1).
