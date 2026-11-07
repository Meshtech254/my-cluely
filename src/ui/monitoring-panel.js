document.addEventListener('DOMContentLoaded', async () => {
  const api = window.electronAPI;
  const panel = document.createElement('details');
  panel.id = 'monitoringPanel'; panel.open = false;
  panel.innerHTML = `
    <summary>Live copilot <span id="liveStatus" role="status">Screen stopped · Audio off</span></summary>
    <div class="live-controls">
      <label>Screen/window <select id="liveSource" aria-label="Screen or window"></select></label>
      <button id="liveRefresh">Refresh sources</button>
      <div><button id="liveStart">Start Monitoring</button> <button id="livePause">Pause</button>
      <button id="liveResume">Resume</button> <button id="liveStop">Stop</button></div>
      <label>Answers <select id="liveMode"><option value="suggest">Suggest Only</option><option value="auto">Auto Answer</option></select></label>
      <label>Response <select id="liveResponse"><option value="quick">Quick</option><option value="detailed">Detailed</option><option value="interview">Interview</option></select></label>
      <label>Capture interval (seconds) <input id="liveInterval" type="number" min="1" max="60" value="2"></label>
      <label>AI cooldown (seconds) <input id="liveCooldown" type="number" min="1" max="120" value="8"></label>
      <label>Exclude window titles (comma separated) <input id="liveExclusions" placeholder="Password manager, Banking"></label>
      <label><input id="liveLock" type="checkbox" checked> Pause screen and audio on lock/sleep</label>
      <label><input id="liveVisual" type="checkbox"> Allow image fallback for diagrams or missing OCR</label>
      <label>Audio input <select id="liveAudioSource"><option value="">Default microphone</option></select></label>
      <label><input id="liveConsent" type="checkbox"> I have permission to capture this audio and other participants have consented.</label>
      <div><button id="liveAudioStart">Start Audio Listening</button> <button id="liveAudioPause">Pause Audio</button></div>
      <p class="live-notice">OCR and Whisper run locally. Auto Answer sends detected questions, recent screen text, speech and relevant knowledge to your configured AI provider. Image fallback may also send a screenshot. Suggest Only waits for Answer. Frames are held in memory only. Screen capture covers the selected source. Title exclusions apply to window capture; select a window to avoid sensitive apps on a whole display. For system audio, select an enabled Windows loopback / Stereo Mix input if available.</p>
      <div id="liveError" role="alert"></div><div id="liveOcr"></div><button id="liveRetryOcr">Retry local OCR</button>
      <strong>Detected question</strong><div id="liveQuestion"></div>
      <button id="liveApprove">Answer</button> <button id="liveCancel">Cancel answer</button> <button id="liveClear">Clear session</button>
      <pre id="liveAnswer" aria-live="polite"></pre>
      <details><summary>Recent answers</summary><div id="liveHistory"></div></details>
    </div>`;
  const style = document.createElement('style');
  style.textContent = `#monitoringPanel{box-sizing:border-box;width:540px;max-height:580px;overflow:auto;background:rgba(16,18,24,.96);color:#eee;border:1px solid #555;border-radius:8px;padding:8px;font:12px/1.45 system-ui;-webkit-app-region:no-drag}#monitoringPanel summary{cursor:pointer}#liveStatus{font-size:11px;color:#a9d7b4;margin-left:8px}.live-controls>label{display:block;margin:6px 0}#monitoringPanel select,#monitoringPanel input:not([type=checkbox]){max-width:300px;background:#222;color:#fff;border:1px solid #777;border-radius:4px;padding:3px}#monitoringPanel input[type=number]{width:55px}#monitoringPanel button{background:#303747;color:white;border:1px solid #778;border-radius:4px;padding:4px 7px;margin:3px 0;cursor:pointer}.live-notice{color:#c1c4cd;font-size:11px}#liveError{color:#ffb4a9}#liveAnswer{white-space:pre-wrap;overflow-wrap:anywhere;font:13px/1.5 system-ui;max-height:220px;overflow:auto}#liveHistory p{white-space:pre-wrap;border-top:1px solid #555;padding-top:8px}`;
  style.textContent += '#monitoringPanel{width:520px}';
  document.head.appendChild(style); document.body.appendChild(panel);
  const $ = id => document.getElementById(id);
  const run = async action => { try { $('liveError').textContent = ''; return await action(); } catch (error) { $('liveError').textContent = error.message; } };
  const refresh = async () => {
    const selected = $('liveSource').value; const sources = await api.monitoringSources();
    $('liveSource').replaceChildren(...sources.map(s => new Option(s.name, s.id)));
    if (sources.some(s => s.id === selected)) $('liveSource').value = selected;
    const audio = await navigator.mediaDevices.enumerateDevices();
    const chosenAudio = $('liveAudioSource').value;
    $('liveAudioSource').replaceChildren(new Option('Default microphone', ''), ...audio.filter(d => d.kind === 'audioinput' && d.deviceId !== 'default').map((d, i) => new Option(d.label || `Audio input ${i + 1}`, d.deviceId)));
    $('liveAudioSource').value = chosenAudio;
  };
  const configure = () => api.monitoringConfigure({ mode: $('liveMode').value, responseMode: $('liveResponse').value,
    interval: Number($('liveInterval').value) * 1000, cooldown: Number($('liveCooldown').value) * 1000,
    exclusions: $('liveExclusions').value, pauseOnLock: $('liveLock').checked, visualFallback: $('liveVisual').checked });
  for (const id of ['liveMode', 'liveResponse', 'liveInterval', 'liveCooldown', 'liveExclusions', 'liveLock', 'liveVisual']) $(id).addEventListener('change', () => run(configure));
  const actions = { liveRefresh: refresh, liveStart: async () => { await configure(); await api.monitoringStart($('liveSource').value); },
    livePause: () => api.monitoringPause(), liveResume: () => api.monitoringResume(), liveStop: () => api.monitoringStop(), liveRetryOcr: () => api.monitoringRetryOcr(),
    liveApprove: () => api.monitoringApprove(), liveCancel: () => api.monitoringCancel(),
    liveClear: async () => { await api.clearSessionMemory(); $('liveAnswer').textContent = ''; },
    liveAudioStart: async () => {
      if (!$('liveConsent').checked) throw new Error('Confirm audio consent before listening.');
      window.liveAudioDeviceId = $('liveAudioSource').value;
      await api.monitoringAudio(true);
    }, liveAudioPause: () => api.monitoringAudio(false) };
  for (const [id, action] of Object.entries(actions)) $(id).addEventListener('click', () => run(action));
  $('liveConsent').addEventListener('change', () => { if (!$('liveConsent').checked) run(() => api.monitoringAudio(false)); });
  api.onMonitoringEvent((_event, data) => {
    if (data.type === 'status') {
      $('liveStatus').textContent = `Screen ${data.state} · Audio ${data.audio ? 'LISTENING' : 'off'}`;
      $('liveQuestion').textContent = data.question || 'Waiting for a readable question in the selected source.'; $('liveError').textContent = data.error;
      $('liveApprove').disabled = !data.question;
      $('liveMode').value = data.options.mode; $('liveOcr').textContent = data.ocr;
      $('liveHistory').replaceChildren(...data.history.map(item => { const p = document.createElement('p'); p.textContent = `${item.question}\n${item.answer}`; return p; }));
    } else if (data.type === 'answer-start') $('liveAnswer').textContent = '';
    else if (data.type === 'answer-chunk') $('liveAnswer').textContent = ($('liveAnswer').textContent + data.delta).slice(-20000);
    else if (data.type === 'answer-end') $('liveAnswer').textContent = data.answer;
  });
  const observer = new ResizeObserver(() => window.mainWindowUI?.resizeWindowToContent());
  observer.observe(panel);
  await run(refresh); await api.monitoringStatus();
});
