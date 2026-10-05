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
    constructor(code, status) { super(code); this.code = code; this.status = status || 0; }
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
    if (!res.ok) throw new AgentError((json && json.error) || 'HTTP_' + res.status, res.status);
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
    /* Suscripción SSE. Devuelve una función para cerrarla. */
    events(id, onEvent, onLost) {
      const es = new EventSource(base() + '/api/imports/' + id + '/events');
      let lost = 0;
      EVENTS.forEach((t) => es.addEventListener(t, (m) => {
        lost = 0;
        let data = {};
        try { data = JSON.parse(m.data); } catch (e) { /* noop */ }
        onEvent(t, data);
      }));
      es.onerror = () => {
        // EventSource reintenta solo; si el servidor dejó de existir, avisamos tras varios intentos.
        if (es.readyState === EventSource.CLOSED || ++lost >= 4) { es.close(); if (onLost) onLost(); }
      };
      return () => es.close();
    },
    async file(id, fileId) {
      let res;
      try { res = await fetch(base() + '/api/imports/' + id + '/files/' + fileId); } catch (e) { throw new AgentError('AGENT_OFFLINE'); }
      if (!res.ok) throw new AgentError('FILE_NOT_FOUND', res.status);
      const blob = await res.blob();
      const kind = res.headers.get('x-artifact-kind') || 'PDF';
      const head = new Uint8Array(await blob.slice(0, 1024).arrayBuffer());
      if (kind === 'DICOM_ZIP') {
        const zipMagic = head.length >= 4 && head[0] === 0x50 && head[1] === 0x4b && [0x03, 0x05, 0x07].includes(head[2]) && [0x04, 0x06, 0x08].includes(head[3]);
        if (!zipMagic || (blob.type && !/(?:application.*zip|application.*octet-stream)/i.test(blob.type))) throw new AgentError('INVALID_MEDICAL_ARCHIVE');
      } else if (kind === 'PDF') {
        if ((blob.type && !/pdf|octet-stream/i.test(blob.type)) || !String.fromCharCode.apply(null, head).includes('%PDF-')) throw new AgentError('NOT_PDF');
      } else throw new AgentError('UNKNOWN_ARTIFACT');
      return { blob, kind, mimeType: blob.type, sha256: res.headers.get('x-content-sha256') || '' };
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
  // La memoria solo acelera lecturas. Una importación se confirma únicamente cuando IndexedDB
  // confirmó la escritura, para que el archivo siga disponible después de cerrar o recargar el Portal.
  const mem = new Map();
  P.files = {
    put(key, blob) {
      return tx('readwrite', (s) => s.put(blob, key)).then(() => { mem.set(key, blob); return true; }, () => false);
    },
    get(key) {
      if (mem.has(key)) return Promise.resolve(mem.get(key));
      return tx('readonly', (s) => s.get(key)).then((b) => { if (b) mem.set(key, b); return b; });
    },
    del(key) { mem.delete(key); return tx('readwrite', (s) => s.delete(key)); },
    clear() { mem.clear(); return tx('readwrite', (s) => s.clear()).catch(() => {}); },
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
