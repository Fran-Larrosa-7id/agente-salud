/** Only these fixed capture options may be selected; never pass environment text to x11vnc. */
export function captureArguments(value: string | undefined): string[] {
  switch (value) {
    case undefined:
    case 'legacy': return ['-noxdamage', '-noshm'];
    case 'shm': return ['-noxdamage'];
    case 'shm_damage': return [];
    default: throw new Error('REMOTE_CAPTURE_MODE must be legacy, shm or shm_damage');
  }
}
