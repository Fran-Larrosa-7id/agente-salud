# Portal con estudios importados, sin datos precargados

La portada saluda «Bienvenido». La cuenta y sus preferencias usan textos generales, sin nombre, DNI, nacimiento o datos de contacto ficticios. El inicio muestra estudios y documentos importados y sus estados vacíos. El selector ofrece solamente Pérez Cambet, Centro DM y RDC Chacabuco; se retiraron las instituciones y catálogos simulados.

La semilla del navegador está vacía: sin estudios, resultados clínicos, recetas, alergias, antecedentes, medicación, vacunas, autorizaciones, compartidos, sesiones de otros dispositivos ni actividad ficticia. Se retiraron los controles para restaurar la demo y los contactos de soporte inventados. El formulario del piloto mantiene su acceso 1234/1234.

Se conserva la clave `portal_pacientes_v1` y se migra su contenido al esquema 2. La migración mantiene los estudios con referencia a archivo importado, su metadata y clave de Blob, las preferencias de lectura y los registros asociados a instituciones reales. Los elementos precargados y los resultados de catálogos simulados sin archivo se descartan. No se borra IndexedDB ni se reescriben los archivos importados. Si localStorage rechaza la escritura de la migración, la cuenta limpia continúa en memoria con las referencias conservadas; el almacenamiento anterior queda disponible para reintentar.

La fecha de la portada usa la fecha actual del navegador. Las fechas y contenido originales de los estudios se conservan.

Validación: diez E2E de frontend, apertura directa, importación activa, acceso unificado y migración aprobados. La prueba específica de migración se repitió tras retirar los contactos de ayuda: un caso aprobado. Comprueba cuenta nueva vacía, ausencia de datos ficticios en inicio/perfil/salud/ayuda, eliminación de muestras de la cuenta antigua y descarga del PDF conservado con bytes iguales al original, incluso ante cuota de localStorage. Los sitios, credenciales y archivos de QA son ficticios y quedan en las pruebas; no se precargan en el portal.

Los dos E2E remotos también aprobaron. TypeScript y comprobación del diff aprobaron; el contenedor local reconstruido quedó saludable.

Cambios principales: `portal-pacientes/js/data.js`, `screens.js`, `app.js`, `auth.js` y `traer.js`. El test nuevo está en `test/e2e/imported-only.test.ts`. La captura de una cuenta vacía está en `.docker-local/qa/portal-empty.png`.

Aplicar desde la raíz con `docker compose up --build -d --wait`; recargar el Portal para ejecutar la migración en ese navegador. No se necesita borrar datos, restablecer la cuenta ni volver a importar los archivos guardados.
