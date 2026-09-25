# Catálogo de soluciones — Vertical Salud (mockups)

Colección de mockups navegables para explorar posibles soluciones digitales de la Vertical Salud. Sirven como base visual y funcional para adaptar cada solución a distintos clientes.

Son conceptos independientes: no forman parte de Horus ni de Osiris.

## Qué NO es

- No es un producto productivo.
- No tiene backend real.
- No tiene integraciones reales (WhatsApp, agendas, Horus, Osiris).
- No representa implementaciones clínicas validadas.

## Productos incluidos

| Producto | Problema que resuelve | Usuarios | Estado | Demo |
| --- | --- | --- | --- | --- |
| Turnos Online | Encontrar y reservar turnos por especialidad o profesional | Paciente / Institución | Fuerte | `turnos-online/turnos-online.html` |
| Onboarding de pacientes | Preparar datos y documentación antes de la atención | Paciente / Recepción | Fuerte | `onboarding.html` |
| Turnos por WhatsApp | Gestión conversacional de turnos sobre la agenda real | Paciente / Institución | Fuerte | `whatsapp-turnos/index.html` |
| Llamador de pacientes | Ordenar la sala de espera | Recepción / Profesional / Paciente | Fuerte | `llamador-pacientes/index.html` |
| Prescripción y Órdenes Digitales | Emitir recetas y órdenes y que el paciente las encuentre en su Portal | Profesional / Paciente | Solución principal · mock navegable | `prescripcion-ordenes/index.html` |
| Portal del paciente | Acceso digital único a servicios de la institución | Paciente | Complementario | `app-mobile-pacientes/index.html` |
| Portal de Pacientes (historia personal) | Reunir en un solo lugar la información de salud repartida entre instituciones; «Traer mis estudios» | Paciente | Nuevo · mock navegable | `portal-pacientes/index.html` |
| Asistente IA | Consulta de información operativa en lenguaje natural | Personal administrativo | Capacidad transversal | `institucion.html?ia=1` |
| Triage | Priorización basada en reglas de la institución | Paciente / Guardia | Exploratorio | `triage-riesgo/index.html` |

Punto de entrada: `index.html` (catálogo).

## Cómo ejecutar

HTML, CSS y JS puros, sin build ni dependencias. Las sincronizaciones entre pestañas usan `localStorage`, por eso conviene servir la carpeta en vez de abrir los archivos con doble clic:

```
python -m http.server 8000
```

y abrir `http://localhost:8000`. Sirve cualquier servidor estático (`npx serve .`, Live Server de VS Code).

## Cómo probar cada demo

### Turnos por WhatsApp (`whatsapp-turnos/`)
- `chat.html`: elegir un escenario y mirar el panel «Qué pasa por detrás» (IA → Motor → Agenda).
  - **Profesional no disponible**: el Dr. Larrosa el 18/09 está de vacaciones; se ofrecen alternativas.
  - **Horario que se ocupa**: elegir las 10:00 provoca la revalidación y ofrece 10:30, 11:00, 11:30.
  - **Hablar con un operador**: derivación humana.
  - Solicitar, recordatorio, cancelar y reprogramar completan el resto.
  - «Reiniciar demo» limpia la conversación.
- `panel.html`: arquitectura conceptual, reglas del motor y automatizaciones (Disparador / Acción / Estado). Apagar una automatización cambia lo que pasa en el chat.

### Llamador (`llamador-pacientes/`)
- Abrir `pantalla.html` (sala) y `panel.html` (recepción) en dos pestañas; «Llamar siguiente» actualiza la sala.
- `mobile.html`: vista del profesional.
- `configuracion.html`: cambiar formato del llamado (nombre, iniciales, número de turno), datos visibles y sonido; la pantalla se actualiza al instante.

### Onboarding (`onboarding.html`)
- `institucion.html`: panel «Configuración de onboarding», cambiar la plantilla (p. ej. Diagnóstico por imágenes).
- `paciente.html`: el flujo omite las secciones no solicitadas y muestra los documentos requeridos. Abrirlo después de cambiar la plantilla.
- «Reiniciar configuración» vuelve a Consulta general.

### Portal de Pacientes — historia personal (`portal-pacientes/index.html`)
Independiente del Portal del paciente de turnos. Acceso demo: DNI 32.456.789 y cualquier contraseña (DNI distinto → error de acceso).
- **Traer mis estudios** (flujo principal): Estudios → «Traer mis estudios» → Laboratorio Norte → Continuar → contraseña cualquiera → Autorizar → búsqueda → elegir → Guardar. Los 6 estudios aparecen como «Nuevo» en Estudios, Documentos e Historial.
- **Error de conexión:** elegir Clínica del Sur; el primer intento falla y «Reintentar» funciona. Instituciones «Próximamente» en «Ver más instituciones».
- **Compartir:** abrir un estudio → Compartir → qué y por cuánto tiempo → «Crear acceso seguro» → copiar o revocar. Los accesos quedan en Mi perfil → Privacidad.
- **Estados:** estudio con resultado pendiente (Vitamina D), búsquedas sin resultados, y Mi perfil → «Ver como cuenta nueva» para los estados vacíos. «Restablecer datos de la demo» vuelve a la semilla.
- Mi perfil → «Tamaño del texto» agranda toda la interfaz (pensado para adultos mayores).

