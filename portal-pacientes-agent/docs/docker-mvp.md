# Auditoría y alcance de la primera entrega

Fecha: 13/10/2026. La entrega sigue la secuencia del documento: primero Docker local, luego piloto remoto supervisado. No se despliega un servidor público en esta fase.

## Código existente

- `src/server/app.ts`: Express 5, REST y SSE; sirve el frontend existente de `../portal-pacientes`. El acceso demo por DNI del frontend no autentica la API.
- `src/jobs`: máquina de estados explícita, AbortController por job, TTL, selección, acuses de persistencia del Portal y retención de archivos. Se conservan los estados/eventos actuales para no romper la UX.
- `src/browser/browser-host.ts`: Chromium de Playwright, canal opcional; no necesita perfiles de usuario. `.env.example` exigía Edge y Ollama en la práctica, aunque el código permite Chromium y reglas.
- `src/browser/session.ts`: captura de respuestas PDF, downloads, popups, iframes, blobs y solicitudes acotadas. Los selectores son DOM; no se encontraron menús nativos de Edge, rutas Windows absolutas ni dependencia del directorio Downloads en el worker.
- Pérez Cambet: `https://www.biodatasa.com.ar/lwcloud/percamb/login`, listado y referencias de estudios, captura de PDF.
- Centro DM: `https://estudios.centrodm.com.ar/`, Pixeon en el origen exacto `https://curie.centrodm.com.ar:8090`. Descarga ZIP DICOM completo; no se convierte artificialmente en PDF.
- RDC: `https://rdcchacabuco.from-ar.com/patientportal/index.php`, modal y fuentes PDF (incluido blob, iframe y respuestas por rangos).
- `src/llm`: proveedores optativos. Las observaciones están enmascaradas y no contienen capturas ni valores de formularios. Docker utiliza reglas sin claves ni servicios de IA. El código existente permite seleccionar OpenAI; no se añadió fallback cloud automático.
- `agent-openai/` es otra PoC y queda fuera de la imagen y del arranque.

## Cambios

- Imagen fijada a Playwright 1.55.1 y paquete de igual versión. El parche 1.55.1 corrige el aviso GHSA-7mvr-c777-76hp encontrado en 1.55.0.
- Instalación con lockfile, usuario `pwuser` (UID 1000), sandbox explícito y perfil seccomp basado en el oficial. Se permite adicionalmente la syscall `chroot`, necesaria dentro del namespace del sandbox al eliminar todas las capacidades con `cap_drop: ALL`; no se concede `CAP_SYS_CHROOT` al contenedor. No se usa `--no-sandbox`, modo privilegiado, `SYS_ADMIN` ni IPC del host. Chromium dispone de 1 GiB de memoria compartida privada.
- `init`, filesystem de imagen de solo lectura, temporales privados en RAM y logs con rotación. Xvfb conserva el worker headed; noVNC lo muestra por el backend autenticado durante login/intervención humana.
- `/health` solo devuelve `{ok:true}`. El formulario del Portal autentica al único propietario del piloto y emite una sesión HttpOnly para API, SSE, archivos y navegador remoto. No se usa el cuadro Basic del navegador. El piloto local usa usuario `1234` y contraseña `1234`, según lo solicitado.
- Se rechazan mutaciones de otros sitios y se deshabilita la depuración sensible en producción. La contraseña del portal es independiente de las credenciales de las instituciones.
- Un solo job por defecto. El último contexto cerrado dispara el cierre de Chromium. La cancelación durante la apertura espera y cierra el contexto que estuviera pendiente.
- El almacenamiento serializa escrituras/deduplicación y espera escrituras pendientes antes de limpiar, para que una descarga tardía no recree temporales después de cancelar.

## Almacenamiento

Los archivos del worker viven en `/var/lib/portal/import-jobs`, separado del perfil temporal de Chromium en `/tmp` y `/home/pwuser`. Los nombres son UUID y se validan firma/tamaño PDF o ZIP, además de deduplicar por SHA-256. El storage es temporal: los acuses del Portal, cancelación, TTL y retención eliminan los archivos; al reiniciar se limpia el directorio.

La persistencia final sigue siendo IndexedDB del navegador del paciente. No se creó un repositorio médico permanente en el servidor. Antes de un piloto con documentos reales deben definirse retención, backup, borrado y consentimiento de esa persistencia final. El almacenamiento servidor persistente deberá usar un volumen privado independiente, nunca el perfil del browser.

## Ejecución desde la raíz del repositorio

