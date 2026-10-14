/* Portal de Pacientes — estudios importados y estado local del navegador. */
(function () {
  const P = (window.P = window.P || {});
  P.TODAY = new Date();
  P.TODAY_ISO = P.TODAY.getFullYear() + '-' + String(P.TODAY.getMonth() + 1).padStart(2, '0') + '-' + String(P.TODAY.getDate()).padStart(2, '0');
  P.STORE_KEY = 'portal_pacientes_v1';
  P.PATIENT = { first: '', last: '', full: 'Mi cuenta', initials: 'PP', dni: '', dniFmt: '', birth: '' };
  P.INSTITUTIONS = [
    { id: 'pc', name: 'Pérez Cambet', kind: 'Laboratorio', city: '', mono: 'PC', tone: 'teal', compatible: true, featured: true, live: 'percamb', host: 'www.biodatasa.com.ar' },
    { id: 'cdm', name: 'Centro DM', kind: 'Diagnóstico por imágenes', city: 'CABA', mono: 'CDM', tone: 'sky', compatible: true, featured: true, live: 'centrodm', host: 'estudios.centrodm.com.ar' },
    { id: 'rdc', name: 'RDC Chacabuco', kind: 'Diagnóstico por imágenes', city: '', mono: 'RDC', tone: 'sky', compatible: true, featured: true, live: 'rdcchacabuco', host: 'rdcchacabuco.from-ar.com' },
  ];
  P.SELF = { id: 'yo', name: 'Declarado por vos', kind: 'Dato propio', mono: '', tone: 'self' };
  P.findImportable = () => [];
  function seed() {
    return { version: 2, session: null, textSize: 'normal', docView: 'grid', contact: { email: '', phone: '' }, passwordChanged: '',
      authorizations: [], studies: [], documents: [], allergies: [], conditions: [], meds: [], vaccines: [], imports: [], shares: [], sessions: [], activity: [] };
  }
  function load() {
    let saved;
    try { saved = JSON.parse(localStorage.getItem(P.STORE_KEY) || 'null'); } catch {}
    if (!saved || ![1, 2].includes(saved.version)) return seed();
    if (saved.version === 2) return Object.assign(seed(), saved);
    // Migrar la cuenta anterior conservando referencias y bytes de todos los archivos importados.
    const studies = (saved.studies || []).filter(study => study.file && typeof study.file.key === 'string' && study.file.key);
    const ids = new Set(studies.map(study => study.id));
    const live = new Set(P.INSTITUTIONS.map(institution => institution.id));
    const clean = Object.assign(seed(), {
      session: saved.session || null, textSize: saved.textSize || 'normal', docView: saved.docView || 'grid', studies,
      documents: (saved.documents || []).filter(document => document.file && document.file.key),
      authorizations: (saved.authorizations || []).filter(auth => live.has(auth.inst)),
      imports: (saved.imports || []).filter(item => live.has(item.inst)),
      shares: (saved.shares || []).filter(share => ids.has(share.studyId)),
      activity: studies.filter(study => study.importedAt).map(study => ({ at: study.importedAt, text: 'Importaste un estudio', sub: study.name })),
    });
    try { localStorage.setItem(P.STORE_KEY, JSON.stringify(clean)); } catch {}
    return clean;
  }
  P.db = load();
  P.save = function () {
    try { localStorage.setItem(P.STORE_KEY, JSON.stringify(P.db)); return true; } catch { return false; }
  };
  /* ---------- Selectores ---------- */
  const byDateDesc = (a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0);

  P.inst = (id) => P.INSTITUTIONS.find((i) => i.id === id) || P.SELF;
  P.studies = () => {
    const all = P.db.studies;
    return all.slice().sort(byDateDesc);
  };
  P.study = (id) => P.db.studies.find((s) => s.id === id);
  P.activeMeds = () => P.db.meds.filter((m) => m.status === 'activa');
  P.pastMeds = () => P.db.meds.filter((m) => m.status !== 'activa');
  P.authorization = (instId) => P.db.authorizations.find((a) => a.inst === instId);

  P.DOC_KINDS = {
    resultado: 'Resultado',
    informe: 'Informe',
    receta: 'Receta',
    indicaciones: 'Indicaciones',
    otros: 'Otro documento',
  };

  P.documents = () => {
    const fromStudies = P.studies()
      .filter((s) => s.status === 'disponible')
      .map((s) => ({
        id: 'doc-' + s.id,
        title: s.name,
        kind: s.type === 'laboratorio' ? 'resultado' : 'informe',
        date: s.reportDate || s.date,
        inst: s.inst,
        pages: s.pages,
        size: s.size,
        studyId: s.id,
        imported: !!s.importedAt,
        isImage: s.type !== 'laboratorio',
        file: s.file || null,
      }));
    const own = P.db.documents;
    return fromStudies.concat(own).sort(byDateDesc);
  };
  P.doc = (id) => P.documents().find((d) => d.id === id);

  /* Instituciones que aportan datos al historial (orden por cantidad de datos). */
  P.sourceInstitutions = () => {
    const count = {};
    const add = (id) => { if (id && id !== 'yo') count[id] = (count[id] || 0) + 1; };
    P.studies().forEach((s) => add(s.inst));
    P.db.allergies.forEach((a) => add(a.inst));
    P.db.conditions.forEach((c) => add(c.inst));
    P.db.meds.forEach((m) => add(m.inst));
    P.db.vaccines.forEach((v) => add(v.inst));
    return Object.keys(count).sort((a, b) => count[b] - count[a]);
  };

  P.shareStatus = (sh) => {
    if (sh.revoked) return 'revocado';
    return new Date(sh.expires) > P.TODAY ? 'activo' : 'vencido';
  };
})();
