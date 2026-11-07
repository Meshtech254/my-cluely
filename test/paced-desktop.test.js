const test = require('node:test');
const assert = require('node:assert/strict');
const Desktop = require('../src/services/automation-desktop');
test('desktop paced input can pause, resume and abort between characters', async () => {
  const desktop = new Desktop({ capture: {}, displays: () => [] }); const abort = new AbortController();
  desktop.signal = abort.signal; desktop.handle = 10; desktop.typingDelay = 15;
  desktop.inspect = async () => ({ foreground: 10 });
  let text = '';
  desktop.request = async (op, args) => { if (op === 'type_character') text += args.value; return {}; };
  const typing = desktop.execute({ name: 'fill_field', args: { label: 'Fictional field', value: 'abcdefghij' } });
  const rejected = assert.rejects(typing, /abort/i);
  while (text.length < 2) await new Promise(r => setTimeout(r, 5));
  desktop.pause(); const partial = text; await new Promise(r => setTimeout(r, 50)); assert.equal(text, partial);
  desktop.resume(); while (text.length < 4) await new Promise(r => setTimeout(r, 5)); abort.abort(); await rejected;
  const stopped = text; await new Promise(r => setTimeout(r, 40)); assert.equal(text, stopped); assert.ok(text.length < 10);
});
test('desktop window switching and application launches require approval and explicit allowlists', async () => {
  const desktop = new Desktop({ capture: {}, displays: () => [] });
  desktop.approvedWindows = [{ id: 'window:10:0', name: 'Fictional editor' }]; let selected;
  desktop.switchTo = async window => { selected = window; return {}; };
  await assert.rejects(desktop.execute({ name: 'switch_window', args: { label: 'Fictional editor' } }), /approval/);
  await assert.rejects(desktop.execute({ name: 'switch_window', args: { label: 'Unapproved email' } }, true), /not approved/);
  await desktop.execute({ name: 'switch_window', args: { label: 'Fictional editor' } }, true); assert.equal(selected.id, 'window:10:0');
  await assert.rejects(desktop.openApplication('powershell'), /allowlist/);
});
