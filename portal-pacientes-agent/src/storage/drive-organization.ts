/** Only trusted internal identifiers determine folder names, never scraped HTML. */
export const INSTITUTION_FOLDERS = { centrodm: 'Centro DM', percamb: 'Pérez Cambet', rdcchacabuco: 'RDC Chacabuco' } as const;
export type DriveProvider = keyof typeof INSTITUTION_FOLDERS;
export const DRIVE_APP = 'portal-pacientes-v1';
export const FOLDER_MIME = 'application/vnd.google-apps.folder';
export interface RemoteFile {
  id: string; name?: string; size?: string; mimeType: string; appProperties?: Record<string, string>;
  trashed?: boolean; shared?: boolean; ownedByMe?: boolean; parents?: string[]; md5Checksum?: string; createdTime?: string;
}
export function isDriveProvider(value: string): value is DriveProvider { return Object.hasOwn(INSTITUTION_FOLDERS, value); }
export function privateAppFile(file: RemoteFile, owner: string): boolean {
  return !!file.id && file.ownedByMe === true && !file.shared && !file.trashed &&
    file.appProperties?.pp_app === DRIVE_APP && file.appProperties?.pp_owner === owner;
}
export function isAppFolder(file: RemoteFile, owner: string, provider?: DriveProvider, parent?: string): boolean {
  if (!privateAppFile(file, owner) || file.mimeType !== FOLDER_MIME) return false;
  const props = file.appProperties!;
  if (provider) return props.pp_role === 'institution' && props.pp_provider === provider && props.pp_parent === parent &&
    file.parents?.length === 1 && file.parents[0] === parent;
  // Old releases created only the root and had no role. An institution folder cannot qualify.
  return !props.pp_provider && !props.pp_parent && (props.pp_role === 'root' || !props.pp_role && file.name === 'Portal Pacientes');
}
export function isMedicalOriginal(file: RemoteFile, owner: string): boolean {
  const props = file.appProperties || {};
  return privateAppFile(file, owner) && isDriveProvider(props.pp_provider) && /^[a-f0-9]{64}$/.test(props.pp_sha256 || '') &&
    ['PDF', 'DICOM_ZIP'].includes(props.pp_kind) && file.mimeType === (props.pp_kind === 'PDF' ? 'application/pdf' : 'application/zip') &&
    Number.isSafeInteger(Number(file.size)) && Number(file.size) > 0 &&
    (!props.pp_md5 || /^[a-f0-9]{32}$/.test(props.pp_md5) && props.pp_md5 === file.md5Checksum);
}
export interface MoveCandidate {
  id: string; provider: DriveProvider; sha256: string; bytes: number; mimeType: string; kind: string; md5?: string;
}
export interface DriveMovePlan { rootId: string | null; files: MoveCandidate[] }
export const MOVE_CONFIRMATION = 'MOVER_ARCHIVOS_REVISADOS';
export function matchesCandidate(file: RemoteFile, owner: string, candidate: MoveCandidate): boolean {
  const props = file.appProperties || {};
  return isMedicalOriginal(file, owner) && file.id === candidate.id && props.pp_provider === candidate.provider &&
    props.pp_sha256 === candidate.sha256 && props.pp_kind === candidate.kind && file.mimeType === candidate.mimeType &&
    Number(file.size) === candidate.bytes && file.md5Checksum === candidate.md5;
}
