/* Portal de Pacientes — compartir un estudio con un acceso temporal. */
(function () {
  const P = window.P;
  const ic = P.icon;
  const DURATIONS = [
    { id: '24h', label: '24 horas', hours: 24 },
    { id: '7d', label: '7 días', hours: 24 * 7 },
    { id: '30d', label: '30 días', hours: 24 * 30 },
  ];

  const code = () => {
    const c = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const pick = () => c[Math.floor(Math.random() * c.length)];
    return pick() + pick() + pick() + '-' + pick() + pick() + pick();
  };
  const expiry = (hours) => new Date(P.TODAY.getTime() + hours * 3600000);

  P.openShare = function (studyId) {
    const s = P.study(studyId);
    if (!s) return;
    const inst = P.inst(s.inst);
    const st = { estudio: true, documento: true, duration: '7d', recipient: '' };

    const h = P.overlay({ kind: 'drawer', title: 'Compartir estudio', className: 'ov-share' });

    function form() {
      h.setTitle('Compartir estudio');
      h.setBody(
        '<form id="share-form" class="share-form" novalidate>' +
        '<div class="share-study">' + P.typeTile(s.type) + '<div><p class="share-name">' + P.esc(s.name) + '</p><p class="muted"><span class="num">' + P.fmt(s.date) + '</span> · ' + inst.name + '</p></div></div>' +
        '<fieldset class="fs"><legend class="fs-l">¿Qué querés compartir?</legend>' +
        checkCard('estudio', 'Este estudio', s.results ? 'Resultados y datos del estudio' : 'Datos del estudio') +
        checkCard('documento', 'Documento original', 'PDF emitido por ' + inst.name) +
        '<p class="field-error" id="sh-err" hidden>' + ic('alert', 16) + 'Elegí al menos una opción para compartir.</p>' +
        '</fieldset>' +
        '<fieldset class="fs"><legend class="fs-l">¿Durante cuánto tiempo?</legend><div class="dur-grid">' +
        DURATIONS.map((d) =>
          '<label class="dur"><input type="radio" name="dur" value="' + d.id + '"' + (st.duration === d.id ? ' checked' : '') + '>' +
          '<span class="dur-box"><span class="dur-l">' + d.label + '</span><span class="dur-s">Vence el <span class="num">' + P.fmt(P.toISO(expiry(d.hours))) + '</span></span></span></label>'
        ).join('') + '</div></fieldset>' +
        '<div class="field"><label for="sh-to">¿Para quién es? <span class="optional">(opcional)</span></label>' +
        '<input class="input" id="sh-to" placeholder="Por ejemplo: Dra. Pereyra" value="' + P.esc(st.recipient) + '" autocomplete="off" aria-describedby="sh-to-h">' +
        '<p class="field-hint" id="sh-to-h">Solo para que lo reconozcas en tu lista de accesos.</p></div>' +
        '<p class="share-assure">' + ic('shield', 20) + '<span>Quien tenga el enlace verá solo lo que elegiste, hasta la fecha de vencimiento. Podés revocarlo cuando quieras.</span></p>' +
        '</form>'
      );
      h.setFoot('<button class="btn btn-secondary" type="button" data-ov-close>Cancelar</button><button class="btn btn-accent" type="submit" form="share-form">' + ic('link', 18) + 'Crear acceso seguro</button>');

      const f = h.el.querySelector('#share-form');
      f.addEventListener('change', (e) => {
        if (e.target.name === 'dur') st.duration = e.target.value;
        if (e.target.name === 'inc') { st[e.target.value] = e.target.checked; h.el.querySelector('#sh-err').hidden = true; }
      });
      f.addEventListener('submit', async (e) => {
        e.preventDefault();
        st.recipient = h.el.querySelector('#sh-to').value.trim();
        if (!st.estudio && !st.documento) { h.el.querySelector('#sh-err').hidden = false; return; }
        const done = P.busy(h.el.querySelector('[form="share-form"]'), 'Creando acceso…');
        await P.wait(900);
        done();
        const d = DURATIONS.find((x) => x.id === st.duration);
        const sh = {
          id: 'sh-' + Date.now(),
          studyId: s.id,
          recipient: st.recipient,
          includes: ['estudio', 'documento'].filter((k) => st[k]),
          created: P.toISO(P.TODAY),
          expires: P.toISO(expiry(d.hours)),
          code: code(),
        };
        P.db.shares.unshift(sh);
        P.db.activity.unshift({ at: sh.created, text: 'Compartiste un estudio', sub: s.name + (sh.recipient ? ' · ' + sh.recipient : '') });
        P.save();
        result(sh, d);
      });
    }

    function checkCard(value, title, sub) {
      return '<label class="check-card"><input type="checkbox" name="inc" value="' + value + '"' + (st[value] ? ' checked' : '') + '>' +
        '<span class="cbox" aria-hidden="true">' + ic('check', 16) + '</span><span><span class="check-t">' + title + '</span><span class="check-s">' + sub + '</span></span></label>';
    }

    function result(sh, d) {
      const url = 'portaldepacientes.ejemplo/c/' + sh.code;
      h.setTitle('Acceso creado');
      h.setBody(
        '<div class="share-done">' +
        '<div class="done-mark" aria-hidden="true"><svg viewBox="0 0 52 52"><circle cx="26" cy="26" r="24"/><path d="M15 27l7 7 15-16"/></svg></div>' +
        '<h3 class="share-done-t">Tu acceso seguro está listo</h3>' +
        '<p class="muted">Compartí este enlace' + (sh.recipient ? ' con ' + P.esc(sh.recipient) : '') + '. Funciona hasta la fecha de vencimiento.</p>' +
        '<div class="link-box"><span class="link-url">' + ic('link', 18) + '<span class="num">' + url + '</span></span>' +
        '<button type="button" class="btn btn-primary btn-sm" data-copy>' + ic('copy', 16) + '<span>Copiar</span></button></div>' +
        '<dl class="rows rows-tight">' +
        '<div class="row"><dt>Incluye</dt><dd>' + sh.includes.map((k) => (k === 'estudio' ? 'El estudio' : 'Documento original')).join(' y ') + '</dd></div>' +
        '<div class="row"><dt>Vence</dt><dd><span class="num">' + P.fmtDateTime(sh.expires) + '</span> <span class="muted">(en ' + d.label + ')</span></dd></div>' +
        (sh.recipient ? '<div class="row"><dt>Para</dt><dd>' + P.esc(sh.recipient) + '</dd></div>' : '') +
        '</dl>' +
        '<p class="share-assure">' + ic('info', 20) + '<span>Lo encontrás en <a class="link" href="#/perfil/privacidad" data-ov-close>Mi perfil → Privacidad</a>, donde podés revocarlo en cualquier momento.</span></p>' +
        '</div>'
      );
      h.setFoot('<button type="button" class="btn btn-danger-ghost" data-revoke>' + ic('ban', 18) + 'Revocar acceso</button><button type="button" class="btn btn-primary" data-ov-close>Listo</button>');
      h.body.querySelector('[data-copy]').addEventListener('click', (e) => {
        const b = e.currentTarget;
        try { navigator.clipboard && navigator.clipboard.writeText('https://' + url); } catch (err) { /* noop */ }
        b.innerHTML = ic('check', 16) + '<span>Copiado</span>';
        P.toast('Enlace copiado.', { icon: 'copy' });
        setTimeout(() => { if (document.contains(b)) b.innerHTML = ic('copy', 16) + '<span>Copiar</span>'; }, 2200);
      });
      h.foot.querySelector('[data-revoke]').addEventListener('click', async () => {
        const ok = await P.confirm({ title: '¿Revocar este acceso?', text: 'El enlace dejará de funcionar de inmediato.', confirmLabel: 'Revocar acceso', tone: 'danger' });
        if (!ok) return;
        sh.revoked = true;
        P.db.activity.unshift({ at: P.toISO(P.TODAY), text: 'Revocaste un acceso compartido', sub: sh.recipient || s.name });
        P.save();
        h.close();
        P.toast('Acceso revocado. El enlace ya no funciona.');
        P.rerender();
      });
      h.foot.querySelector('.btn-primary').focus();
    }

    form();
    const prevClose = h.close;
    h.close = function (r) { prevClose(r); if (location.hash.startsWith('#/estudios/') || location.hash.startsWith('#/perfil')) P.rerender(); };
  };
})();
