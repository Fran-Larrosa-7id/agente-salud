# portal-pacientes-agent

La implementación Docker se documenta en [Auditoría y comandos Docker](docs/docker-mvp.md). Conserva las tres integraciones y el frontend. Usa Chromium con sandbox, reglas sin servicios de IA y un solo job. Con `REMOTE_LOGIN=true`, el Portal ofrece «Abrir navegador» mediante noVNC autenticado; detecta el ingreso y continúa automáticamente en la misma sesión. Ver [Login automático y QA](docs/login-automatico.md) y [QA Docker](docs/docker-qa.md).

MVP de **«Traer mis estudios» con IA** para el Portal de Pacientes. El caso inicial es el **Laboratorio Pérez Cambet** (LabWin Cloud).

> «Solamente tuve que iniciar sesión. Todo lo demás se hizo solo.»

El paciente inicia sesión **él mismo** en la ventana real del laboratorio. Un agente de IA detecta que entró, encuentra sus estudios, le muestra la lista en el Portal y descarga **solo** los PDF que el paciente elige.

## Arquitectura

```text
Portal de Pacientes (../portal-pacientes, HTML/JS)
        │  REST + SSE (solo estados resumidos)
        ▼
Agent API (Express) ── JobManager (estados, TTL, limpieza)
        │
        ▼
AgentImportRunner ── HealthPortalAgent (OBSERVAR → DECIDIR → ACTUAR)
        │                   │ AgentModel (Anthropic / OpenAI-compatible / Ollama local / reglas)
        ▼                   ▼
BrowserSession (Playwright, un BrowserContext aislado por job, allowlist de dominios)
        │
        ▼
https://www.biodatasa.com.ar/lwcloud/percamb/login
```

- **La IA decide y Playwright ejecuta.** El modelo solo elige una herramienta por turno. La política de seguridad y la ejecución viven en el backend.
- **Contraseña:** el paciente la escribe en el sitio del laboratorio. No pasa por el frontend, el backend, el modelo, los logs ni los eventos. El colector de página nunca lee valores de campos, y la interceptación de red no lee cuerpos de solicitudes.

```text
src/
├─ config.ts                     variables de entorno
├─ server/                       app.ts (API), sse.ts, index.ts (arranque)
├─ jobs/                         states.ts, job.ts, job-manager.ts, agent-runner.ts, fake-runner.ts, file-store.ts, pdf.ts
├─ agent/
│  ├─ health-portal-agent.ts     ciclo del agente y límites
│  ├─ prompts/health-portal-agent.prompt.ts   system prompt versionado
│  ├─ tools/                     definitions.ts (herramientas), executor.ts
│  ├─ policies/action-policy.ts  qué se puede tocar
│  ├─ observation.ts             lo único que ve el modelo (enmascarado)
│  └─ studies.ts                 extracción de metadata mínima
├─ browser/                      browser-host.ts, session.ts, collector.ts, login-detector.ts
├─ llm/                          anthropic.ts, openai.ts, ollama.ts, rules.ts, errors.ts, index.ts
├─ providers/percamb/            URL, dominios y pistas de Pérez Cambet
└─ security/                     sanitize.ts, logger.ts, domain-policy.ts
test/unit, test/e2e, test/fixtures/fake-portal.ts
```

## Cómo correrlo

```bash
cd portal-pacientes-agent
npm install
npx playwright install chromium
cp .env.example .env        # por defecto usa reglas sin claves ni Ollama; no reemplazar un .env existente
npm run dev                 # API + frontend en http://127.0.0.1:8787
```

Abrí `http://127.0.0.1:8787/#/traer?inst=pc`. Para entrar al Portal usá el DNI de la demo, `32.456.789`, y cualquier contraseña.

El frontend también funciona servido aparte (`python -m http.server 8000` desde la raíz del repo): en ese caso llama a `http://127.0.0.1:8787`. Para usar otra URL, ejecutá `localStorage.pp_agent_url = 'http://…'` en la consola del navegador.

| Comando | Qué hace |
| --- | --- |
| `npm run dev` | Agente real con ventana visible (`HEADLESS=false`) |
| `npm run start:fake` | **FakeProviderAgent**: todo el flujo sin laboratorio, sin IA y sin navegador. `FAKE_SCENARIO` acepta `human`, `timeout`, `unavailable`, `empty` y `partial` |
| `npm test` | Tests unitarios y E2E (portal falso local, nunca el real) |
| `npm run typecheck` | Verificación de tipos |

