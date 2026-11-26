# Inicio de sesión en laboratorios

## Flujo actual

En «Traer mis estudios», elegí la institución, completá su usuario y contraseña y marcá el permiso para que el Portal inicie sesión. El servicio recibe los datos en el cuerpo del POST de creación del job. La interfaz habilita el formulario en HTTPS y en el entorno local de loopback. El job usa un contexto aislado de Chromium.

Las credenciales pasan al runner en una referencia privada de un solo uso, separada del estado y de los eventos del job. La referencia se revoca al tomarla, al terminar el intento y al cancelar o expirar el job. El Portal vacía los campos al enviar el formulario. Los jobs con credenciales desactivan el trazado del contexto y los volcados de errores de Playwright. Una sesión nueva requiere volver a ingresar los datos.

Playwright solo completa un formulario visible que pueda identificar de forma inequívoca en el sitio autorizado. Si el proveedor pide un CAPTCHA, un segundo factor u otra acción, aparece «Abrir navegador seguro». El escritorio comparte el Chromium y el contexto del job. El detector exige dos lecturas positivas y una confirmación antes de continuar con el listado. Al detectar el acceso, se revoca la conexión de noVNC y la pestaña del Portal muestra la selección. El usuario elige qué recuperar. La confirmación de guardado en el modo Google Drive llega después de verificar el archivo subido y actualizar la biblioteca.

Un desafío alojado en otro dominio depende de que ese dominio esté autorizado en la configuración del proveedor.

## Validación manual local

1. Prepará un entorno local de Google y Drive siguiendo [Google local en el puerto 8888](google-local-8888.md). Usá la URL configurada para OAuth y el perfil local que habilita `REMOTE_LOGIN`. En «Perfil», conectá el Drive de la cuenta autorizada.
2. Empezá por Pérez Cambet. En «Traer mis estudios», elegí el laboratorio, ingresá «Usuario o DNI» y «Contraseña», marcá el permiso y pulsá «Conectar y buscar estudios». Confirmá que aparecen el avance de conexión y la selección sin abrir otra pestaña.
3. Elegí un estudio autorizado y esperá «Estudios guardados». Abrí el PDF desde la biblioteca y desde Google Drive. Repetí la búsqueda para confirmar que el mismo estudio aparece como ya guardado.
4. Si el proveedor pide una verificación, abrí el navegador seguro, completá el paso en el sitio de la institución y confirmá que la selección aparece automáticamente en el Portal. También podés verificar que «Cancelar la importación» cierra la sesión del job.
5. Repetí con Centro DM usando «N.º de documento» y comprobá que el archivo es el ZIP DICOM completo. En RDC Chacabuco, usá «E-mail o DNI» y «Contraseña o número de acceso». Marcá la casilla adicional de términos de VisualMedica y comprobá el PDF.

| Institución | Cobertura y límites |
| --- | --- |
| Pérez Cambet | El formulario público confirma «Usuario/DNI». El recorrido sintético cubre acceso, selección, PDF, Drive y un segundo factor. |
| Centro DM/Pixeon | El acceso público de pacientes solicita el número de documento. El login sintético cubre la página principal, iframe, popup, CAPTCHA y segundo factor. La descarga ZIP sigue dependiendo de que el visor esté disponible en el origen Pixeon autorizado. |
| RDC Chacabuco | La prueba sintética cubre la aceptación explícita de términos, el formulario de VisualMedica, el rechazo de credenciales, MFA y la detección del listado en `#/grilla`. |

Las pruebas del navegador usan credenciales y documentos sintéticos. `npm test` cubre el flujo de login y el almacenamiento. `npm run test:remote` requiere Linux con Xvfb, x11vnc, websockify y noVNC para enviar el código de verificación por el escritorio remoto real.
