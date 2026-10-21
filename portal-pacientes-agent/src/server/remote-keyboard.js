import keysyms from '/remote-assets/core/input/keysymdef.js';
import KeyTable from '/remote-assets/core/input/keysym.js';

// noVNC's textarea/input fallback, adapted to erase committed text immediately.
// RFB remains the only transport. No clipboard, credential endpoint or storage.
export function mobileKeyboard({ input, toggle, tools, desktop, connection }) {
  const sentinel = '\u200b';
  let composing = false, pending;
  const reset = () => { input.value = sentinel; input.setSelectionRange(1, 1); };
  const send = keysym => connection()?.sendKey(keysym);
  function commit() {
    clearTimeout(pending);
    if (composing) return;
    const value = input.value;
    if (!value.startsWith(sentinel)) send(KeyTable.XK_BackSpace);
    for (const char of value.replace(sentinel, '')) {
      send(char === '\n' ? KeyTable.XK_Return : char === '\t' ? KeyTable.XK_Tab : keysyms.lookup(char.codePointAt(0)));
    }
    reset();
  }
  function close() {
    clearTimeout(pending); composing = false; input.value = ''; input.blur();
    tools.hidden = true; toggle.setAttribute('aria-expanded', 'false'); toggle.textContent = 'Abrir teclado';
    const current = connection(); if (current) current.focusOnClick = true;
  }
  function focus() {
    // Must be synchronous in the user's tap for Safari/Chrome's native keyboard.
    if (!connection()) return;
    tools.hidden = false; toggle.setAttribute('aria-expanded', 'true'); toggle.textContent = 'Cerrar teclado';
    connection().focusOnClick = false;
    reset(); input.focus({ preventScroll: true });
  }
  toggle.addEventListener('click', () => tools.hidden ? focus() : close());
  input.addEventListener('beforeinput', event => {
    if (composing || event.isComposing || !event.cancelable) return;
    const key = { deleteContentBackward: KeyTable.XK_BackSpace, insertLineBreak: KeyTable.XK_Return, insertParagraph: KeyTable.XK_Return }[event.inputType];
    if (key) { event.preventDefault(); send(key); reset(); }
  });
  input.addEventListener('input', event => { if (!composing && !event.isComposing) commit(); });
  input.addEventListener('compositionstart', () => { clearTimeout(pending); composing = true; });
  input.addEventListener('compositionend', () => { composing = false; pending = setTimeout(commit, 0); });
  input.addEventListener('keydown', event => {
    event.stopPropagation(); // Never forward a second printable key via canvas Keyboard.
    if (composing || event.isComposing || event.keyCode === 229) return;
    const key = { Enter: KeyTable.XK_Return, Tab: KeyTable.XK_Tab, Escape: KeyTable.XK_Escape }[event.key];
    if (key) { event.preventDefault(); send(key); reset(); }
  });
  input.addEventListener('blur', close);
  tools.querySelectorAll('[data-remote-key]').forEach(button => {
    button.addEventListener('pointerdown', event => event.preventDefault());
    button.addEventListener('click', () => {
      if (button.dataset.remoteKey === 'close') { close(); return; }
      // Explicit navigation must not leave an unfinished word for the next remote field.
      composing = false; commit();
      send({ tab: KeyTable.XK_Tab, enter: KeyTable.XK_Return, backspace: KeyTable.XK_BackSpace }[button.dataset.remoteKey]);
      input.focus({ preventScroll: true });
    });
  });
  // Preserve input focus while noVNC handles a tap on a different remote field.
  desktop.addEventListener('pointerdown', () => { if (!tools.hidden) input.focus({ preventScroll: true }); });
  // Same focus guard as noVNC's keepVirtualKeyboard: preserve VNC mouse events,
  // but suppress the browser's default focus change to its focusable canvas.
  desktop.addEventListener('mousedown', event => { if (document.activeElement === input) event.preventDefault(); }, true);
  function viewport() {
    document.documentElement.style.setProperty('--remote-viewport', Math.round(window.visualViewport?.height || window.innerHeight) + 'px');
  }
  window.visualViewport?.addEventListener('resize', () => { viewport(); if (!tools.hidden) tools.scrollIntoView({ block: 'nearest' }); });
  window.visualViewport?.addEventListener('scroll', viewport);
  window.addEventListener('resize', viewport);
  window.addEventListener('orientationchange', viewport);
  window.addEventListener('pagehide', close);
  viewport();
  return { close };
}
