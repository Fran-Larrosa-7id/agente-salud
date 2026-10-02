import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { chromium, type Browser } from 'playwright';
import { probePixeonDownload, handlePixeonCookieConsent, clickPixeonControl } from '../../src/browser/pixeon-download.js';
import type { ProviderStructureEvent } from '../../src/browser/types.js';
import { testBrowserChannel } from '../browser-channel.js';

let browser: Browser;
before(async () => { browser = await chromium.launch({ headless: true, channel: testBrowserChannel }); });
after(async () => { await browser?.close(); });

for (const [name, html, depth] of [
  ['div role button', '<div role="button"><i></i><span>Descargar</span></div>', 0],
  ['onclick en abuelo', '<div onclick="window.clicked=true"><div><span>Descargar</span></div></div>', 2],
  ['tabindex en abuelo', '<div tabindex="0"><div><span>Descargar</span></div></div>', 2],
  ['aria label en icono', '<button aria-label="Descargar"><i></i></button>', 0],
  ['toolbar estructural', '<section><span>Layout</span><span>Zoom</span><span>Presets</span><div style="cursor:pointer"><span>Descargar</span></div></section>', 1],
] as const) {
  test(`Pixeon: ${name}`, async () => {
    const page = await browser.newPage();
    try {
      await page.setContent(html);
      const events: ProviderStructureEvent[] = [];
      const result = await probePixeonDownload(page, 'download', e => events.push(e));
      assert.ok(result.control);
      assert.ok(events.some(e => e.event === 'pixeon_download_candidate' && e.clickableAncestorDepth === depth));
      await clickPixeonControl(result.control, page, () => {});
      assert.ok(!JSON.stringify(events).includes('Descargar'), 'no se registra texto DOM');
    } finally { await page.close(); }
  });
}

test('Pixeon: toolbar en iframe y menú en otro frame; elige solo full ZIP DCM', async () => {
  const page = await browser.newPage();
  try {
    await page.setContent('<iframe></iframe><iframe></iframe>');
    const [, toolbar, menu] = page.frames();
    await toolbar.setContent('<div onclick="window.clicked=true"><div><span>Descargar</span></div></div>');
    const events: ProviderStructureEvent[] = [];
    const result = await probePixeonDownload(page, 'download', e => events.push(e));
    assert.equal(result.control?.frame, toolbar);
    assert.ok(events.some(e => e.event === 'pixeon_download_candidate' && e.frameIndex === 1 && e.tag === 'div' && e.clickableAncestorDepth === 2));
    await clickPixeonControl(result.control!, page, () => {});
    assert.equal(await toolbar.evaluate('window.clicked'), true);
    await menu.setContent(['Descargar PNG', 'Descargar Serie Actual - ZIP DCM', 'Descargar todas las Series - ZIP DCM con Viewer', 'Descargar todas las Series - ZIP DCM', 'Descargar todas las Series PNG'].map((label, i) => `<button onclick="window.choice=${i}">${label}</button>`).join(''));
    const options = await probePixeonDownload(page, 'menu', e => events.push(e), toolbar);
    assert.equal(options.menuOptions, 5);
    assert.equal(options.control?.frame, menu);
    await clickPixeonControl(options.control!, page, () => {});
    assert.equal(await menu.evaluate('window.choice'), 3);
  } finally { await page.close(); }
});

test('Pixeon: usa primero el selector real .downloadToolsItem sin exigir role ni onclick', async () => {
  const page = await browser.newPage();
  try {
    await page.setContent('<div class="styles__itemToolsWrapper-sc-1dc1cnr-0 cBerdC downloadToolsItem"><svg width="26" height="26"></svg>Descargar</div>');
    await page.evaluate(`document.querySelector('.downloadToolsItem').addEventListener('click', () => window.clicked = true)`);
    const events: ProviderStructureEvent[] = [];
    const result = await probePixeonDownload(page, 'download', e => events.push(e));
    assert.equal(result.strategy, 'class_fastpath');
    assert.ok(result.control);
    assert.ok(events.some(e => e.event === 'pixeon_download_fastpath' && e.selector === 'downloadToolsItem' && e.count === 1 && e.visible));
    assert.ok(events.some(e => e.event === 'pixeon_download_button' && e.found && e.strategy === 'class_fastpath'));
    assert.ok(!JSON.stringify(events).includes('styles__itemToolsWrapper-sc-1dc1cnr-0'));
    await clickPixeonControl(result.control, page, e => events.push(e));
    assert.equal(await page.evaluate('window.clicked'), true);
  } finally { await page.close(); }
});

test('Pixeon: espera a que .downloadToolsItem aparezca antes del timeout', async () => {
  const page = await browser.newPage();
  try {
    await page.setContent('<main></main>');
    await page.evaluate(`setTimeout(() => { const item = document.createElement('div'); item.className = 'downloadToolsItem'; item.textContent = 'Descargar'; document.body.append(item); }, 1500)`);
    const events: ProviderStructureEvent[] = [];
    const result = await probePixeonDownload(page, 'download', e => events.push(e), undefined, undefined, 5_000);
    assert.equal(result.strategy, 'class_fastpath');
    assert.ok(result.control);
    const appeared = events.find(e => e.event === 'pixeon_download_fastpath' && e.visible);
    assert.equal(appeared?.count, 1);
    assert.ok((appeared?.elapsedMs || 0) >= 1_200 && (appeared?.elapsedMs || 0) < 5_000);
  } finally { await page.close(); }
});

