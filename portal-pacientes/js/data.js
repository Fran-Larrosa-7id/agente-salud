/* Portal de Pacientes — datos de demostración y estado local.
   Todo es ficticio. El estado vive en localStorage (clave portal_pacientes_v1). */
(function () {
  const P = (window.P = window.P || {});

  P.TODAY = new Date(2026, 8, 23, 10, 42);
  P.TODAY_ISO = '2026-09-23';
  P.STORE_KEY = 'portal_pacientes_v1';

  P.PATIENT = {
    first: 'María',
    last: 'González',
    full: 'María González',
    initials: 'MG',
    dni: '32456789',
    dniFmt: '32.456.789',
    birth: '1986-03-14',
  };

  /* tone = color del monograma de cada institución (identifica la procedencia de un vistazo) */
  P.INSTITUTIONS = [
    { id: 'ln', name: 'Laboratorio Norte', kind: 'Laboratorio', city: 'San Isidro', mono: 'LN', tone: 'sage', compatible: true, featured: true, host: 'pacientes.laboratorionorte.ejemplo' },
    { id: 'lc', name: 'Laboratorio Central', kind: 'Laboratorio', city: 'CABA', mono: 'LC', tone: 'indigo', compatible: true, featured: true, host: 'resultados.laboratoriocentral.ejemplo' },
    { id: 'dm', name: 'Diagnóstico Médico', kind: 'Centro de diagnóstico', city: 'CABA', mono: 'DM', tone: 'sand', compatible: true, featured: true, host: 'portal.diagnosticomedico.ejemplo' },
    { id: 'hc', name: 'Hospital Central', kind: 'Hospital', city: 'CABA', mono: 'HC', tone: 'navy', compatible: true, featured: true, host: 'mi.hospitalcentral.ejemplo' },
    { id: 'ci', name: 'Centro de Imágenes', kind: 'Diagnóstico por imágenes', city: 'Vicente López', mono: 'CI', tone: 'sky', compatible: true, featured: true, host: 'informes.centrodeimagenes.ejemplo' },
    { id: 'lo', name: 'Laboratorio Oeste', kind: 'Laboratorio', city: 'Morón', mono: 'LO', tone: 'slate', compatible: true, featured: true, host: 'online.laboratoriooeste.ejemplo' },
    { id: 'cc', name: 'Clínica Central', kind: 'Clínica', city: 'CABA', mono: 'CC', tone: 'teal', compatible: true, host: 'pacientes.clinicacentral.ejemplo' },
    { id: 'cs', name: 'Clínica del Sur', kind: 'Clínica', city: 'Lomas de Zamora', mono: 'CS', tone: 'rose', compatible: true, flaky: true, host: 'portal.clinicadelsur.ejemplo' },
    { id: 'sr', name: 'Sanatorio del Río', kind: 'Sanatorio', city: 'Tigre', mono: 'SR', tone: 'slate', compatible: false },
    { id: 'ip', name: 'Instituto Médico Plaza', kind: 'Centro médico', city: 'La Plata', mono: 'IP', tone: 'sand', compatible: false },
  ];
  P.SELF = { id: 'yo', name: 'Declarado por vos', kind: 'Dato propio', mono: '', tone: 'self' };

  /* Resultados de demostración. Se muestran tal como los "informa" cada laboratorio; el portal no los interpreta. */
  const R = {
    hemograma: [
      ['Hemoglobina', '13,4', 'g/dL', '12,0 – 16,0'],
      ['Hematocrito', '40,1', '%', '36 – 46'],
      ['Glóbulos rojos', '4,52', 'millones/mm³', '4,00 – 5,20'],
      ['Glóbulos blancos', '6.800', '/mm³', '4.000 – 10.000'],
      ['Plaquetas', '245.000', '/mm³', '150.000 – 400.000'],
    ],
    hemograma25: [
      ['Hemoglobina', '13,1', 'g/dL', '12,0 – 16,0'],
      ['Hematocrito', '39,4', '%', '36 – 46'],
      ['Glóbulos rojos', '4,41', 'millones/mm³', '4,00 – 5,20'],
      ['Glóbulos blancos', '7.200', '/mm³', '4.000 – 10.000'],
      ['Plaquetas', '231.000', '/mm³', '150.000 – 400.000'],
    ],
    lipidico: [
      ['Colesterol total', '196', 'mg/dL', 'Deseable: menor a 200'],
      ['Colesterol HDL', '52', 'mg/dL', 'Mayor a 40'],
      ['Colesterol LDL', '118', 'mg/dL', 'Menor a 130'],
      ['Triglicéridos', '130', 'mg/dL', 'Menor a 150'],
    ],
    orina: [
      ['Color', 'Amarillo', '', '—'],
      ['Aspecto', 'Límpido', '', '—'],
      ['Densidad', '1,020', '', '1,005 – 1,030'],
      ['pH', '6,0', '', '5,0 – 7,5'],
      ['Proteínas', 'No se detectan', '', '—'],
    ],
    completo: [
      ['Hemoglobina', '13,2', 'g/dL', '12,0 – 16,0'],
      ['Glóbulos blancos', '6.500', '/mm³', '4.000 – 10.000'],
      ['Glucemia', '92', 'mg/dL', '70 – 110'],
      ['Urea', '31', 'mg/dL', '15 – 45'],
      ['Creatinina', '0,82', 'mg/dL', '0,50 – 1,10'],
      ['Colesterol total', '201', 'mg/dL', 'Deseable: menor a 200'],
    ],
    glucemia: [['Glucemia en ayunas', '94', 'mg/dL', '70 – 110']],
    hepatograma: [
      ['Bilirrubina total', '0,7', 'mg/dL', '0,2 – 1,2'],
      ['GOT (AST)', '21', 'U/L', 'Hasta 32'],
      ['GPT (ALT)', '19', 'U/L', 'Hasta 33'],
      ['Fosfatasa alcalina', '74', 'U/L', '35 – 104'],
    ],
    ionograma: [
      ['Sodio', '140', 'mEq/L', '136 – 145'],
      ['Potasio', '4,2', 'mEq/L', '3,5 – 5,1'],
      ['Cloro', '103', 'mEq/L', '98 – 107'],
    ],
    uremia: [
      ['Urea', '29', 'mg/dL', '15 – 45'],
      ['Creatinina', '0,79', 'mg/dL', '0,50 – 1,10'],
    ],
  };
  P.RESULTS = R;

  function study(o) {
    return Object.assign({ status: 'disponible', pages: 1, size: '96 KB', results: null, images: 0 }, o);
  }

  function seed() {
    return {
      version: 1,
      session: null,
      emptyDemo: false,
      textSize: 'normal',
      docView: 'grid',
      contact: { email: 'maria.gonzalez@ejemplo.com', phone: '+54 9 11 5555-0142' },
      passwordChanged: '2026-03-02',
      authorizations: [
        { inst: 'hc', since: '2023-05-02', mode: 'red' },
        { inst: 'cc', since: '2019-06-10', mode: 'red' },
        { inst: 'lc', since: '2025-02-10', mode: 'red' },
        { inst: 'ci', since: '2025-06-05', mode: 'autorizada' },
        { inst: 'dm', since: '2025-10-22', mode: 'autorizada' },
      ],
      studies: [
        study({ id: 'hemograma-2026', name: 'Hemograma completo', type: 'laboratorio', date: '2026-09-18', reportDate: '2026-09-19', inst: 'lc', requestedBy: 'Dra. Laura Pereyra', protocol: 'LC-2026-184233', pages: 2, size: '184 KB', results: R.hemograma }),
        study({ id: 'lipidico-2026', name: 'Perfil lipídico', type: 'laboratorio', date: '2026-09-18', reportDate: '2026-09-19', inst: 'lc', requestedBy: 'Dra. Laura Pereyra', protocol: 'LC-2026-184234', pages: 1, size: '122 KB', results: R.lipidico }),
        study({ id: 'vitd-2026', name: 'Vitamina D (25-OH)', type: 'laboratorio', date: '2026-09-18', inst: 'lc', requestedBy: 'Dra. Laura Pereyra', protocol: 'LC-2026-184235', status: 'pendiente', expected: '2026-09-26' }),
        study({ id: 'ecg-2026', name: 'Electrocardiograma', type: 'otros', date: '2026-08-12', reportDate: '2026-08-12', inst: 'hc', requestedBy: 'Dra. Laura Pereyra', protocol: 'HC-ECG-55120', pages: 2, size: '310 KB', images: 1 }),
        study({ id: 'rx-torax-2026', name: 'Radiografía de tórax', type: 'imagenes', date: '2026-03-14', reportDate: '2026-03-15', inst: 'ci', requestedBy: 'Dr. Martín Ríos', protocol: 'CI-RX-20931', pages: 2, size: '2,4 MB', images: 2 }),
        study({ id: 'orina-2026', name: 'Análisis de orina', type: 'laboratorio', date: '2026-01-27', reportDate: '2026-01-28', inst: 'hc', requestedBy: 'Dr. Martín Ríos', protocol: 'HC-LAB-90412', results: R.orina }),
        study({ id: 'rm-rodilla-2025', name: 'Resonancia de rodilla derecha', type: 'imagenes', date: '2025-10-22', reportDate: '2025-10-24', inst: 'dm', requestedBy: 'Dr. Pablo Acosta', protocol: 'DM-RM-7741', pages: 3, size: '6,8 MB', images: 4 }),
        study({ id: 'eco-abd-2025', name: 'Ecografía abdominal', type: 'imagenes', date: '2025-06-05', reportDate: '2025-06-05', inst: 'ci', requestedBy: 'Dr. Martín Ríos', protocol: 'CI-ECO-18820', pages: 2, size: '1,9 MB', images: 3 }),
        study({ id: 'hemograma-2025', name: 'Hemograma completo', type: 'laboratorio', date: '2025-02-10', reportDate: '2025-02-11', inst: 'lc', requestedBy: 'Dr. Martín Ríos', protocol: 'LC-2025-020187', pages: 2, size: '176 KB', results: R.hemograma25 }),
      ],
      documents: [
        { id: 'doc-receta-losartan', title: 'Receta · Losartán 50 mg', kind: 'receta', date: '2026-08-12', inst: 'hc', pages: 1, size: '88 KB', by: 'Dra. Laura Pereyra' },
        { id: 'doc-indic-0812', title: 'Indicaciones de la consulta', kind: 'indicaciones', date: '2026-08-12', inst: 'hc', pages: 1, size: '64 KB', by: 'Dra. Laura Pereyra' },
        { id: 'doc-orden-lab', title: 'Orden de estudios de laboratorio', kind: 'indicaciones', date: '2026-09-02', inst: 'cc', pages: 1, size: '71 KB', by: 'Dra. Laura Pereyra' },
        { id: 'doc-vacuna-gripe', title: 'Certificado de vacunación antigripal', kind: 'otros', date: '2026-04-15', inst: 'hc', pages: 1, size: '52 KB', by: 'Vacunatorio Hospital Central' },
      ],
      allergies: [
        { id: 'al-penicilina', name: 'Penicilina', type: 'Medicamento', reaction: 'Erupción en la piel', inst: 'hc', date: '2025-08-12' },
        { id: 'al-ibuprofeno', name: 'Ibuprofeno', type: 'Medicamento', reaction: 'Hinchazón en labios y párpados', inst: 'cc', date: '2026-02-03' },
      ],
      conditions: [
        { id: 'ant-hta', name: 'Hipertensión arterial', category: 'Enfermedad', since: '2019', inst: 'cc', date: '2019-06-10', note: 'En seguimiento con controles periódicos.', related: ['ecg-2026'] },
        { id: 'ant-apendice', name: 'Apendicectomía', category: 'Cirugía', since: '2008', inst: 'hc', date: '2023-05-02', note: 'Cirugía programada, sin internación prolongada.', related: [] },
        { id: 'ant-fam-dbt', name: 'Diabetes tipo 2 en la familia (madre)', category: 'Antecedente familiar', since: '', inst: 'yo', date: '2026-02-03', note: 'Dato que informaste vos al completar tu perfil.', related: [] },
      ],
      meds: [
        { id: 'med-losartan', name: 'Losartán', dose: '50 mg', how: '1 comprimido por día', start: '2026-08-12', by: 'Dra. Laura Pereyra', inst: 'hc', status: 'activa' },
        { id: 'med-atorva', name: 'Atorvastatina', dose: '20 mg', how: '1 comprimido por la noche', start: '2025-10-02', by: 'Dr. Martín Ríos', inst: 'cc', status: 'activa' },
        { id: 'med-enalapril', name: 'Enalapril', dose: '10 mg', how: '1 comprimido cada 12 horas', start: '2019-06-10', end: '2026-08-12', by: 'Dr. Martín Ríos', inst: 'cc', status: 'finalizada' },
        { id: 'med-paracetamol', name: 'Paracetamol', dose: '500 mg', how: 'Hasta 3 comprimidos por día, si hay dolor', start: '2025-10-22', end: '2025-11-05', by: 'Dr. Pablo Acosta', inst: 'dm', status: 'finalizada' },
      ],
      vaccines: [
        { id: 'vac-gripe-2026', name: 'Antigripal 2026', dose: 'Dosis anual', date: '2026-04-15', inst: 'hc' },
        { id: 'vac-covid-2025', name: 'COVID-19', dose: 'Refuerzo', date: '2025-10-20', inst: 'hc' },
        { id: 'vac-dt-2021', name: 'Doble adulto (dT)', dose: 'Refuerzo', date: '2021-07-08', inst: 'cc' },
      ],
      imports: [],
      shares: [
        { id: 'sh-1', studyId: 'hemograma-2026', recipient: 'Dra. Laura Pereyra', includes: ['estudio', 'documento'], created: '2026-09-19T09:10', expires: '2026-09-26T09:10', code: 'K7M-29Q' },
        { id: 'sh-0', studyId: 'rx-torax-2026', recipient: 'Kinesiología', includes: ['documento'], created: '2026-03-15T11:00', expires: '2026-03-16T11:00', code: 'R2D-81X' },
      ],
      sessions: [
        { id: 'se-this', device: 'Chrome en Windows', place: 'Buenos Aires, Argentina', when: 'Ahora', icon: 'monitor', current: true },
        { id: 'se-phone', device: 'Safari en iPhone', place: 'Buenos Aires, Argentina', when: 'Hace 2 días', icon: 'smartphone' },
      ],
      activity: [
        { at: '2026-09-23T10:42', text: 'Ingresaste al portal', sub: 'Chrome en Windows' },
        { at: '2026-09-19T09:10', text: 'Compartiste un estudio', sub: 'Hemograma completo · Dra. Laura Pereyra' },
        { at: '2026-03-02T18:25', text: 'Cambiaste tu contraseña', sub: 'Safari en iPhone' },
        { at: '2025-10-22T12:03', text: 'Autorizaste a Diagnóstico Médico', sub: 'Traer mis estudios' },
      ],
    };
  }

  /* Lo que "encuentra" cada institución al traer estudios. */
  const CATALOG = {
    ln: [
      { key: 'completo', name: 'Laboratorio completo', type: 'laboratorio', date: '2026-08-05', results: R.completo, pages: 2 },
      { key: 'glucemia', name: 'Glucemia en ayunas', type: 'laboratorio', date: '2026-08-05', results: R.glucemia },
      { key: 'hemograma', name: 'Hemograma completo', type: 'laboratorio', date: '2026-05-03', results: R.hemograma25, pages: 2 },
      { key: 'orina', name: 'Análisis de orina', type: 'laboratorio', date: '2026-05-03', results: R.orina },
      { key: 'hepatograma', name: 'Hepatograma', type: 'laboratorio', date: '2025-11-20', results: R.hepatograma },
      { key: 'ionograma', name: 'Ionograma', type: 'laboratorio', date: '2025-11-20', results: R.ionograma },
    ],
    lo: [
      { key: 'completo', name: 'Laboratorio completo', type: 'laboratorio', date: '2025-12-12', results: R.completo, pages: 2 },
      { key: 'uremia', name: 'Uremia y creatinina', type: 'laboratorio', date: '2025-12-12', results: R.uremia },
      { key: 'orina', name: 'Análisis de orina', type: 'laboratorio', date: '2025-04-08', results: R.orina },
    ],
    cs: [
      { key: 'eco', name: 'Ecografía de tiroides', type: 'imagenes', date: '2025-09-30', images: 3, pages: 2 },
      { key: 'ecg', name: 'Electrocardiograma', type: 'otros', date: '2025-09-30', images: 1, pages: 2 },
      { key: 'hemograma', name: 'Hemograma completo', type: 'laboratorio', date: '2025-09-26', results: R.hemograma25, pages: 2 },
      { key: 'glucemia', name: 'Glucemia en ayunas', type: 'laboratorio', date: '2025-09-26', results: R.glucemia },
    ],
    lc: [
      { key: 'glucemia', name: 'Glucemia en ayunas', type: 'laboratorio', date: '2025-02-10', results: R.glucemia },
      { key: 'lipidico', name: 'Perfil lipídico', type: 'laboratorio', date: '2025-02-10', results: R.lipidico },
    ],
    ci: [{ key: 'rx', name: 'Radiografía de columna lumbar', type: 'imagenes', date: '2025-06-05', images: 2, pages: 2 }],
    dm: [{ key: 'densito', name: 'Densitometría ósea', type: 'imagenes', date: '2025-10-22', images: 2, pages: 2 }],
    hc: [{ key: 'espiro', name: 'Espirometría', type: 'otros', date: '2025-07-14', images: 1, pages: 2 }],
    cc: [
      { key: 'ecg', name: 'Electrocardiograma', type: 'otros', date: '2025-03-18', images: 1, pages: 2 },
      { key: 'eco', name: 'Ecocardiograma', type: 'imagenes', date: '2025-03-18', images: 3, pages: 3 },
    ],
  };

  P.findImportable = function (instId) {
    const list = CATALOG[instId] || [];
    return list
      .map((c, i) =>
        Object.assign(
          {
            id: 'imp-' + instId + '-' + c.key,
            inst: instId,
            status: 'disponible',
            pages: 1,
            images: 0,
            results: null,
            requestedBy: 'Sin dato en el documento',
            protocol: instId.toUpperCase() + '-' + (48210 + i * 37),
            size: c.type === 'imagenes' ? '3,1 MB' : (c.pages || 1) * 90 + ' KB',
          },
          c,
          { reportDate: c.date }
        )
      )
      .filter((s) => !P.db.studies.some((x) => x.id === s.id));
  };

  /* ---------- Store ---------- */
  function load() {
    try {
      const raw = localStorage.getItem(P.STORE_KEY);
      if (raw) {
        const d = JSON.parse(raw);
        if (d && d.version === 1) return d;
      }
    } catch (e) { /* sin storage: seguimos con la semilla */ }
    return seed();
  }
  P.db = load();
  P.save = function () {
    try { localStorage.setItem(P.STORE_KEY, JSON.stringify(P.db)); } catch (e) { /* noop */ }
  };
  P.resetDemo = function () {
    const session = P.db.session;
    const textSize = P.db.textSize;
    P.db = seed();
    P.db.session = session;
    P.db.textSize = textSize;
    P.save();
  };

  /* ---------- Selectores ---------- */
  const byDateDesc = (a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0);

  P.inst = (id) => P.INSTITUTIONS.find((i) => i.id === id) || P.SELF;
  P.studies = () => {
    const all = P.db.emptyDemo ? P.db.studies.filter((s) => s.importedAt) : P.db.studies;
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
      }));
    const own = P.db.emptyDemo ? [] : P.db.documents;
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
