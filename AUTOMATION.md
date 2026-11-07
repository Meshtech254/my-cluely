# Windows desktop agent

This adds an opt-in task controller to the existing Electron overlay. Existing chat, screenshot analysis, monitoring and speech services remain separate. No frontend framework or replacement Electron application was introduced.

## Run

From PowerShell in the repository:

```powershell
npm install
# Optional when Microsoft Edge is installed; otherwise required:
npx playwright install chromium
npm start
```

Configure Gemini or OpenAI in the existing Settings. Import a CV through the existing knowledge-base settings. Each enabled source is independently selectable as a knowledge profile; select the CV intended for this task. No profile means no stored personal knowledge is supplied. Use separate CV sources for separate profiles.

Expand **Desktop agent** in the existing floating overlay. Choose Assist, Guided or Auto, an exact website URL or specific Windows application, and a knowledge profile. Enter a task such as “Fill this application using the selected CV and leave it ready for review.” Click **Start task**.

To use your existing Chrome/Edge tabs, install [the browser extension](browser-extension/README.md), register its ID through **Connect browser extension**, allow a tab from its popup, and choose **Existing browser tab (extension)** in the overlay. The extension uses an authenticated local named pipe through native messaging; no local web server or remotely accessible control port is introduced. It does not start tasks from website content.

All text entry is paced character by character. Adjust **Typing delay per character** from 10–250 ms (default 65 ms). Pause/resume checks occur between characters; Stop aborts the task. An explicit writing request can use `compose_text` to create original prose. Factual personal fields still require source-grounded `fill_field`.

- Assist explains a plan without launching a browser or controlling the desktop.
- Guided asks before each input action.
- Auto with **Auto approve task actions** enabled performs task-scoped input, navigation, writing, app switching and allowed app launches without action prompts. This is the default UI setting and is remembered locally. Turning the switch off requires approval before each subsequent input action. Turning it on while awaiting approval resumes the pending action. An executing action may finish before a changed setting takes effect. Guided mode always requests approval.
- With Auto approve off, review the actual selected page/application, proposed action, values and field summary before approving. With it on, starting the task authorizes actions within that task and selected target; it does not expand website or application scope, grant instructions from page content, or allow protected fields.
- For desktop approval, focus the selected application during the three-second countdown. An overlay covering a target coordinate causes rejection. Resize or move the overlay as needed. Desktop screenshots are shown in the panel; coordinate values use physical virtual-desktop pixels, including negative origins.
- Pause prevents the next action; an already executing action may finish. Resume continues. Stop aborts provider requests and closes the active automation browser/worker. **Ctrl+Alt+Shift+X** is the global emergency stop. Locking or suspending the desktop also stops automation.
- Successful browser completion leaves the isolated browser open for manual review, with no further planned actions. Stop or starting a new task closes it. Browser session cookies survive steps in that browser only; they are not imported from your usual browser or retained across new tasks.
- The extension works in the tab and existing login session you explicitly allow. Completion/Stop detaches automation and leaves that tab open. Auto approve authorizes task actions without individual prompts; otherwise input needs approval. Use the extension's **Stop & disconnect** or Ctrl+Shift+Y to revoke permission.
- For PC tasks, select **Other windows this task may switch to** before starting. `switch_window` can select only those windows or the initial one. `open_application` can launch Notepad, Calculator or File Explorer after approval and selects a uniquely identified new window. Windows can deny foreground activation; focus the approved app manually when prompted. No arbitrary executable paths or arguments are accepted.

Starting sends the task, selected profile and page content to the configured provider. Desktop mode additionally sends window screenshots. Field summaries and screenshots stay in application memory; the agent does not write screenshot files or form values to activity logs. The browser/website and provider have their own storage and retention behavior.

## Architecture and guardrails

`automation.service.js` owns the state machine, single-action execution loop, approval gate and cancellation. Defaults: 600 actions, a selectable 1–30 minute task budget (30 by default), three consecutive execution failures, 2,000,000 cumulative reported AI tokens, 600 screenshots, and 20 browser navigation requests. Provider requests have a 45-second timeout; browser navigation 15 seconds and element actions six seconds. The token ceiling is checked after each response before acting; an in-flight provider request can consume tokens beyond the remaining allowance. There are no automatic navigation retries. Missing elements trigger a fresh inspection before replanning; consecutive failures stop the task. Three scrolls without viewport progress stop rather than loop. Extension inspection prioritizes controls in the viewport and provides stable control references and nearby product context. Trusted debugger mouse events perform clicks, with a visible gold in-page pointer; this does not move the operating system cursor. Playwright browser actions also display this pointer.

