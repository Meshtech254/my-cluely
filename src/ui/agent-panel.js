document.addEventListener('DOMContentLoaded', async () => {
  const api = window.electronAPI;
  const panel = document.createElement('details'); panel.id = 'agentPanel';
  panel.innerHTML = `<summary>Desktop agent · <span id="agentState" role="status">idle</span></summary>
    <label>Mode <select id="agentMode"><option value="assist">Assist — explain only</option><option value="guided">Guided — approve actions</option><option value="auto" selected>Auto — perform the task</option></select></label>
    <label><input id="agentAutoApprove" type="checkbox" checked> Auto approve task actions</label>
    <p>On: perform the task without action prompts. Off: ask before each input action. You can change this while the task runs; an action already executing may finish.</p>
    <label>Target <select id="agentTarget"><option value="browser">New automation browser</option><option value="extension">Existing browser tab (extension)</option><option value="desktop">Windows applications</option></select></label>
    <details><summary>Connect browser extension</summary><p>Load the browser-extension folder as an unpacked extension in Chrome or Edge. Copy its ID here, register the connection, then click Connect and allow this tab in its popup.</p><label>Extension ID <input id="agentExtensionId" maxlength="32" placeholder="32-letter extension ID"></label><button id="agentInstallExtension">Register browser connection</button><button id="agentCheckExtension">Check connection</button><div id="agentExtensionStatus" role="status"></div></details>
    <label>Website (exact origin scope) <input id="agentUrl" type="url" placeholder="https://example.com"></label>
    <label>Application <select id="agentSource"></select></label>
    <label>Other windows this task may switch to <select id="agentWindows" multiple size="3" aria-label="Approved additional windows"></select></label>
    <label>Typing delay per character (ms) <input id="agentTypingDelay" type="number" min="10" max="250" value="65"></label>
    <label>Task time limit (minutes) <input id="agentDuration" type="number" min="1" max="30" value="30"></label>
    <p>Keep the connected browser tab active. A gold pointer shows browser movement and clicks; text appears character by character. Tasks can run for up to 30 minutes and may finish sooner when complete.</p>
    <label>Knowledge profile <select id="agentProfile"><option value="">No personal knowledge</option></select></label>
    <button id="agentRefresh">Refresh windows/profiles</button>
    <label>Task <textarea id="agentTask" rows="3" maxlength="4000" placeholder="Fill the form using the selected CV and leave it ready for review."></textarea></label>
    <p>A URL alone opens the website in Guided or Auto without an AI call. Assist mode only explains actions and cannot navigate.</p>
    <div><button id="agentStart">Start task</button> <button id="agentPause">Pause</button> <button id="agentResume">Resume</button> <button id="agentStop">Stop</button></div>
    <p>Emergency stop: Ctrl+Alt+Shift+X. Extension stop: Ctrl+Shift+Y. With Auto approve off, review actions before they run. For manual desktop approval, focus the selected app during the 3-second countdown.</p>
    <p>Starting sends your task, selected knowledge profile and page contents to the configured AI provider. Desktop mode also sends screenshots of the selected window. Screenshots and field values are held in memory for this session.</p>
    <div id="agentPermission"></div><div id="agentPlanned"></div><div id="agentError" role="alert"></div>
    <div id="agentApproval" hidden role="group" aria-label="Action approval"><strong>Review this action — it may send data or change the selected application.</strong><pre id="agentApprovalText"></pre><button id="agentApprove">Approve this action</button> <button id="agentDecline">Decline and stop</button></div>
    <strong>Fields for review (local display)</strong><pre id="agentFields"></pre><pre id="agentSummary" aria-live="polite"></pre>
    <details><summary>Recent screenshot — coordinates use physical desktop pixels</summary><img id="agentImage" alt="Selected target screenshot" hidden></details>
    <details><summary>Activity log</summary><pre id="agentLog"></pre></details>`;
  const style = document.createElement('style');
  style.textContent = '#agentPanel{box-sizing:border-box;width:520px;max-height:650px;overflow:auto;background:#171c27;color:#eee;border:1px solid #667;border-radius:8px;padding:8px;font:12px/1.5 system-ui;-webkit-app-region:no-drag}#agentPanel label{display:block;margin:6px 0}#agentPanel textarea{display:block;width:95%}#agentPanel input,#agentPanel select,#agentPanel textarea,#agentPanel button{background:#263044;color:white;border:1px solid #778;border-radius:4px;padding:4px;max-width:95%}#agentPanel button{margin:3px;cursor:pointer}#agentPanel pre{white-space:pre-wrap;overflow-wrap:anywhere}#agentPanel p{font-size:11px;color:#c3c9d4}#agentError{color:#ffb4a9}#agentApproval{border:2px solid #dbb45a;padding:8px}#agentImage{max-width:100%}';
  document.head.appendChild(style); document.body.appendChild(panel);
  const $ = name => document.getElementById(`agent${name}`);
  let taskActive = false;
  try { $('AutoApprove').checked = localStorage.getItem('agentAutoApprove') !== 'false'; } catch (_) {}
  const syncAutoApprove = () => { $('AutoApprove').disabled = $('Mode').value !== 'auto'; };
  $('Mode').addEventListener('change', syncAutoApprove); syncAutoApprove();
  const run = async fn => { try { $('Error').textContent = ''; await fn(); } catch (e) { $('Error').textContent = e.message; } };
  const refresh = async () => {
    const [sources, profiles] = await Promise.all([api.monitoringSources(), api.knowledgeList()]);
    $('Source').replaceChildren(...sources.filter(s => s.id.startsWith('window:')).map(s => new Option(s.name, s.id)));
    $('Windows').replaceChildren(...sources.filter(s => s.id.startsWith('window:')).map(s => new Option(s.name, s.id)));
    $('Profile').replaceChildren(new Option('No personal knowledge', ''), ...profiles.filter(s => s.enabled).map(s => new Option(s.name, s.id)));
  };
  const render = state => {
    $('State').textContent = state.state;
    $('Permission').textContent = `Mode: ${state.mode || 'assist'} · Target: ${state.targetLabel || state.target || 'none'} · ${state.permission ? 'control session active' : 'no control permission'}`;
    $('Planned').textContent = state.planned ? `Planned: ${state.planned.name} ${state.planned.label}` : state.phase === 'planning_started' ? 'Planning next action…' : '';
    $('Error').textContent = state.error ? `${state.error.reason} (Task ${state.taskId})` : '';
    $('Approval').hidden = !state.approval;
    $('ApprovalText').textContent = state.approval ? JSON.stringify(state.approval, null, 2) : '';
    $('Fields').textContent = state.fields.map(f => `${f.label}: ${f.value}`).join('\n');
    $('Summary').textContent = `${state.summary}\n${state.missing.length ? 'Missing / left empty: ' + state.missing.join(', ') : ''}`;
    $('Log').textContent = state.log.join('\n');
    $('Image').hidden = !state.image; if (state.image) $('Image').src = `data:image/png;base64,${state.image}`;
    const active = !['idle', 'completed', 'stopped', 'blocked'].includes(state.state);
    taskActive = active;
    if (active) $('Mode').value = state.mode;
    if (active && state.mode === 'auto') $('AutoApprove').checked = state.autoApprove === true;
    syncAutoApprove();
    $('Start').disabled = active;
    for (const name of ['Mode', 'Target', 'Url', 'Source', 'Profile', 'Task', 'Refresh', 'Windows', 'TypingDelay', 'Duration', 'InstallExtension', 'ExtensionId']) $(name).disabled = active;
    window.mainWindowUI?.resizeWindowToContent();
  };
  const checkExtension = async () => { const state = await api.agentExtensionStatus(); if (state.tab) $('Target').value = 'extension'; $('ExtensionStatus').textContent = state.tab ? `Connected: ${state.tab.title} (${state.tab.url}). Existing browser tab selected.` : 'No tab allowed. Open the extension popup in your browser.'; };
  const actions = { Refresh: refresh, CheckExtension: checkExtension, InstallExtension: async () => { await api.agentExtensionInstall($('ExtensionId').value.trim()); $('Target').value = 'extension'; $('ExtensionStatus').textContent = 'Registered. Existing browser tab selected. Click the OpenCluely extension icon in your browser, then Connect and allow this tab.'; },
    Start: () => api.agentStart({ instruction: $('Task').value, mode: $('Mode').value, autoApprove: $('Mode').value === 'auto' && $('AutoApprove').checked, target: $('Target').value, url: $('Url').value, sourceId: $('Source').value, profileId: $('Profile').value, typingDelay: Number($('TypingDelay').value), durationMinutes: Number($('Duration').value), allowedWindowIds: [...$('Windows').selectedOptions].map(option => option.value) }),
    Pause: () => api.agentPause(), Resume: () => api.agentResume(), Stop: () => api.agentStop(), Approve: () => api.agentApprove(true), Decline: () => api.agentApprove(false) };
  for (const [name, action] of Object.entries(actions)) $(name).addEventListener('click', () => run(action));
  $('AutoApprove').addEventListener('change', () => {
    const enabled = $('AutoApprove').checked;
    try { localStorage.setItem('agentAutoApprove', String(enabled)); } catch (_) {}
    if (taskActive) run(() => api.agentSetAutoApprove(enabled));
  });
  api.onAgentStatus((_event, state) => render(state));
  new ResizeObserver(() => window.mainWindowUI?.resizeWindowToContent()).observe(panel);
  panel.addEventListener('toggle', () => window.mainWindowUI?.resizeWindowToContent());
  await run(refresh); await run(async () => render(await api.agentStatus()));
});
