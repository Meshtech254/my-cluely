document.getElementById('id').textContent = chrome.runtime.id;
const show = state => { document.getElementById('status').textContent = state.error || (state.connected ? `Connected\n${state.tab?.title || ''}\n${state.tab?.url || ''}` : 'Disconnected. Open the desktop app and register the extension ID.'); };
for (const [id, op] of [['connect', 'connect'], ['stop', 'disconnect']]) document.getElementById(id).onclick = async () => {
  try { show(await chrome.runtime.sendMessage({ op })); } catch (error) { show({ error: error.message }); }
};
chrome.runtime.sendMessage({ op: 'status' }).then(show);
setInterval(() => chrome.runtime.sendMessage({ op: 'status' }).then(show).catch(() => {}), 1000);
