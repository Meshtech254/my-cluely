// Runs in an isolated extension world. No page-provided messages or model-supplied code.
function pageAction(operation, args = {}) {
  if (Array.isArray(operation)) [operation, args] = operation;
  const run = () => {
  if (operation === 'remove_cursor') { globalThis.__opencluelyCursor?.host.remove(); delete globalThis.__opencluelyCursor; return true; }
  if (operation === 'cursor') {
    let cursor = globalThis.__opencluelyCursor;
    if (!cursor?.host.isConnected) {
      const host = document.createElement('div'); host.setAttribute('data-opencluely-overlay', '');
      host.setAttribute('aria-hidden', 'true');
      host.style.cssText = 'all:initial;position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none';
      const root = host.attachShadow({ mode: 'closed' });
      root.innerHTML = '<style>:host{pointer-events:none}svg{filter:drop-shadow(0 1px 2px #0008)}span{display:block;background:#171c27;color:white;padding:3px 7px;border-radius:5px;font:12px system-ui;white-space:nowrap}i{position:absolute;left:-10px;top:-10px;width:26px;height:26px;border:3px solid #f6b747;border-radius:50%;box-sizing:border-box}</style><i hidden></i><svg width="23" height="28" viewBox="0 0 23 28"><path d="M2 2v21l6-6 5 9 4-2-5-9h9Z" fill="#f6b747" stroke="#171c27" stroke-width="2"/></svg><span></span>';
      document.documentElement.appendChild(host);
      cursor = globalThis.__opencluelyCursor = { host, caption: root.querySelector('span'), ring: root.querySelector('i') };
    }
    cursor.host.style.transform = `translate(${Math.max(0, Math.min(innerWidth - 24, args.x))}px,${Math.max(0, Math.min(innerHeight - 30, args.y))}px)`;
    cursor.caption.textContent = args.caption || 'OpenCluely'; cursor.ring.hidden = !args.click;
    return true;
  }
  const visible = e => !!e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden';
  const label = e => {
    const explicit = e.getAttribute('aria-label'); if (explicit) return explicit.trim();
    const labelled = e.getAttribute('aria-labelledby');
    if (labelled) return labelled.split(/\s+/).map(id => document.getElementById(id)?.textContent || '').join(' ').trim();
    if (e.labels?.length) {
      const copy = e.labels[0].cloneNode(true); copy.querySelectorAll('input,textarea,select,button').forEach(n => n.remove()); return copy.textContent.trim();
    }
    return (e.getAttribute('placeholder') || e.innerText || e.getAttribute('title') || '').trim();
  };
  const role = e => e.getAttribute('role') || ({ BUTTON: 'button', A: 'link', SELECT: 'combobox', TEXTAREA: 'textbox' }[e.tagName]) || (e.type === 'checkbox' ? 'checkbox' : e.type === 'radio' ? 'radio' : 'textbox');
  const protectedField = e => ['password', 'file', 'hidden'].includes(e.type) || /password|passcode|\botp\b|authenticat|verification code|api.?key|secret|card|\bcvv\b|captcha/i.test(`${label(e)} ${e.name} ${e.id} ${e.autocomplete}`);
  const elements = () => [...document.querySelectorAll('input,textarea,select,button,a,[role="button"],[role="checkbox"],[contenteditable="true"]')].filter(visible);
  const refs = globalThis.__opencluelyRefs ||= { next: 1, elements: new WeakMap(), byId: new Map() };
  const reference = e => { let id = refs.elements.get(e); if (!id) { id = `oc-${refs.next++}`; refs.elements.set(e, id); refs.byId.set(id, e); } return id; };
  for (const [id, e] of refs.byId) if (!e.isConnected) refs.byId.delete(id);
  const inViewport = e => { const r = e.getBoundingClientRect(); return r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth; };
  if (operation === 'inspect') {
    const all = elements();
    const items = [...all.filter(inViewport), ...all.filter(e => !inViewport(e))].slice(0, 120).map(e => ({ ref: reference(e), label: label(e).slice(0, 200), role: role(e), inViewport: inViewport(e), context: (e.closest('article,li,[role="listitem"]')?.innerText || '').replace(/\s+/g, ' ').slice(0, 350), type: e.type || e.tagName.toLowerCase(), required: !!e.required, invalid: e.validity ? !e.validity.valid : false,
      protected: protectedField(e), options: e.tagName === 'SELECT' ? [...e.options].slice(0, 100).map(o => ({ label: o.label.slice(0, 200), value: o.value.slice(0, 200) })) : undefined }));
    const clone = document.body.cloneNode(true); clone.querySelectorAll('script,style,input,textarea,select,[contenteditable="true"],[data-opencluely-overlay]').forEach(e => e.remove());
    const viewportText = [...document.querySelectorAll('h1,h2,h3,p,article,[role="listitem"]')].filter(e => visible(e) && inViewport(e)).slice(0, 50).map(e => e.innerText).join('\n').slice(0, 7000);
    return { url: location.href, focusedRef: all.includes(document.activeElement) ? reference(document.activeElement) : null, viewport: { x: scrollX, y: scrollY, width: innerWidth, height: innerHeight, pageHeight: document.documentElement.scrollHeight, text: viewportText }, structure: clone.textContent.replace(/\s+/g, ' ').slice(0, 14000), fields: items,
      validationErrors: [...document.querySelectorAll('[role="alert"]')].slice(0, 20).map(e => e.textContent.slice(0, 300)) };
  }
  const matches = args.ref ? [refs.byId.get(args.ref)].filter(e => e?.isConnected && visible(e) && label(e).slice(0, 200) === args.label && (!args.role || role(e) === args.role)) : elements().filter(e => label(e) === args.label && (!args.role || role(e) === args.role));
  if (matches.length !== 1) throw new Error('Field/control missing or ambiguous; use its exact visible label');
  const element = matches[0];
  if (element.disabled || element.readOnly) throw new Error('Control unavailable');
  if (operation === 'pointer_target') {
    if (element.matches('input[type=password],input[type=file]')) throw new Error('Protected control');
    element.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
    const r = element.getBoundingClientRect();
    const x = Math.max(0, Math.min(innerWidth - 1, r.x + r.width / 2)), y = Math.max(0, Math.min(innerHeight - 1, r.y + r.height / 2));
    const top = document.elementFromPoint(x, y);
    if (top !== element && !element.contains(top) && !(element.type === 'checkbox' && top?.contains(element))) throw new Error('Control is covered by another element; inspect the page first');
    return { x, y, checked: element.checked, ref: reference(element) };
  }
  if (operation === 'focus') {
    if (protectedField(element) || !(element.matches('input,textarea') || element.isContentEditable)) throw new Error('Protected or unsupported text field');
    element.scrollIntoView({ block: 'center' }); element.focus();
    // Remember identity in this isolated world so typing cannot silently move to another field.
    globalThis.__opencluelyField = element;
    return { focused: document.activeElement === element };
  }
  if (operation === 'verify_focus') return document.activeElement === element && globalThis.__opencluelyField === element && !protectedField(element);
  if (operation === 'click_element') { if (element.matches('input[type=password],input[type=file]')) throw new Error('Protected control'); element.click(); }
  else if (operation === 'select_option') {
    if (element.tagName !== 'SELECT' || ![...element.options].some(o => o.value === args.value && !o.disabled)) throw new Error('Option unavailable');
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; setter.call(element, args.value);
    element.dispatchEvent(new Event('input', { bubbles: true })); element.dispatchEvent(new Event('change', { bubbles: true }));
  } else if (operation === 'toggle_checkbox') {
    if (!element.matches('input[type=checkbox]')) throw new Error('Use a native checkbox');
    if (element.checked !== args.checked) element.click();
  } else if (operation !== 'wait_for_element') throw new Error('Unsupported page operation');
  return true;
  };
  try { return { ok: true, value: run() }; }
  catch (error) { return { ok: false, error: error.message }; }
}
if (typeof module !== 'undefined') module.exports = { pageAction };