test('Pixeon: menú de DIVs sin semántica elige solo todas las Series ZIP DCM', async () => {
  const page = await browser.newPage();
  try {
    await page.setContent([
      'Descargar Serie Actual - PNG',
      'Descargar todas las Series - PNG',
      'Descargar Serie Actual - ZIP DCM',
      'Descargar todas las Series - ZIP DCM',
      'Descargar todas las Series con Viewer - ZIP DCM',
    ].map((label, i) => `<div class="option" data-option="${i}">${label}</div>`).join(''));
    await page.evaluate(`document.querySelectorAll('.option').forEach((item) => item.addEventListener('click', () => window.choice = item.getAttribute('data-option')))`);
    const events: ProviderStructureEvent[] = [];
    const menu = await probePixeonDownload(page, 'menu', e => events.push(e));
    assert.equal(menu.menuOptions, 5);
    assert.ok(menu.control);
    await clickPixeonControl(menu.control!, page, e => events.push(e));
    assert.equal(await page.evaluate('window.choice'), '3');
  } finally { await page.close(); }
});

test('Pixeon: toolbar y menú dentro de shadow DOM abierto', async () => {
  const page = await browser.newPage();
  try {
    await page.setContent('<div id="host"></div>');
    await page.evaluate(`document.querySelector('#host').attachShadow({mode:'open'}).innerHTML = '<div role="button" onclick="this.nextElementSibling.hidden=false"><span>Descargar</span></div><section hidden><button onclick="window.choice=true">Descargar todas las Series - ZIP DCM</button></section>'`);
    const result = await probePixeonDownload(page, 'download', () => {});
    assert.ok(result.control);
    await clickPixeonControl(result.control, page, () => {});
    const menu = await probePixeonDownload(page, 'menu', () => {}, result.control.frame);
    assert.equal(menu.menuOptions, 1);
    await clickPixeonControl(menu.control!, page, () => {});
    assert.equal(await page.evaluate('window.choice'), true);
  } finally { await page.close(); }
});

for (const [attr, label] of [['data-label', 'Descargar'], ['data-tooltip', 'Descargar']] as const) {
  test(`Pixeon: finder DOM identifica ${attr} sin exponer su valor`, async () => {
    const page = await browser.newPage();
    try {
      await page.setContent(`<section><span>Restaurar</span><span>Ajustar al panel</span><span>Pantalla llena</span><span>Lista de Anotaciones</span><span>Configuraciones</span><div class="toolbar-item" style="width:100px;height:24px" ${attr}="${label}"></div></section>`);
      const events: ProviderStructureEvent[] = [];
      const result = await probePixeonDownload(page, 'download', e => events.push(e));
      assert.ok(result.control, 'el class de acción permite resolver el nodo vacío');
      const evidence = events.find(e => e.event === 'pixeon_dom_candidate');
      assert.equal(evidence?.matchedAttribute, attr);
      assert.equal(evidence?.parentClassSanitized, '');
      assert.ok(!JSON.stringify(events).includes(label), 'no se registran valores de atributos');
      assert.ok(events.some(e => e.event === 'pixeon_clickable_ancestor' && e.tag === 'div'));
    } finally { await page.close(); }
  });
}

test('Pixeon: acepta cookie overlay, espera hidden y no acepta un modal ajeno', async () => {
  const page = await browser.newPage();
  try {
    await page.setContent('<button onclick="window.clicked=true">Descargar</button><div role="dialog" style="position:fixed;inset:0;background:white"><p>Uso de cookies</p><button onclick="this.parentElement.remove()">Aceptar</button></div>');
    assert.equal(await handlePixeonCookieConsent(page, () => {}), true);
    assert.equal(await page.getByRole('dialog').count(), 0);
    const result = await probePixeonDownload(page, 'download', () => {});
    await clickPixeonControl(result.control!, page, () => {});
    assert.equal(await page.evaluate('window.clicked'), true);
    await page.setContent('<div role="dialog"><p>Confirmar operación</p><button onclick="window.unwanted=true">Aceptar</button></div>');
    assert.equal(await handlePixeonCookieConsent(page, () => {}), false);
    assert.equal(await page.evaluate('window.unwanted'), undefined);
  } finally { await page.close(); }
});

test('Pixeon: texto sin interacción se distingue de texto ausente', async () => {
  const page = await browser.newPage();
  try {
    await page.setContent('<div><span>Descargar</span></div>');
    const result = await probePixeonDownload(page, 'download', () => {});
    assert.equal(result.control, null);
    assert.ok(result.textMatches > 0);
    await page.setContent('<p>Sin acción de descarga</p>');
    const missing = await probePixeonDownload(page, 'download', () => {});
    assert.equal(missing.control, null);
    assert.equal(missing.textMatches, 0);
  } finally { await page.close(); }
});

