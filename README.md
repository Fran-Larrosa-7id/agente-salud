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
| Onboarding de pacientes | Preparar datos y documentación antes de la atención | Paciente / Recepción | Fuerte | `onboarding.html` |
| Turnos por WhatsApp | Gestión conversacional de turnos sobre la agenda real | Paciente / Institución | Fuerte | `whatsapp-turnos/index.html` |
| Llamador de pacientes | Ordenar la sala de espera | Recepción / Profesional / Paciente | Fuerte | `llamador-pacientes/index.html` |
| Portal del paciente | Acceso digital único a servicios de la institución | Paciente | Complementario | `app-mobile-pacientes/index.html` |
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

### Portal del paciente (`app-mobile-pacientes/index.html`)
Navegar Inicio, Turnos, Estudios, Avisos y Perfil.

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

Ningún reinicio usa `localStorage.clear()`: cada demo restaura solo sus claves. No se renombraron las claves a un prefijo común para no romper la sincronización existente.

## Limitaciones del prototipo

- **Turnos WhatsApp**: no usa la API de WhatsApp, no consulta una agenda real y la IA se simula con escenarios guionados.
- **Llamador**: la sincronización usa `localStorage` y solo funciona entre pestañas del mismo navegador; no hay servidor en tiempo real. El sonido es un beep simulado.
- **Onboarding**: los datos no persisten en ningún backend y las cargas de archivos son simuladas. No reemplaza una historia clínica.
- **Portal**: no se integra con Horus ni Osiris.
- **IA**: no usa un modelo real; responde con reglas sobre datos de ejemplo.
- **Triage**: las reglas son ilustrativas y no representan protocolos clínicos validados. Siempre debe existir revisión profesional.

## Documentación

- `ROADMAP_PRODUCTOS.md`: estado de cada producto.
- `HANDOFF.md`: arquitectura, archivos y notas para retomar el proyecto.
- `PRODUCT.md`, `DESIGN.md`: contexto de producto y sistema de diseño.