### Portal del paciente (`app-mobile-pacientes/index.html`)
Navegar Inicio, Turnos, Estudios, Avisos y Perfil. El acceso demo es local; el próximo turno y «Mis turnos» permiten revisar, cancelar (el diálogo muestra la política), agregar al calendario (`.ics`) y abrir la reprogramación en Turnos Online. La reserva conserva el email del acceso demo para asociarla al portal. Para probar los cambios de cobertura, abrir en otra pestaña Turnos Online → Panel → Coberturas, marcar un convenio para revisión y preparar el aviso al paciente.

### Turnos Online (`turnos-online/turnos-online.html`)
- Reservar por especialidad o profesional; al ingresar desde el portal puede precompletar los datos del acceso demo.
- Panel → Coberturas: actualizar el estado y fecha de un convenio, identificar turnos futuros afectados, y simular aviso, contacto, cambio de cobertura, pase a particular o resolución. Un cambio no cancela turnos por sí solo.
- Panel → Configuración (Políticas institucionales): límites de cancelación/reprogramación, si un turno con cobertura a validar se confirma igual, documentación por tipo de atención (consultas / estudios y prácticas) y la tabla de canales de aviso. Para documentación necesaria, la demo comprueba que se seleccionó un archivo; no transmite ni conserva su contenido.
- La reserva y el portal comparten el estado local; abrir ambas páginas en pestañas del mismo navegador para comprobar la sincronización.

#### Escenarios de demo
- **A · Conoce la especialidad:** Por especialidad → Cardiología → «Primer turno disponible» → Swiss Medical (Vigente, última validación) → confirmar.
- **B · Conoce al profesional:** Por profesional → buscar «romero» (o «cardio») → la especialidad se completa sola → cobertura → tipo → horario.
- **C · Documentación opcional:** con una consulta, DNI y credencial aparecen como opcionales y se puede confirmar sin cargarlos («Podés completarlo más adelante»). Con «Estudio o práctica», la orden médica es necesaria y bloquea hasta seleccionar un archivo.
- **D · Cobertura vigente:** elegir Swiss Medical, OSDE o IOMA: «Vigente · Última validación».
- **E · Cobertura a validar:** elegir Galeno u «Otra obra social»: aviso «Tu cobertura necesita ser verificada antes de la atención» y turno «Confirmado · cobertura pendiente» (o sin confirmar si se desactiva la política). En el panel, abrir el turno en la agenda → «Registrar cobertura validada»; el Portal pasa a «Cobertura validada».
- **F · Convenio suspendido después de reservar:** Panel → Coberturas → OSDE → «Convenio suspendido» desde hoy → «Aplicar cambio y detectar turnos» → «Notificar paciente» en el turno de María González → en el Portal (acceso demo) aparece la alerta y el aviso → María actualiza la cobertura o sigue como particular, o recepción usa «Cambiar cobertura» / «Pasar a particular».

### Prescripción y Órdenes Digitales (`prescripcion-ordenes/`)
Prototipo conceptual. Una implementación productiva deberá adaptarse a los requisitos regulatorios, de identificación, firma, interoperabilidad y seguridad aplicables.

- `index.html`: portada con el disclaimer, accesos, escenarios y «Acerca de esta demo» (con «Reiniciar demo»).
- `demo.html`: panel profesional y Portal del Paciente en paralelo, sincronizados en el mismo navegador.
- `profesional.html`: paciente actual (búsqueda por nombre o DNI), nueva prescripción, nueva orden, vista previa, emisión simulada, historial (Todas / Emitidas / Borradores / Anuladas), ver, descargar (HTML de demostración), compartir (solo un aviso, sin datos médicos), anular con confirmación y duplicar como borrador nuevo. «Avisos al paciente» define los canales (Portal siempre; WhatsApp y email conceptuales).
- `consulta.html`: vista ilustrativa de una atención en Horus con «Nueva prescripción» y «Nueva orden»; abren el módulo con la paciente elegida y ofrecen volver a la atención.
- Portal del Paciente → «Recetas y órdenes» (acceso rápido en Inicio, aviso de documento nuevo, notificaciones y detalle). Enlace directo: `app-mobile-pacientes/index.html#recetas` o `#recetas/<id>`.
- WhatsApp → escenario «Documentación disponible» (`whatsapp-turnos/chat.html?escenario=documentacion`): el mensaje lleva al Portal y no incluye el contenido.

