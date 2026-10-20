import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// No credentials are accepted on the command line or printed to the console.
const target = new URL('../../.env.google.local', import.meta.url);
try {
  const template = await readFile(new URL('../../google-local.env.example', import.meta.url), 'utf8');
  const content = template.replace('GENERATE_SESSION_SECRET', randomBytes(48).toString('base64url'))
    .replace('GENERATE_TOKEN_ENCRYPTION_KEY', randomBytes(32).toString('base64'));
  await writeFile(target, content, { flag: 'wx', mode: 0o600 });
  console.log('Creado archivo privado: ' + fileURLToPath(target));
  console.log('Completar GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET y GOOGLE_ALLOWED_EMAILS en un editor local.');
  console.log('No compartir su contenido. En Windows hereda los permisos de tu carpeta de usuario.');
} catch (error) {
  if (error?.code === 'EEXIST') console.error('El archivo ya existe; se conserva sin modificar claves ni credenciales.');
  else console.error('No se pudo preparar la configuración local.');
  process.exitCode = 1;
}