## Navegador de Playwright

Por defecto, el agente conserva el Chromium instalado con Playwright. En Windows se puede seleccionar un navegador instalado configurando `BROWSER_CHANNEL` en `.env`, por ejemplo:

```env
BROWSER_CHANNEL=msedge
HEADLESS=false
```

Al iniciar, el agente intenta abrir el canal configurado y registra `browser_ready channel=msedge` si esta disponible. Si no puede lanzarlo, informa `BROWSER_NOT_INSTALLED`; sin `BROWSER_CHANNEL`, se mantiene el comportamiento actual con Chromium empaquetado.
Los E2E de Playwright también leen `.env` y usan ese canal; si no está definido, conservan Chromium.

## Ejecutar IA local gratis (Ollama)

Con `LLM_PROVIDER=ollama` la inferencia ocurre en tu computadora: no se usa ninguna clave ni se envía nada a servicios externos.

1. Instalá [Ollama](https://ollama.com) y dejalo corriendo como servicio. No hace falta ejecutar `ollama run`.
2. Descargá el modelo:

   ```bash
   ollama pull qwen3:8b
   ```

3. Configurá `.env`:

   ```env
   LLM_PROVIDER=ollama
   OLLAMA_BASE_URL=http://127.0.0.1:11434
   OLLAMA_MODEL=qwen3:8b
   HEADLESS=false
   ```

4. Ejecutá `npm run dev`. Al iniciar vas a ver:

   ```text
   server_started port=8787 runner=agent headless=false model=ollama
   ollama_connected model=qwen3:8b
   Ollama: http://127.0.0.1:11434
   Modelo: qwen3:8b
   Estado: disponible
   Agente listo en http://127.0.0.1:8787
   ```

5. Abrí `http://127.0.0.1:8787/#/traer?inst=pc`.

**Cómo funciona:**

- `OllamaAgentModel` (`src/llm/ollama.ts`) solo reemplaza la capa de inferencia. Usa el mismo ciclo, el mismo system prompt, las mismas herramientas y las mismas políticas.
- Llama a `POST /api/chat` con `stream: false`, `think: false` y `temperature: 0`.
- La respuesta sale con **structured output**: el campo `format` lleva un JSON Schema armado desde `TOOL_DEFS`, con la forma `{"action":"click","elementId":"f0-12"}`.
- Toda decisión, de cualquier proveedor, se valida contra el esquema de su herramienta (`src/agent/tools/validate.ts`) antes de ejecutarse. Una respuesta inválida no ejecuta nada, cuenta como paso y se reintenta. Cuatro inválidas seguidas → `AGENT_STUCK`.
- **Razonamiento de Qwen:** se desactiva con `think: false`. Si igual llega (`message.thinking` o `<think>`), se descarta: no va a logs, eventos ni al frontend.
- **Observación compacta:** 40 elementos (el resto con `getInteractiveElements`), los últimos 6 pasos y sin campos vacíos. El prefijo del prompt es fijo, así Ollama reutiliza la caché entre decisiones.
- **Sin fallback:** si Ollama está apagado o falta el modelo, el agente se detiene con `MODEL_UNAVAILABLE`. Nunca se llama a Anthropic ni a OpenAI.
- **Comprobaciones:** Ollama se verifica al iniciar y cada 15 s. Si no responde, los jobs nuevos se rechazan (503 `MODEL_UNAVAILABLE`) antes de abrir el laboratorio.
- **Solo local:** se acepta únicamente `127.0.0.1`, `localhost` o `::1`. Otro host exige `OLLAMA_ALLOW_REMOTE=true`.

| Variable | Default | Uso |
| --- | --- | --- |
| `OLLAMA_BASE_URL` | `http://127.0.0.1:11434` | Servidor de Ollama |
| `OLLAMA_MODEL` | `qwen3:8b` | Modelo. Tiene que soportar structured output |
| `OLLAMA_TIMEOUT_MS` | `120000` | Tiempo máximo por decisión. Al vencer se corta la solicitud |
| `OLLAMA_NUM_CTX` | `8192` | Contexto. El default de Ollama es chico para la observación |
| `OLLAMA_KEEP_ALIVE` | `30m` | Tiempo que el modelo queda en memoria |
| `MAX_AGENT_DURATION_MS` | `600000` con Ollama | Tiempo máximo por objetivo |
| `MAX_PDF_BYTES` | `41943040` (40 MiB) | Tamaño máximo; se valida MIME, firma `%PDF-` y bytes antes de guardar |
| `PROVIDER_DEBUG_STRUCTURE` | `false` | Emite tipo de página y contadores estructurales de Pérez Cambet, nunca texto del portal |

**Rendimiento medido con Qwen3 8B** (Ryzen 7 5700G, 32 GB, CPU):

- primera decisión: unos 60 s (carga el modelo y procesa el prompt de sistema);
- decisiones siguientes: entre 2 y 9 s.

### Prueba real contra Pérez Cambet (manual)

1. Arrancá con `npm run dev`, `HEADLESS=false` y el modelo configurado: la API key, u Ollama corriendo.
2. En el Portal: Estudios → **Traer mis estudios** → **Pérez Cambet** → **Abrir Pérez Cambet**.
3. Se abre Chromium con el sitio real. Iniciá sesión **ahí** con tu cuenta.
4. No toques nada más. El Portal pasa solo a «Buscando tus estudios» y muestra la lista.
5. Elegí uno o más estudios y tocá **Traer seleccionado(s)**. En la ventana vas a ver al agente abrir el estudio y usar «Ver en PDF».
6. El PDF aparece en Estudios → detalle → **Documento original**. La ventana del laboratorio se cierra.

## API

| Método | Ruta | Descripción |
| --- | --- | --- |
| `GET` | `/api/health` | Runner, modelo, `modelReady`, proveedores |
| `POST` | `/api/imports/percamb` | Crea el job y abre el navegador. Devuelve `{ "jobId" }` (201) · 503 `LLM_NOT_CONFIGURED` / `MODEL_UNAVAILABLE` · 429 `TOO_MANY_JOBS` |
| `GET` | `/api/imports/:jobId` | Estado público del job |
| `GET` | `/api/imports/:jobId/events` | SSE. Primero `snapshot`, después los eventos |
| `GET` | `/api/imports/:jobId/studies` | Estudios encontrados (metadata mínima) |
| `POST` | `/api/imports/:jobId/retry-discovery` | Reintenta la detección tras un parser mismatch, reutilizando la sesión del navegador |
| `POST` | `/api/imports/:jobId/import` | `{ "studyIds": [...] }`. Responde 202, o 400/409 si la selección es inválida |
| `GET` | `/api/imports/:jobId/files/:fileId` | PDF (`application/pdf`, `x-content-sha256`) |
| `DELETE` | `/api/imports/:jobId` | Cancela, cierra el navegador en el acto y borra los archivos |

Eventos SSE:

- conexión y login: `provider_opening`, `provider_opened`, `waiting_user_login`, `authenticated`;
- búsqueda: `agent_started`, `agent_observing`, `searching_studies`, `provider_parser_mismatch`, `studies_found`, `waiting_selection`;
- descarga: `opening_study`, `finding_document`, `downloading`, `importing`, `file_ready`, `study_failed`;
- intervención: `human_action_required`;
- cierre: `completed`, `error` (con `code`).

## Estados del job

```text
CREATED → OPENING_PROVIDER → WAITING_FOR_USER_LOGIN → AUTHENTICATED → AGENT_STARTING → AGENT_OBSERVING
→ SEARCHING_STUDIES → (PROVIDER_PARSER_MISMATCH → AGENT_STARTING → …)* → STUDIES_FOUND → WAITING_SELECTION → (OPENING_STUDY → FINDING_DOCUMENT → DOWNLOADING → IMPORTING)×N → COMPLETED
```

- **Pausa:** `HUMAN_ACTION_REQUIRED` (CAPTCHA, código, sesión vencida, aviso desconocido, ambigüedad).
- **Recuperable:** `PROVIDER_PARSER_MISMATCH` conserva el navegador abierto; `/retry-discovery` vuelve a listar sin repetir el login.
- **Terminales:** `COMPLETED`, `AUTH_TIMEOUT`, `PROVIDER_UNAVAILABLE`, `PROVIDER_CHANGED`, `AGENT_UNABLE_TO_CONTINUE`, `CANCELLED`, `EXPIRED`, `ERROR`.
- Las transiciones inválidas lanzan un error.
- Al entrar en un estado terminal se aborta todo lo pendiente y se cierra el `BrowserContext`.

## Seguridad y privacidad

- **Herramientas del agente**, todas de lectura o de navegación acotada:
  - `getPageSummary`, `getInteractiveElements`, `getTables`, `click`, `openLink`, `goBack`, `wait`, `scroll`;
  - `inspectCurrentUrl`, `inspectNewPage`, `findDownloadActions`, `downloadFromElement`, `detectPdfResponse`;
  - `finishGoal`, `requestHumanAction`.

  **No existen** herramientas para escribir texto, completar formularios, ejecutar JavaScript, usar la terminal, leer archivos ni navegar a una URL arbitraria (hay un test que lo verifica).
- **Política:**
  - bloquea etiquetas de escritura (cambiar, pagar, turno, enviar, guardar, cerrar sesión, grupo familiar…) y cualquier elemento dentro del formulario de ingreso;
  - bloquea envíos de formularios, salvo filtros de búsqueda;
  - bloquea los enlaces a otros dominios;
  - bloquea las filas de estudios que el paciente no eligió;
  - no permite descargar durante la búsqueda;
  - aplica el límite de descargas por job.
- **Allowlist:** solo `biodatasa.com.ar` y `www.biodatasa.com.ar` para navegar. Las fuentes de Google se permiten solo como subrecurso. Si el agente navega a un dominio inesperado, se detiene (`UNEXPECTED_DOMAIN`).
- **Lo que ve el modelo:**
  - roles, etiquetas, formas de columnas (`fecha`, `número`, `texto`) y palabras de interfaz;
  - fechas, números, emails y nombres propios enmascarados (`‹fecha›`, `‹n›`, `‹texto›`);
  - nunca HTML, capturas de pantalla ni valores de campos;
  - la metadata de los estudios (fecha, protocolo, entrega, estado) la extrae el backend, no el modelo.
- **Logs:** lista blanca de campos (`jobId`, `provider`, `state`, `step`, `errorCode`, contadores y solo esquema/host en navegación bloqueada). Cualquier otro valor se descarta o queda `[redacted]`.
- **Playwright:** sin screenshots, video, trace ni HAR. `PLAYWRIGHT_DEBUG_ARTIFACTS=true` solo con cuentas de prueba.
- **Archivos:** `tmp/import-jobs/<uuid>/<uuid>.pdf`, deduplicados por SHA-256. Se borran:
  - al entregarlos todos;
  - al cancelar;
  - al vencer `FILE_RETENTION_MINUTES`;
  - al reiniciar el servidor.
- **Límites:**
  - `MAX_AGENT_STEPS`, `MAX_AGENT_DURATION_MS`, `MAX_DOWNLOADS_PER_JOB` y `MAX_CONCURRENT_JOBS`;
  - bucles (misma acción, 3 veces) y acciones inválidas seguidas (4) cortan el agente;
  - `LOGIN_TIMEOUT_MINUTES` y `JOB_TTL_MINUTES`.

## Limitaciones conocidas

- El área autenticada de Pérez Cambet no se pudo relevar sin una cuenta. Los tests usan un portal falso con descargas, pestañas nuevas, visor embebido y respuestas PDF. La primera prueba real puede requerir ajustar las pistas en `providers/percamb`.
- Se extraen todas las filas de estudios visibles/cargadas en la página actual; no se navega automáticamente por paginación.
- Para Pérez Cambet prioriza los enlaces `ver_resultado`, conserva estudios con metadata parcial y guarda sus referencias exactas solo en memoria. Si no puede construir una referencia segura, emite `PROVIDER_PARSER_MISMATCH`, muestra un estado recuperable en el Portal y conserva Edge abierto para reintentar sobre la misma sesión, cancelar o esperar el TTL.
- Si el portal agrega un CAPTCHA en un dominio de terceros, hay que sumarlo a `staticHosts`. Hoy se bloquea.
- La API puede protegerse con `PORTAL_AUTH_USER` y `PORTAL_AUTH_PASSWORD`; producción exige contraseña. En Docker solo se publica en loopback. noVNC atraviesa el mismo backend; VNC y websockify solo escuchan en loopback interno. Para acceso desde otra computadora sigue faltando desplegar el proxy HTTPS.
- Los PDF traídos se guardan en el navegador del paciente (IndexedDB), no en un backend.
