// Hoja del documento (prescripción u orden). La usan el panel profesional, la atención y el Portal del Paciente,
// para que el documento se vea igual en los tres lados. Requiere rx-store.js.
(function (global) {
  const S = global.RxStore;

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  const ICONS = {
    emitida: '<path d="M20 6 9 17l-5-5"/>',
    vigente: '<path d="M20 6 9 17l-5-5"/>',
    borrador: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
    anulada: '<circle cx="12" cy="12" r="9"/><path d="m5.6 5.6 12.8 12.8"/>',
    vencida: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  };
  function icon(name, size) {
    return '<svg aria-hidden="true" width="' + (size || 14) + '" height="' + (size || 14) + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">' + (ICONS[name] || '') + '</svg>';
  }

  // Estado con ícono + palabra (+ color por clase). Nunca solo color.
  function statusTag(d, audience) {
    const key = S.statusOf(d);
    const label = audience === 'patient' ? (S.PATIENT_STATUS_LABELS[key] || S.STATUS_LABELS[key]) : S.STATUS_LABELS[key];
    const iconKey = audience === 'patient' && key === 'emitida' ? 'vigente' : key;
    return '<span class="rx-state rx-state--' + key + '">' + icon(iconKey) + esc(label) + '</span>';
  }

  function empty(text) { return '<span class="rx-sheet-empty">' + esc(text) + '</span>'; }

  // d: documento (puede ser un borrador en edición). opts.audience: 'pro' | 'patient'
  function render(d, opts) {
    const o = opts || {};
    const audience = o.audience || 'pro';
    const p = S.patient(d.patientId) || { name: 'Paciente sin seleccionar', dni: '—', coverage: '' };
    const pro = S.professional(d.professionalId || S.CURRENT_PROFESSIONAL);
    const key = S.statusOf(d);
    const isDraft = key === 'borrador';
    const title = S.kindLabel(d);
    const dateISO = d.dateISO || S.todayISO();
    const expires = d.expiresISO || S.addDaysISO(dateISO, S.VALIDITY_DAYS[d.kind] || 30);
    const coverage = p.coverage ? p.coverage + (p.plan ? ' ' + p.plan : '') : '';

    let body = '';
    if (d.kind === 'receta') {
      const m = d.med;
      body += '<p class="rx-sheet-label">Medicamento</p>';
      body += m
        ? '<p class="rx-sheet-main">' + esc(m.name) + ' <span>' + esc(m.strength) + '</span></p><p class="rx-sheet-sub">' + esc([m.form, d.med.presentation].filter(Boolean).join(' · ')) + (d.quantity ? ' · Cantidad: ' + esc(d.quantity) + (Number(d.quantity) === 1 ? ' envase' : ' envases') : '') + '</p>'
        : '<p class="rx-sheet-main">' + empty('Elegí un medicamento') + '</p>';
      body += '<p class="rx-sheet-label">Cómo usarlo</p>';
      const dose = d.dose || '';
      const freq = d.frequency || '';
      const dur = d.duration && d.duration.value ? 'Durante ' + d.duration.value + ' ' + d.duration.unit : '';
      body += (dose || freq || dur)
        ? '<p class="rx-sheet-text">' + [esc(dose), esc(freq ? freq.charAt(0).toLowerCase() + freq.slice(1) : '')].filter(Boolean).join(' ') + (dur ? '<br>' + esc(dur) : '') + '</p>'
        : '<p class="rx-sheet-text">' + empty('Dosis, frecuencia y duración') + '</p>';
    } else {
      const type = S.ORDER_TYPES[d.orderType];
      body += '<p class="rx-sheet-label">Solicitud</p>';
      body += d.service ? '<p class="rx-sheet-main">' + esc(d.service) + '</p>' : '<p class="rx-sheet-main">' + empty('Prestación o estudio solicitado') + '</p>';
      body += '<p class="rx-sheet-sub">' + esc(type ? type.label : 'Tipo sin elegir') + ' · Prioridad ' + (d.priority === 'preferente' ? 'preferente' : 'habitual') + '</p>';
      if (d.reason && audience === 'pro') body += '<p class="rx-sheet-label">Motivo / observaciones</p><p class="rx-sheet-text">' + esc(d.reason) + '</p>';
    }
    body += '<p class="rx-sheet-label">Indicaciones</p>';
    body += d.instructions ? '<p class="rx-sheet-text">' + esc(d.instructions) + '</p>' : '<p class="rx-sheet-text">' + empty('Sin indicaciones adicionales') + '</p>';
    if (d.kind === 'receta' && d.notes && audience === 'pro') body += '<p class="rx-sheet-label">Observaciones <small>· no se muestran al paciente</small></p><p class="rx-sheet-text">' + esc(d.notes) + '</p>';

    const annulled = key === 'anulada'
      ? '<p class="rx-sheet-band rx-sheet-band--annul" role="note">' + icon('anulada', 16) + '<span><b>Documento anulado</b> el ' + esc(S.fmtDate(S.isoOf(d.annulledAt))) + (d.annulReason ? '. Motivo: ' + esc(d.annulReason) : '') + '. Queda registrado en el historial.</span></p>'
      : key === 'vencida'
        ? '<p class="rx-sheet-band" role="note">' + icon('vencida', 16) + '<span><b>Vencida</b> el ' + esc(S.fmtDate(expires)) + '. Para continuar, consultá con tu profesional.</span></p>'
        : '';

    return '<article class="rx-sheet' + (isDraft ? ' is-draft' : '') + (key === 'anulada' ? ' is-annulled' : '') + '" aria-label="' + esc(title + (d.number ? ' ' + d.number : ' en borrador')) + '">'
      + '<header class="rx-sheet-head"><div><p class="rx-sheet-inst">' + esc(S.INSTITUTION.name) + '</p><p class="rx-sheet-site">' + esc(S.INSTITUTION.site) + '</p></div>'
      + '<div class="rx-sheet-id"><span>N.º</span><b class="num">' + (d.number ? esc(d.number) : 'Se asigna al emitir') + '</b></div></header>'
      + '<div class="rx-sheet-titlebar"><h3 class="rx-sheet-title">' + esc(title) + '</h3>' + statusTag(d, audience) + '</div>'
      + annulled
      + '<dl class="rx-sheet-meta">'
      + '<div class="rx-sheet-meta-p"><dt>Paciente</dt><dd>' + esc(p.name) + '<small class="num">DNI ' + esc(p.dni) + (coverage ? ' · ' + esc(coverage) : '') + '</small></dd></div>'
      + '<div><dt>Fecha</dt><dd class="num">' + esc(S.fmtDate(dateISO)) + '</dd></div>'
      + '<div><dt>Vigencia</dt><dd class="num">hasta ' + esc(S.fmtDate(expires)) + '</dd></div>'
      + '</dl>'
      + '<section class="rx-sheet-body">' + body + '</section>'
      + '<footer class="rx-sheet-foot"><div class="rx-sheet-sign"><b>' + esc(pro ? pro.name : '') + '</b><span>' + esc(pro ? pro.specialty + ' · ' + pro.license : '') + '</span><span class="rx-sheet-nosign">Sin firma digital · demostración</span></div>'
      + (isDraft
        ? '<div class="rx-sheet-code rx-sheet-code--pending"><span>El código se genera al emitir</span></div>'
        : '<figure class="rx-sheet-code">' + S.demoCodeSVG(d.number || d.id, 64) + '<figcaption>Código de demostración</figcaption></figure>')
      + '</footer>'
      + '<p class="rx-sheet-demo">Documento de demostración. No tiene validez para dispensa ni para realizar prestaciones.</p>'
      + '</article>';
  }

  // Versión descargable: HTML autocontenido, marcado como demostración
  function downloadHTML(d, audience) {
    const css = '*{box-sizing:border-box}body{margin:0;padding:32px;background:#F7F9FC;font-family:Inter,system-ui,sans-serif;color:#172033}'
      + '.rx-sheet{max-width:640px;margin:0 auto;background:#fff;border:1px solid #DCE4EC;border-radius:12px;padding:28px}'
      + '.rx-sheet-head,.rx-sheet-titlebar,.rx-sheet-foot{display:flex;justify-content:space-between;gap:16px;align-items:flex-start}'
      + '.rx-sheet-inst{font-weight:700;margin:0}.rx-sheet-site,.rx-sheet-sub,small{color:#657184;font-size:13px;margin:0}'
      + '.rx-sheet-id{text-align:right;font-size:13px}.rx-sheet-id span{display:block;color:#657184}.rx-sheet-titlebar{border-top:2px solid #102A43;margin-top:16px;padding-top:12px}'
      + '.rx-sheet-title{margin:0;font-size:20px;color:#102A43}.rx-state{display:inline-flex;gap:6px;align-items:center;font-size:13px;font-weight:600}'
      + '.rx-sheet-meta{display:grid;grid-template-columns:2fr 1fr 1fr;gap:12px;border-block:1px solid #DCE4EC;padding:12px 0;margin:16px 0}.rx-sheet-meta dt{font-size:12px;color:#657184}.rx-sheet-meta dd{margin:0;font-weight:600}.rx-sheet-meta small{display:block;font-weight:400}'
      + '.rx-sheet-label{font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#657184;margin:16px 0 4px}.rx-sheet-main{font-size:18px;font-weight:700;margin:0}.rx-sheet-text{margin:0}'
      + '.rx-sheet-foot{border-top:1px solid #DCE4EC;margin-top:20px;padding-top:16px;align-items:flex-end}.rx-sheet-sign span{display:block;font-size:13px;color:#657184}.rx-sheet-code{margin:0;text-align:center;font-size:11px;color:#657184}.rx-sheet-code svg{color:#102A43}'
      + '.rx-sheet-band{display:flex;gap:8px;padding:10px 12px;background:#F1F5F9;border-radius:8px;font-size:14px}.rx-sheet-demo{margin:16px 0 0;font-size:12px;color:#657184;text-align:center}';
    const html = '<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><title>' + esc(S.kindLabel(d) + ' ' + (d.number || '')) + ' · DEMO</title><style>' + css + '</style></head><body>'
      + render(d, { audience: audience || 'patient' }) + '</body></html>';
    const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = (d.kind === 'receta' ? 'prescripcion-' : 'orden-') + (d.number || 'borrador').toLowerCase() + '-demo.html';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // Compartir: nunca incluye el contenido médico, solo el aviso y el número de demostración
  async function share(d) {
    const text = S.kindLabel(d) + ' ' + (d.number || '') + ' disponible en el Portal del Paciente de ' + S.INSTITUTION.name + '. Documento de demostración.';
    try {
      if (navigator.share) { await navigator.share({ title: S.kindLabel(d), text }); return 'shared'; }
    } catch (err) { if (err && err.name === 'AbortError') return 'aborted'; }
    try { await navigator.clipboard.writeText(text); return 'copied'; } catch (_) { return 'unavailable'; }
  }

  global.RxSheet = { render, statusTag, icon, esc, downloadHTML, share };
})(window);
