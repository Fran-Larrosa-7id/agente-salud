import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const target = fileURLToPath(new URL('../../.env.docker', import.meta.url));
try {
  writeFileSync(target, 'PORTAL_AUTH_USER=1234\nPORTAL_AUTH_PASSWORD=1234\n', { flag: 'wx', mode: 0o600 });
  console.log('Creado .env.docker. Consultar este archivo local para el acceso; no subirlo al repositorio.');
} catch (error) {
  if (error.code !== 'EEXIST') throw error;
  console.log('.env.docker ya existe; se conserva.');
}
