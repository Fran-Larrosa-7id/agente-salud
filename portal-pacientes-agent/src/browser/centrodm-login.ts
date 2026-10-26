/** Login evidence only. Never reads field values, clicks menus or returns study IDs. */
export const CENTRODM_RESPONSIVE_LOGIN_SOURCE = String.raw`(() => {
  const visible = el => !!el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden' && getComputedStyle(el).display !== 'none';
  const fold = text => String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
  const validDate = text => {
    const match = text.trim().match(/^(\d{2})\/(\d{2})\/(\d{2}|\d{4})$/);
    if (!match) return false;
    const year = Number(match[3]) + (match[3].length === 2 ? 2000 : 0);
    const value = new Date(Date.UTC(year, Number(match[2]) - 1, Number(match[1])));
    return value.getUTCFullYear() === year && value.getUTCMonth() === Number(match[2]) - 1 && value.getUTCDate() === Number(match[1]);
  };
  const studyTarget = node => {
    for (const attr of ['href', 'data-url', 'data-href', 'onclick']) {
      const raw = node.getAttribute(attr); if (!raw) continue;
      const match = attr === 'onclick' ? raw.match(/(?:https?:\/\/[^'"\s()]+)?\/funcion\/llamadoURL\.php\?[^'"\s()]+/i) : null;
      if (attr === 'onclick' && !match) continue;
      try {
        const target = new URL(match ? match[0] : raw, location.href);
        if (target.origin === location.origin && /\/funcion\/llamadoURL\.php$/i.test(target.pathname) && target.search.length > 1) return target.href;
      } catch {}
    }
    return '';
  };
  const candidates = root => Array.from(root.querySelectorAll('a[href],a[onclick],button[onclick],[data-url],[data-href]'));
  const tableList = Array.from(document.querySelectorAll('table')).some(table => {
    if (!visible(table)) return false;
    const headers = fold(Array.from(table.querySelectorAll('th')).filter(visible).map(el => el.innerText).join(' '));
    if (!/FECHA/.test(headers) || !/ESTUDIO/.test(headers) || !/ACCIONES/.test(headers)) return false;
    return Array.from(table.querySelectorAll('tbody tr')).filter(visible).some(row => {
      const date = Array.from(row.querySelectorAll('td')).filter(visible).some(cell => validDate(cell.innerText));
      // Bootstrap collapses these links on phones. Their presence in a visible
      // dated study row is evidence; visibility of the menu is not required.
      return date && candidates(row).some(studyTarget);
    });
  });
  if (tableList) return true;
  // Centro DM also uses its own div-based ns-table grid. Date/action pairing
  // is positional in that variant; require matching nonzero counts, specific
  // visible headers and provider-specific date nodes, never arbitrary cards.
  return Array.from(document.querySelectorAll('.ns-table')).filter(visible).some(grid => {
    const headers = fold(grid.innerText);
    if (!/FECHA\s+(?:DEL\s+)?ESTUDIO/.test(headers) || !/\bACCIONES\b/.test(headers)) return false;
    const dates = Array.from(grid.querySelectorAll('.ns-table__text')).filter(visible).filter(node => validDate(node.innerText));
    const targets = new Set(candidates(grid).map(studyTarget).filter(Boolean));
    return dates.length > 0 && dates.length === targets.size;
  });
})()`;
