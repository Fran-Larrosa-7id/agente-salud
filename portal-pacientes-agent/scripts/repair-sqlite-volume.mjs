import { chownSync, chmodSync, lstatSync, readdirSync } from 'node:fs';

// One-off repair for the EMPTY volume created by the old Playwright UID 1001 image.
// Run only while portal is stopped, as 1001:1000, with all normal Docker restrictions.
// Never follows symlinks, traverses data, changes secrets, deletes or rewrites a DB.
const directory = '/var/lib/portal-data';
try {
  const stat = lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error();
  if (stat.uid === 1000 && stat.gid === 1000 && (stat.mode & 0o700) === 0o700 && (stat.mode & 0o007) === 0) {
    console.log('SQLITE_VOLUME_OK: directorio preparado para 1000:1000; no se modifica.');
  } else if (stat.uid === 1001 && stat.gid === 1000 && (stat.mode & 0o777) === 0o770) {
    console.log('SQLITE_VOLUME_OK: directorio legado ya reparado; no se modifica ningún archivo.');
  } else {
    if (process.getuid() !== 1001 || process.getgid() !== 1000 || stat.uid !== 1001 || readdirSync(directory).length !== 0) throw new Error();
    // A file's unprivileged owner may change its group to its own primary GID.
    // Preserve owner 1001 and give only the application's GID 1000 directory access.
    chownSync(directory, 1001, 1000);
    chmodSync(directory, 0o770);
    console.log('SQLITE_VOLUME_REPAIRED: volumen vacío; acceso exclusivo para propietario y grupo de la aplicación, sin root.');
  }
} catch {
  console.error('SQLITE_VOLUME_REPAIR_REFUSED: no se borró ni migró información. Se requiere volumen vacío del antiguo UID 1001 y proceso 1001:1000; si contiene datos, respaldar y revisar permisos antes de continuar.');
  process.exitCode = 1;
}
