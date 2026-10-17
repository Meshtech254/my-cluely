document.addEventListener('DOMContentLoaded', () => {    
    const logger = {
        info: (...args) => console.log('[SettingsWindowUI]', ...args)
    };

    // Get DOM elements
    const closeButton = document.getElementById('closeButton');
    const quitButton = document.getElementById('quitButton');
    const speechProviderSelect = document.getElementById('speechProvider');
    const azureKeyInput = document.getElementById('azureKey');
    const azureRegionInput = document.getElementById('azureRegion');
    const whisperCommandInput = document.getElementById('whisperCommand');
    const whisperModelInput = document.getElementById('whisperModel');
    const whisperLanguageInput = document.getElementById('whisperLanguage');
    const whisperDeviceSelect = document.getElementById('whisperDevice');
    const whisperCaptureModeSelect = document.getElementById('whisperCaptureMode');
    const whisperResponseTargetSelect = document.getElementById('whisperResponseTarget');
    const whisperSegmentMsInput = document.getElementById('whisperSegmentMs');
    const geminiKeyInput = document.getElementById('geminiKey');
    const llmProviderSelect = document.getElementById('llmProvider');
    const openaiKeyInput = document.getElementById('openaiKey');
    const openaiModelInput = document.getElementById('openaiModel');
    const windowGapInput = document.getElementById('windowGap');
    const codingLanguageSelect = document.getElementById('codingLanguage');
    const activeSkillSelect = document.getElementById('activeSkill');
    const translateScreenInput = document.getElementById('translateScreen');
    const iconGrid = document.getElementById('iconGrid');

    // Check if window.api exists
    if (!window.api) {
        console.error('window.api not available');
        return;
    }

    // Request current settings when window opens
    const requestCurrentSettings = () => {
        if (window.electronAPI && window.electronAPI.getSettings) {
            window.electronAPI.getSettings().then(settings => {
                loadSettingsIntoUI(settings);
            }).catch(error => {
                console.error('Failed to get settings:', error);
            });
        }
    };

    // Close button handler
    if (closeButton) {
        closeButton.addEventListener('click', () => {
            window.api.closeSettings();
        });
    }

    // Quit button handler with multiple attempts
    if (quitButton) {
        quitButton.addEventListener('click', () => {
            try {
                // Try multiple ways to quit the app
                if (window.api && window.api.quit) {
                    window.api.quit();
                }
                
                // Also try the electron API if available
                if (window.electronAPI && window.electronAPI.quit) {
                    window.electronAPI.quit();
                }
                
                // Fallback: close the window
                setTimeout(() => {
                    window.close();
                }, 500);
                
            } catch (error) {
                console.error('Error quitting app:', error);
                window.close();
            }
        });
    }

    // Function to load settings into UI
    const loadSettingsIntoUI = (settings) => {
        if (settings.speechProvider && speechProviderSelect) speechProviderSelect.value = settings.speechProvider;
        // Always set the input value, even if empty, so the user sees what's
        // currently configured (including env-derived defaults). Previously
        // empty strings were skipped which left stale UI values.
        if (azureKeyInput) {
            azureKeyInput.value = settings.azureKey || '';
            azureKeyInput.placeholder = settings.azureConfigured
                ? 'Saved securely — leave blank to keep current key'
                : 'Enter your Azure key';
        }
        if (azureRegionInput) azureRegionInput.value = settings.azureRegion || '';
        if (whisperCommandInput) whisperCommandInput.value = settings.whisperCommand || '';
        if (whisperModelInput) whisperModelInput.value = settings.whisperModel || 'base';
        if (whisperLanguageInput) whisperLanguageInput.value = settings.whisperLanguage || '';
        if (whisperDeviceSelect) whisperDeviceSelect.value = settings.whisperDevice || 'cpu';
        if (whisperCaptureModeSelect) whisperCaptureModeSelect.value = settings.whisperCaptureMode || 'vad';
        if (whisperResponseTargetSelect) whisperResponseTargetSelect.value = settings.whisperResponseTarget || 'both';
        if (whisperSegmentMsInput) whisperSegmentMsInput.value = settings.whisperSegmentMs || '';
        if (geminiKeyInput) {
            geminiKeyInput.value = settings.geminiKey || '';
            geminiKeyInput.placeholder = settings.geminiConfigured
                ? 'Saved securely — leave blank to keep current key'
                : 'Enter your Google API key';
        }
        if (llmProviderSelect) llmProviderSelect.value = settings.llmProvider || 'gemini';
        if (openaiKeyInput) {
            openaiKeyInput.value = '';
            openaiKeyInput.placeholder = settings.openaiConfigured ? 'Saved securely — leave blank to keep current key' : 'Enter your OpenAI API key';
        }
        if (openaiModelInput) openaiModelInput.value = settings.openaiModel || 'gpt-4o-mini';
        if (windowGapInput) windowGapInput.value = settings.windowGap || '';

        // Set C++ as default if no coding language is specified
        if (codingLanguageSelect) {
            codingLanguageSelect.value = settings.codingLanguage || 'cpp';
        }

        if (settings.activeSkill && activeSkillSelect) activeSkillSelect.value = settings.activeSkill;
        if (translateScreenInput) translateScreenInput.checked = settings.translateScreen === true;

        // Handle icon selection
        const selectedIcon = settings.selectedIcon || settings.appIcon;
        if (selectedIcon && iconGrid) {
            const iconOptions = iconGrid.querySelectorAll('.icon-option');
            iconOptions.forEach(option => {
                if (option.dataset.icon === selectedIcon) {
                    option.classList.add('selected');
                } else {
                    option.classList.remove('selected');
                }
            });
        }

        updateSpeechFieldStates();
    };

    // Load settings when window opens
    window.api.onLoadSettings((settings) => {
        loadSettingsIntoUI(settings);
    });

    // Listen for settings window shown event
    if (window.electronAPI && window.electronAPI.onSettingsWindowShown) {
        window.electronAPI.onSettingsWindowShown(() => {
            requestCurrentSettings();
        });

    // Listen for coding language changes from other windows via helper
    window.electronAPI.onCodingLanguageChanged((event, data) => {
            if (data && data.language && codingLanguageSelect) {
                codingLanguageSelect.value = data.language;
                console.log('Language updated from overlay window:', data.language);
            }
    });
    }

    // Save settings helper function
    const saveSettings = () => {
        const settings = {};
        if (speechProviderSelect) settings.speechProvider = speechProviderSelect.value;
        if (azureKeyInput) settings.azureKey = azureKeyInput.value;
        if (azureRegionInput) settings.azureRegion = azureRegionInput.value;
        if (whisperCommandInput) settings.whisperCommand = whisperCommandInput.value;
        if (whisperModelInput) settings.whisperModel = whisperModelInput.value;
        if (whisperLanguageInput) settings.whisperLanguage = whisperLanguageInput.value;
        if (whisperDeviceSelect) settings.whisperDevice = whisperDeviceSelect.value;
        if (whisperCaptureModeSelect) settings.whisperCaptureMode = whisperCaptureModeSelect.value;
        if (whisperResponseTargetSelect) settings.whisperResponseTarget = whisperResponseTargetSelect.value;
        if (whisperSegmentMsInput) settings.whisperSegmentMs = whisperSegmentMsInput.value;
        if (geminiKeyInput) settings.geminiKey = geminiKeyInput.value;
        if (llmProviderSelect) settings.llmProvider = llmProviderSelect.value;
        if (openaiKeyInput) settings.openaiKey = openaiKeyInput.value;
        if (openaiModelInput) settings.openaiModel = openaiModelInput.value;
        if (windowGapInput) settings.windowGap = windowGapInput.value;
        if (codingLanguageSelect) settings.codingLanguage = codingLanguageSelect.value;
        if (activeSkillSelect) settings.activeSkill = activeSkillSelect.value;
        if (translateScreenInput) settings.translateScreen = translateScreenInput.checked;
        
        window.api.saveSettings(settings);
    };

    const updateSpeechFieldStates = () => {
        const provider = speechProviderSelect ? speechProviderSelect.value : 'azure';

        // Show/hide provider-specific field groups instead of just disabling
        // them. This keeps the settings UI clean — only the relevant fields
        // for the selected provider are visible.
        const azureGroup = document.getElementById('azureFields');
        const whisperGroup = document.getElementById('whisperFields');
        const azureNote = document.getElementById('azureFieldsNote');

        if (azureGroup) {
            azureGroup.style.display = provider === 'azure' ? '' : 'none';
        }
        if (whisperGroup) {
            whisperGroup.style.display = provider === 'whisper' ? '' : 'none';
        }
        if (azureNote) {
            azureNote.style.display = provider === 'azure' ? '' : 'none';
        }

        // Also toggle disabled attribute for any leftover direct field refs
        [azureKeyInput, azureRegionInput].forEach(input => {
            if (input) input.disabled = provider !== 'azure';
        });
        [whisperCommandInput, whisperModelInput, whisperLanguageInput, whisperDeviceSelect,
            whisperCaptureModeSelect, whisperResponseTargetSelect, whisperSegmentMsInput].forEach(input => {
            if (input) input.disabled = provider !== 'whisper';
        });
    };

    // Add event listeners for all inputs
    const inputs = [
        azureKeyInput,
        azureRegionInput,
        whisperCommandInput,
        whisperModelInput,
        whisperLanguageInput,
        whisperDeviceSelect,
        whisperCaptureModeSelect,
        whisperResponseTargetSelect,
        whisperSegmentMsInput,
        geminiKeyInput,
        openaiKeyInput,
        openaiModelInput,
        windowGapInput
    ];

    if (llmProviderSelect) llmProviderSelect.addEventListener('change', saveSettings);

    inputs.forEach(input => {
        if (input) {
            input.addEventListener('change', saveSettings);
            input.addEventListener('blur', saveSettings);
        }
    });

    if (speechProviderSelect) {
        speechProviderSelect.addEventListener('change', () => {
            updateSpeechFieldStates();
            saveSettings();
        });
    }

    // Language selection handler
    if (codingLanguageSelect) {
        codingLanguageSelect.addEventListener('change', (e) => {
            const lang = e.target.value;
            // use electronAPI so main broadcast is consistent
            if (window.electronAPI && window.electronAPI.saveSettings) {
                window.electronAPI.saveSettings({ codingLanguage: lang });
            } else {
                // fallback
                saveSettings();
            }
        });
    }

    // Skill selection handler
    if (activeSkillSelect) {
        activeSkillSelect.addEventListener('change', (e) => {
            saveSettings();
            // Also update the main window
            window.api.updateSkill(e.target.value);
        });
    }
    if (translateScreenInput) translateScreenInput.addEventListener('change', saveSettings);

    updateSpeechFieldStates();

    // Initialize icon grid with correct paths
    const initializeIconGrid = () => {
        if (!iconGrid) return;

        const icons = [
            { key: 'terminal', name: 'Terminal', src: './assests/icons/terminal.png' },
            { key: 'activity', name: 'Activity', src: './assests/icons/activity.png' },
            { key: 'settings', name: 'Settings', src: './assests/icons/settings.png' }
        ];

        iconGrid.innerHTML = '';

        icons.forEach(icon => {
            const iconElement = document.createElement('div');
            iconElement.className = 'icon-option';
            iconElement.dataset.icon = icon.key;
            
            const img = document.createElement('img');
            img.src = icon.src;
            img.alt = icon.name;
            img.onload = () => {
                logger.info('Icon loaded successfully:', icon.src);
            };
            img.onerror = () => {
                console.error('Failed to load icon:', icon.src);
                // Try alternative paths
                const altPaths = [
                    `./assests/${icon.key}.png`,
                    `./assets/icons/${icon.key}.png`,
                    `./assets/${icon.key}.png`
                ];
                
                let pathIndex = 0;
                const tryNextPath = () => {
                    if (pathIndex < altPaths.length) {
                        img.src = altPaths[pathIndex];
                        pathIndex++;
                    } else {
                        img.style.display = 'none';
                        console.error('All icon paths failed for:', icon.key);
                    }
                };
                
                img.onload = () => {
                    logger.info('Icon loaded with alternative path:', img.src);
                };
                
                img.onerror = tryNextPath;
                tryNextPath();
            };
            
            const label = document.createElement('div');
            label.textContent = icon.name;
            
            iconElement.appendChild(img);
            iconElement.appendChild(label);
            
            // Click handler for icon selection
            iconElement.addEventListener('click', () => {                
                // Remove selection from all icons
                iconGrid.querySelectorAll('.icon-option').forEach(opt => {
                    opt.classList.remove('selected');
                });
                
                // Add selection to clicked icon
                iconElement.classList.add('selected');
                
                // Save the selection - this should trigger the app icon change
                window.api.saveSettings({ selectedIcon: icon.key });
                
                // Show visual feedback
                iconElement.style.transform = 'scale(0.95)';
                setTimeout(() => {
                    iconElement.style.transform = 'scale(1)';
                }, 100);
            });
            
            iconGrid.appendChild(iconElement);
        });
    };

    const knowledgeSources = document.getElementById('knowledgeSources');
    const knowledgeStatus = document.getElementById('knowledgeStatus');
    const knowledgeMode = document.getElementById('knowledgeMode');
    const prioritizeCv = document.getElementById('prioritizeCv');
    const knowledgeMaxChunks = document.getElementById('knowledgeMaxChunks');
    const knowledgeMaxChars = document.getElementById('knowledgeMaxChars');
    const setKnowledgeStatus = (message) => { if (knowledgeStatus) knowledgeStatus.textContent = message || ''; };
    const loadKnowledge = async () => {
        if (!window.electronAPI?.knowledgeList || !knowledgeSources) return;
        try {
            const result = await window.electronAPI.knowledgeList();
            if (knowledgeMode) knowledgeMode.value = result.options.mode;
            if (prioritizeCv) prioritizeCv.checked = !!result.options.prioritizeCv;
            if (knowledgeMaxChunks) knowledgeMaxChunks.value = result.options.maxChunks || 4;
            if (knowledgeMaxChars) knowledgeMaxChars.value = result.options.maxChars || 6000;
            knowledgeSources.replaceChildren();
            for (const source of result.sources) {
                const row = document.createElement('div'); row.className = 'settings-item';
                const info = document.createElement('div'); info.className = 'settings-stack';
                const name = document.createElement('div'); name.className = 'settings-item-label'; name.textContent = source.name;
                const detail = document.createElement('div'); detail.className = 'settings-item-description';
                detail.textContent = `${source.type} · ${new Date(source.addedAt).toLocaleDateString()} · ${source.status}${source.origin ? ` · ${source.origin}` : ''}`;
                info.append(name, detail);
                const enabled = document.createElement('input'); enabled.type = 'checkbox'; enabled.checked = !!source.enabled; enabled.title = 'Use this source';
                enabled.addEventListener('change', async () => { await window.electronAPI.knowledgeSetEnabled(source.id, enabled.checked); });
                row.append(info, enabled);
                const view = document.createElement('button'); view.className = 'btn'; view.textContent = 'View';
                view.addEventListener('click', async () => {
                    const content = await window.electronAPI.knowledgeRead(source.id);
                    if (!content) return;
                    document.getElementById('knowledgeViewerTitle').textContent = content.name;
                    document.getElementById('knowledgeViewerText').textContent = content.text;
                    document.getElementById('knowledgeViewer').showModal();
                });
                row.appendChild(view);
                if (source.type === 'website') {
                    const refresh = document.createElement('button'); refresh.className = 'btn'; refresh.textContent = 'Refresh';
                    refresh.addEventListener('click', async () => { try { await window.electronAPI.knowledgeRefresh(source.id); setKnowledgeStatus('Website refreshed.'); await loadKnowledge(); } catch (e) { setKnowledgeStatus(e.message); } });
                    row.appendChild(refresh);
                }
                const remove = document.createElement('button'); remove.className = 'btn btn-danger'; remove.textContent = 'Delete';
                remove.addEventListener('click', async () => { await window.electronAPI.knowledgeDelete(source.id); setKnowledgeStatus('Source deleted.'); await loadKnowledge(); });
                row.appendChild(remove); knowledgeSources.appendChild(row);
            }
        } catch (error) { setKnowledgeStatus(error.message || 'Could not load local sources.'); }
    };

    document.getElementById('knowledgeAddFiles')?.addEventListener('click', async () => {
        try {
            const result = await window.electronAPI.knowledgeAddFiles();
            const errors = result.errors || [];
            setKnowledgeStatus(errors.length ? errors.map((item) => `${item.name}: ${item.error}`).join(' · ') : `${result.added.length} source(s) added.`);
            await loadKnowledge();
        } catch (error) { setKnowledgeStatus(error.message); }
    });
    document.getElementById('knowledgeAddUrl')?.addEventListener('click', async () => {
        const url = window.prompt('Enter a public HTTPS website URL:');
        if (!url) return;
        try { await window.electronAPI.knowledgeAddUrl(url); setKnowledgeStatus('Website indexed.'); await loadKnowledge(); }
        catch (error) { setKnowledgeStatus(error.message || 'Website could not be indexed.'); }
    });
    const saveKnowledgeOptions = async () => {
        try { await window.electronAPI.knowledgeOptions({ mode: knowledgeMode?.value, prioritizeCv: prioritizeCv?.checked, maxChunks: Number(knowledgeMaxChunks?.value), maxChars: Number(knowledgeMaxChars?.value) }); }
        catch (error) { setKnowledgeStatus(error.message); }
    };
    knowledgeMode?.addEventListener('change', saveKnowledgeOptions);
    prioritizeCv?.addEventListener('change', saveKnowledgeOptions);
    knowledgeMaxChunks?.addEventListener('change', saveKnowledgeOptions);
    knowledgeMaxChars?.addEventListener('change', saveKnowledgeOptions);
    if (window.electronAPI?.onSettingsWindowShown) window.electronAPI.onSettingsWindowShown(loadKnowledge);
    loadKnowledge();
    document.getElementById('knowledgeViewerClose')?.addEventListener('click', () => document.getElementById('knowledgeViewer').close());

    // Initialize icon grid
    initializeIconGrid();

    // Request settings on load
    setTimeout(() => {
        requestCurrentSettings();
    }, 200);

    // ESC key to close
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            window.api.closeSettings();
        }
    });
}); 
