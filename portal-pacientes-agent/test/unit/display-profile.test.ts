import assert from 'node:assert/strict';
import { test } from 'node:test';
import { contextDisplayOptions, DISPLAY_COMPATIBILITY, displaySize } from '../../src/browser/display-profile.js';
test('provider compatibility keeps desktop UA and allows a touch responsive context without isMobile layout changes', () => {
  for (const provider of ['centrodm', 'percamb', 'rdcchacabuco']) {
    assert.equal(DISPLAY_COMPATIBILITY[provider].responsive, true); assert.equal(DISPLAY_COMPATIBILITY[provider].mobileUA, false);
  }
  assert.equal(contextDisplayOptions('responsive').userAgent, undefined);
  assert.deepEqual(contextDisplayOptions('responsive').viewport, { width: 390, height: 844 });
  assert.deepEqual(contextDisplayOptions('desktop').viewport, { width: 1180, height: 820 });
  assert.equal(contextDisplayOptions('responsive').isMobile, false); assert.equal(contextDisplayOptions('responsive').hasTouch, true);
  assert.equal(contextDisplayOptions('mobile-emulation').isMobile, true); assert.match(contextDisplayOptions('mobile-emulation').userAgent!, /Mobile/);
  assert.deepEqual(displaySize('mobile', 40, 9000), { width: 320, height: 844 });
  assert.deepEqual(displaySize('mobile', 844, 278), { width: 844, height: 278 });
  assert.deepEqual(displaySize('desktop', 390, 720), { width: 1180, height: 820 });
});
