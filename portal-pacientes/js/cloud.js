(function () {
  const P = window.P;
  P.cloudMessages = {
    DRIVE_NOT_CONNECTED: 'Conectá tu Google Drive para guardar los estudios.',
    DRIVE_TOKEN_EXPIRED: 'Necesitamos que vuelvas a conectar tu Google Drive.',
    DRIVE_STORAGE_FULL: 'Tu Google Drive no tiene espacio. Liberá espacio y reintentá.',
    DRIVE_RATE_LIMIT: 'Google Drive está ocupado. Esperá un momento y reintentá.',
    DRIVE_UPLOAD_FAILED: 'No pudimos terminar de guardar en Drive. Podés reintentar mientras la importación siga abierta.',
    FILE_MISSING: 'El archivo ya no está disponible en tu Drive. No lo restauramos automáticamente.',
    SESSION_EXPIRED: 'Tu sesión venció. Volvé a ingresar con Google.',
    PDF_PREVIEW_FAILED: 'No pudimos abrir el PDF. Podés descargarlo o abrirlo en Drive.',
    IMPORT_BUSY: 'Hay una importación en curso. Intentá en unos minutos.',
    GOOGLE_ACCESS_DENIED: 'No se autorizó el acceso con Google. Revisá la cuenta elegida y volvé a intentar.',
    AGENT_OFFLINE: 'No pudimos conectar con el Portal. Revisá la conexión y reintentá.',
  };
  P.cloudMessage = code => P.cloudMessages[code] || 'No pudimos completar la operación. Volvé a intentar.';
  P.syncCloudCatalog = async function (reconcile) {
    if (P.authMode !== 'google' || !P.googleUser) return [];
    const generation = P.identityGeneration;
    P.cloudSyncBusy = true;
    try {
      const result = await P.agent.catalog(!!reconcile && P.driveStatus !== 'disconnected');
      if (generation !== P.identityGeneration) return [];
      P.driveStatus = result.drive;
      P.cloudSyncError = result.syncError || null;
      const studies = result.studies.map(record => {
        const institution = P.INSTITUTIONS.find(item => item.live === record.providerId);
        return { id: 'drive-' + record.id, name: record.title || (record.providerId === 'percamb' ? 'Resultados de laboratorio' : 'Estudio de imágenes'),
          type: record.providerId === 'percamb' ? 'laboratorio' : 'imagenes', date: record.date || '', studyDate: record.date || '', reportDate: null,
          inst: institution ? institution.id : 'yo', provider: record.providerId, sourceKey: record.sourceStudyKey,
          status: record.status === 'stored' ? 'disponible' : 'no_disponible', remoteStatus: record.status, hidden: !!record.hidden,
          pages: 0, images: 0, results: null, size: P.fmtBytes(record.bytes), importedAt: record.createdAt, importedBy: 'agent',
          origin: 'google_drive', requestedBy: 'Sin dato', protocol: '', artifactKind: record.kind,
          file: { storageBackend: 'google_drive', catalogId: record.id, key: 'drive:' + record.id, bytes: record.bytes, kind: record.kind, mimeType: record.mimeType, sha256: record.sha256 } };
      });
      P.db.studies = P.db.studies.filter(study => study.origin !== 'google_drive').concat(studies);
      P.save(); return studies;
    } catch (error) {
      if (generation === P.identityGeneration) P.cloudSyncError = error.code || 'AGENT_OFFLINE';
      return [];
    } finally { if (generation === P.identityGeneration) P.cloudSyncBusy = false; }
  };
  const labels = { disconnected: 'Desconectado', connected: 'Conectado', reconnect_required: 'Necesita reconexión', storage_full: 'Sin espacio', temporary_error: 'Error temporal' };
  const tones = { connected: 'success', reconnect_required: 'warning', storage_full: 'warning', temporary_error: 'warning', disconnected: 'neutral' };
  P.renderDrivePanel = function () {
    if (P.authMode !== 'google') return '';
    const status = P.driveStatus || 'disconnected';
    const reconnect = status === 'reconnect_required';
    return '<section class="settings" aria-labelledby="h-drive"><h2 class="sec-title" id="h-drive">Google Drive</h2>' +
      '<div class="set-row set-row-top"><span class="drive-mark" aria-hidden="true">' + P.icon('cloud', 22) + '</span><div class="set-t"><p class="set-name">Tus estudios se guardan en tu Drive ' +
      P.badge(tones[status] || 'neutral', labels[status] || 'Desconectado', status === 'connected' ? 'check' : status === 'disconnected' ? '' : 'alert') + '</p>' +
      (P.googleUser ? '<p class="muted">' + P.esc(P.googleUser.email) + '</p>' : '') +
      '<p class="muted mt-2">Los archivos se guardan en TU cuenta de Google. Podés desconectarla cuando quieras.</p>' +
      (P.cloudSyncError ? '<p role="alert" class="field-error mt-2">' + P.icon('alert', 16) + P.esc(P.cloudMessage(P.cloudSyncError)) + '</p>' : '') +
      '<div class="btn-row mt-4">' + (status === 'disconnected' || reconnect ? '<a class="btn btn-primary" href="/api/drive/connect">' + (reconnect ? 'Reconectar Google Drive' : 'Conectar mi Google Drive') + '</a>' : '') +
      '<button type="button" class="btn btn-secondary" data-action="cloud-sync"' + (P.cloudSyncBusy ? ' disabled' : '') + '>' + P.icon('retry', 18) + 'Actualizar mis estudios</button>' +
      (status !== 'disconnected' ? '<button type="button" class="btn btn-ghost" data-action="drive-disconnect">Desconectar Drive</button>' : '') + '</div></div></div>' +
      '<div class="set-foot"><p class="muted">Tus medicamentos, alergias y vacunas de esta cuenta permanecen en este navegador. Los estudios de Drive y la opción de ocultarlos de tu biblioteca se sincronizan con tu cuenta.</p>' +
      '<p class="muted">Los archivos anteriores del piloto quedan separados. No se asignan ni se suben automáticamente a esta cuenta.</p></div></section>';
  };
  P.cloudBanner = function () {
    if (P.authMode !== 'google') return '';
    const ok = !P.cloudSyncError && P.driveStatus === 'connected';
    return '<div class="sync' + (ok ? '' : ' sync-warn') + '" role="status">' + P.icon(ok ? 'cloud' : 'alert', 18) + '<span class="sync-t">' + (P.cloudSyncError ? P.esc(P.cloudMessage(P.cloudSyncError)) : ok ? 'Sincronizado con tu Google Drive.' : 'Google Drive: ' + (labels[P.driveStatus] || 'Desconectado')) + '</span>' +
      '<span class="sync-a"><button type="button" class="link" data-action="cloud-sync">' + P.icon('retry', 16) + 'Actualizar</button><a class="link" href="#/perfil">Administrar Drive</a></span></div>';
  };
  P.actions['cloud-sync'] = async button => {
    const done = P.busy(button, 'Sincronizando…');
    await P.syncCloudCatalog(true); done(); P.rerender();
  };
  P.actions['drive-disconnect'] = async () => {
    if (!await P.confirm({ title: '¿Desconectar Google Drive?', text: 'Se cancelarán tus importaciones en curso. Los archivos ya guardados permanecerán en TU Drive.', confirmLabel: 'Desconectar Drive' })) return;
    try {
      const result = await P.agent.call('POST', '/api/drive/disconnect');
      P.driveStatus = 'disconnected'; P.cloudSyncError = null; P.rerender();
      if (!result.revocationConfirmed) P.toast('Desconectamos el Portal. Google no confirmó la revocación: podés quitar el permiso desde la configuración de tu cuenta Google.', { tone: 'danger' });
    } catch (error) { P.toast(P.cloudMessage(error.code), { tone: 'danger' }); }
  };
  P.cloudDownload = async function (document) {
    try {
      await P.agent.call('GET', '/api/studies/' + encodeURIComponent(document.file.catalogId));
      const link = window.document.createElement('a'); link.href = '/api/studies/' + encodeURIComponent(document.file.catalogId) + '/download';
      link.download = ''; window.document.body.appendChild(link); link.click(); link.remove();
    } catch (error) { P.toast(P.cloudMessage(error.code), { tone: 'danger' }); await P.syncCloudCatalog(false); P.rerender(); }
  };
  P.openCloudDocument = function (document) {
    const id = encodeURIComponent(document.file.catalogId);
    window.open('/api/studies/' + id + '/open', '_blank', 'noopener,noreferrer');
  };
  P.readCloudPdf = async function (document, signal) {
    const id = encodeURIComponent(document.file.catalogId);
    const response = await fetch('/api/studies/' + id + '/download', { signal, cache: 'no-store', redirect: 'error' });
    if (!response.ok) {
      const error = await response.json().catch(() => null);
      throw new P.agent.AgentError(error?.error || 'PDF_PREVIEW_FAILED', response.status);
    }
    const pdf = await response.blob();
    if (pdf.type !== 'application/pdf' || !pdf.size || pdf.size !== document.file.bytes) {
      throw new P.agent.AgentError('PDF_PREVIEW_FAILED');
    }
    return pdf;
  };
  P.actions['cloud-trash'] = async button => {
    if (!await P.confirm({ title: '¿Enviar el archivo a la papelera de tu Drive?', text: 'El original dejará de estar disponible desde el Portal. Podés restaurarlo desde la papelera de Google Drive. No se borran otros estudios.', confirmLabel: 'Enviar a la papelera', tone: 'danger' })) return;
    try { await P.agent.call('DELETE', '/api/studies/' + encodeURIComponent(button.dataset.id), { confirm: true }); P.closeAllOverlays(); await P.syncCloudCatalog(false); P.rerender(); }
    catch (error) { P.toast(P.cloudMessage(error.code), { tone: 'danger' }); }
  };
  P.actions['cloud-visibility'] = async button => {
    const hidden = button.dataset.hidden === 'true';
    if (hidden && !await P.confirm({ title: '¿Ocultar de mi biblioteca?', text: 'Conservamos el historial y los metadatos. El archivo de Google Drive no se elimina. Podés volver a mostrarlo desde Estudios ocultos.', confirmLabel: 'Ocultar de mi biblioteca' })) return;
    const generation = P.identityGeneration;
    try {
      await P.agent.call('POST', '/api/studies/' + encodeURIComponent(button.dataset.id) + '/visibility', { hidden, confirm: hidden });
      if (generation !== P.identityGeneration) return;
      await P.syncCloudCatalog(false); P.rerender();
    } catch (error) { if (generation === P.identityGeneration) P.toast(P.cloudMessage(error.code), { tone: 'danger' }); }
  };
})();