Requisitos: Docker Desktop con motor Linux y Compose v2 o posterior. Docker Desktop debe estar iniciado.

```bash
node portal-pacientes-agent/scripts/init-docker.mjs
docker compose config --quiet
docker compose up --build -d --wait
curl http://127.0.0.1:8787/health
docker compose exec -T portal npm run smoke
docker compose exec -T portal npm run typecheck
docker compose exec -T portal npm test
docker compose run --rm --no-deps portal npm run test:remote
docker compose ps
docker compose logs --tail 50 portal
docker compose down
```

Abrir `http://127.0.0.1:8787`. Hay un solo formulario: usuario `1234` y contraseña `1234`, precargados para la demostración. Ambos son configurables en `.env.docker`. La sesión habilita también las importaciones y dura hasta 12 horas; se termina al cerrar sesión o reiniciar el backend.

El archivo `.env.docker` está ignorado por Git y queda fuera del contexto Docker. No se lee ni se copia el `.env` existente del agente. El helper no reemplaza una clave existente.

Compose carga las credenciales directamente desde `.env.docker` mediante `env_file`; no se interpolan desde variables externas. Después de inicializar ese archivo también funciona `docker compose up -d --wait` sin `--env-file`. Si un contenedor fue creado manualmente con otras credenciales, recrearlo con `docker compose up -d --force-recreate --wait`.

Detener con `down` elimina todos los temporales RAM de los contenedores. Para eliminar también la imagen local del proyecto:

```bash
docker compose --env-file .env.docker down --rmi local
```

No hay volúmenes de estudios que limpiar en esta fase. No usar `docker system prune`: afectaría otros proyectos.

El smoke solo lee páginas públicas y reporta institución, status y códigos técnicos. No completa formularios, lee contenido clínico, produce capturas ni consulta modelos. Falla si alguno de los accesos no responde correctamente, pero siempre cierra sus contextos y Chromium. Verificar también que no quedan procesos con `docker compose --env-file .env.docker exec -T portal ps -eo comm` tras terminar.

## Bloqueos para el piloto remoto

El login interactivo en Docker está implementado y probado con un sitio ficticio: el Portal muestra «Abrir navegador», abre `/remote/:jobId` en otra pestaña y transmite el framebuffer de Xvfb mediante noVNC. El usuario escribe en el Chromium del servidor; el worker confirma señales estables de ingreso y continúa automáticamente, conservando contexto y cookies. Al revocar el escritorio, ambas pestañas avanzan a la búsqueda/selección sin otra confirmación. «Cancelar y cerrar» sigue disponible durante la interacción. Ver [Login automático](login-automatico.md).

VNC (5900) y websockify (6080) solo escuchan en loopback dentro del contenedor; ningún puerto se publica. El backend autoriza el acceso inicial con la identidad del piloto y genera una cookie HttpOnly, SameSite=Strict, acotada al job y al timeout de login. El WebSocket valida cookie, origen y estado interactivo. Al salir de login/intervención, cancelar, completar o expirar se destruyen conexiones y procesos del desktop. Solo se permite un job; un nuevo contexto no conserva cookies del anterior. Los bytes VNC se transportan sin registrar ni interpretar teclas, contraseñas ni imágenes; no se envían al modelo.

El test remoto corre en un contenedor aislado con Xvfb, usa noVNC para escribir credenciales ficticias y verifica login, reanudación en el mismo contexto, cancelación y rechazo de sockets sin autorización, con origen externo o tras revocación. No equivale a haber probado desde otra computadora ni con cuentas reales.

El acceso desde otra computadora y el despliegue real siguen pendientes de servidor, dominio, proxy HTTPS, storage definitivo y revisión de las condiciones de privacidad indicadas en el documento. Esta configuración publica únicamente `127.0.0.1:8787`.

## Referencias técnicas

- [Docker oficial de Playwright](https://playwright.dev/docs/docker): versión de imagen compatible, instalación del paquete, usuario separado, seccomp e init.
- [Perfil seccomp oficial versionado](https://github.com/microsoft/playwright/blob/v1.55.0/utils/docker/seccomp_profile.json): base local con el permiso puntual de `chroot` documentado arriba.
- [Aviso corregido en 1.55.1](https://github.com/advisories/GHSA-7mvr-c777-76hp).
- [Integración oficial de noVNC](https://github.com/novnc/noVNC/blob/master/docs/EMBEDDING.md) y [websockify](https://github.com/novnc/websockify).