#### Escenarios de demo
- **1 · Prescripción:** María González → Nueva prescripción → buscar «Demo A» → dosis, frecuencia y duración → Revisar → Emitir → Ver documento → Portal → Recetas y órdenes → detalle → aviso en Notificaciones.
- **2 · Orden:** seleccionar paciente → Nueva orden → Diagnóstico por imágenes → completar la solicitud → Emitir → Portal → ver la orden.
- **Trazabilidad:** abrir un documento emitido → Anular (queda «Anulada» en el historial y en el Portal) o «Duplicar como nueva» (crea un borrador; el original no cambia).

### Asistente IA (`institucion.html?ia=1`)
Probar «¿Quién requiere revisión?» o «Mostrame pacientes de la Dra. Martínez». Rechaza preguntas clínicas.

### Triage (`triage-riesgo/`)
- `evaluacion.html` para completar una evaluación y sumarse a la cola.
- `panel.html` para ver la cola; ahí se edita el contacto de emergencia («Restaurar valor demo» vuelve al original).

## Persistencia local (localStorage)

| Clave | Uso | Cómo reiniciar |
| --- | --- | --- |
| `onboarding_config_v1` | Plantilla y requisitos de onboarding | «Reiniciar configuración» en `institucion.html` |
| `llamador_pacientes_state_v1` | Colas, atención y llamados | «Reiniciar demo» en el panel |
| `llamador_config_v1` | Privacidad, pantalla, sonido | «Restaurar valores demo» en la configuración |
| `wa-flujos`, `wa-actividad-extra` | Automatizaciones y actividad | «Reiniciar demo» en el panel de WhatsApp |
| `triage_riesgo_state_v1` | Cola de guardia | «Reiniciar demo» en el panel de triage |
| `triage_contacto_v1` | Contacto de emergencia | «Restaurar valor demo» en el panel de triage |
| `vertical-salud-turnos-online-v2` | Turnos, coberturas, políticas y actividad compartidos | No hay reset global; la demo de turnos reinicia su semilla cada día |
| `vertical-salud-portal-session-v1` | Sesión mock del Portal del Paciente | «Cerrar sesión» en Perfil; es solo un acceso local de demostración |
| `salud_prescripciones_v1` | Prescripciones, órdenes, numeración demo y canales de aviso (panel profesional, atención y Portal) | «Reiniciar demo» en la portada, el panel profesional o la vista en paralelo de Prescripción y órdenes |
| `portal_pacientes_v1` | Sesión, estudios traídos, accesos compartidos, autorizaciones y preferencias del Portal de Pacientes (historia personal) | Mi perfil → «Restablecer datos de la demo» |

Ningún reinicio usa `localStorage.clear()`: cada demo restaura solo sus claves. No se renombraron las claves a un prefijo común para no romper la sincronización existente.

## Limitaciones del prototipo

- **Turnos WhatsApp**: no usa la API de WhatsApp, no consulta una agenda real y la IA se simula con escenarios guionados.
- **Llamador**: la sincronización usa `localStorage` y solo funciona entre pestañas del mismo navegador; no hay servidor en tiempo real. El sonido es un beep simulado.
- **Onboarding**: los datos no persisten en ningún backend y las cargas de archivos son simuladas. No reemplaza una historia clínica.
- **Portal**: no se integra con Horus ni Osiris.
- **Turnos Online / Portal**: comparten datos solo en `localStorage` del mismo navegador y origen; el acceso no autentica identidad ni reemplaza un backend. La disponibilidad y el estado de cobertura son orientativos, no garantizan prestaciones ni importes. Los documentos no salen del dispositivo ni se conservan.
- **Prescripción y Órdenes Digitales**: no emite recetas reales, no firma digitalmente, no valida identidad real, no consulta bases farmacológicas (el catálogo es de demostración, con nombres ficticios), no valida normativas, no integra farmacias ni obras sociales y no contiene lógica clínica (no sugiere medicamentos, dosis ni interacciones). El código del documento es un patrón visual de demostración, no un QR válido.
- **IA**: no usa un modelo real; responde con reglas sobre datos de ejemplo.
- **Triage**: las reglas son ilustrativas y no representan protocolos clínicos validados. Siempre debe existir revisión profesional.

## Documentación

- `ROADMAP_PRODUCTOS.md`: estado de cada producto.
- `HANDOFF.md`: arquitectura, archivos y notas para retomar el proyecto.
- `PRODUCT.md`, `DESIGN.md`: contexto de producto y sistema de diseño.