`automation-policy.js` supplies tool JSON schemas and an independent strict main-process validator. Only the named tools and exact argument keys/types/ranges are accepted. No model-provided JavaScript, selectors, shell commands, paths, process names or executable code can run. The preload exposes start/status/pause/resume/stop/approval operations, through the existing trusted main-frame IPC checks. It does not expose a raw action executor.

`automation-browser.js` uses Playwright semantic locators, readiness checks, accessible snapshots, visible field metadata and validation alerts. It launches a fresh Chromium session, falling back to an isolated installed Edge session on Windows if Chromium is missing. It does not attach to existing tabs. Browser scope is exactly the initial origin, including port. Cross-origin requests and popups are blocked. Non-read requests and fetch/XHR require an approved action; unexpected navigation also requires approval. Service workers, downloads and dialogs are disabled/dismissed. The next action is rejected and replanned when page state changed after planning. Fixed application-owned DOM inspection functions are used; the model cannot supply code.

`automation-desktop.js` runs the fixed `windows-agent.ps1` worker with JSON lines over stdin/stdout. It uses Windows UI Automation and documented Win32 input APIs instead of a native Node addon requiring Electron ABI rebuilds. The worker reads the selected HWND, foreground window, physical bounds and available semantic controls. Coordinate targets must fall in the selected window and a display, have a recent screenshot (15 seconds maximum), unchanged window bounds and pass a native top-window hit test. The worker checks foreground ownership again. Mouse and key down/up events are sent together to prevent a held modifier or button across cancellation. Unicode typing is supported; native readonly/password Edit controls are rejected in the focused-field fallback. Desktop semantic fill and invoke are preferred. If accessibility is missing, a reviewed coordinate click followed by a separately approved `fill_field` with label `__focused_text_field__` can type into a focused native Edit control. Fallback typing appends; select existing text explicitly when replacement is intended. Arbitrary custom, terminal and browser contenteditable controls are not supported by that fallback.

