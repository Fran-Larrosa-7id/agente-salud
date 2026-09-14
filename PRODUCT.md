# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

static HTML/CSS/JS (user-specified explicitly: "si queres usa html, css y js y lo que veas necesario"). No framework, no build step, no backend, no persistence — local mock data only.

## Users

- **Paciente**: recibe un turno médico y necesita completar información administrativa y clínica básica antes de la consulta, desde el celular, en pocos minutos, sin que se sienta un trámite burocrático.
- **Recepción / Administración**: en la institución de salud, necesita ver de un vistazo qué pacientes están listos para el día, quién tiene información o documentación pendiente, y a quién hay que contactar o revisar antes de que llegue.
- **Profesional de salud**: quiere disponer de un resumen clínico y administrativo previo del paciente (antecedentes, alergias, medicación) sin leer una historia clínica completa.

## Product Purpose

"Onboarding de Pacientes" (también presentable como Pre-admisión Digital / Preconsulta Digital / Admisión Inteligente) es un producto conceptual para la Vertical Salud que permite a los pacientes completar antes de la consulta: datos personales, cobertura médica, antecedentes, alergias, medicación y documentación, con consentimiento digital. La institución obtiene visibilidad previa de quién está listo, quién tiene información pendiente y quién requiere revisión, reduciendo la carga administrativa en el momento de la atención y el tiempo perdido de consulta.

Éxito para este proyecto = un mockup/prototipo navegable de alta fidelidad, no funcional en el backend, que comunique la propuesta de forma convincente a una clínica, centro médico, consultorio o sanatorio en una demo de pocos minutos.

## Positioning

No es una historia clínica electrónica ni un sistema de turnos. Es una capa de pre-admisión conversacional y mobile-first que se ubica entre "el turno fue agendado" y "el paciente llega a la clínica", eliminando la fricción de completar/repetir información en el mostrador. El diferencial frente a un formulario web genérico es la combinación de: experiencia paciente cuidada y rápida (no burocrática) + panel operativo institucional con visibilidad de estado por paciente (listo / pendiente / requiere revisión), no solo un formulario que junta datos.

## Operating Context

- Es un proyecto independiente, no forma parte de Horus ni depende de su código o servicios, aunque puede convivir conceptualmente dentro de la misma Vertical Salud.
- No hay backend real, ni integración con APIs, ni persistencia real. Todo el estado y datos son mock/locales.
- No se busca un MVP funcional completo, sino un prototipo frontend navegable y visualmente convincente para mostrar a clientes potenciales (clínicas, centros médicos, consultorios, sanatorios).
- No se subirá a ningún repositorio productivo.
- Debe soportar una demo guiada: navegación completa del flujo paciente (mobile-first) y del dashboard institucional (desktop-first), con una forma simple de alternar entre ambas demos (selector inicial, no parte conceptual del producto final).

## Capabilities and Constraints

- Dos experiencias distintas pero relacionadas dentro del mismo prototipo: (1) flujo paciente mobile-first de 9 pantallas (bienvenida, estado de onboarding, datos personales, cobertura médica, información clínica, documentación, revisión, consentimiento, finalización); (2) dashboard institucional desktop-first (métricas, listado de pacientes con filtros/búsqueda, detalle de paciente con checklist/alertas/documentos/acciones rápidas).
- Datos mock realistas en español rioplatense/argentino (nombres, DNI formato AR, obras sociales/prepagas reales del mercado argentino), sin lorem ipsum.
- Carga de archivos, envío de formularios, recordatorios y acciones administrativas son simulados (sin backend), pero deben sentirse creíbles (estados de carga, éxito, error, pendiente).
- Terminología del dominio: onboarding / pre-admisión, cobertura médica, antecedentes, documentación, revisión, listo para atender.
- Explícitamente fuera de alcance: historia clínica electrónica completa, autenticación real, integración con obras sociales reales, Redux/estado global si no hace falta, backend simulado complejo, generación de decenas de archivos.

## Evidence on Hand

Ninguna. No hay datos reales, testimonios, logos institucionales ni assets de marca existentes — todo el contenido (pacientes, turnos, profesionales, obras sociales) es mock y debe declararse como tal implícitamente por ser un prototipo de demo.

## Product Principles

1. La experiencia del paciente debe sentirse humana, breve y de confianza — nunca como un trámite burocrático o una ficha médica interminable.
2. La experiencia institucional debe responder preguntas operativas (¿quién está listo?, ¿qué falta?, ¿a quién reviso?) sin abusar de gráficos o widgets decorativos.
3. Cada pantalla y componente debe justificar su existencia; preferible un prototipo acotado y pulido a uno grande y mediocre.
4. El estado (progreso, documentos, revisión) debe comunicarse siempre con más de una señal (texto + color + ícono), nunca solo color.
5. El producto debe sentirse como un HealthTech premium independiente — nunca como una plantilla genérica ni como un ejercicio claramente generado por IA.

## Accessibility & Inclusion

Contraste adecuado, foco visible, navegación por teclado, labels asociados a inputs, estados no dependientes únicamente del color, tamaños de objetivo táctil cómodos en mobile, mensajes de error claros, y respeto de `prefers-reduced-motion` en toda animación.
