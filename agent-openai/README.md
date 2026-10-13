# Portal Pacientes — OpenAI Agents API / PoC v4

## Prueba de la página pública de Pérez Cambet

Esta variante utiliza el navegador alojado de OpenAI con `gpt-6-luna` para abrir solamente:

`https://www.biodatasa.com.ar/lwcloud/percamb/login`

El objetivo es confirmar que puede ver las etiquetas de acceso, sin iniciar sesión, escribir DNI/contraseña, enviar formularios ni descargar estudios.

### Si ya venís usando la v3

1. Copiá `percamb-public.mjs` al lado de tu `smoke.mjs`.
2. En tu `package.json`, agregá en `scripts`: `"test:percamb": "node percamb-public.mjs"`.
3. Conservá tu `.env` actual; el archivo nuevo fija la URL de Pérez Cambet y toma de `.env` solamente la clave, el modelo y el timeout.
4. Ejecutá `npm run test:percamb` y aprobá SOLO `https://www.biodatasa.com.ar` (o `https://biodatasa.com.ar`).

### Si bajaste el proyecto v4 completo

1. Copiá tu `.env` anterior a esta carpeta (no lo envíes a nadie).
2. `npm install`
3. `npm run test:percamb`

### Qué esperamos

- Sesión creada y solicitud de acceso al dominio legítimo.
- Eventos `computer_use_call` y `agent.session.turn.completed`.
- Reporte de título, URL final, campos visibles y botón de acceso.
- Validación local de las etiquetas del formulario, sin que sus textos se incluyan en el prompt del agente.
- `[CLEANUP] Sesion eliminada`.

Si el agente informa que no puede abrir la página, **no fuerces el acceso**: traé la salida de la consola (sin secretos ni datos personales) para diagnosticarlo.

### Seguridad y facturación

- `Auto recharge` desactivado; revisar Usage después de cada ejecución.
- Sin `spend_control` porque esta cuenta devolvió `400 Session budget configuration is not enabled`.
- `SESSION_TIMEOUT_SECONDS=90` limita el seguimiento, **no es un límite absoluto de facturación**.
- Las aprobaciones de otros orígenes se rechazan automáticamente.
- El agente no debe ingresar datos personales ni médicos; no compartas ninguna contraseña en chat.
- Se intenta eliminar la sesión siempre; si falla, limpiá con `npm run cleanup -- sess_ID_REAL`.

La prueba original se conserva en `npm start` con `example.com` o el `TARGET_URL` de tu `.env`.

node --env-file=.env --input-type=module -e "import OpenAI from 'openai'; const api = new OpenAI(); const page = await api.beta.agents.sessions.list({limit:50}); for(const s of page.data) console.log(s.id, s.status);"
