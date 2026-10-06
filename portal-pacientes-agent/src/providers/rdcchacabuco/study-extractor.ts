/** Parser estructural de VisualMedica. Solo retorna metadata administrativa y tokens efímeros. */
export interface RdcRawAction {
  index: number;
  iconToken: string;
  rowIndex: number;
  stableId: string;
  title: string;
  studyType: string;
  studyDate: string;
}

export interface RdcExtraction {
  recognized: boolean;
  tableCount: number;
  candidateRows: number;
  resultActions: number;
  actions: RdcRawAction[];
  primaryFileIcons: number;
  fallbackFileIcons: number;
  fallbackClassFileIcons: number;
  broadFileIcons: number;
  candidateRowMetadata: { title: string; studyType: string; studyDate: string }[];
}

export function normalizeRdcDate(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const text = value.trim();
  let year: number;
  let month: number;
  let day: number;
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) {
    year = Number(iso[1]); month = Number(iso[2]); day = Number(iso[3]);
  } else {
    const local = text.match(/^(\d{1,2})[/. -](\d{1,2})[/. -](\d{2,4})$/);
    if (!local) return undefined;
    day = Number(local[1]); month = Number(local[2]); year = Number(local[3]);
    if (year < 100) year += year > 70 ? 1900 : 2000;
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return undefined;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export const RDC_EXTRACTOR_SOURCE = String.raw`(args) => {
  const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim();
  const fold = (value) => clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const visible = (el) => { const s = getComputedStyle(el); return !!el.getClientRects().length && s.visibility !== 'hidden' && s.display !== 'none'; };
  if (args.documentToken && document.documentElement) document.documentElement.setAttribute('data-pp-rdc-document', args.documentToken);
  const dateText = (value) => {
    const m = clean(value).match(/^(\d{1,2}[/. -]\d{1,2}[/. -]\d{2,4}|\d{4}-\d{2}-\d{2})$/);
    return m ? m[1] : '';
  };
  const readMetadata = (row, action) => {
    const cells = row ? Array.from(row.querySelectorAll(':scope > td,:scope > th,:scope > [role="cell"],:scope > [role="gridcell"]')) : [];
    const usableCells = cells.length ? cells : row ? Array.from(row.children) : [];
    const table = row?.closest('table');
    const headerNodes = table
      ? Array.from(table.querySelectorAll('thead th,thead td,[role="columnheader"]'))
      : Array.from(row?.closest('[role="grid"],[role="table"]')?.querySelectorAll('[role="columnheader"]') || []);
    const headers = headerNodes.map((node) => fold(node.textContent));
    const values = usableCells.map((cell) => clean(cell.innerText || cell.textContent));
    const labeled = usableCells.map((cell) => fold(cell.getAttribute('data-label') || cell.getAttribute('aria-label') || ''));
    const actionCell = action?.closest('td,th,[role="cell"],[role="gridcell"]');
    const actionIndex = actionCell ? usableCells.indexOf(actionCell) : -1;
    const typeIndex = headers.findIndex((h) => /tipo.*estudio|tipo de estudio|study type/.test(h));
    const descriptionIndex = headers.findIndex((h) => /descripcion|descripci|study description|examen/.test(h) && !/tipo|fecha/.test(h));
    const dateIndex = headers.findIndex((h) => /fecha.*estudio|fecha|study date|date/.test(h));
    const byLabel = (pattern) => labeled.findIndex((h) => pattern.test(h));
    const labeledType = byLabel(/tipo.*estudio|study type/);
    const labeledDescription = byLabel(/descripcion|descripci|study description/);
    const labeledDate = byLabel(/fecha|study date|date/);
    const pickedDate = dateIndex >= 0 ? values[dateIndex] : labeledDate >= 0 ? values[labeledDate] : values.find(dateText) || '';
    let pickedType = typeIndex >= 0 ? values[typeIndex] : labeledType >= 0 ? values[labeledType] : '';
    let pickedDescription = descriptionIndex >= 0 ? values[descriptionIndex] : labeledDescription >= 0 ? values[labeledDescription] : '';
    const isUsable = (value, index) => value && index !== actionIndex && !dateText(value) && !/^(?:acciones|accion|archivo|ver|abrir|descargar|compartir)$/i.test(fold(value));
    const remaining = values.map((value, index) => ({ value, index })).filter((item) => isUsable(item.value, item.index));
    if (!pickedType && remaining.length) pickedType = remaining[0].value;
    if (!pickedDescription) pickedDescription = remaining.find((item) => item.value !== pickedType)?.value || '';
    return { title: clean(pickedDescription).slice(0, 160), studyType: clean(pickedType).slice(0, 100), studyDate: dateText(pickedDate) };
  };
  const primaryIcons = Array.from(document.querySelectorAll('i.fa.fa-file.icon-size')).filter(visible);
  const fallbackTagIcons = Array.from(document.querySelectorAll('i.fa-file')).filter(visible);
  const fallbackClassIcons = Array.from(document.querySelectorAll('.fa-file.icon-size')).filter(visible);
  const fallbackIcons = Array.from(new Set([...fallbackTagIcons, ...fallbackClassIcons]));
  const broadIconCount = document.querySelectorAll('.fa-file').length;
  const broadIcons = Array.from(document.querySelectorAll('.fa-file')).filter(visible);
  const specificIcons = Array.from(new Set([...primaryIcons, ...fallbackIcons]));
  const icons = specificIcons.length ? specificIcons : broadIcons;
  const actions = [];
  const rows = Array.from(document.querySelectorAll('tr,[role="row"],.study-row,.result-row,[class*="study-row"],[class*="result-row"]')).filter((row) => visible(row) && !row.closest('thead'));
  const candidateRows = new Set(rows);
  const rowIndexes = new Map(rows.map((row, index) => [row, index]));
  let nextFallbackRowIndex = rows.length;
  const getRow = (node) => {
    const semantic = node.closest('tr,[role="row"],.study-row,.result-row,[class*="study-row"],[class*="result-row"]');
    if (semantic && !semantic.closest('thead')) return semantic;
    let current = node.parentElement;
    for (let depth = 0; current && current !== document.body && depth < 8; depth++, current = current.parentElement) {
      const cells = Array.from(current.children);
      const hasFileIcon = !!current.querySelector('.fa-file');
      if (cells.length >= 3 && hasFileIcon && clean(current.innerText).length < 900) return current;
    }
    return null;
  };
  const stableId = (row, action) => {
    const nodes = [action, row].filter(Boolean);
    for (const node of nodes) {
      for (const attr of Array.from(node.attributes || [])) {
        const name = attr.name.toLowerCase();
        if (/^(?:data-(?:study|exam|accession|result|document)(?:[-_]?id|[-_]?key|[-_]?number)|study[-_]?id|exam[-_]?id|accession[-_]?number)$/.test(name) && clean(attr.value)) return clean(attr.value).slice(0, 180);
      }
    }
    const values = [];
    for (const node of nodes) {
      if (node.matches('a[href]')) values.push(node.getAttribute('href') || '');
      values.push(node.getAttribute('onclick') || '');
    }
    for (const value of values) {
      const urls = value.match(/(?:https?:\/\/[^\s'"()]+|(?:\.\.\/|\.\/|\/)[^\s'"()]+)/g) || [];
      for (const raw of urls) {
        try {
          const url = new URL(raw, location.href);
          for (const [key, id] of url.searchParams.entries()) {
            if (/^(?:id|studyid|examid|accession|accessionnumber|resultid|documentid|estudioid|examenid)$/i.test(key.replace(/[^a-z0-9]/gi, '')) && id && id.length <= 180) return id;
          }
          const parts = url.pathname.split('/').filter(Boolean);
          const last = parts.at(-1) || '';
          if (parts.length > 1 && !/^(?:index\.php|ver|pdf|documento|estudio|archivo)$/i.test(last) && /^[a-z0-9_-]{3,180}$/i.test(last)) return last;
        } catch (_) {}
      }
    }
    return '';
  };
  for (const icon of icons) {
    const row = getRow(icon);
    if (row && !rowIndexes.has(row)) {
      rowIndexes.set(row, nextFallbackRowIndex++);
      candidateRows.add(row);
    }
    const rowIndex = row ? rowIndexes.get(row) : nextFallbackRowIndex++;
    const metadata = readMetadata(row, icon);
    const iconToken = args.prefix + '-icon-' + actions.length;
    icon.setAttribute('data-pp-rdc-icon', iconToken);
    actions.push({ index: actions.length, iconToken, rowIndex, stableId: stableId(row, icon), ...metadata });
  }
  const candidateRowMetadata = Array.from(candidateRows).map((row) => readMetadata(row, null));
  const tables = Array.from(document.querySelectorAll('table,[role="table"],[role="grid"]')).filter(visible);
  const hasExpectedHeaders = tables.some((table) => {
    const h = Array.from(table.querySelectorAll('thead th,thead td,[role="columnheader"]')).map((node) => fold(node.textContent)).join('|');
    return /tipo.*estudio|tipo de estudio/.test(h) && /descripci|description/.test(h) && /fecha/.test(h);
  });
  const hasStudyContext = /mis estudios|estudios disponibles|resultados/i.test(clean(document.body && document.body.innerText));
  const hasPassword = !!document.querySelector('input[type="password"]');
  return { recognized: !hasPassword && (actions.length > 0 || hasExpectedHeaders || (hasStudyContext && /sin estudios|no hay resultados/i.test(clean(document.body && document.body.innerText)))), tableCount: tables.length, candidateRows: candidateRows.size, resultActions: icons.length, primaryFileIcons: primaryIcons.length, fallbackFileIcons: fallbackTagIcons.length, fallbackClassFileIcons: fallbackClassIcons.length, broadFileIcons: broadIconCount, actions, candidateRowMetadata };
}`;
