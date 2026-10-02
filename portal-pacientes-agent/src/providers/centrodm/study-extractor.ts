/**
 * Extractor DOM de solo lectura del listado Centro DM.
 * La referencia de apertura y el identificador bruto viven transitoriamente en memoria del job;
 * nunca se incorporan al resultado público ni a los logs.
 */
export interface CentroDmRawAction extends CentroDmActionStructure {
  href: string;
  stableId: string;
  actionToken: string;
  targetBlank: boolean;
  date: string;
  title: string;
  modality: string;
}

export interface CentroDmActionStructure {
  index: number;
  tag: string;
  hrefPresent: boolean;
  hrefKind: 'llamadoURL';
  ancestorTr: boolean;
}

export interface CentroDmExtraction {
  recognized: boolean;
  emptyResults: boolean;
  tableCount: number;
  resultActions: number;
  candidateRows: number;
  rowsWithAction: number;
  actions: CentroDmRawAction[];
}

export const CENTRODM_EXTRACTOR_SOURCE = String.raw`(args) => {
  const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim();
  const norm = (value) => clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const fold = (value) => norm(value).toLowerCase();
  const visible = (el) => {
    const style = getComputedStyle(el);
    return !!el.getClientRects().length && style.visibility !== 'hidden' && style.display !== 'none';
  };
  const isLlamado = (value) => /(?:^|\/)funcion\/llamadourl\.php(?:[?#]|$)/i.test(String(value || '').replace(/\\\//g, '/'));
  const validDate = (value) => {
    const match = clean(value).match(/\b\d{1,2}[/. -]\d{1,2}[/. -]\d{2,4}\b/);
    return match ? match[0] : '';
  };
  const normalizeDate = (value) => {
    const match = String(value || '').match(/\b(\d{1,2})[/. -](\d{1,2})[/. -](\d{2,4})\b/);
    if (!match) return '';
    let year = Number(match[3]);
    if (year < 100) year += year > 70 ? 1900 : 2000;
    const month = Number(match[2]);
    const day = Number(match[1]);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return '';
    return year + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0');
  };
  const modalityCode = (value) => {
    const text = norm(value).toUpperCase();
    const match = text.match(/\b(MRI|CR|CT|MR|US|SC|DX|MG|OT|NM|PT|XA|RF|ES|ECG)\b/);
    if (match) return match[1] === 'MRI' ? 'MR' : match[1];
    if (/TOMOGRAF/.test(text)) return 'CT';
    if (/RESONANC/.test(text)) return 'MR';
    if (/ECOGRAF|ULTRASON/.test(text)) return 'US';
    if (/RADIOGRAF/.test(text)) return 'DX';
    if (/MAMOGRAF/.test(text)) return 'MG';
    return '';
  };
  const standaloneModality = (value) => /^(?:MRI|CR|CT|MR|US|SC|DX|MG|OT|NM|PT|XA|RF|ES|ECG|TOMOGRAFIA|RESONANCIA|ECOGRAFIA|ULTRASONIDO|RADIOGRAFIA|MAMOGRAFIA)$/i.test(norm(value));
  const attrs = (el) => Array.from(el.attributes || []).map((attr) => attr.value);
  const hasCalledDataAttribute = (el) => Array.from(el.attributes || []).some((attr) => attr.name.toLowerCase().startsWith('data-') && isLlamado(attr.value));
  const actionNodes = Array.from(document.querySelectorAll('*'))
    .filter((el) => visible(el) && (el.matches('a[href],button,[role="button"],[onclick],img,svg[aria-label]') || hasCalledDataAttribute(el)));
  const actions = [];
  const seenActions = new Set();
  const interactive = (el) => el.matches('a[href],button,[role="button"],[onclick],[data-href],[data-url],[data-action]') || hasCalledDataAttribute(el);
  const calledTarget = (el) => {
    let node = el;
    for (let depth = 0; node && node !== document.body && depth < 8; depth++, node = node.parentElement) {
      if (!interactive(node)) continue;
      const values = attrs(node);
      const called = values.find(isLlamado);
      if (called) return { node, value: called };
    }
    return null;
  };
  const routeFromValue = (value) => {
    const text = String(value || '').replace(/\\\//g, '/');
    const absolute = text.match(/https?:\/\/[^\s'"()< >]*\/funcion\/llamadourl\.php(?:\?[^\s'"()< >]*)?/i);
    if (absolute) return absolute[0].replace(/[;,]+$/, '');
    const route = text.match(/(?:^|\/)(?:funcion)\/llamadourl\.php(?:\?[^\s'"()< >]*)?/i);
    if (!route) return '';
    return route[0].replace(/[;,]+$/, '');
  };
  const actionHref = (node, matchedValue) => {
    const direct = node.getAttribute('href');
    const candidate = direct && isLlamado(direct) ? direct : routeFromValue(matchedValue);
    try {
      const url = new URL(candidate, location.href);
      return /^https?:$/.test(url.protocol) ? url.href : '';
    } catch (_) { return ''; }
  };
  const stableIdFrom = (row, node, href) => {
    try {
      const url = new URL(href, location.href);
      for (const [key, value] of url.searchParams.entries()) {
        if (fold(key).replace(/[^a-z0-9]/g, '') === 'accessionnphp' && value && value.length <= 180) return value;
      }
    } catch (_) {}
    const attrId = (row && (row.getAttribute('data-study-id') || row.getAttribute('data-exam-id'))) ||
      node.getAttribute('data-study-id') || node.getAttribute('data-exam-id');
    if (attrId) return clean(attrId).slice(0, 120);
    try {
      const url = new URL(href, location.href);
      const preferred = new Set(['id', 'idestudio', 'estudioid', 'studyid', 'idstudy', 'codestudio', 'codigoestudio', 'accession', 'accessionnumber', 'accessionnphp', 'studyinstanceuid']);
      for (const [key, value] of url.searchParams.entries()) {
        const normalizedKey = fold(key).replace(/[^a-z0-9]/g, '');
        if (preferred.has(normalizedKey) && value && value.length <= 180) return value;
      }
    } catch (_) {}
    return '';
  };
  const rowFor = (node) => {
    const semantic = node.closest('tr,[role="row"]');
    if (semantic && !semantic.closest('thead')) return semantic;
    let current = node;
    for (let depth = 0; current && current !== document.body && depth < 9; depth++, current = current.parentElement) {
      if (current.tagName !== 'DIV' || !visible(current)) continue;
      const text = clean(current.innerText || current.textContent);
      if (!text || text.length > 700) continue;
      const descendants = Array.from(current.querySelectorAll('*')).filter((el) => interactive(el) && attrs(el).some(isLlamado));
      const callCount = descendants.length + Number(attrs(current).some(isLlamado));
      if (callCount !== 1) continue;
      const children = Array.from(current.children);
      if (children.length >= 2 && (validDate(text) || children.length >= 3)) return current;
    }
    return null;
  };
  for (const el of actionNodes) {
    const matched = calledTarget(el);
    if (!matched || seenActions.has(matched.node)) continue;
    seenActions.add(matched.node);
    const row = rowFor(matched.node);
    const href = actionHref(matched.node, matched.value);
    const actionToken = args.prefix + '-a-' + actions.length;
    matched.node.setAttribute('data-pp-centrodm-action', actionToken);
    matched.node.setAttribute('data-pp-id', 'centrodm-' + actionToken);
    const anchor = matched.node instanceof HTMLAnchorElement ? matched.node : matched.node.closest('a[href]');
    actions.push({ node: matched.node, row, href, stableId: stableIdFrom(row, matched.node, href), actionToken,
      targetBlank: ((matched.node.getAttribute('target') || (anchor && anchor.getAttribute('target')) || '').toLowerCase() === '_blank'),
      date: '', title: '', modality: '', structure: {
      index: actions.length,
      tag: matched.node.tagName.toLowerCase(),
      hrefPresent: !!href,
      hrefKind: 'llamadoURL',
      ancestorTr: !!matched.node.closest('tr'),
    }});
  }

  const structuralRows = Array.from(document.querySelectorAll('tr,[role="row"],[data-study-id],[data-exam-id],[class*="study-row"],[class*="exam-row"],[class*="estudio-row"],[class*="examen-row"]'))
    .filter((row) => visible(row) && !row.closest('thead') && !row.querySelector('[role="columnheader"]'));
  for (const action of actions) if (action.row && !structuralRows.includes(action.row)) structuralRows.push(action.row);
  const tableCount = Array.from(document.querySelectorAll('table')).filter(visible).length;
  const grouped = new Map();
  for (const action of actions) {
    if (!action.row) continue;
    const group = grouped.get(action.row) || [];
    group.push(action);
    grouped.set(action.row, group);
  }
  for (const [row, rowActions] of grouped.entries()) {
    // Varias acciones de apertura en una misma fila son ambiguas para metadata;
    // cada referencia sigue siendo válida y conserva su identidad por URL.
    if (rowActions.length !== 1) continue;
    const action = rowActions[0];
    let cells = Array.from(row.querySelectorAll(':scope > td,:scope > th,:scope > [role="cell"],:scope > [role="gridcell"]'));
    if (!cells.length) cells = Array.from(row.children);
    const table = row.closest('table');
    const headerNodes = table
      ? Array.from(table.querySelectorAll('thead th,thead td,[role="columnheader"]'))
      : Array.from(row.closest('[role="grid"],[role="table"]')?.querySelectorAll('[role="columnheader"]') || []);
    const headers = headerNodes.map((header) => fold(header.textContent));
    const values = cells.map((cell) => clean(cell.innerText || cell.textContent));
    const actionCell = action.node.closest('td,th,[role="cell"],[role="gridcell"]') || (cells.includes(action.node) ? action.node : null);
    const actionCellIndex = actionCell ? cells.indexOf(actionCell) : -1;
    let date = '';
    let title = clean(row.getAttribute('data-study-name') || row.getAttribute('data-exam-name') || '');
    let modality = modalityCode(row.getAttribute('data-modality') || '');

    const dateIndex = headers.findIndex((header) => /(?:^|\b)(?:fecha|date|realiz)/.test(header));
    const modalityIndex = headers.findIndex((header) => /modalidad|modality/.test(header));
    if (dateIndex >= 0 && dateIndex < values.length) date = validDate(values[dateIndex]);
    if (modalityIndex >= 0 && modalityIndex < values.length) modality = modality || modalityCode(values[modalityIndex]);
    if (!title) {
      const titleIndex = headers.findIndex((header, index) => index !== actionCellIndex &&
        /estudio|examen|procedimiento|descripcion|study|exam/.test(header) && !/fecha|modalidad|medico|solicitante/.test(header));
      if (titleIndex >= 0 && titleIndex < values.length) title = values[titleIndex];
    }

    if (!date) date = validDate(values.find((value) => validDate(value)) || '');
    if (!modality) modality = values.map(modalityCode).find(Boolean) || '';
    if (!title) {
      const start = dateIndex >= 0 ? dateIndex + 1 : 0;
      const end = modalityIndex >= 0 ? modalityIndex : values.length;
      for (let index = start; index < end; index++) {
        if (index === actionCellIndex) continue;
        const header = headers[index] || '';
        const value = values[index] || '';
        if (!value || /medico|solicitante|profesional|doctor|compart|share/.test(header)) continue;
        if (/^(?:dr\.?|dra\.?|doctor|doctora)\s/i.test(value)) continue;
        if (validDate(value) || standaloneModality(value)) continue;
        title = value;
        break;
      }
    }
    title = clean(title).slice(0, 120);
    if (/^(?:paciente|documento|dni|fecha|modalidad|estado|compartir)$/i.test(title)) title = '';
    action.date = normalizeDate(date) || date;
    action.title = title;
    action.modality = modality;
  }

  const bodyText = fold(document.body ? document.body.innerText : '');
  const emptyResults = /sin estudios|no se encontraron|no hay resultados|sin resultados/.test(bodyText);
  const resultText = /(?:\bestudios\b|\bexamenes\b|\bresultados\b)/.test(bodyText);
  const hasResultHeaders = headersFrom(document).some((headers) =>
    headers.some((header) => /fecha|date/.test(header)) &&
    headers.some((header) => /estudio|examen|study|exam/.test(header)) &&
    headers.some((header) => /modalidad|modality/.test(header)));
  const hasDataRows = structuralRows.some((row) => row.querySelector(':scope > td,:scope > [role="cell"],:scope > [role="gridcell"]'));
  const hasPassword = !!document.querySelector('input[type="password"]');
  const recognized = !hasPassword && (actions.length > 0 || (hasResultHeaders && (hasDataRows || resultText)) ||
    (resultText && (actions.length > 0 || emptyResults)));
  return {
    recognized,
    emptyResults,
    tableCount,
    resultActions: actions.length,
    candidateRows: structuralRows.length,
    rowsWithAction: grouped.size,
    actions: actions.map((action) => ({
      ...action.structure,
      href: action.href,
      stableId: action.stableId,
      actionToken: action.actionToken,
      targetBlank: action.targetBlank,
      date: action.date,
      title: action.title,
      modality: action.modality,
    })),
  };

  function headersFrom(doc) {
    const sets = [];
    for (const table of Array.from(doc.querySelectorAll('table'))) {
      const headers = Array.from(table.querySelectorAll('thead th,thead td,[role="columnheader"]')).map((node) => fold(node.textContent));
      if (headers.length) sets.push(headers);
    }
    const gridHeaders = Array.from(doc.querySelectorAll('[role="columnheader"]')).map((node) => fold(node.textContent));
    if (gridHeaders.length) sets.push(gridHeaders);
    return sets;
  }
}`;
