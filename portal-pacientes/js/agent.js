/* Portal de Pacientes — cliente del agente de importación (portal-pacientes-agent) y
   almacenamiento local de los PDF traídos (IndexedDB).
   El Portal nunca pide ni recibe la contraseña del laboratorio: solo habla con la API del agente. */
(function () {
  const P = window.P;

  /* ---------- API del agente ---------- */
  const DEFAULT_PORT = '8787';
  function base() {
    try {
      const o = localStorage.getItem('pp_agent_url');
      if (o) return o.replace(/\/$/, '');
    } catch (e) { /* sin storage */ }
    if (location.port === DEFAULT_PORT) return location.origin;
    return 'http://' + (location.hostname === 'localhost' ? 'localhost' : '127.0.0.1') + ':' + DEFAULT_PORT;
  }

  class AgentError extends Error {
    constructor(code, status, activeJobId) { super(code); this.code = code; this.status = status || 0; this.activeJobId = activeJobId || null; }
  }

  async function call(method, path, body) {
    let res;
    try {
      res = await fetch(base() + path, {
        method,
        headers: body ? { 'content-type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (e) {
      throw new AgentError('AGENT_OFFLINE');
    }
    let json = null;
    try { json = await res.json(); } catch (e) { /* sin cuerpo */ }
    if (!res.ok) {
      if (res.status === 401 && P.portalAuthEnabled) { P.db.session = null; P.save(); location.hash = '#/login'; }
      throw new AgentError((json && json.error) || 'HTTP_' + res.status, res.status, json && json.activeJobId);
    }
    return json;
  }

  const EVENTS = ['snapshot', 'provider_opening', 'provider_opened', 'waiting_user_login', 'authenticated', 'agent_started', 'agent_observing',
    'searching_studies', 'studies_found', 'waiting_selection', 'opening_study', 'viewer_ready', 'finding_document', 'downloading', 'importing',
    'file_ready', 'study_failed', 'human_action_required', 'provider_parser_mismatch', 'completed', 'error'];

  P.agent = {
    AgentError,
    base,
    health: () => call('GET', '/api/health'),
    start: (provider) => call('POST', '/api/imports/' + encodeURIComponent(provider)),
    job: (id) => call('GET', '/api/imports/' + id),
    importSelected: (id, studyIds, importedSourceKeys) => call('POST', '/api/imports/' + id + '/import', { studyIds, importedSourceKeys }),
    async acknowledgePortalImport(id, fileId, studyId, persisted) {
      const path = '/api/imports/' + id + '/files/' + fileId + '/ack';
      const body = { studyId, persisted };
      try { return await call('POST', path, body); }
      catch (error) {
        if (error instanceof AgentError && error.status) throw error;
        await new Promise((resolve) => setTimeout(resolve, 250));
        return call('POST', path, body); // idempotente: cubre una respuesta perdida después del acuse.
      }
    },
    retryDiscovery: (id) => call('POST', '/api/imports/' + id + '/retry-discovery'),
    cancel: (id) => call('DELETE', '/api/imports/' + id).catch(() => null),
    cancelActive: (id) => call('DELETE', '/api/imports/' + encodeURIComponent(id)),
    /* Suscripción SSE. Devuelve una función para cerrarla. */
    events(id, onEvent, onLost) {
      const es = new EventSource(base() + '/api/imports/' + id + '/events');
      let lost = 0;
      EVENTS.forEach((t) => es.addEventListener(t, (m) => {
        // EventSource usa «error» tanto para mensajes del job como para fallos de transporte.
        if (typeof m.data !== 'string') return;
        lost = 0;
        let data = {};
        try { data = JSON.parse(m.data); } catch (e) { /* noop */ }
        if (m.lastEventId) data.lastSeq = Number(m.lastEventId);
        onEvent(t, data);
      }));
      es.onopen = () => {
        lost = 0;
        call('GET', '/api/imports/' + id).then(snapshot => onEvent('snapshot', snapshot)).catch(error => {
          if ([401, 403, 404, 410].includes(error.status)) { es.close(); if (onLost) onLost(); }
        });
      };
      es.onerror = () => {
        // EventSource reintenta solo; si el servidor dejó de existir, avisamos tras varios intentos.
        if (es.readyState === EventSource.CLOSED || ++lost >= 4) { es.close(); if (onLost) onLost(); }
      };
      return () => es.close();
    },
    async file(id, fileId, onVerify) {
      let res;
      try { res = await fetch(base() + '/api/imports/' + id + '/files/' + fileId); } catch (e) { throw new AgentError('AGENT_OFFLINE'); }
      if (!res.ok) throw new AgentError('FILE_NOT_FOUND', res.status);
      const blob = await res.blob();
      if (onVerify) onVerify();
      const expected = res.headers.get('x-content-sha256');
      const bytes = await blob.arrayBuffer();
      const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), n => n.toString(16).padStart(2, '0')).join('');
      if (!expected || sha256 !== expected || (res.headers.has('content-length') && Number(res.headers.get('content-length')) !== blob.size)) throw new AgentError('ARTIFACT_INTEGRITY_FAILED');
      const kind = res.headers.get('x-artifact-kind') || 'PDF';
      const head = new Uint8Array(await blob.slice(0, 1024).arrayBuffer());
      if (kind === 'DICOM_ZIP') {
        const zipMagic = head.length >= 4 && head[0] === 0x50 && head[1] === 0x4b && [0x03, 0x05, 0x07].includes(head[2]) && [0x04, 0x06, 0x08].includes(head[3]);
        if (!zipMagic || (blob.type && !/(?:application.*zip|application.*octet-stream)/i.test(blob.type))) throw new AgentError('INVALID_MEDICAL_ARCHIVE');
      } else if (kind === 'PDF') {
        if ((blob.type && !/pdf|octet-stream/i.test(blob.type)) || !String.fromCharCode.apply(null, head).includes('%PDF-')) throw new AgentError('NOT_PDF');
      } else throw new AgentError('UNKNOWN_ARTIFACT');
      return { blob, kind, mimeType: blob.type, sha256 };
    },
  };

  /* ---------- Archivos locales (IndexedDB) ---------- */
  const DB_NAME = 'portal_pacientes_files';
  const STORE = 'files';
  let dbp = null;
  function open() {
    if (!('indexedDB' in window)) return Promise.reject(new Error('NO_IDB'));
    if (!dbp) {
      dbp = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(STORE);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      dbp.catch(() => { dbp = null; });
    }
    return dbp;
  }
  function tx(mode, fn) {
    return open().then((db) => new Promise((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const r = fn(t.objectStore(STORE));
      t.oncomplete = () => resolve(r && 'result' in r ? r.result : undefined);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error || new Error('IDB_TX_ABORTED'));
    }));
  }
  // Una importación se confirma únicamente cuando IndexedDB
  // confirmó la escritura, para que el archivo siga disponible después de cerrar o recargar el Portal.
  P.files = {
    put(key, blob) {
      return tx('readwrite', (s) => s.put(blob, key)).then(() => true, () => false);
    },
    get(key) {
      return tx('readonly', (s) => s.get(key));
    },
    del(key) { return tx('readwrite', (s) => s.delete(key)); },
    clear() { return tx('readwrite', (s) => s.clear()).catch(() => {}); },
  };

  /** Descarga un Blob con el nombre indicado. */
  P.saveBlob = function (blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  };

  P.fmtBytes = (n) => (n >= 1048576 ? (n / 1048576).toFixed(1).replace('.', ',') + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');
})();
