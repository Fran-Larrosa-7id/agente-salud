/* Portal de Pacientes — ingreso y recuperación de contraseña. */
(function () {
  const P = window.P;
  const ic = P.icon;
  const rec = (P.ui.rec = { step: 'dni', dni: '' });

  const art =
    '<div class="auth-art" aria-hidden="true">' +
    '<div class="aa-sources">' +
    [['HC', 'navy', 'Hospital Central', 'Medicación'], ['LC', 'indigo', 'Laboratorio Central', 'Hemograma'], ['CI', 'sky', 'Centro de Imágenes', 'Radiografía']].map((x, i) =>
      '<div class="aa-chip" style="--i:' + i + '"><span class="mono mono-md t-' + x[1] + '">' + x[0] + '</span><span><b>' + x[2] + '</b><span>' + x[3] + '</span></span></div>'
    ).join('') + '</div>' +
    '<div class="aa-card"><div class="aa-card-head">' + P.logo(28) + '<span>Tu historial</span></div>' +
    ['Alergias', 'Medicación', 'Estudios', 'Documentos'].map((t, i) => '<div class="aa-row" style="--i:' + i + '"><span class="aa-check">' + ic('check', 14) + '</span>' + t + '</div>').join('') +
    '</div></div>';

  function layout(inner) {
    return (
      '<div class="auth">' +
      '<section class="auth-brand">' +
      '<div class="auth-logo">' + P.logo(40) + '<span><span class="brand-name">Portal de Pacientes</span><span class="brand-sub">Vertical Salud</span></span></div>' +
      '<div class="auth-pitch"><h2 class="auth-h">Toda tu salud, en un solo lugar.</h2>' +
      '<p>Estudios, medicación, alergias y documentos de las instituciones donde te atendés, organizados para vos y con el origen de cada dato.</p></div>' +
      art +
      '<p class="auth-trust">' + ic('shield', 18) + 'Tus datos están protegidos. Vos decidís qué compartir.</p>' +
      '</section>' +
      '<main class="auth-main" id="main" tabindex="-1"><div class="auth-mobile-logo">' + P.logo(36) + '<span class="brand-name">Portal de Pacientes</span></div>' +
      '<div class="auth-card">' + inner + '</div>' +
      '<footer class="auth-foot">Una solución de 7Ideas · Vertical Salud</footer></main></div>'
    );
  }

  P.renderLogin = function () {
    document.title = 'Ingresar · Portal de Pacientes';
    return layout(
      '<h1 class="auth-title" tabindex="-1">Ingresar</h1>' +
      '<p class="muted">Usá tu DNI y la contraseña del portal.</p>' +
      '<div class="alert alert-error" id="login-alert" role="alert" hidden></div>' +
      '<form id="login-form" class="auth-form" novalidate>' +
      '<div class="field"><label for="dni">DNI</label>' +
      '<input class="input input-lg num" id="dni" name="dni" inputmode="numeric" autocomplete="username" value="' + P.PATIENT.dniFmt + '" aria-describedby="dni-e">' +
      '<p class="field-error" id="dni-e" hidden></p></div>' +
      '<div class="field"><div class="field-top"><label for="pass">Contraseña</label><a class="link link-sm" href="#/recuperar">Olvidé mi contraseña</a></div>' +
      '<div class="pass-wrap"><input class="input input-lg" id="pass" name="pass" type="password" autocomplete="current-password" value="demo1234" aria-describedby="pass-e caps">' +
      '<button type="button" class="pass-toggle" data-action="toggle-pass" aria-label="Mostrar contraseña" aria-pressed="false">' + ic('eye', 20) + '</button></div>' +
      '<p class="field-hint" id="caps" hidden>' + ic('info', 16) + 'Bloq Mayús está activado.</p>' +
      '<p class="field-error" id="pass-e" hidden></p></div>' +
      '<button class="btn btn-primary btn-lg btn-block" type="submit">Ingresar</button>' +
      '</form>' +
      '<p class="auth-note">' + ic('info', 16) + '<span>Demo: DNI <b class="num">32.456.789</b> y cualquier contraseña.</span></p>' +
      '<p class="auth-first">¿Primera vez? Tu institución de salud te envía la invitación por email para crear tu cuenta.</p>'
    );
  };

  P.mountLogin = function () {
    const f = document.getElementById('login-form');
    const dni = f.querySelector('#dni');
    const pass = f.querySelector('#pass');
    dni.addEventListener('input', () => { dni.value = P.fmtDni(dni.value); clearErr(dni); });
    pass.addEventListener('input', () => clearErr(pass));
    pass.addEventListener('keyup', (e) => { if (e.getModifierState) document.getElementById('caps').hidden = !e.getModifierState('CapsLock'); });
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const alert = document.getElementById('login-alert');
      alert.hidden = true;
      const digits = dni.value.replace(/\D/g, '');
      let bad = false;
      if (digits.length < 7) { setErr(dni, 'Revisá tu DNI: debe tener 7 u 8 números.'); bad = true; }
      if (!pass.value) { setErr(pass, 'Ingresá tu contraseña.'); bad = true; }
      if (bad) { f.querySelector('[aria-invalid="true"]').focus(); return; }
      const done = P.busy(f.querySelector('[type="submit"]'), 'Ingresando…');
      await P.wait(800);
      if (digits !== P.PATIENT.dni) {
        done();
        alert.hidden = false;
        alert.innerHTML = ic('alert', 20) + '<span>No encontramos una cuenta con ese DNI y contraseña. Revisá los datos o <a class="link" href="#/recuperar">recuperá tu contraseña</a>.</span>';
        alert.focus && alert.setAttribute('tabindex', '-1');
        alert.focus();
        return;
      }
      P.db.session = { since: P.toISO(P.TODAY) };
      P.save();
      P.ui.fresh = true;
      location.hash = '#/inicio';
    });
  };

  function setErr(input, msg) {
    const e = document.getElementById(input.id + '-e');
    input.setAttribute('aria-invalid', 'true');
    e.hidden = false;
    e.innerHTML = ic('alert', 16) + msg;
  }
  function clearErr(input) {
    input.removeAttribute('aria-invalid');
    const e = document.getElementById(input.id + '-e');
    if (e) e.hidden = true;
  }

  P.actions['toggle-pass'] = (el) => {
    const input = el.parentElement.querySelector('input');
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    el.setAttribute('aria-pressed', show);
    el.setAttribute('aria-label', show ? 'Ocultar contraseña' : 'Mostrar contraseña');
    el.innerHTML = ic(show ? 'eye-off' : 'eye', 20);
  };

  /* ---------- Recuperar contraseña ---------- */
  P.renderRecover = function () {
    document.title = 'Recuperar contraseña · Portal de Pacientes';
    const back = '<a class="back-link" href="#/login">' + ic('arrow-left', 18) + 'Volver a ingresar</a>';
    let inner = '';
    if (rec.step === 'dni') {
      inner =
        back + '<h1 class="auth-title" tabindex="-1">Recuperar contraseña</h1>' +
        '<p class="muted">Ingresá tu DNI y te enviamos un enlace al email registrado para crear una contraseña nueva.</p>' +
        '<form id="rec-form" class="auth-form" novalidate><div class="field"><label for="rdni">DNI</label>' +
        '<input class="input input-lg num" id="rdni" inputmode="numeric" autocomplete="username" value="' + P.esc(rec.dni) + '" autofocus aria-describedby="rdni-e">' +
        '<p class="field-error" id="rdni-e" hidden></p></div>' +
        '<button class="btn btn-primary btn-lg btn-block" type="submit">Enviar enlace</button></form>';
    } else if (rec.step === 'sent') {
      inner =
        back + '<div class="auth-icon" aria-hidden="true">' + ic('mail', 28) + '</div>' +
        '<h1 class="auth-title" tabindex="-1">Revisá tu email</h1>' +
        '<p class="muted">Si el DNI está registrado, enviamos un enlace a <b>m••••••••@ejemplo.com</b>. Vence en 30 minutos.</p>' +
        '<ul class="tips"><li>Puede tardar unos minutos en llegar.</li><li>Revisá también la carpeta de spam o correo no deseado.</li></ul>' +
        '<div class="btn-col"><button class="btn btn-primary btn-lg btn-block" type="button" data-action="rec-open">Abrir el enlace (demo)</button>' +
        '<button class="btn btn-ghost btn-block" type="button" data-action="rec-resend" id="resend">Reenviar email</button></div>';
    } else if (rec.step === 'reset') {
      inner =
        '<h1 class="auth-title" tabindex="-1">Creá una contraseña nueva</h1>' +
        '<p class="muted">Para <b>María González</b> · DNI <span class="num">' + P.PATIENT.dniFmt + '</span></p>' +
        '<form id="reset-form" class="auth-form" novalidate>' +
        '<div class="field"><label for="np">Nueva contraseña</label><input class="input input-lg" id="np" type="password" autocomplete="new-password" autofocus aria-describedby="np-h np-e">' +
        '<div class="meter" aria-hidden="true"><span id="meter-bar"></span></div><p class="field-hint" id="np-h">Al menos 8 caracteres. Combiná letras y números.</p><p class="field-error" id="np-e" hidden></p></div>' +
        '<div class="field"><label for="nr">Repetí la contraseña</label><input class="input input-lg" id="nr" type="password" autocomplete="new-password" aria-describedby="nr-e"><p class="field-error" id="nr-e" hidden></p></div>' +
        '<button class="btn btn-primary btn-lg btn-block" type="submit">Guardar contraseña</button></form>';
    } else {
      inner =
        '<div class="auth-icon auth-icon-ok" aria-hidden="true">' + ic('check', 28) + '</div>' +
        '<h1 class="auth-title" tabindex="-1">Contraseña actualizada</h1>' +
        '<p class="muted">Ya podés ingresar con tu nueva contraseña. Por seguridad, cerramos las sesiones abiertas en otros dispositivos.</p>' +
        '<a class="btn btn-primary btn-lg btn-block mt-6" href="#/login">Ir a ingresar</a>';
    }
    return layout(inner);
  };

  P.mountRecover = function () {
    const f = document.getElementById('rec-form');
    if (f) {
      const input = f.querySelector('#rdni');
      input.addEventListener('input', () => { input.value = P.fmtDni(input.value); clearErr(input); });
      f.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (input.value.replace(/\D/g, '').length < 7) { setErr(input, 'Revisá tu DNI: debe tener 7 u 8 números.'); input.focus(); return; }
        const done = P.busy(f.querySelector('[type="submit"]'), 'Enviando…');
        await P.wait(800);
        done();
        rec.dni = input.value;
        rec.step = 'sent';
        P.route();
      });
    }
    const r = document.getElementById('reset-form');
    if (r) {
      const np = r.querySelector('#np'), nr = r.querySelector('#nr');
      np.addEventListener('input', () => {
        clearErr(np);
        const v = np.value;
        const score = (v.length >= 8) + /\d/.test(v) + /[A-Za-z]/.test(v) + (v.length >= 12);
        const bar = document.getElementById('meter-bar');
        bar.style.transform = 'scaleX(' + score / 4 + ')';
        bar.dataset.level = score;
      });
      nr.addEventListener('input', () => clearErr(nr));
      r.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (np.value.length < 8) { setErr(np, 'La contraseña debe tener al menos 8 caracteres.'); np.focus(); return; }
        if (np.value !== nr.value) { setErr(nr, 'Las contraseñas no coinciden.'); nr.focus(); return; }
        const done = P.busy(r.querySelector('[type="submit"]'), 'Guardando…');
        await P.wait(800);
        done();
        P.db.passwordChanged = P.TODAY_ISO;
        P.save();
        rec.step = 'done';
        P.route();
      });
    }
  };

  P.actions['rec-open'] = () => { rec.step = 'reset'; P.route(); };
  P.actions['rec-resend'] = (el) => {
    P.toast('Te enviamos otro email.', { icon: 'mail' });
    let n = 30;
    el.disabled = true;
    const tick = () => {
      if (!document.contains(el)) return;
      if (n <= 0) { el.disabled = false; el.textContent = 'Reenviar email'; return; }
      el.textContent = 'Podés reenviar en ' + n-- + ' s';
      setTimeout(tick, 1000);
    };
    tick();
  };
  P.resetRecover = () => { rec.step = 'dni'; };
})();
