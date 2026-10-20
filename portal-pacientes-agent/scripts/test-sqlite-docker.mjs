import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../../', import.meta.url));
const image = process.env.SQLITE_TEST_IMAGE || 'portal-google-local-portal';
const volume = 'portal-sqlite-regression-' + randomUUID();
function docker(args) {
  const result = spawnSync('docker', args, { cwd: root, stdio: 'inherit' });
  if (result.error || result.status !== 0) throw new Error('DOCKER_SQLITE_REGRESSION_FAILED');
}
try {
  // No .env files, credentials, ports or real volumes are used by this test.
  docker(['info', '--format', '{{.ServerVersion}}']);
  docker(['image', 'inspect', image, '--format', '{{.Id}}']);
  docker(['volume', 'create', '--label', 'portal-pacientes.test=sqlite', volume]);
  const options = ['run', '--rm', '--init', '--read-only', '--user', '1000:1000', '--cap-drop', 'ALL',
    '--security-opt', 'no-new-privileges:true',
    '--security-opt', 'seccomp=' + path.join(root, 'portal-pacientes-agent/docker/seccomp_profile.json'),
    '--shm-size', '1g', '--tmpfs', '/tmp:size=1g,mode=1777',
    '--tmpfs', '/home/pwuser:size=128m,uid=1000,gid=1000,mode=0700',
    '--tmpfs', '/var/lib/portal:size=1g,uid=1000,gid=1000,mode=0700',
    '--mount', 'type=volume,src=' + volume + ',dst=/var/lib/portal-data', '--entrypoint', 'node', image,
    '--import', 'tsx'];
  docker([...options, 'scripts/check-sqlite-container.ts', 'write']);
  docker([...options, 'scripts/check-drive-recovery-container.ts', 'write']);
  // A different container opens the same volume, proving on-disk persistence.
  docker([...options, 'scripts/check-sqlite-container.ts', 'read']);
  docker([...options, 'scripts/check-drive-recovery-container.ts', 'startup']);
  docker([...options, 'scripts/check-drive-recovery-container.ts', 'read']);
  console.log('PASS: SQLite/WAL/SHM and pending Drive ZIP recovery across recreated restricted containers.');
} catch {
  console.error('FAIL: Docker/image unavailable or SQLite container regression failed. No real data or secrets were modified.');
  process.exitCode = 1;
} finally {
  console.log('Synthetic test volume retained (no volumes deleted): ' + volume);
}
