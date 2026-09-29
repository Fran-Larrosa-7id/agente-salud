/**
 * Extractor de solo lectura para el listado LabWin de Pérez Cambet.
 * Recorre acciones visibles y las asocia con su fila sin abrirla ni devolver el texto de la fila.
 */
export interface LabwinRawStudy {
  date?: string;
  deliveryDate?: string;
  status?: string;
  protocol?: string;
  href: string;
  rowToken: string;
  actionToken: string;
}

export interface LabwinExtraction {
  recognized: boolean;
  resultActions: number;
  resultLinks: number;
  candidateRows: number;
  metadataComplete: number;
  structure: { index: number; depth: number; tag: string; links: number; textNodes: number; siblings: number; classType: string; hrefMatch: boolean }[];
  rows: LabwinRawStudy[];
}

export const LABWIN_EXTRACTOR_SOURCE = String.raw`(function (args) {
  function norm(s) { return String(s || '').replace(/\s+/g, ' ').trim(); }
  function fold(s) { return norm(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase(); }
  function visible(el) {
    if (!el || !el.getClientRects || !el.getClientRects().length) return false;
    var cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none' && parseFloat(cs.opacity || '1') > 0.02;
  }
  function dateMatches(s) {
    return norm(s).match(/\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}|\d{4}-\d{2}-\d{2}/g) || [];
  }
  function statusLike(s) {
    return /^(finalizad[oa]s?|complet[oa]s?|parcial(?:es)?|pendientes?|entregad[oa]s?|en proceso|disponibles?|list[oa]s?|validada?|terminad[oa]s?|impres[oa]s?|enviad[oa]s?|en curso)$/i.test(norm(s));
  }
  function protocolLike(s) {
    return /^\s*[A-Z]{0,5}[-\s]?\d[\d\s./-]{2,31}\s*$/i.test(norm(s));
  }
  var body = fold(document.body ? document.body.innerText : '');
  var hasListMarker = body.includes('RESULTADOS ONLINE') || /\/lwcloud\/percamb\/rol/i.test(location.pathname);

  function hrefMatch(el) {
    var anchor = el && (el.tagName === 'A' ? el : el.closest && el.closest('a[href]'));
    return !!(anchor && /ver_resultado/i.test(anchor.getAttribute('href') || ''));
  }
  function sameOriginHref(anchor) {
    if (!anchor) return '';
    try {
      var u = new URL(anchor.href || anchor.getAttribute('href'), location.href);
      return u.origin === location.origin && /^https?:$/.test(u.protocol) && /ver_resultado/i.test(u.pathname) ? u.href : '';
    } catch (e) { return ''; }
  }
  var resultAnchors = Array.prototype.slice.call(document.querySelectorAll('a[href*="ver_resultado" i]')).filter(visible);
  resultAnchors = resultAnchors.filter(function (el, i, all) { return all.indexOf(el) === i; });

  var interactiveSelector = 'a[href],button,input[type=image],[role=button],[onclick],[ng-click],[data-action],[tabindex],[style*="cursor" i],[class*="eye" i],[class*="ojo" i],[class*="view" i],[aria-label],[title]';
  function attrText(el) {
    var out = [el.getAttribute('aria-label'), el.getAttribute('title'), el.getAttribute('class'), el.id,
      el.getAttribute('data-icon'), el.getAttribute('data-action'), el.getAttribute('role')];
    var children = el.querySelectorAll('svg,i,[class*="eye" i],[class*="ojo" i],[class*="view" i],[aria-label],[title],[data-icon],use');
    for (var i = 0; i < children.length && i < 24; i++) {
      var c = children[i];
      out.push(c.getAttribute('class'), c.id, c.getAttribute('aria-label'), c.getAttribute('title'),
        c.getAttribute('data-icon'), c.getAttribute('href'), c.getAttribute('xlink:href'));
    }
    return fold(out.filter(Boolean).join(' '));
  }
  function labelText(el) {
    var aria = norm(el.getAttribute('aria-label') || el.getAttribute('title') || '');
    if (aria) return aria;
    var t = norm(el.innerText || el.textContent || '');
    return t.length <= 64 ? t : '';
  }
  function clickable(el) {
    if (/^(A|BUTTON)$/.test(el.tagName) || el.tagName === 'INPUT') return true;
    if (el.matches('[role=button],[onclick],[ng-click],[data-action],[tabindex]')) return true;
    if (el.matches('[href]') && el.tagName !== 'USE') return true;
    try { if (getComputedStyle(el).cursor === 'pointer') return true; } catch (e) { /* detached element */ }
    return /(?:^|[\s_-])(?:btn|button|action|clickable|eye|ojo|view)(?:$|[\s_-])/i.test(String(el.className || ''));
  }
  function safeAction(el) {
    var label = fold(labelText(el));
    var attrs = attrText(el);
    if (/(ELIMINAR|BORRAR|CANCELAR|CAMBIAR|GUARDAR|ENVIAR|PAGAR|CERRAR SESION|ACEPTAR|CONFIRMAR)/.test(label)) return false;
    var eyeIcon = /(?:\bEYE\b|FA-EYE|ICON-EYE|\bOJO\b|VISIBILITY|ICON-VIEW|VIEW-ICON)/.test(attrs);
    var viewLabel = /^(VER|VER ESTUDIO|VER RESULTADO|CONSULTAR|DETALLE|INFORME|ABRIR|RESULTADO|RESULTADOS)$/.test(label);
    var routeHandler = Array.prototype.slice.call(el.attributes || []).some(function (a) {
      return /^(onclick|data-.*|ng-click)$/i.test(a.name) && /ver_resultado/i.test(a.value || '');
    });
    return clickable(el) && (eyeIcon || viewLabel || routeHandler);
  }
  var fallbackActions = Array.prototype.slice.call(document.querySelectorAll(interactiveSelector)).filter(visible).filter(safeAction).map(function (el) {
    if (!/^(SVG|USE|I|SPAN)$/.test(el.tagName)) return el;
    var parent = el.parentElement;
    for (var depth = 0; parent && depth < 5; depth++, parent = parent.parentElement) if (clickable(parent) && visible(parent)) return parent;
    return el;
  });
  fallbackActions = fallbackActions.filter(function (el, i, all) { return all.indexOf(el) === i; });
  // Si el ícono tiene su propio selector además del botón, conserva el control clickeable más externo.
  fallbackActions = fallbackActions.filter(function (el, i, all) {
    return !all.some(function (other, j) { return i !== j && el.contains(other) && clickable(other); });
  });
  var actions = resultAnchors.length ? resultAnchors : fallbackActions;
  if (!hasListMarker && !actions.length) return { recognized: false, resultActions: 0, resultLinks: 0, candidateRows: 0, metadataComplete: 0, structure: [], rows: [] };

  function rowHint(el) {
    if (/^(TR)$/.test(el.tagName) || el.getAttribute('role') === 'row') return true;
    var ident = fold(String(el.className || '') + ' ' + (el.id || '') + ' ' + (el.getAttribute('data-role') || ''));
    if (/(?:^|[ _-])(ACTION|BUTTON|EYE|ICON)(?:$|[ _-])/.test(ident)) return false;
    return /(?:^|[ _-])(ROW|ITEM|RECORD|RESULT|STUDY|PROTOCOL|FILA|ESTUDIO|PROTOCOLO)(?:$|[ _-])/.test(ident);
  }
  function linkCount(node) {
    var self = node.matches && node.matches('a[href*="ver_resultado" i]') && visible(node) ? 1 : 0;
    return self + Array.prototype.filter.call(node.querySelectorAll ? node.querySelectorAll('a[href*="ver_resultado" i]') : [], function (a) { return visible(a); }).length;
  }
  function textNodeCount(node) {
    var count = 0;
    var walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    while (walker.nextNode() && count < 999) if (norm(walker.currentNode.nodeValue)) count++;
    return count;
  }
  function classType(node) {
    var raw = node.className && typeof node.className === 'object' ? node.className.baseVal : node.className;
    var ident = fold(String(raw || '') + ' ' + (node.getAttribute('role') || ''));
    if (/(^|[ _-])(ROW|FILA|RECORD)([ _-]|$)/.test(ident)) return 'row';
    if (/(^|[ _-])(GRID|TABLE|TBODY|THEAD)([ _-]|$)/.test(ident)) return 'grid';
    if (/(^|[ _-])(LIST|LISTA)([ _-]|$)/.test(ident)) return 'list';
    if (/(^|[ _-])(ITEM|STUDY|ESTUDIO|RESULT)([ _-]|$)/.test(ident)) return 'item';
    if (/(^|[ _-])(CONTAINER|CONTENT|WRAPPER)([ _-]|$)/.test(ident)) return 'container';
    return 'other';
  }
  function hasMetadata(text) { return dateMatches(text).length > 0 || statusLike(text) || protocolLike(text); }
  var structure = [];
  function findRow(action, index, isResultLink) {
    var node = action;
    var fallback = null;
    var metadataRow = null;
    var semanticRow = null;
    for (var depth = 0; node && node !== document.body && depth < 6; depth++, node = node.parentElement) {
      if (!visible(node)) continue;
      var text = norm(node.innerText || node.textContent || '');
      var links = isResultLink ? linkCount(node) : 1;
      var textNodes = textNodeCount(node);
      structure.push({ index: index, depth: depth, tag: String(node.tagName || 'other').toUpperCase().slice(0, 12), links: links,
        textNodes: Math.min(textNodes, 999), siblings: node.parentElement ? node.parentElement.children.length : 0,
        classType: classType(node), hrefMatch: isResultLink });
      if (isResultLink && links !== 1) continue;
      if (text.length <= 1800) {
        if (!fallback) fallback = node;
        if (!metadataRow && hasMetadata(text)) metadataRow = node;
        if (!isResultLink && !semanticRow && rowHint(node)) semanticRow = node;
      }
    }
    return metadataRow || semanticRow || fallback || (isResultLink ? action : null);
  }
  function cellValues(row) {
    if (row.tagName === 'TR') return Array.prototype.slice.call(row.children).map(function (c) { return norm(c.innerText || c.textContent); });
    var cells = Array.prototype.slice.call(row.querySelectorAll('[role=cell],[role=gridcell],[data-label],[data-field],td,th'))
      .filter(function (el) { return visible(el); });
    if (cells.length) return cells.map(function (c) { return norm(c.innerText || c.textContent); });
    return Array.prototype.slice.call(row.children).map(function (c) { return norm(c.innerText || c.textContent); });
  }
  function headerValues(row) {
    if (row.tagName === 'TR') {
      var table = row.closest('table');
      var header = table && (table.querySelector('thead tr') || table.querySelector('tr th') && table.querySelector('tr'));
      if (header) return Array.prototype.slice.call(header.children).map(function (c) { return fold(c.innerText || c.textContent); });
    }
    return Array.prototype.slice.call(row.querySelectorAll('[data-label],[data-field],[aria-label]'))
      .filter(function (c) { return !c.matches('a,button,input,[role=button],[onclick],[ng-click]'); })
      .map(function (c) { return fold(c.getAttribute('data-label') || c.getAttribute('data-field') || c.getAttribute('aria-label') || ''); });
  }
  function field(values, headers, pattern) {
    for (var i = 0; i < values.length; i++) if (headers[i] && pattern.test(headers[i])) return values[i] || '';
    return '';
  }
  var rows = [];
  var candidateRows = 0;
  var metadataComplete = 0;
  actions.forEach(function (action, index) {
    var isResultLink = resultAnchors.length > 0;
    var anchor = action.tagName === 'A' ? action : action.closest('a[href]');
    var href = isResultLink ? sameOriginHref(anchor) : (anchor ? (function () { try { var u = new URL(anchor.href, location.href); return u.origin === location.origin && /^https?:$/.test(u.protocol) ? u.href : ''; } catch (e) { return ''; } })() : '');
    if (isResultLink && !href) return;
    var row = findRow(action, index, isResultLink);
    if (!row) return;
    candidateRows++;
    var values = cellValues(row);
    var headers = headerValues(row);
    var rowText = norm(row.innerText || row.textContent || '');
    var dates = dateMatches(rowText);
    var date = field(values, headers, /FECHA|INGRESO|RECEPCION|EXTRACCION|ATENCION/) || (!headers.length && dates.length === 1 ? dates[0] : '');
    var deliveryDate = field(values, headers, /ENTREGA|INFORME|DISPONIBLE/) || (!headers.length && dates.length === 2 ? dates[1] : '');
    if (!dateMatches(date).length) date = '';
    if (!dateMatches(deliveryDate).length) deliveryDate = '';
    var status = field(values, headers, /ESTADO|SITUACION|CONDICION/);
    if (!statusLike(status)) status = values.find(statusLike) || '';
    var protocol = field(values, headers, /PROTOCOLO|ORDEN|PEDIDO|NRO|NUMERO/);
    if (!protocolLike(protocol) && !headers.length) protocol = values.find(protocolLike) || '';
    var rowToken = args.prefix + '-r' + index;
    var actionToken = args.prefix + '-a' + index;
    row.setAttribute('data-pp-study-row', rowToken);
    action.setAttribute('data-pp-study-action', actionToken);
    action.setAttribute('data-pp-id', 'study-' + actionToken);
    if (date && deliveryDate && statusLike(status)) metadataComplete++;
    rows.push({ date: date, deliveryDate: deliveryDate, status: statusLike(status) ? status : '',
      protocol: protocolLike(protocol) ? protocol : '', href: href, rowToken: rowToken, actionToken: actionToken });
  });
  var recognized = hasListMarker || actions.length > 0;
  return { recognized: recognized, resultActions: actions.length, resultLinks: resultAnchors.length,
    candidateRows: candidateRows, metadataComplete: metadataComplete, structure: structure, rows: rows };
})`;