test('Pixeon: overlay tardío intercepta click; acepta y reintenta una sola vez', async () => {
  const page = await browser.newPage();
  try {
    await page.setContent('<button onclick="window.clicked=(window.clicked||0)+1">Descargar</button>');
    const events: ProviderStructureEvent[] = [];
    const result = await probePixeonDownload(page, 'download', e => events.push(e));
    await page.evaluate(`document.body.insertAdjacentHTML('beforeend', '<div role="dialog" style="position:fixed;inset:0;background:white"><p>Consentimiento cookies</p><button onclick="this.parentElement.remove()">Aceptar</button></div>')`);
    await clickPixeonControl(result.control!, page, e => events.push(e));
    assert.equal(await page.evaluate('window.clicked'), 1);
    assert.ok(events.some(e => e.event === 'pixeon_download_click' && e.intercepted));
  } finally { await page.close(); }
});

test('Pixeon: no interactúa con frames fuera de la política existente', async () => {
  const page = await browser.newPage();
  try {
    await page.setContent('<iframe></iframe>');
    await page.frames()[1].setContent('<button onclick="window.clicked=true">Descargar</button>');
    const result = await probePixeonDownload(page, 'download', () => {}, undefined, f => f === page.mainFrame());
    assert.equal(result.control, null);
    assert.equal(await handlePixeonCookieConsent(page, () => {}, f => f === page.mainFrame()), false);
  } finally { await page.close(); }
});

test('Pixeon: fallback detecta toolbar repetitiva, la describe y no hace click sin señal semántica', async () => {
  const page = await browser.newPage();
  try {
    await page.setContent(`<div class="toolbar" style="display:flex;gap:12px">${Array.from({ length: 7 }, (_, i) => `<div class="tool-item" style="width:28px;height:28px;cursor:pointer" data-index="${i}"><svg><circle cx="10" cy="10" r="5"></circle></svg></div>`).join('')}</div>`);
    const events: ProviderStructureEvent[] = [];
    const result = await probePixeonDownload(page, 'download', e => events.push(e));
    assert.equal(result.control, null, 'la geometría sola no habilita clicks');
    assert.ok(events.some(e => e.event === 'pixeon_structural_fallback' && e.started));
    assert.ok(events.some(e => e.event === 'pixeon_toolbar_detected' && (e.candidates || 0) >= 5));
    const candidates = events.filter(e => e.event === 'toolbar_candidate');
    assert.ok(candidates.length >= 5);
    assert.ok(candidates.every(e => e.tag === 'div' && e.cursorPointer && typeof e.xBucket === 'number' && e.svgCount === 1));
    assert.ok(!JSON.stringify(events).includes('data-index'));
  } finally { await page.close(); }
});

test('Pixeon: el fallback estructural registra clases action/button sin click por clase sola', async () => {
  const page = await browser.newPage();
  try {
    await page.setContent('<div class="button-export" style="width:32px;height:32px">Acción</div>');
    const events: ProviderStructureEvent[] = [];
    const result = await probePixeonDownload(page, 'download', e => events.push(e));
    assert.equal(result.control, null, 'una clase genérica de botón no es una señal suficiente para clickear');
    assert.ok(events.some(e => e.event === 'toolbar_candidate' && e.classNamesSanitized === 'button-export'));
  } finally { await page.close(); }
});

test('Pixeon: data-action download resuelve locator estructural con señal semántica', async () => {
  const page = await browser.newPage();
  try {
    await page.setContent('<div data-action="download" onclick="window.downloaded=true" style="position:absolute;top:10px;width:32px;height:32px">Exportar</div>');
    const events: ProviderStructureEvent[] = [];
    const result = await probePixeonDownload(page, 'download', e => events.push(e));
    assert.ok(result.control);
    assert.ok(events.some(e => e.event === 'pixeon_download_structural_candidate' && e.found));
    await clickPixeonControl(result.control!, page, () => {});
    assert.equal(await page.evaluate('window.downloaded'), true);
    assert.ok(!JSON.stringify(events).includes('window.downloaded'));
  } finally { await page.close(); }
});

test('Pixeon: class SVG arrow-down es señal estructural; no se usan coordenadas', async () => {
  const page = await browser.newPage();
  try {
    await page.setContent('<div class="toolbar" style="display:flex;gap:10px"><div class="tool-item" style="width:30px;height:30px;cursor:pointer" onclick="window.downloaded=true"><svg class="icon-arrow-down"></svg></div></div>');
    const events: ProviderStructureEvent[] = [];
    const result = await probePixeonDownload(page, 'download', e => events.push(e));
    assert.ok(result.control);
    assert.ok(events.some(e => e.event === 'toolbar_candidate' && e.actionHint === 'download'));
    await clickPixeonControl(result.control!, page, () => {});
    assert.equal(await page.evaluate('window.downloaded'), true);
  } finally { await page.close(); }
});
