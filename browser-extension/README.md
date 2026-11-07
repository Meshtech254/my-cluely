# Install in Chrome or Edge on Windows

1. Start the desktop app from the project with `npm start`.
2. Open `chrome://extensions` (Chrome) or `edge://extensions` (Edge).
3. Enable **Developer mode**, click **Load unpacked**, and select this `browser-extension` folder.
4. Copy the extension's 32-letter ID. In OpenCluely, expand **Desktop agent → Connect browser extension**, paste the ID and click **Register browser connection**. This registers a native messaging host for your Windows account; administrator privileges are not required.
5. Visit the website you want to use. Click the OpenCluely extension toolbar icon, then **Connect and allow this tab**. Pin the extension if you want easy access.
6. In the desktop panel, choose **Existing browser tab (extension)** and click **Check connection**. Select your knowledge profile when needed, set typing delay, enter a task and start it.

Examples:

- “Fill this form using my selected CV. Leave unsupported fields empty and stop before submission.”
- “Draft a polite reply in the Message body saying I will review the proposal tomorrow. Do not send it.”
- “Type this into the Notes field: Meeting starts at 10.”

In Auto mode, **Auto approve task actions** runs clicks, typing, scrolling and navigation without action prompts. It is on by default and remembers your switch preference. Turn it off to approve each input action, including during a task. Turning it on while an action is awaiting approval resumes that action. An action already executing may finish when you turn the switch off. Guided mode always asks. Auto approval is limited to the task and the selected tab; login, protected fields and website boundaries remain enforced. You will see characters appear in the real page, rather than a separate automation browser. The website receives normal browser input events. Not every custom editor is supported; fields need a usable accessible label. Typing does not include simulated typos or bypass website access restrictions.

Pause/resume in OpenCluely pauses between characters. **Stop & disconnect** in the extension or **Ctrl+Shift+Y** stops the extension immediately and revokes the tab. **Ctrl+Alt+Shift+X** stops the desktop agent. Browsers may reserve a shortcut; inspect `chrome://extensions/shortcuts` or `edge://extensions/shortcuts` if needed.

The companion app must remain running. No API keys are stored in the extension. The extension uses `activeTab`, `scripting`, `debugger`, and `nativeMessaging`; it has no blanket website permission and no page-to-native message listener. Chrome/Edge shows a debugging notice while a task controls the selected tab. Opening DevTools or cancelling that notice can detach the agent and stop the task. Internal browser/store pages, cross-origin frames and CAPTCHA/MFA interactions are unsupported.

Keep the allowed tab active while it runs. Browser actions display a gold in-page pointer that moves to the target, shows clicks, and labels typing; this is separate from the Windows system pointer. Text is typed character by character. Product controls with repeated names are distinguished using their inspected references and nearby product text. Tasks have a selectable 1–30 minute time limit (30 by default), and stop sooner when complete, cancelled, blocked, or unable to make progress. Enable **Auto approve task actions** for unattended execution within the selected task scope.

After updating these extension files, click **Reload** on the extension at `chrome://extensions` or `edge://extensions`, refresh the website tab, then reconnect it. Install the rebuilt desktop app too to receive the task-duration and planner changes.

Only one browser connection is supported at a time. Register the ID from the browser you actually use. If the extension folder moves or its ID changes, register the new ID and reconnect. Registration creates `com.opencluely.agent` entries under your account's Chrome and Edge `NativeMessagingHosts` keys and stores the launcher/config in OpenCluely's user-data directory. It does not change browser security policy. The actual registry registration and toolbar permission grant must be completed on your own browser; automated tests do not modify your browser profile or registry.

The native launcher currently requires Windows and a normal Electron build with RunAsNode support. After updating or moving the app, click Register again so the launcher points to the current installation. Restricted corporate browser policy can prevent native messaging or debugging.

This extension controls web tabs. **Windows applications** in the desktop app controls your PC: select the initial app and any additional windows that may be used, then describe the task. Auto approve also covers allowed app launches and switching selected windows. With it off, these actions require individual approval. You can navigate folders in the selected Explorer window. Other installed apps can be controlled after you open and select them. Arbitrary shell commands, unrestricted file access and installation are not exposed; external submissions must be explicitly requested in the task.

Full architecture, tests and remaining limitations: [AUTOMATION.md](../AUTOMATION.md).

Official references: [Chrome native messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging), [Chrome debugger API](https://developer.chrome.com/docs/extensions/reference/api/debugger).
