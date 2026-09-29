/**
 * Colector que corre DENTRO de la página del laboratorio (vía frame.evaluate).
 *
 * Se mantiene como texto (no como función) para que el transpilador no le inyecte helpers
 * y para que quede claro exactamente qué se ejecuta en el sitio externo. Es de solo lectura:
 * lo único que modifica es un atributo data-pp-id para poder volver a encontrar cada elemento.
 *
 * Nunca lee el valor de campos de texto ni de contraseña.
 */
export const COLLECTOR_SOURCE = String.raw`(function (args) {
  var FRAME = args.frame;
  var HINTS = args.hints || [];
  var MAX_EL = 160;
  var DATE = /\b\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}\b/;
  function norm(s) { return String(s || '').replace(/\s+/g, ' ').trim(); }
  function fold(s) { return norm(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase(); }
  function visible(el) {
    if (!el || !el.getClientRects || !el.getClientRects().length) return false;
    var cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none' && parseFloat(cs.opacity || '1') > 0.02;
  }
  if (typeof window.__ppSeq !== 'number') window.__ppSeq = 0;
  function pid(el) {
    var v = el.getAttribute('data-pp-id');
    if (!v) { v = 'f' + FRAME + '-' + (++window.__ppSeq); el.setAttribute('data-pp-id', v); }
    return v;
  }
  function textOf(el) { return norm(el.innerText || el.textContent || '').slice(0, 160); }
  function labelOf(el) {
    var a = el.getAttribute('aria-label'); if (a && norm(a)) return norm(a);
    var lb = el.getAttribute('aria-labelledby');
    if (lb) {
      var t = lb.split(/\s+/).map(function (i) { var n = document.getElementById(i); return n ? textOf(n) : ''; }).join(' ');
      if (norm(t)) return norm(t);
    }
    var t2 = textOf(el); if (t2) return t2;
    if (el.tagName === 'INPUT' && /^(button|submit|reset)$/i.test(el.type || '')) return norm(el.value);
    if (el.tagName === 'INPUT' && el.type === 'image') return norm(el.alt || el.title || '');
    var ti = el.getAttribute('title'); if (ti && norm(ti)) return norm(ti);
    var img = el.querySelector('img[alt]'); if (img && norm(img.alt)) return norm(img.alt);
    return '';
  }
  function iconHint(el) {
    var s = String(el.getAttribute('class') || '') + ' ' + String(el.getAttribute('onclick') || '') + ' ' +
      String(el.getAttribute('ng-click') || '') + ' ' + String(el.getAttribute('href') || '').slice(0, 200);
    var inner = el.querySelectorAll('i,span,img,svg,use');
    for (var i = 0; i < inner.length && i < 6; i++) {
      s += ' ' + (inner[i].getAttribute('class') || '') + ' ' + (inner[i].getAttribute('src') || '') + ' ' + (inner[i].getAttribute('href') || '');
    }
    var m = s.toLowerCase().match(/pdf|print|imprim|download|descarg|eye|search|file|detalle|result|informe/g);
    if (!m) return '';
    var uniq = [];
    m.forEach(function (x) { if (uniq.indexOf(x) < 0) uniq.push(x); });
    return uniq.join(' ');
  }

  /* ---------- Colecciones: tablas, grillas ARIA y listas repetidas ---------- */
  var collections = [];
  var rowOf = new Map();
  function addCollection(kind, headers, rowEls, cellsOf) {
    if (!rowEls.length || collections.length >= 6) return;
    var id = 'c' + FRAME + '-' + collections.length;
    collections.push({
      id: id, frame: FRAME, kind: kind,
      headers: headers.map(function (h) { return h.slice(0, 60); }),
      rows: rowEls.slice(0, 60).map(function (r) { return cellsOf(r).map(function (c) { return c.slice(0, 120); }); }),
      rowCount: rowEls.length
    });
    rowEls.forEach(function (r, i) { rowOf.set(r, { c: id, r: i }); });
  }

  Array.prototype.slice.call(document.querySelectorAll('table')).forEach(function (t) {
    if (!visible(t) || t.querySelector('table')) return;
    var trs = Array.prototype.slice.call(t.querySelectorAll('tr'));
    var headRow = t.querySelector('thead tr') || trs.filter(function (tr) { return tr.querySelector('th') && !tr.querySelector('td'); })[0];
    var headers = headRow ? Array.prototype.slice.call(headRow.children).map(textOf) : [];
    var data = trs.filter(function (tr) { return tr !== headRow && tr.querySelector('td') && visible(tr); });
    if (!data.length) return;
    var maxCols = 0;
    data.forEach(function (tr) { if (tr.children.length > maxCols) maxCols = tr.children.length; });
    if (maxCols < 2 && headers.length < 2) return;
    addCollection('table', headers, data, function (tr) { return Array.prototype.slice.call(tr.children).map(textOf); });
  });

  Array.prototype.slice.call(document.querySelectorAll('[role=table],[role=grid],[role=treegrid]')).forEach(function (g) {
    if (!visible(g) || g.tagName === 'TABLE') return;
    var rows = Array.prototype.slice.call(g.querySelectorAll('[role=row]')).filter(visible);
    var head = rows.filter(function (r) { return r.querySelector('[role=columnheader]'); })[0];
    var headers = head ? Array.prototype.slice.call(head.querySelectorAll('[role=columnheader]')).map(textOf) : [];
    var data = rows.filter(function (r) { return r !== head && r.querySelector('[role=cell],[role=gridcell]'); });
    addCollection('grid', headers, data, function (r) {
      return Array.prototype.slice.call(r.querySelectorAll('[role=cell],[role=gridcell]')).map(textOf);
    });
  });

  if (!collections.length) {
    var accepted = [];
    var parents = Array.prototype.slice.call(document.querySelectorAll('ul,ol,div,section,main'));
    parents.reverse().forEach(function (p) {
      if (collections.length >= 6 || !visible(p)) return;
      if (accepted.some(function (a) { return p.contains(a); })) return;
      var kids = Array.prototype.slice.call(p.children).filter(visible);
      var groups = {};
      kids.forEach(function (k) { var key = k.tagName + '.' + (k.getAttribute('class') || ''); (groups[key] = groups[key] || []).push(k); });
      Object.keys(groups).forEach(function (key) {
        var g = groups[key];
        var dated = g.filter(function (k) {
          var t = textOf(k);
          return DATE.test(t) && t.length < 400 && k.querySelector('a,button,[onclick],[role=button]');
        });
        if (dated.length && dated.length >= Math.ceil(g.length * 0.8)) {
          accepted.push(p);
          addCollection('list', [], dated, function (k) {
            return Array.prototype.slice.call(k.querySelectorAll('*'))
              .filter(function (e) { return e.children.length === 0 && norm(e.textContent); })
              .slice(0, 10).map(textOf);
          });
        }
      });
    });
  }

  function membership(el) {
    var n = el;
    while (n && n !== document.body) {
      var m = rowOf.get(n);
      if (m) return m;
      n = n.parentElement;
    }
    return null;
  }

  /* ---------- Elementos interactivos ---------- */
  var SEL = 'a[href],button,input[type=button],input[type=submit],input[type=image],[role=button],[role=link],[role=menuitem],[role=tab],[onclick],[ng-click],summary';
  var all = Array.prototype.slice.call(document.querySelectorAll(SEL)).filter(visible);
  var set = new Set(all);
  var elements = [];
  all.forEach(function (el) {
    if (elements.length >= MAX_EL) return;
    var up = el.parentElement && el.parentElement.closest(SEL);
    if (up && set.has(up)) return;
    var mem = membership(el);
    var form = el.closest('form');
    var tag = el.tagName.toLowerCase();
    var type = String(el.getAttribute('type') || '').toLowerCase();
    elements.push({
      id: pid(el), frame: FRAME, tag: tag,
      role: el.getAttribute('role') || (tag === 'a' ? 'link' : 'button'),
      label: labelOf(el).slice(0, 120),
      iconHint: iconHint(el),
      href: tag === 'a' ? String(el.href || '') : '',
      target: String(el.getAttribute('target') || ''),
      type: type,
      disabled: !!el.disabled || el.getAttribute('aria-disabled') === 'true',
      collection: mem ? mem.c : undefined,
      row: mem ? mem.r : undefined,
      inPasswordForm: !!(form && form.querySelector('input[type=password]')),
      isSubmit: type === 'submit' || (tag === 'button' && !type && !!form)
    });
  });

  /* ---------- Señales ---------- */
  var bodyText = fold(document.body ? document.body.innerText : '');
  var hintHits = HINTS.filter(function (h) { return bodyText.indexOf(fold(h)) >= 0; });
  var pw = Array.prototype.slice.call(document.querySelectorAll('input[type=password]')).some(visible);
  var captchaEl = document.querySelector('iframe[src*="recaptcha"],iframe[src*="hcaptcha"],iframe[src*="turnstile"],.g-recaptcha,.h-captcha,.cf-turnstile,img[src*="captcha" i],[id*="captcha" i],[class*="captcha" i]');
  var captcha = !!(captchaEl && visible(captchaEl)) || /NO SOY UN ROBOT|VERIFICA QUE ERES HUMANO|CAPTCHA/.test(bodyText);
  function inputEvidence(el) {
    var attrs = [el.getAttribute('aria-label'), el.getAttribute('placeholder'), el.getAttribute('name'), el.id, el.getAttribute('autocomplete')].join(' ');
    var label = el.id ? document.querySelector('label[for="' + CSS.escape(el.id) + '"]') : null;
    if (label) attrs += ' ' + textOf(label);
    if (el.closest('label')) attrs += ' ' + textOf(el.closest('label'));
    return /\b(OTP|CODIGO|CÓDIGO|VERIFICACION|VERIFICATION|TOKEN|SEGUNDO FACTOR|ONE.TIME.CODE)\b/i.test(attrs);
  }
  var otpInput = Array.prototype.slice.call(document.querySelectorAll('input[autocomplete="one-time-code"]')).some(visible);
  var labeledCodeInput = Array.prototype.slice.call(document.querySelectorAll('input[type=text],input[type=tel],input[type=number],input:not([type])'))
    .some(function (el) { return visible(el) && inputEvidence(el); });
  var explicitOtpCopy = /(?:INGRESA|INTRODUCE|ESCRIBE|INGRESE|INTRODUZCA|ENTER|PROVIDE) (?:EL |TU |THE )?(?:CODIGO|TOKEN|OTP)|(?:CODIGO|TOKEN|OTP) (?:DE VERIFICACION|DE SEGURIDAD|QUE (?:TE )?ENVIAMOS|REQUERIDO|DE UN SOLO USO)|(?:AUTENTICACION|VERIFICACION) (?:DE )?DOS FACTORES (?:REQUERIDA|NECESARIA)|SEGUNDO FACTOR (?:REQUERIDO|NECESARIO)/.test(bodyText);
  var otp = otpInput || labeledCodeInput || explicitOtpCopy;
  var modalEl = Array.prototype.slice.call(document.querySelectorAll('[role=dialog],[role=alertdialog],[aria-modal=true],.modal.in,.modal.show,.swal2-popup,.ui-dialog,.bootbox')).filter(visible)[0];
  var embeds = Array.prototype.slice.call(document.querySelectorAll('embed,object,iframe')).filter(function (e) {
    var src = String(e.getAttribute('src') || e.getAttribute('data') || '');
    var type = String(e.getAttribute('type') || '');
    return /pdf/i.test(type) || /\.pdf(\b|$)|pdf/i.test(src);
  }).map(function (e) {
    var src = e.getAttribute('src') || e.getAttribute('data') || '';
    try { return new URL(src, location.href).href; } catch (err) { return ''; }
  }).filter(Boolean);
  var headings = Array.prototype.slice.call(document.querySelectorAll('h1,h2,h3,h4,legend,caption,[role=heading],.navbar-brand,.panel-title,.card-title'))
    .filter(visible).map(textOf).filter(Boolean).slice(0, 15);

  return {
    url: location.href,
    title: document.title || '',
    headings: headings,
    hintHits: hintHits,
    hasPasswordField: pw,
    captcha: captcha,
    otp: otp,
    modal: !!modalEl,
    modalText: modalEl ? textOf(modalEl) : '',
    noResultsText: /NO (SE ENCONTRARON|HAY|EXISTEN|TIENE) (RESULTADOS|ESTUDIOS|PROTOCOLOS|REGISTROS|DATOS)|SIN RESULTADOS/.test(bodyText),
    isPdfViewer: document.contentType === 'application/pdf',
    pdfEmbeds: embeds,
    elements: elements,
    collections: collections
  };
})`;