Knowledge is selected explicitly and bounded to 16,000 characters. Lines identifying credentials are excluded. Automatic text filling requires an exact supporting source quote containing the value (or a value explicitly present in the user's task). Unsupported facts remain empty. Guided narrative generation requires review. This is a conservative grounding check, not proof that a CV is accurate or that a fact is appropriate for a field. Inspect the real form before submitting. Page, screenshot and knowledge content cannot alter scope, mode, tools or approvals. The prompt and validation tests cover representative injection attempts; this is not a universal guarantee against every malicious website.

## Tests

AI planning retries transient connection failures and HTTP 408/429/500/502/503/504 responses up to four attempts within the existing shared 45-second planning deadline. Backoff honors Retry-After, reports retry progress in the task log, and stops immediately on task cancellation. Authentication and missing-model errors do not retry. Outages, rate limits and access failures have separate error messages. Only planning requests are retried; already executed computer actions are not replayed.

```powershell
npm test                   # unit/regression and mocked provider contracts
npm run check:syntax
npm run test:automation    # real headless Chromium/Edge + localhost fixture
npm run test:desktop       # briefly opens and controls a fictional Windows form
npm run test:ui            # hidden Electron overlay + real preload; mocked backend
npm run test:extension     # real native host subprocess and authenticated pipe transport
npm run test:extension:ui  # actual MV3 extension, isolated browser profile, fictional form
npm run test-speech        # existing installed Whisper diagnostic
```

`test/fixtures/agent-form.html` contains a local example application, deliberately unknown certificate field, password field, dynamic field, external link and hostile instruction text. Browser E2E imports a fictional CV through the real knowledge base, fills and verifies text/dropdown/checkbox values, leaves unknown information empty, produces a review summary, verifies zero submissions, and exercises navigation, protected fields and dynamic elements. The E2E uses a deterministic planner; no live provider credentials or real personal data are needed. Provider tool-call wiring is separately tested with mocked Gemini/OpenAI responses.

The native fixture tests window inspection, cursor movement, double-click, text entry, Ctrl+A/Backspace, scrolling and out-of-window rejection. It requires an interactive unlocked Windows desktop. The test explicitly shows its fixture window; an invisible fixture cannot pass hit-testing. This environment exposed no named UI Automation field, so text entry was verified through the guarded native Edit fallback. Semantic UI Automation filling is implemented but was not verified against an application exposing a usable control tree. Some native text controls do not implement Ctrl+A; use a supported control or semantic fill. Multi-monitor and negative-origin bounds have unit coverage, not physical multi-monitor hardware verification.

## Verified in this implementation session

- `npm test`: 69 passing regression tests include knowledge, streaming, monitoring, OCR, strict extension framing, installer contracts, approval gates, automatic authorization, live Auto approve switching, transient provider recovery and paced-input scheduling.
- Real browser E2E: passed using installed Edge; no submission occurred.
- The original native input fixture passed mouse movement, double-click, text entry, shortcut deletion and scope rejection. The paced-input rerun encountered Windows foreground denial and a changed fictional input value; the current scheduling, pause/resume and cancellation have separate unit coverage. The test remains available and reports failure rather than bypassing foreground checks. Native semantic UI Automation and live cross-application switching still require verification on an unlocked desktop.
- Actual unpacked MV3 extension passed in an isolated Edge profile: popup, inspection, trusted per-character input, partial text, pause/resume, dropdown, checkbox, origin/secret/approval guards and mid-typing cancellation, with no submission. A fixture-only localhost host permission substitutes for the real toolbar's activeTab user gesture in the headless test. Production extension permissions are unchanged.
- Real native host ↔ authenticated named-pipe transport passed, including split Unicode frames and disconnect rejection. Installer registry calls are mocked in unit tests; tests do not register the extension in your own browser.
- Hidden Electron UI: passed monitoring and agent start, approval, field/missing summary, stop and panel sizing.
- Syntax checks passed.
- `npm run test-speech`: failed because the local Whisper CLI is not installed/available in this environment. No live microphone transcription was verified.
- Chromium download failed with network resets/DNS errors; installed Edge provided the tested fallback.

## Current limitations

Live Gemini/OpenAI planning calls have not been exercised with real credentials. Model/tool compatibility depends on the configured model; unsupported tool calling produces a visible blocked error. Token accounting is a task limit, not a provider billing cap.

Desktop operation is deliberately more conservative than browser Auto. UI Automation support varies by application; custom dropdowns, checkboxes and inaccessible controls may need reviewed coordinate actions or manual input. Only the three named Windows apps have launch tools; open other applications manually and approve their windows before starting. Window discovery after launch currently depends on unique English window titles. Apps that reuse an existing window or a different localized title can require manual window selection.

File uploads, file deletion, software installation, payments, authentication entry, CAPTCHA/MFA solving and security changes have no dedicated automation tools. Native clicks can still activate consequential controls; with Auto approve on, the task must explicitly authorize the requested outcome. Auto approve does not expand task scope. Keep secrets out of the selected profile and screenshots. Existing knowledge documents themselves remain on disk under the application's existing storage policy.

The isolated Playwright browser's strict same-origin networking can prevent sites that depend on external CDNs, third-party login or background APIs from functioning. The extension permits ordinary static resources but blocks cross-origin document navigation and unapproved mutations/fetch/XHR while a task is attached. Existing website requests, service workers and site behaviors may already be running in your real tab; attachment does not isolate or sandbox that website. An approved input may autosave characters as they arrive. Start a new user-scoped task for another origin; never expand scope based on instructions from a page. Complex frames and multi-tab workflows are not implemented. Review each destination and input before approval.

Single-monitor native interaction was tested. Mixed-DPI/multi-monitor hardware, elevated apps/UAC, protected desktops and packaged installer execution were not verified. Windows input cannot control higher-integrity apps or bypass OS security. The PowerShell worker is included in `asarUnpack`; local PowerShell execution policy can block it and must be handled by the machine's normal administration policy. No policy bypass is applied.

No app rebuild, packaging, deployment or unrelated migration was performed.

Official API references: [Playwright locators](https://playwright.dev/docs/locators), [Windows SendInput](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-sendinput).
