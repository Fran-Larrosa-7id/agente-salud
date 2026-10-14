# Login remoto automático — 14/10/2026

Implementa el cambio de experiencia solicitado en `PORTAL_PACIENTES_LOGIN_100_AUTOMATICO_CODEX.md` sobre el repositorio actual. El paciente escribe las credenciales y resuelve los desafíos de la institución; no confirma después su ingreso.

## Causa y comportamiento

El detector ya exigía dos lecturas positivas, pero `AgentImportRunner` esperaba además `approved` cuando `REMOTE_LOGIN=true`. Se retiró esa condición del login y de las intervenciones humanas. Al confirmar evidencia estable, el job pasa a `AUTHENTICATED` y discovery usa la misma sesión. El evento revoca inmediatamente los sockets VNC y detiene sus procesos, sin cerrar el BrowserContext.

El detector excluye contraseña, CAPTCHA, MFA y diálogos visibles. Centro DM exige señales específicas de estudios (tabla tipada, acción propia o lista vacía con logout) junto con evidencia del área autenticada; el logo «Estudios» o «Perfil» no alcanza. Funciona en la URL raíz. Un popup autorizado debe tener dos lecturas positivas de la misma pestaña y una revalidación antes de adoptarlo dentro del mismo contexto. Los iframe permitidos se combinan mediante el colector existente.

Desaparecen «Ya ingresé», la pantalla final de confirmación y el regreso manual a selección. La pestaña original continúa por SSE; la auxiliar navega automáticamente al Portal con el mismo job. No depende de `opener` ni de cerrar la pestaña, y nunca cierra la original. No se seleccionan ni descargan estudios sin elección del paciente.

El cliente distingue los mensajes SSE `error` de errores de transporte de EventSource. Antes confundía un corte de conexión con un fallo del job. Reconcilia por GET al abrir/reconectar y descarta eventos repetidos/antiguos por secuencia. Una desconexión VNC tras autenticación recupera el estado antes de ofrecer un error.

El endpoint `/resume` sigue temporalmente por compatibilidad. No cambia el estado ni elude el detector; mientras falta ingreso o un desafío continúa pendiente devuelve 409. Los clientes actuales no lo llaman.

Corrección posterior de Centro DM: la pantalla real usa «Bienvenido a tu portal de estudios» e íconos sin texto; la primera batería sintética esperaba «Mis estudios» o un logout textual. Se agregó la bienvenida exacta y una señal booleana respaldada por el extractor existente: acciones propias del proveedor asociadas a fechas de estudios. Así se reconocen filas DIV y acciones `onclick`, sin leer el nombre de la cuenta como evidencia. Se mantienen las lecturas consecutivas y el bloqueo ante contraseña/desafíos. La regresión reproduce ese diseño con datos ficticios: 27 pruebas específicas de login, Centro DM y ZIP aprobaron; TypeScript y comprobación del diff también.

Corrección posterior de RDC: VisualMedica muestra «Sus estudios realizados» y mantiene `/patientportal/index.php`, cambiando solo el hash a `#/grilla`. Se incorporó esa pista específica al proveedor. La regresión reproduce encabezado, enlace «Salir», columnas y acciones de archivo con datos ficticios; llega a selección sin `/resume`, conserva contexto y deja cero estudios seleccionados. También prueba contraseña incorrecta y desafíos pendientes. Las 37 pruebas específicas de detector, login de ambas instituciones y PDF RDC aprobaron; TypeScript y comprobación del diff aprobaron. No se usaron nombres ni documentos de la captura como datos de prueba.

## Archivos

- `src/browser/login-detector.ts`, `session.ts`, `types.ts`: evidencia estable, desafíos y candidatos de login.
- `src/jobs/agent-runner.ts`: continuidad automática sin aprobación manual.
- `src/server/remote-client.js`, `remote-desktop.ts`: transporte, navegación automática y retiro de botones.
- `../portal-pacientes/js/agent.js`, `traer.js`: reconexión, secuencias y textos.
- `test/unit/automatic-login.test.ts`, `test/e2e/automatic-login.test.ts`, `test/e2e/remote-desktop.test.ts`: pruebas sintéticas.

No se cambian selectores/extractores de descarga, Pixeon, los archivos ZIP/PDF ni su persistencia. No se incorpora ningún modelo ni servicio de IA. Los snapshots permanecen efímeros en el backend; el detector no lee valores de inputs ni registra contenido autenticado.

## Construcción y prueba local

Apertura directa: el primer botón «Abrir institución» reserva una pestaña dentro del clic y la dirige al login remoto cuando se crea el job. Así evita exigir otro clic y evita depender de abrir popups después de una operación asíncrona. Si el navegador bloquea la pestaña, continúa en la misma ventana. Si falla el inicio, se cierra la pestaña provisional; si el paciente la cierra durante la preparación, se cancela el job. La pantalla de espera ofrece «Volver a abrir el navegador» únicamente como enlace secundario de recuperación. La prueba `direct-login-open.test.ts` cubre las tres instituciones, ventana sin opener, un solo inicio, bloqueo y rechazo por importación activa.

Validación de apertura directa: ocho E2E de apertura, importación activa y frontend aprobados, cero fallos. TypeScript y comprobación del diff aprobados. Se reconstruyó y actualizó el contenedor local, que quedó saludable.

Resultados: suite general con 174 casos, 172 aprobados, 0 fallos y 2 remotos omitidos porque se ejecutan aparte. Los dos E2E noVNC aprobaron, incluidos corte/reconexión SSE, eventos repetidos, ingreso automático sin `/resume`, selección en ambas pestañas y revocación sin cerrar el contexto. Centro DM cubre misma URL, error de contraseña, MFA/CAPTCHA humanos, iframe y popup autorizado. TypeScript y `git diff --check` aprobaron. Tras ajustar el transporte SSE, se revalidaron los siete E2E de frontend e importación activa: siete aprobados, cero fallos. El contenedor local reconstruido quedó saludable, con `/api/health` autenticado 200, `remoteLogin=true`, `runner=agent` y `browserReady=true`.

Desde `C:\Users\franc\Desktop\mocks-salud`, con Docker Desktop iniciado y `.env.docker` existente:

```powershell
docker compose up --build -d --wait
docker compose exec -T portal npm run typecheck
docker compose run --rm --no-deps portal npm test
docker compose run --rm --no-deps portal npm run test:remote
```

Abrir `http://127.0.0.1:8787`: el único formulario del Portal tiene precargado el usuario `1234` y la contraseña `1234`; basta pulsar «Ingresar». En «Traer mis estudios», elegir institución, abrir navegador e ingresar en su sitio. El Portal debe mostrar búsqueda y luego selección sin confirmaciones adicionales. Cancelar debe cerrar la sesión del worker. Las pruebas automatizadas usan exclusivamente sitios, credenciales y estudios ficticios; una prueba con una cuenta real requiere el consentimiento correspondiente.

Las capturas de QA sintético quedan en `.docker-local/qa/remote-desktop.png`, `remote-mobile.png` y `remote-automatic-selection.png`. La última muestra la selección alcanzada automáticamente. No constituyen validación de una cuenta real, ni certificación de un despliegue externo HTTPS. Este cambio se aplica al entorno local; no publica el piloto a usuarios reales.
