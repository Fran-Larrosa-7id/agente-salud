import { randomUUID } from 'node:crypto';
import type { Frame, Locator, Page } from 'playwright';
import type { ProviderStructureEvent } from './types.js';

type Trace = (event: ProviderStructureEvent) => void;
export interface DownloadControl { locator: Locator; frame: Frame }

/** Locators CSS/semánticos atraviesan shadow roots abiertos; nunca se usa XPath. */
export async function probePixeonDownload(page: Page, kind: 'download' | 'menu', trace: Trace, preferred?: Frame, canInteract: (frame: Frame) => boolean = () => true, toolbarTimeoutMs = 0) {
  const frames = page.frames();
  const ordered = preferred ? [preferred, ...frames.filter(f => f !== preferred)] : frames;
  trace({ event: 'pixeon_frames', count: frames.length });
  trace({ event: 'pixeon_download_probe', frames: frames.length });
  let textMatches = 0;
  let domMatches = 0;
  let menuOptions = 0;
  let chosen: DownloadControl | null = null;
  if (kind === 'download') {
    const startedAt = Date.now();
    const deadline = startedAt + Math.max(0, toolbarTimeoutMs);
    let lastCount = 0;
    trace({ event: 'pixeon_download_fastpath', selector: 'downloadToolsItem', started: true });
    do {
      lastCount = 0;
      for (const frame of ordered) {
        if (!canInteract(frame)) continue;
        const locator = frame.locator('.downloadToolsItem').first();
        const count = await locator.count().catch(() => 0);
        lastCount += count;
        if (!count || !await locator.isVisible().catch(() => false)) continue;
        const elapsedMs = Date.now() - startedAt;
        trace({ event: 'pixeon_download_fastpath', selector: 'downloadToolsItem', count, visible: true, elapsedMs, frameIndex: frames.indexOf(frame) });
        trace({ event: 'pixeon_download_button', found: true, strategy: 'class_fastpath' });
        return { control: { locator, frame }, textMatches, domMatches, menuOptions, strategy: 'class_fastpath' as const };
      }
      if (Date.now() >= deadline) break;
      await new Promise(resolve => setTimeout(resolve, Math.min(200, Math.max(1, deadline - Date.now()))));
    } while (Date.now() <= deadline);
    trace({ event: 'pixeon_download_fastpath', selector: 'downloadToolsItem', count: lastCount, visible: false, elapsedMs: Date.now() - startedAt });
  }
  for (const frame of ordered) {
    const frameIndex = frames.indexOf(frame);
    if (!canInteract(frame)) {
      trace({ event: 'pixeon_frame', index: frameIndex, isMain: frame === page.mainFrame(), downloadCandidates: 0 });
      continue;
    }
    const selectors = [
      frame.getByRole('button', { name: /descargar/i }),
      frame.getByRole('link', { name: /descargar/i }),
      frame.getByText(/^descargar$/i),
      frame.getByText(/descargar/i),
      frame.locator('[aria-label*="descarg" i],[title*="descarg" i],[data-title*="descarg" i],[data-label*="descarg" i],[data-tooltip*="descarg" i]'),
      frame.locator('[id*="download" i],[class*="download" i],[data-testid*="download" i],[name*="download" i]'),
      frame.locator('button,a,[role="button"],[role="menuitem"]').filter({ hasText: /descargar/i }),
    ];
    const seen = new Set<string>();
    let candidates = 0;
    let standardMatches = 0;
    const resolve = async (nodes: Locator, i: number, fromText: boolean) => {
      if (!await nodes.nth(i).isVisible().catch(() => false)) return;
      if (fromText) textMatches++;
      const token = randomUUID();
      const result = await nodes.nth(i).evaluate((node, args) => {
        const label = [node.getAttribute('aria-label'), node.getAttribute('title'), node.getAttribute('data-title'), node.getAttribute('data-label'), node.getAttribute('data-tooltip'), node.textContent].join(' ');
        const normalized = label.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
        if (args.kind === 'download' && /\b(png|zip|dcm|series)\b/.test(normalized)) return null;
        if (args.kind === 'menu' && !/\b(png|zip|dcm)\b/.test(normalized)) return null;
        const hasMenuOptionChild = Array.from(node.children).some(child => {
          const childText = (child.textContent || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
          return /\b(descargar|download)\b/.test(childText) && /\b(png|zip|dcm)\b/.test(childText);
        });
        const menuOption = args.kind === 'menu' && !hasMenuOptionChild && /\b(descargar|download)\b/.test(normalized) && /\b(png|zip|dcm)\b/.test(normalized);
        const full = /\btodas\b/.test(normalized) && /\bseries\b/.test(normalized) && /\bzip\b/.test(normalized) && /\bdcm\b/.test(normalized) && !/\b(viewer|actual|png)\b/.test(normalized);
        let owner: Element | null = node;
        for (let depth = 0; owner && depth <= 8; depth++) {
          if (owner === document.body || owner === document.documentElement) break;
          const style = getComputedStyle(owner);
          const rect = owner.getBoundingClientRect();
          const visible = rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none' && Number(style.opacity || 1) > 0.02;
          const tabindex = owner.getAttribute('tabindex');
          const classText = typeof owner.className === 'string' ? owner.className : '';
          const actionableClass = /toolbar|action|button|download|control/i.test(classText + ' ' + owner.id);
          const interactive = owner.matches('button,a,[role="button"],[role="menuitem"],[onclick],[ng-click]') ||
            typeof (owner as HTMLElement).onclick === 'function' || (!!tabindex && (owner as HTMLElement).tabIndex >= 0) || actionableClass;
          let toolbarConfidence = false;
          if (!interactive && style.cursor === 'pointer' && (!owner.parentElement || getComputedStyle(owner.parentElement).cursor !== 'pointer')) {
            let container = owner.parentElement;
            for (let level = 0; container && level < 4; level++, container = container.parentElement) {
              const labels = Array.from(container.querySelectorAll('button,a,span,[role="button"],[aria-label],[title]'), el => [el.textContent, el.getAttribute('aria-label'), el.getAttribute('title')].filter(Boolean).join(' ')).join(' ').toLowerCase();
              const hits = labels.match(/\b(restaurar|ajustar|layout|zoom|presets|paleta|anotacion|girar|descargar|pantalla llena|lista de anotaciones|configuraciones)\b/g) || [];
              if (new Set(hits).size >= 3) { toolbarConfidence = true; break; }
            }
          }
          if (visible && (interactive || toolbarConfidence || (menuOption && owner === node))) {
            const marker = owner.getAttribute('data-pixeon-download-probe') || args.token;
            owner.setAttribute('data-pixeon-download-probe', marker);
            return {
              marker, depth, full, tag: owner.tagName.toLowerCase(), role: owner.getAttribute('role') || 'none',
              classNamesSanitized: classText.split(/\s+/).filter(x => /^(?:toolbar|action|button|download|control|item|icon|menu|viewer)(?:[-_][a-z0-9]+)?$/i.test(x)).slice(0, 3).join('_'),
              parentTag: owner.parentElement?.tagName.toLowerCase() || 'none',
              parentClassSanitized: (typeof owner.parentElement?.className === 'string' ? owner.parentElement.className : '').split(/\s+/).filter(x => /^(?:toolbar|action|button|download|control|item|icon|menu|viewer)(?:[-_][a-z0-9]+)?$/i.test(x)).slice(0, 3).join('_'),
              hasOnclick: owner.hasAttribute('onclick') || typeof (owner as HTMLElement).onclick === 'function', hasTabindex: !!tabindex,
              toolbarConfidence, matchedAttribute: args.matchedAttribute,
            };
          }
          const root: Node = owner.getRootNode();
          owner = owner.parentElement || (root instanceof ShadowRoot ? root.host : null);
        }
        return null;
      }, { token, kind, matchedAttribute: fromText ? 'text' : 'attribute' }).catch(() => null);
      if (!result || seen.has(result.marker)) return;
      seen.add(result.marker);
      candidates++;
      const locator = frame.locator(`[data-pixeon-download-probe="${result.marker}"]`);
      trace({ event: 'pixeon_download_candidate', frameIndex, tag: result.tag, role: result.role, textMatch: fromText, visible: true, clickableAncestorDepth: result.depth, matchedAttribute: result.matchedAttribute, toolbarConfidence: result.toolbarConfidence, hasOnclick: result.hasOnclick, hasTabindex: result.hasTabindex, classNamesSanitized: result.classNamesSanitized, parentTag: result.parentTag, parentClassSanitized: result.parentClassSanitized });
      trace({ event: 'pixeon_clickable_ancestor', depth: result.depth, tag: result.tag, role: result.role, toolbarConfidence: result.toolbarConfidence });
      if (kind === 'menu') menuOptions++;
      if (!chosen && (kind === 'download' || result.full)) chosen = { locator, frame };
    };
    for (let selectorIndex = 0; selectorIndex < selectors.length; selectorIndex++) {
      const nodes = selectors[selectorIndex];
      const count = await nodes.count().catch(() => 0);
      standardMatches += count;
      if (kind === 'download' && selectorIndex === 2) trace({ event: 'pixeon_text_exact', count, frameIndex });
      if (kind === 'download' && selectorIndex === 3) trace({ event: 'pixeon_text_partial', count, frameIndex });
      if (kind === 'download' && selectorIndex === 4) trace({ event: 'pixeon_attr_candidates', count, frameIndex });
      if (kind === 'download' && selectorIndex === 2) trace({ event: 'pixeon_download_text_matches', count, frameIndex });
      if (kind === 'download' && selectorIndex < 2) trace({ event: 'pixeon_download_role_matches', count, frameIndex });
      if (kind === 'download' && selectorIndex === 4) trace({ event: 'pixeon_download_attr_matches', count, frameIndex });
      for (let i = 0; i < Math.min(count, 100); i++) {
        await resolve(nodes, i, selectorIndex === 2 || selectorIndex === 3);
      }
    }
    // DOM acotado: no se devuelve texto, HTML, URL ni valores clínicos; solo estructura sanitizada.
    const dom = await frame.locator('[aria-label],[title],[data-title],[data-label],[data-tooltip],[id*="download" i],[class*="download" i],[data-testid*="download" i],[name*="download" i],button,a,[role="button"],span,div').evaluateAll((nodes, args) => {
      const out: { index: number; marker: string; tag: string; role: string; classNamesSanitized: string; hasOnclick: boolean; hasTabindex: boolean; parentTag: string; parentClassSanitized: string; matchedAttribute: string; depth: number; toolbarConfidence: boolean; full: boolean; clickableTag: string; clickableRole: string }[] = [];
      for (let index = 0; index < Math.min(nodes.length, 1200) && out.length < 30; index++) {
        const node = nodes[index];
        const textNode = Array.from(node.childNodes).filter(n => n.nodeType === Node.TEXT_NODE).map(n => n.textContent || '').join(' ');
        const pseudo = [getComputedStyle(node, '::before').content, getComputedStyle(node, '::after').content].join(' ').replace(/^['"]|['"]$/g, '');
        const attrs = ['aria-label', 'title', 'data-title', 'data-label', 'data-tooltip'];
        const matchedAttribute = attrs.find(name => /descarg/i.test(node.getAttribute(name) || '')) ||
          ['id', 'class', 'data-testid', 'name'].find(name => /download/i.test(typeof node.getAttribute(name) === 'string' ? node.getAttribute(name)! : '')) ||
          (/descarg/i.test(pseudo) ? 'pseudo' : '');
        const semanticText = textNode.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() === 'descargar' || (node.textContent || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() === 'descargar';
        const normalizedText = (node.textContent || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
        const hasMenuOptionChild = Array.from(node.children).some(child => {
          const childText = (child.textContent || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
          return /\b(descargar|download)\b/.test(childText) && /\b(png|zip|dcm)\b/.test(childText);
        });
        const menuOption = args.kind === 'menu' && !hasMenuOptionChild && /\b(descargar|download)\b/.test(normalizedText) && /\b(png|zip|dcm)\b/.test(normalizedText);
        if (!matchedAttribute && !semanticText && !menuOption) continue;
        const nodeStyle = getComputedStyle(node); const rect = node.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0 || nodeStyle.display === 'none' || nodeStyle.visibility === 'hidden') continue;
        const labels = [node.textContent, ...attrs.map(name => node.getAttribute(name) || ''), pseudo].join(' ');
        const normalized = labels.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
        if (args.kind === 'download' && /\b(png|zip|dcm|series)\b/.test(normalized)) continue;
        if (args.kind === 'menu' && !/\b(png|zip|dcm)\b/.test(normalized)) continue;
        const full = /\btodas\b/.test(normalized) && /\bseries\b/.test(normalized) && /\bzip\b/.test(normalized) && /\bdcm\b/.test(normalized) && !/\b(viewer|actual|png)\b/.test(normalized);
        let owner: Element | null = node; let chosen: Element | null = null; let depth = 0; let toolbarConfidence = false;
        for (let level = 0; owner && level <= 8; level++) {
          if (owner === document.body || owner === document.documentElement) break;
          const tabindex = owner.getAttribute('tabindex');
          const clickable = owner.matches('button,a,[role="button"],[role="menuitem"],[onclick],[ng-click]') || typeof (owner as HTMLElement).onclick === 'function' || (!!tabindex && (owner as HTMLElement).tabIndex >= 0) || /toolbar|action|button|download|control/i.test((typeof owner.className === 'string' ? owner.className : '') + ' ' + owner.id) || (menuOption && owner === node);
          if (clickable) { chosen = owner; depth = level; break; }
          let container: Element | null = owner;
          for (let n = 0; container && n < 4; n++, container = container.parentElement) {
            const adjacentLabels = Array.from(container.querySelectorAll('button,a,span,[role="button"],[aria-label],[title]'), el => [el.textContent, el.getAttribute('aria-label'), el.getAttribute('title')].filter(Boolean).join(' ')).join(' ').toLowerCase();
            const matches = adjacentLabels.match(/\b(restaurar|ajustar|layout|zoom|presets|paleta|anotacion|girar|descargar|pantalla llena|lista de anotaciones|configuraciones)\b/g) || [];
            if (new Set(matches).size >= 3) { chosen = owner; depth = level; toolbarConfidence = true; break; }
          }
          if (chosen) break;
          const root: Node = owner.getRootNode(); owner = owner.parentElement || (root instanceof ShadowRoot ? root.host : null);
        }
        const marker = chosen?.getAttribute('data-pixeon-download-probe') || (args.tokenBase + '-' + index);
        chosen?.setAttribute('data-pixeon-download-probe', marker);
        out.push({ index: out.length, marker: chosen ? marker : '', tag: node.tagName.toLowerCase(), role: node.getAttribute('role') || 'none', classNamesSanitized: (typeof node.className === 'string' ? node.className : '').split(/\s+/).filter(x => /^(?:toolbar|action|button|download|control|item|icon|menu|viewer)(?:[-_][a-z0-9]+)?$/i.test(x)).slice(0, 3).join('_'), hasOnclick: !!node.getAttribute('onclick') || typeof (node as HTMLElement).onclick === 'function', hasTabindex: node.hasAttribute('tabindex'), parentTag: node.parentElement?.tagName.toLowerCase() || 'none', parentClassSanitized: (typeof node.parentElement?.className === 'string' ? node.parentElement.className : '').split(/\s+/).filter(x => /^(?:toolbar|action|button|download|control|item|icon|menu|viewer)(?:[-_][a-z0-9]+)?$/i.test(x)).slice(0, 3).join('_'), matchedAttribute: matchedAttribute || 'text', depth, toolbarConfidence, full, clickableTag: chosen?.tagName.toLowerCase() || 'none', clickableRole: chosen?.getAttribute('role') || 'none' });
      }
      return out;
    }, { kind, tokenBase: randomUUID() }).catch(() => []);
    for (const candidate of dom) {
      domMatches++;
      trace({ event: 'pixeon_dom_candidate', index: candidate.index, tag: candidate.tag, role: candidate.role, classNamesSanitized: candidate.classNamesSanitized, hasOnclick: candidate.hasOnclick, hasTabindex: candidate.hasTabindex, parentTag: candidate.parentTag, parentClassSanitized: candidate.parentClassSanitized, matchedAttribute: candidate.matchedAttribute, toolbarConfidence: candidate.toolbarConfidence });
      if (!candidate.marker || seen.has(candidate.marker)) continue;
      const locator = frame.locator(`[data-pixeon-download-probe="${candidate.marker}"]`);
      if (!await locator.count().catch(() => 0)) continue;
      seen.add(candidate.marker);
      candidates++;
      trace({ event: 'pixeon_clickable_ancestor', depth: candidate.depth, tag: candidate.clickableTag, role: candidate.clickableRole, toolbarConfidence: candidate.toolbarConfidence });
      if (!chosen && (kind === 'download' || candidate.full)) chosen = { locator, frame };
      if (kind === 'menu') menuOptions++;
    }
    if (kind === 'download' && standardMatches === 0) {
      trace({ event: 'pixeon_structural_fallback', found: true, started: true });
      const viewport = await frame.evaluate(() => ({ width: innerWidth, height: innerHeight })).catch(() => ({ width: 0, height: 0 }));
      const tokenBase = randomUUID();
      const toolbarItems = await frame.locator('button,a,[role="button"],[tabindex],[onclick],[ng-click],[data-action],[class*="download" i],[class*="tool" i],[class*="action" i],[class*="button" i],[class*="icon" i],[class*="toolbar" i],[style*="cursor" i]').evaluateAll((nodes, view) => {
        const items: { index: number; marker: string; tag: string; role: string; classNamesSanitized: string; hasOnclick: boolean; hasTabindex: boolean; cursorPointer: boolean; xBucket: number; widthBucket: string; childElementCount: number; svgCount: number; imgCount: number; dataTestIdPresent: boolean; dataActionPresent: boolean; actionHint: string; toolbarDetected: boolean }[] = [];
        const bucketWidth = Math.max(1, view.width / 16);
        for (let index = 0; index < Math.min(nodes.length, 2500) && items.length < 40; index++) {
          const node = nodes[index];
          const element = node as HTMLElement;
          const style = getComputedStyle(node); const rect = node.getBoundingClientRect();
          if (rect.width <= 0 || rect.height <= 0 || style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity || 1) <= 0.02 || rect.top < 0 || rect.top > Math.min(160, view.height * 0.25)) continue;
          const classText = typeof node.className === 'string' ? node.className : '';
          const tabindex = node.getAttribute('tabindex');
          const role = node.getAttribute('role') || 'none';
          const pointer = style.cursor === 'pointer';
          // A toolbar wrapper is useful as context, but is not itself an actionable candidate.
          // Its repeated children are discovered and described independently below.
          const classActionHint = classText.split(/\s+/).some(token => !/^toolbar$/i.test(token) && /(?:download|tool|action|button)/i.test(token));
          const semantic = /^(BUTTON|A)$/.test(node.tagName) || role === 'button' || (!!tabindex && element.tabIndex >= 0) || node.hasAttribute('onclick') || typeof element.onclick === 'function' || pointer || classActionHint;
          if (!semantic) continue;
          const iconText = Array.from(node.querySelectorAll('svg,[aria-label],[title],use'), icon => [icon.getAttribute('aria-label'), icon.getAttribute('title'), icon.getAttribute('href'), icon.getAttribute('xlink:href'), typeof icon.className === 'string' ? icon.className : ''].filter(Boolean).join(' ')).join(' ');
          const hints = [classText, node.id, node.getAttribute('aria-label'), node.getAttribute('title'), node.getAttribute('data-action'), node.getAttribute('onclick'), node.getAttribute('ng-click'), node.getAttribute('v-on:click'), iconText].filter(Boolean).join(' ').toLowerCase();
          const actionHint = /download|descarg|arrow[-_ ]?down/.test(hints) ? 'download' : /dicom/.test(hints) ? 'dicom' : /zip/.test(hints) ? 'zip' : /export/.test(hints) ? 'export' : /\bsave\b|guardar/.test(hints) ? 'save' : '';
          let repeatedToolbar = false;
          let parent: Element | null = node.parentElement;
          for (let level = 0; parent && level < 5; level++, parent = parent.parentElement) {
            const siblings = Array.from(parent.children).map(child => ({ child, rect: child.getBoundingClientRect(), style: getComputedStyle(child) })).filter(item => item.rect.width > 0 && item.rect.height > 0 && item.rect.top >= 0 && item.rect.top <= Math.min(160, view.height * 0.25) && item.style.display !== 'none' && item.style.visibility !== 'hidden' && Math.abs(item.rect.height - rect.height) <= Math.max(8, rect.height * 0.3) && Math.abs(item.rect.top - rect.top) <= 12);
            const xs = siblings.map(item => item.rect.left).sort((a, b) => a - b);
            const horizontal = xs.length >= 5 && xs.slice(1).every((x, i) => x >= xs[i] + 2);
            if (horizontal) { repeatedToolbar = true; break; }
          }
          const tokens = classText.split(/\s+/).filter(token => /^(?:tool|toolbar|action|button|download|control|item|icon|menu|viewer)(?:[-_][a-z0-9]+)?$/i.test(token)).slice(0, 3).join('_');
          const marker = actionHint ? view.tokenBase + '-' + index : '';
          if (actionHint) node.setAttribute('data-pixeon-download-probe', marker);
          const widthBucket = rect.width < 16 ? 'xs' : rect.width < 40 ? 'sm' : rect.width < 100 ? 'md' : 'lg';
          items.push({ index: items.length, marker, tag: node.tagName.toLowerCase(), role, classNamesSanitized: tokens, hasOnclick: node.hasAttribute('onclick') || typeof element.onclick === 'function', hasTabindex: !!tabindex, cursorPointer: pointer, xBucket: Math.floor(rect.left / bucketWidth), widthBucket, childElementCount: node.childElementCount, svgCount: node.querySelectorAll('svg').length, imgCount: node.querySelectorAll('img').length, dataTestIdPresent: node.hasAttribute('data-testid'), dataActionPresent: node.hasAttribute('data-action'), actionHint, toolbarDetected: repeatedToolbar });
        }
        return items;
      }, { width: viewport.width, height: viewport.height, tokenBase }).catch(() => []);
      trace({ event: 'pixeon_toolbar_candidates', count: toolbarItems.length });
      const toolbarDetected = toolbarItems.some(item => item.toolbarDetected);
      if (toolbarDetected) trace({ event: 'pixeon_toolbar_detected', count: toolbarItems.length, candidates: toolbarItems.length, found: true });
      for (const item of toolbarItems) {
        trace({ event: 'toolbar_candidate', index: item.index, tag: item.tag, role: item.role, classNamesSanitized: item.classNamesSanitized, hasOnclick: item.hasOnclick, hasTabindex: item.hasTabindex, cursorPointer: item.cursorPointer, xBucket: item.xBucket, widthBucket: item.widthBucket, childElementCount: item.childElementCount, svgCount: item.svgCount, imgCount: item.imgCount, dataTestIdPresent: item.dataTestIdPresent, dataActionPresent: item.dataActionPresent, actionHint: item.actionHint || undefined, toolbarConfidence: item.toolbarDetected });
        if (item.actionHint === 'download' && item.marker) {
          trace({ event: 'pixeon_download_structural_candidate', found: true, index: item.index, tag: item.tag, matchedAttribute: 'action_hint' });
          const locator = frame.locator(`[data-pixeon-download-probe="${item.marker}"]`);
          if (await locator.isVisible().catch(() => false) && !chosen) chosen = { locator, frame };
        }
      }
    }
    trace({ event: 'pixeon_frame', index: frameIndex, isMain: frame === page.mainFrame(), downloadCandidates: candidates });
  }
  trace({ event: kind === 'download' ? 'pixeon_download_button' : 'pixeon_download_menu_options', found: !!chosen, count: kind === 'menu' ? menuOptions : undefined });
  return { control: chosen, textMatches, domMatches, menuOptions };
}

/** Acepta únicamente consentimiento identificado por su contexto, no cualquier botón Aceptar. */
export async function handlePixeonCookieConsent(page: Page, trace: Trace, canInteract: (frame: Frame) => boolean = () => true): Promise<boolean> {
  let accepted = false;
  for (const frame of page.frames()) {
    if (!canInteract(frame)) continue;
    const buttons = frame.getByRole('button', { name: /^aceptar(?: cookies)?$/i }).or(frame.getByText(/^aceptar(?: cookies)?$/i));
    for (let i = 0, count = Math.min(await buttons.count().catch(() => 0), 30); i < count; i++) {
      const token = randomUUID();
      const match = await buttons.nth(i).evaluate((node, marker) => {
        let ancestor: Element | null = node;
        let owner: Element | null = null;
        for (let depth = 0; ancestor && depth <= 6; depth++) {
          if (!owner && ancestor.matches('button,a,[role="button"],[onclick],[tabindex]')) owner = ancestor;
          if (ancestor.matches('[role="dialog"],[aria-modal="true"],[class*="modal" i],[id*="modal" i],[class*="cookie" i],[id*="cookie" i]') && /cookie|consent|privacidad|privacy/i.test(ancestor.textContent || '') && owner) {
            owner.setAttribute('data-pixeon-consent-action', marker);
            ancestor.setAttribute('data-pixeon-consent-overlay', marker);
            return true;
          }
          const root: Node = ancestor.getRootNode();
          ancestor = ancestor.parentElement || (root instanceof ShadowRoot ? root.host : null);
        }
        return false;
      }, token).catch(() => false);
      if (!match) continue;
      const action = frame.locator(`[data-pixeon-consent-action="${token}"]`);
      if (!await action.isVisible().catch(() => false)) continue;
      trace({ event: 'pixeon_cookie_consent', detected: true, accepted: false });
      await action.click({ timeout: 3_000 });
      await frame.locator(`[data-pixeon-consent-overlay="${token}"]`).waitFor({ state: 'hidden', timeout: 3_000 });
      trace({ event: 'pixeon_cookie_consent', detected: true, accepted: true });
      accepted = true;
      break;
    }
  }
  return accepted;
}

export async function clickPixeonControl(control: DownloadControl, page: Page, trace: Trace, canInteract: (frame: Frame) => boolean = () => true) {
  if (!await control.locator.isVisible()) throw new Error('PIXEON_CONTROL_HIDDEN');
  await control.locator.scrollIntoViewIfNeeded({ timeout: 3_000 });
  try { await control.locator.click({ timeout: 3_000 }); }
  catch (error) {
    if (/intercept|another element would receive|not receive pointer events/i.test(String(error))) trace({ event: 'pixeon_download_click', intercepted: true });
    if (!await handlePixeonCookieConsent(page, trace, canInteract)) throw error;
    await control.locator.click({ timeout: 3_000 });
  }
}
