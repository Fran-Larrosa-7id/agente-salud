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
  var studyDateHeader = /^FECHA(?:\s*:)?$/;
  var labwinProtocolHeader = /^PROTOCOLO\s*:?$/;
  var protocolHeader = /PROTOCOLO|ORDEN|PEDIDO|^(?:NRO\.?|NUMERO)$/;
  function desktopColumns(container) {
    return Array.prototype.filter.call(container.children, function (cell) {
      return /(?:^|\s)col-lg-\d+(?:\s|$)/.test(cell.getAttribute('class') || '');
    });
  }
  var desktopHeaders = Array.prototype.map.call(document.querySelectorAll('.table-header'), function (header) {
    return { element: header, labels: desktopColumns(header).map(headerText) };
  }).filter(function (header) {
    return header.labels.some(function (label) { return studyDateHeader.test(label); }) &&
      header.labels.some(function (label) { return labwinProtocolHeader.test(label); });
  });
  function findDesktopRow(action) {
    var record = action.closest('[ng-repeat^="derivacion in getDerivaciones()"]');
    var row = record && record.querySelector(':scope > .col-lg-12.no-padding');
    if (!row || !row.contains(action)) return null;
    var cells = desktopColumns(row);
    // Bootstrap mantiene todas las columnas en el DOM, incluso las ocultas en móvil.
    for (var group = record.parentElement; group; group = group.parentElement) {
      var header = desktopHeaders.findLast(function (candidate) {
        return group.contains(candidate.element) &&
          (candidate.element.compareDocumentPosition(record) & Node.DOCUMENT_POSITION_FOLLOWING);
      });
      if (header) return header.labels.length === cells.length ? { row: row, cells: cells, headers: header.labels } : null;
    }
    return null;
  }
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
      if (!isResultLink && actions.some(function (other) { return other !== action && node.contains(other); })) break;
      if (text.length <= 1800) {
        if (!fallback) fallback = node;
        if (!metadataRow && hasMetadata(text)) metadataRow = node;
        if (node.matches('tr,[role=row]')) return node;
        if (!semanticRow && hasMetadata(text) && rowHint(node)) semanticRow = node;
      }
    }
    return semanticRow || metadataRow || fallback || (isResultLink ? action : null);
  }
  function headerText(cell) {
    return fold(cell.innerText || cell.textContent);
  }
  function columnHeaders(row, columnCount) {
    var table = row.closest('table');
    var candidates = table && row.tagName === 'TR'
      ? Array.prototype.filter.call(table.rows, function (candidate) {
          return (candidate.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING) &&
            (candidate.parentElement.tagName === 'THEAD' || candidate.querySelector(':scope > th'));
        })
      : [];
    // LabWin también puede presentar la grilla con DIV y encabezados fuera del cuerpo.
    if (!candidates.length) {
      var group = row.tagName === 'TR' && table ? table : row;
      for (var depth = 0; group.parentElement && group.parentElement !== document.body && depth < 3; depth++, group = group.parentElement) {
        var siblings = Array.prototype.slice.call(group.parentElement.children, 0, 4);
        siblings.some(function (sibling) {
          if (sibling === group) return true;
          var headerTable = sibling.matches('table') ? sibling : sibling.querySelector('table');
          candidates.push(sibling);
          candidates.push.apply(candidates, Array.prototype.slice.call(headerTable ? headerTable.rows : sibling.children, 0, 4));
          return false;
        });
      }
    }
    for (var i = 0; i < candidates.length; i++) {
      var cells = Array.prototype.slice.call(candidates[i].children);
      // La columna del ojo puede no tener encabezado.
      if (cells.length !== columnCount && cells.length !== columnCount - 1) continue;
      if (cells.some(function (cell) { return cell.colSpan > 1 || Number(cell.getAttribute('aria-colspan')) > 1; })) continue;
      var headers = cells.map(headerText);
      if (headers.some(function (label) { return studyDateHeader.test(label); }) &&
          headers.some(function (label) { return labwinProtocolHeader.test(label); })) return headers;
    }
    return [];
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
    var desktopRow = desktopHeaders.length ? findDesktopRow(action) : null;
    var row = desktopRow ? desktopRow.row : findRow(action, index, isResultLink);
    if (!row) return;
    candidateRows++;
    var cells = desktopRow ? desktopRow.cells : Array.prototype.slice.call(row.children);
    var headers = desktopRow ? desktopRow.headers : columnHeaders(row, cells.length);
    var labels = cells.map(function (cell, i) {
      return fold(headers[i] || cell.getAttribute('data-label') || cell.getAttribute('data-field') || '');
    });
    var values = cells.map(function (cell, i) {
      if (!desktopRow) return norm(cell.innerText || cell.textContent);
      if (/^ESTADO\s*:?$/.test(labels[i]) && cell.contains(action)) {
        return norm(Array.prototype.filter.call(cell.childNodes, function (node) { return node.nodeType === Node.TEXT_NODE; })
          .map(function (node) { return node.textContent; }).join(' '));
      }
      return /^(FECHA|PROTOCOLO|ENTREGA|ESTADO)\s*:?$/.test(labels[i]) ? norm(cell.innerText || cell.textContent) : '';
    });
    var hasLabels = labels.some(Boolean);
    var dates = hasLabels ? [] : dateMatches(row.innerText || row.textContent);
    var date = field(values, labels, studyDateHeader) || field(values, labels, /^(?:FECHA (?:DE )?)?(?:INGRESO|RECEPCION|EXTRACCION|ATENCION)\s*:?$/) || (!hasLabels && dates.length === 1 ? dates[0] : '');
    var deliveryDate = field(values, labels, /ENTREGA|INFORME|DISPONIBLE/) || (!hasLabels && dates.length === 2 ? dates[1] : '');
    if (!dateMatches(date).length) date = '';
    if (!dateMatches(deliveryDate).length) deliveryDate = '';
    var status = field(values, labels, /ESTADO|SITUACION|CONDICION/);
    if (!statusLike(status)) status = values.find(statusLike) || '';
    var protocol = field(values, labels, protocolHeader);
    var rowToken = args.prefix + '-r' + index;
    var actionToken = args.prefix + '-a' + index;
    row.setAttribute('data-pp-study-row', rowToken);
    action.setAttribute('data-pp-study-action', actionToken);
    action.setAttribute('data-pp-id', 'study-' + actionToken);
    if (date && protocolLike(protocol) && deliveryDate && statusLike(status)) metadataComplete++;
    rows.push({ date: date, deliveryDate: deliveryDate, status: statusLike(status) ? status : '',
      protocol: protocolLike(protocol) ? protocol : '', href: href, rowToken: rowToken, actionToken: actionToken });
  });
  var recognized = hasListMarker || actions.length > 0;
  return { recognized: recognized, resultActions: actions.length, resultLinks: resultAnchors.length,
    candidateRows: candidateRows, metadataComplete: metadataComplete, structure: structure, rows: rows };
})`;
