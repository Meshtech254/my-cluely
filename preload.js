const { contextBridge, ipcRenderer } = require('electron')

const subscribe = (channel, callback) => {
  if (typeof callback !== 'function') return () => {};
  const listener = (_event, ...args) => callback(undefined, ...args);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // Screenshot and OCR
  takeScreenshot: () => ipcRenderer.invoke('take-screenshot'),
  
  // Speech recognition
  startSpeechRecognition: () => ipcRenderer.invoke('start-speech-recognition'),
  stopSpeechRecognition: () => ipcRenderer.invoke('stop-speech-recognition'),
  sendAudioChunk: (buffer) => ipcRenderer.send('audio-chunk', { buffer }),
  getSpeechAvailability: () => ipcRenderer.invoke('get-speech-availability'),
  
  // Window management
  showAllWindows: () => ipcRenderer.invoke('show-all-windows'),
  hideAllWindows: () => ipcRenderer.invoke('hide-all-windows'),
  enableWindowInteraction: () => ipcRenderer.invoke('enable-window-interaction'),
  disableWindowInteraction: () => ipcRenderer.invoke('disable-window-interaction'),
  switchToChat: () => ipcRenderer.invoke('switch-to-chat'),
  switchToSkills: () => ipcRenderer.invoke('switch-to-skills'),
  resizeWindow: (width, height) => ipcRenderer.invoke('resize-window', { width, height }),
  moveWindow: (deltaX, deltaY) => ipcRenderer.invoke('move-window', { deltaX, deltaY }),
  getWindowStats: () => ipcRenderer.invoke('get-window-stats'),
  
  // Session memory
  getSessionHistory: () => ipcRenderer.invoke('get-session-history'),
  getLLMSessionHistory: () => ipcRenderer.invoke('get-llm-session-history'),
  clearSessionMemory: () => ipcRenderer.invoke('clear-session-memory'),
  formatSessionHistory: () => ipcRenderer.invoke('format-session-history'),
  sendChatMessage: (text) => ipcRenderer.invoke('send-chat-message', text),
  getSkillPrompt: (skillName) => ipcRenderer.invoke('get-skill-prompt', skillName),
  
  // Gemini LLM configuration
  setGeminiApiKey: (apiKey) => ipcRenderer.invoke('set-gemini-api-key', apiKey),
  setOpenAIApiKey: (apiKey) => ipcRenderer.invoke('set-openai-api-key', apiKey),
  getGeminiStatus: () => ipcRenderer.invoke('get-gemini-status'),
  testGeminiConnection: () => ipcRenderer.invoke('test-gemini-connection'),
  
  // Settings
  showSettings: () => ipcRenderer.invoke('show-settings'),
  hideSettings: () => ipcRenderer.invoke('hide-settings'),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
  knowledgeList: () => ipcRenderer.invoke('knowledge-list'),
  knowledgeRead: (id) => ipcRenderer.invoke('knowledge-read', id),
  knowledgeAddFiles: () => ipcRenderer.invoke('knowledge-add-files'),
  knowledgeAddUrl: (url) => ipcRenderer.invoke('knowledge-add-url', url),
  knowledgeSetEnabled: (id, enabled) => ipcRenderer.invoke('knowledge-set-enabled', id, enabled),
  knowledgeDelete: (id) => ipcRenderer.invoke('knowledge-delete', id),
  knowledgeRefresh: (id) => ipcRenderer.invoke('knowledge-refresh', id),
  knowledgeOptions: (options) => ipcRenderer.invoke('knowledge-options', options),

  // First-run onboarding
  getFirstRunStatus: () => ipcRenderer.invoke('get-first-run-status'),
  completeFirstRun: () => ipcRenderer.invoke('complete-first-run'),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  closeOnboarding: () => ipcRenderer.invoke('close-onboarding'),
  detectWhisper: () => ipcRenderer.invoke('detect-whisper'),
  installWhisper: () => ipcRenderer.invoke('install-whisper'),
  downloadWhisperModel: (modelName) => ipcRenderer.invoke('download-whisper-model', modelName),
  onInstallProgress: (callback) => subscribe('install-progress', (_event, line) => callback(line)),
  updateAppIcon: (iconKey) => ipcRenderer.invoke('update-app-icon', iconKey),
  updateActiveSkill: (skill) => ipcRenderer.invoke('update-active-skill', skill),
  restartAppForStealth: () => ipcRenderer.invoke('restart-app-for-stealth'),
  closeWindow: () => ipcRenderer.invoke('close-window'),
  notifyMainWindowReady: () => {
    try {
      ipcRenderer.send('main-window-ready');
    } catch (error) {
      console.error('Error notifying main window ready:', error);
    }
  },
  quit: () => {
    try {
      ipcRenderer.send('quit-app');
    } catch (error) {
      console.error('Error in quit:', error);
    }
  },
  
  // LLM window specific methods
  expandLlmWindow: (contentMetrics) => ipcRenderer.invoke('expand-llm-window', contentMetrics),
  resizeLlmWindowForContent: (contentMetrics) => ipcRenderer.invoke('resize-llm-window-for-content', contentMetrics),

  // Clipboard helper for reliable copy actions
  copyToClipboard: (text) => {
    try {
      return ipcRenderer.invoke('copy-to-clipboard', String(text ?? ''));
    } catch (e) {
      console.error('copyToClipboard failed:', e);
      return false;
    }
  },
  
  // Display management
  listDisplays: () => ipcRenderer.invoke('list-displays'),
  captureArea: (options) => ipcRenderer.invoke('capture-area', options),
  
  // Event listeners
  onTranscriptionReceived: (callback) => subscribe('transcription-received', callback),
  onInterimTranscription: (callback) => subscribe('interim-transcription', callback),
  onSpeechStatus: (callback) => subscribe('speech-status', callback),
  onSpeechError: (callback) => subscribe('speech-error', callback),
  onSpeechAvailability: (callback) => subscribe('speech-availability', callback),
  onSessionEvent: (callback) => subscribe('session-event', callback),
  onSessionCleared: (callback) => subscribe('session-cleared', callback),
  onOcrCompleted: (callback) => subscribe('ocr-completed', callback),
  onOcrError: (callback) => subscribe('ocr-error', callback),
  onLlmResponse: (callback) => subscribe('llm-response', callback),
  onLlmError: (callback) => subscribe('llm-error', callback),
  onTranscriptionLlmResponse: (callback) => subscribe('transcription-llm-response', callback),
  onTranscriptionLlmResponseStart: (callback) => subscribe('transcription-llm-response-start', callback),
  onTranscriptionLlmResponseChunk: (callback) => subscribe('transcription-llm-response-chunk', callback),
  onOpenGeminiConfig: (callback) => subscribe('open-gemini-config', callback),
  onDisplayLlmResponse: (callback) => subscribe('display-llm-response', callback),
  onShowLoading: (callback) => subscribe('show-loading', callback),
  onSkillChanged: (callback) => subscribe('skill-changed', callback),
  onInteractionModeChanged: (callback) => subscribe('interaction-mode-changed', callback),
  onRecordingStarted: (callback) => subscribe('recording-started', callback),
  onRecordingStopped: (callback) => subscribe('recording-stopped', callback),
  onCodingLanguageChanged: (callback) => subscribe('coding-language-changed', callback),
  onMainWindowShown: (callback) => subscribe('main-window-shown', callback),
  onSettingsWindowShown: (callback) => subscribe('settings-window-shown', callback)
})

contextBridge.exposeInMainWorld('api', {
    closeSettings: () => ipcRenderer.send('close-settings'),
    quit: () => ipcRenderer.send('quit-app'),
    saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
    updateSkill: (skill) => ipcRenderer.send('update-skill', skill),
    onLoadSettings: (callback) => subscribe('load-settings', (_event, settings) => callback(settings)),
    onInteractionModeChanged: (callback) => subscribe('interaction-mode-changed', (_event, value) => callback(value)),
    onSkillUpdated: (callback) => subscribe('skill-updated', (_event, value) => callback(value)),
    onUpdateSkill: (callback) => subscribe('update-skill', (_event, value) => callback(value))
});
