# Nombres legibles para nuevas subidas a Drive

Los nombres anteriores `estudio-<id>.pdf/.zip` usaban el ID remoto para evitar información personal y separar originales. No eran la clave de deduplicación: esa sigue siendo la cuenta + SHA-256, junto con el ID de Drive, referencias de origen y catálogo existentes.

Ahora solo las creaciones nuevas usan:

```text
2026-10-20 - Centro DM - Informe.pdf
2026-10-20 - Centro DM - Imágenes DICOM.zip
2026-01-15 - RDC Chacabuco - Ecografía - Informe.pdf
Sin fecha - Pérez Cambet - Informe.pdf
```

## Criterios

- Fecha: `studyDate` válida primero; después `date` válida. Se admiten ISO AAAA-MM-DD, timestamps ISO explícitos con zona horaria y DD/MM/AAAA, DD-MM-AAAA o DD.MM.AAAA. Se conserva el día escrito en la fuente, sin convertirlo a otra zona. Se comprueba el calendario, incluidos bisiestos. Si faltan o son ambiguas/inválidas, se usa **Sin fecha**, nunca la fecha actual, de entrega o de importación. No se adivina el siglo de un año de dos cifras; los extractores siguen normalizando sus formatos conocidos como antes.
- Institución: nombre público de la configuración de Centro DM, Pérez Cambet o RDC Chacabuco. Un proveedor desconocido se muestra como **Institución no disponible**, sin copiar su texto arbitrario.
- Tipo: se reconocen términos completos de una lista cerrada, primero en `studyType` y luego en `title`: ecografía/ultrasonido, radiografía, tomografía, resonancia, mamografía, panorámica dental y reconstrucción 3D. Un tipo reconocido agrega esa etiqueta; un texto desconocido no se copia. No se infiere un diagnóstico ni se interpreta una modalidad ambigua como SC. Se conserva **Informe.pdf** o **Imágenes DICOM.zip** según el artefacto real validado.
- Privacidad: no se incluyen nombre de paciente, DNI, protocolo, identificadores de cuenta, descripciones libres ni nombres originales recibidos del laboratorio. Aunque una descripción contenga esos datos, solo puede producir una etiqueta de la lista cerrada o el formato genérico.
- Plataformas: Unicode NFC; se eliminan caracteres de control, marcas de dirección, caracteres de ruta y caracteres inválidos de Windows. Se evita terminar en punto/espacio. El componente completo queda por debajo de 255 bytes incluso con el sufijo más largo. El inicio fecha/Sin fecha evita nombres de dispositivos como CON.

## Nombres repetidos

Se comprueba el nombre en la carpeta privada actual, con el token de esa cuenta y el scope existente `drive.file`. Solo se consultan IDs de los nombres candidatos; no se amplían permisos ni se recorre todo Drive. Para cubrir retrasos del índice de búsqueda se leen por ID los metadatos actuales de originales potencialmente coincidentes del catálogo propio. Los nombres recibidos de esos archivos solo se comparan, nunca se copian a un nombre nuevo.

Si está ocupado, se agrega un sufijo estable de ocho caracteres del SHA-256:

```text
2026-10-20 - Centro DM - Imágenes DICOM - a1b2c3d4.zip
```

Si ese sufijo también está ocupado se amplía a 12, 16 y finalmente 64 caracteres. Si no queda candidato disponible, la creación falla de forma recuperable antes de anunciar persistencia. Una reserva en memoria impide que uploads simultáneos del mismo proceso elijan el mismo nombre. El flujo soportado mantiene un único worker/job activo; no se agrega coordinación distribuida. Google permite nombres duplicados y un usuario u otra aplicación pueden renombrarlos manualmente: esa intervención externa no está bloqueada por el Portal. Nunca se sobrescribe un archivo por su nombre; las operaciones siguen usando IDs y hashes.

## Archivos anteriores, reintentos y sincronización

No hay migración, PATCH de nombre ni recorrido para renombrar archivos existentes. Un original encontrado por hash conserva su ID y nombre, incluso si fue renombrado manualmente o si llegan metadatos más completos. Si la misma copia se referencia desde otra institución, no se cambia el nombre del original compartido por esas referencias.

Una sesión reanudable ya creada conserva el nombre de su metadata en Drive, también si empezó antes de este cambio. Si una sesión expiró sin producir un archivo final, la siguiente creación puede recibir el nombre nuevo, conservando el ID reservado. La recuperación del ZIP pendiente, las referencias de estudios y la sincronización siguen dependiendo del propietario/ID/SHA-256, no del nombre. No se cambia el esquema ni se necesita tocar bases o secretos existentes.

## Archivos y verificación

- Nuevo `src/storage/drive-filename.ts`: fecha estricta, etiquetas seguras y candidatos de colisión.
- `src/storage/google-drive.ts`: elección al crear la sesión nueva, consulta limitada a la carpeta propia, comprobación contra catálogo e índice, reservas y liberación por upload. No cambia bytes, MIME, IDs, hashes ni appProperties.
- Nuevo `test/unit/drive-filename.test.ts`; ampliados `test/unit/google-drive.test.ts` y `test/google-helpers.ts`.

TypeScript y **119/119 unitarias en Windows y Linux** aprobaron. E2E Google/Drive con Edge aprobado: consentimiento, guardado, retry, catálogo en segundo navegador y separación A/B/A. Docker Desktop estuvo disponible: se construyó una imagen aislada `portal-drive-names-regression:local`; la regresión de SQLite y recuperación del ZIP en cinco contenedores restringidos aprobó con un volumen sintético nuevo. Las pruebas usan documentos ficticios y Google simulado; no se subieron ni renombraron archivos reales.

Las regresiones cubren las tres instituciones, PDF/ZIP, fecha ausente/ambigua/inválida, títulos con datos personales, caracteres inseguros, claves de prototipo, nombres repetidos, colisión del sufijo corto, uploads concurrentes, búsqueda de Drive retrasada después de reiniciar, reintentos sin duplicados y conservación de un nombre legado. La suite unitaria Linux se ejecuta en la misma imagen con read_only, UID/GID 1000, cap_drop ALL, no-new-privileges y seccomp.

No se accedió a Ubuntu, secretos, bases reales ni extractores; no se hizo despliegue, merge o push. La imagen/contenedor del portal activo y los archivos que ya existen en Drive conservan su estado. Tras activar manualmente esta versión, una importación nueva que no esté ya deduplicada mostrará el nombre legible en la carpeta Portal Pacientes.
