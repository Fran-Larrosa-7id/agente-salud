# Roadmap de mockups — Vertical Salud

Contexto: trabajo en paralelo a Horus y Osiris (no relacionado), para armar una base de mockups de soluciones ofrecibles a clientes de la Vertical Salud. El objetivo es explorar ideas y comunicar qué se puede ofrecer; no es desarrollo funcional. Punto de entrada: `index.html` (catálogo).

Categorías: FUERTE · COMPLEMENTARIO · CAPACIDAD TRANSVERSAL · EXPLORATORIO · BACKLOG.

## Turnos Online — FUERTE
Ruta: `turnos-online/turnos-online.html`.
- **Qué demuestra:** búsqueda por especialidad o profesional, reserva, consulta y reprogramación; panel institucional con agenda, convenios y políticas de cancelación, reprogramación y documentación.
- **Integración mock:** comparte turnos, cambios de cobertura y políticas con `app-mobile-pacientes/index.html` mediante `localStorage` y eventos `storage` en el mismo navegador/origen.
- **Coberturas:** un cambio no cancela reservas; señala turnos futuros para revisión y permite simular aviso, contacto, cambio de cobertura, pase a particular y resolución con el paciente.
- **Cobertura a validar (escenario E):** el estado registrado se ve en toda la reserva (paso, resumen lateral, resumen final y confirmación). Según la política, el turno queda «Confirmado · cobertura pendiente» o sin confirmar hasta que recepción valide; recepción puede registrar la validación desde el detalle del turno.
- **Documentación por tipo de atención:** consultas y estudios/prácticas tienen reglas propias (no se solicita, opcional, recomendado, necesario). Para lo necesario se comprueba la selección en el navegador; el contenido no se envía ni persiste.
- **Avisos:** tabla compacta de qué canal usa cada evento (WhatsApp, Email, Portal). Es una representación; no hay motor de mensajería.
- **Pendiente:** profesionales con más de una especialidad (el modelo de datos asigna una sola por profesional).
- **Mockeado:** agenda, convenios, políticas y confirmaciones. No consultar servicios externos.
- **No se pretende:** disponibilidad clínica en tiempo real, autenticación real, garantía de cobertura, coseguros ni costos.

## Onboarding de pacientes — FUERTE
Rutas: `onboarding.html`, `institucion.html`, `paciente.html`.
- **Qué demuestra:** preparar datos, documentación e información previa a la atención. La institución elige una plantilla (Consulta general, Pre-admisión quirúrgica, Diagnóstico por imágenes, Laboratorio, Personalizado) y el flujo del paciente omite secciones y ajusta los documentos requeridos.
- **Mockeado:** carga de archivos, envío de datos, estados de los pacientes, persistencia de la configuración (solo `localStorage`).
- **Falta:** requisitos por profesional o sede, recordatorios de onboarding pendiente.
- **No se pretende:** historia clínica, evoluciones, diagnósticos, tratamientos.

## Turnos por WhatsApp — FUERTE
Rutas: `whatsapp-turnos/index.html`, `chat.html`, `panel.html`.
- **Qué demuestra:** la IA interpreta la intención; el motor valida disponibilidad real (ausencias, feriados, bloqueos, turnos existentes) y revalida antes de reservar; la agenda es la fuente de verdad. Escenarios: solicitar, profesional no disponible, horario que se ocupa, recordatorio, cancelar, reprogramar, hablar con un operador. Panel «Qué pasa por detrás», arquitectura conceptual y automatizaciones (Disparador / Acción / Estado) que afectan la conversación.
- **Mockeado:** API de WhatsApp, agenda, motor de turnos, IA.
- **Falta:** escenario para la encuesta post-consulta; vista de la bandeja del operador.
- **No se pretende:** gestor de turnos completo, integración real con agendas.

## Llamador de pacientes — FUERTE
Rutas: `llamador-pacientes/index.html`, `pantalla.html`, `panel.html`, `mobile.html`, `configuracion.html`.
- **Qué demuestra:** sala de espera sincronizada entre recepción, profesional y pantalla; privacidad configurable (nombre completo, nombre + inicial, iniciales, número de turno); datos visibles y sonido configurables; separación de roles.
- **Mockeado:** sincronización (`localStorage` + eventos `storage`, sin servidor en tiempo real), sonido, consultorios.
- **Falta:** estado de llegada del paciente (programado → presente → en espera).
- **No se pretende:** WebSockets, autenticación, integración con la agenda.

## Portal del paciente — COMPLEMENTARIO
Ruta: `app-mobile-pacientes/index.html`.
- **Qué demuestra:** punto único de acceso a turnos, estudios, documentación, cobertura y notificaciones; lista turnos que se reservan en Turnos Online, permite cancelarlos según política y enlaza la reprogramación al flujo compartido.
- **Mockeado:** sesión/acceso local, contenidos clínicos de ejemplo, datos de cobertura y avisos; no hay servicio de autenticación ni backend.
- **Turnos:** el próximo turno muestra estado, cobertura registrada y acciones (ver detalle, reprogramar, cancelar, agregar al calendario con un `.ics`, cómo llegar). El diálogo de cancelación informa la política de la institución.
- **PWA:** manifest con íconos PNG 192/512 (incluido maskable), `apple-touch-icon` y service worker básico para instalación y caché estática cuando se sirve por `localhost` o HTTPS.
- **Falta:** autenticación segura y una API institucional, fuera del alcance del mock.
- **No se pretende:** reemplazar Horus, Osiris, Onboarding ni WhatsApp; ser una app completa.

## Asistente IA — CAPACIDAD TRANSVERSAL
Ruta: `institucion.html?ia=1` (panel embebido).
- **Qué demuestra:** lenguaje natural sobre información operativa (revisión, documentación pendiente, próximos turnos, pacientes de un profesional). Consulta solo las fuentes que la institución decida conectarle.
- **Mockeado:** el modelo; responde con reglas sobre datos de ejemplo.
- **Falta:** presentarlo sobre otros productos (agenda, procesos).
- **No se pretende:** diagnóstico, tratamiento, recomendación clínica, inventar datos.

## Triage — EXPLORATORIO
Rutas: `triage-riesgo/index.html`, `evaluacion.html`, `panel.html`.
- **Qué demuestra:** un motor de evaluación aplica reglas configuradas y validadas por la institución y devuelve una prioridad orientativa; siempre hay revisión profesional. El contacto de emergencia es configurable.
- **Mockeado:** las reglas, que son ilustrativas y no representan un protocolo clínico validado.
- **Falta:** definir con profesionales las reglas antes de cualquier uso real.
- **No se pretende:** algoritmo clínico, clasificación definitiva.

## BACKLOG
Sin desarrollo: gestor de estudios, gestor de cirugías, historia clínica, integraciones reales, backend.

## Journey conceptual
Turnos Online o Turnos por WhatsApp → Onboarding → (llegada) Llamador → Atención (sistema clínico) → Portal del paciente. Cada solución puede funcionar sola o integrarse con otros sistemas; no es un sistema monolítico.
