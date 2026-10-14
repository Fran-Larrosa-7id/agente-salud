# Acceso sencillo para la demostración

Abrir `http://127.0.0.1:8787` y pulsar **Ingresar**. El formulario tiene precargados el usuario `1234` y la contraseña `1234`. No hay un cuadro de acceso del navegador ni un segundo login del Portal. Las credenciales de cada institución se ingresan únicamente en su sitio, como antes.

El formulario inicia una sesión real del backend mediante `/api/auth/login`. La cookie `portal_session` es HttpOnly, SameSite Strict, se limita a ese host y dura hasta 12 horas. El token no se devuelve a JavaScript ni se guarda en localStorage. Recargar o abrir otra pestaña mantiene el acceso. Los endpoints de jobs, SSE, archivos y recursos remotos siguen protegidos; las páginas y recursos estáticos necesarios para mostrar el formulario son públicos.

`Cerrar sesión` revoca la cookie y cancela las importaciones del propietario del piloto, cerrando el escritorio remoto. Las pestañas abiertas vuelven al formulario. Después de reiniciar el backend, hay que pulsar Ingresar otra vez; los archivos guardados en el navegador siguen en IndexedDB. Manipular la sesión visual en localStorage no autentica el backend.

Se reemplaza Basic por sesión de formulario en `src/server/portal-auth.ts` y `app.ts`. `js/auth.js` usa el nuevo acceso en el piloto y conserva el mock sin backend autenticado para desarrollo. `js/app.js` comprueba la sesión al abrir y gestiona el logout; `js/agent.js` vuelve al formulario ante un 401. Los helpers de smoke y durabilidad usan el mismo formulario/API. Se mantiene una identidad compartida de demostración, configurable en `.env.docker`; no se introduce un sistema de cuentas de pacientes ni recuperación simulada de contraseñas en el piloto autenticado.

Reconstruir desde la raíz:

```powershell
docker compose up --build -d --wait
docker compose run --rm --no-deps portal npm test
docker compose run --rm --no-deps portal npm run test:remote
```

QA: `test/unit/portal-auth.test.ts` verifica cookies, credenciales incorrectas, protección de API/SSE/archivos, redirección remota sin challenge Basic, origen y revocación. `test/e2e/unified-login.test.ts` verifica el formulario móvil, persistencia al recargar, pestañas compartidas, logout y sesión local falsa. El E2E noVNC inicia sesión únicamente mediante este formulario, sin `httpCredentials`.

Resultados: suite general, 179 casos, 177 aprobados y dos remotos omitidos por ejecutarse aparte; cero fallos. Los dos E2E noVNC aprobaron. Tras ampliar la prueba de logout con una importación activa, aprobaron también los tres casos específicos de autenticación. TypeScript y comprobación del diff aprobaron. La captura sintética del formulario está en `.docker-local/qa/portal-single-login.png`.
