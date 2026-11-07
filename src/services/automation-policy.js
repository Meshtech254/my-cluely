const { URL } = require('node:url');
// The model receives these schemas, but the main process always validates again.
const text = { type: 'string', minLength: 1, maxLength: 4000 };
const short = { type: 'string', minLength: 1, maxLength: 200 };
const number = { type: 'integer', minimum: -100000, maximum: 100000 };
const schemas = {
  open_url: { url: text }, inspect_page: {},
  open_application: { app: { type: 'string', enum: ['notepad', 'calculator', 'explorer'] } },
  switch_window: { label: short },
  click_element: { label: short, role: { type: 'string', enum: ['button', 'link', 'checkbox', 'radio', 'menuitem', 'tab'] } },
  fill_field: { label: short, value: text, sourceQuote: text },
  compose_text: { label: short, value: text },
  select_option: { label: short, value: short }, toggle_checkbox: { label: short, checked: { type: 'boolean' } },
  scroll: { delta: { type: 'integer', minimum: -2000, maximum: 2000 } },
  press_key: { key: { type: 'string', enum: ['Tab', 'Shift+Tab', 'Enter', 'Escape', 'ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Control+A', 'Backspace'] } },
  move_mouse: { x: number, y: number },
  click_coordinates: { x: number, y: number, button: { type: 'string', enum: ['left', 'right'] }, count: { type: 'integer', minimum: 1, maximum: 2 } },
  capture_screen: {}, wait_for_element: { label: short },
  stop_task: { summary: text, missing: { type: 'array', items: short, maxItems: 40 } }
};
const referenced = new Set(['click_element', 'fill_field', 'compose_text', 'select_option', 'toggle_checkbox', 'wait_for_element']);
const refSchema = { type: 'string', minLength: 1, maxLength: 30, pattern: '^oc-[0-9]+$' };
const tools = Object.entries(schemas).map(([name, properties]) => ({ name,
  description: name === 'fill_field' ? 'Fill a non-secret field. sourceQuote must quote the selected knowledge supporting the value; use USER for information explicitly in the task. Unsupported fields stay empty.' : `Perform ${name} within the selected target only.`,
  parameters: { type: 'object', properties, required: Object.keys(properties), additionalProperties: false } }));
function toolsForTarget(target) {
  const desktopOnly = new Set(['open_application', 'switch_window', 'move_mouse', 'click_coordinates']);
  return tools.filter(t => target === 'desktop' || !desktopOnly.has(t.name)).map(t => target === 'extension' && referenced.has(t.name)
    ? { ...t, parameters: { ...t.parameters, properties: { ...t.parameters.properties, ref: refSchema } } } : t);
}
function validateValue(value, schema) {
  if (schema.type === 'string') return typeof value === 'string' && value.length >= (schema.minLength || 0) && value.length <= (schema.maxLength || 100000) && (!schema.enum || schema.enum.includes(value));
  if (schema.type === 'integer') return Number.isInteger(value) && value >= schema.minimum && value <= schema.maximum;
  if (schema.type === 'boolean') return typeof value === 'boolean';
  if (schema.type === 'array') return Array.isArray(value) && value.length <= schema.maxItems && value.every(v => validateValue(v, schema.items));
  return false;
}
function validateAction(action) {
  if (!action || typeof action !== 'object' || Array.isArray(action) || Object.keys(action).some(k => !['name', 'args'].includes(k))) throw new Error('Invalid action envelope');
  const schema = typeof action.name === 'string' && Object.hasOwn(schemas, action.name) ? schemas[action.name] : null; const args = action.args;
  if (!schema || !args || typeof args !== 'object' || Array.isArray(args) || Object.keys(args).some(k => !Object.hasOwn(schema, k) && !(k === 'ref' && referenced.has(action.name))) || Object.entries(schema).some(([k, s]) => !validateValue(args[k], s)) || (args.ref !== undefined && (typeof args.ref !== 'string' || !/^oc-\d+$/.test(args.ref)))) throw new Error('Invalid automation tool arguments');
  if (['fill_field', 'compose_text'].includes(action.name) && sensitive(action.args.label)) throw new Error('Secret or authentication fields require manual entry');
  if (['fill_field', 'compose_text'].includes(action.name) && /\b(?:sk-[A-Za-z0-9_-]{16,}|AIza[A-Za-z0-9_-]{20,}|AKIA[A-Z0-9]{16})\b|-----BEGIN .*PRIVATE KEY-----|\b\d{13,19}\b/.test(action.args.value)) throw new Error('Potential secret or payment value requires manual entry');
  if (action.name === 'compose_text' && /^(?:full name|first name|last name|email|phone|date|employer|certificate|qualification|salary|address)$/i.test(action.args.label.trim())) throw new Error('Factual personal fields must use source-grounded fill_field');
  return action;
}
function sensitive(label) { return /password|passcode|\botp\b|authenticat|security code|verification code|api.?key|secret|card|\bcvv\b|\bcvc\b|captcha/i.test(label); }
function scopedUrl(raw, origin) {
  const url = new URL(raw);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) throw new Error('Use HTTPS, or HTTP on localhost for testing');
  if (origin && url.origin !== origin) throw new Error('Navigation outside the selected origin is blocked. Start a new task for that site.');
  return url;
}
function navigationRequest(instruction, suppliedUrl = '') {
  const text = typeof instruction === 'string' ? instruction.trim() : '';
  if (typeof suppliedUrl !== 'string') throw new Error('Website URL must be text');
  const match = text.match(/(?:https?:\/\/|(?:javascript|data|file|ftp|chrome|edge|about|mailto):)[^\s<>"']+/i);
  const url = suppliedUrl.trim() || match?.[0].replace(/[.,;!?]+$/, '') || '';
  const rest = url ? text.replace(url, '').trim() : text;
  const navigationOnly = !!url && /^(?:(?:please\s+)?(?:open|visit|browse|navigate(?:\s+to)?|go\s+to)(?:\s+(?:this|the)\s+(?:website|url|page|site))?)?[.!]?$/i.test(rest);
  return { url, instruction: text || url, navigationOnly };
}
function agentError(code, message) { return Object.assign(new Error(message), { code, diagnosticReason: message }); }
function needsApproval(action, mode, target, autoApprove) {
  if (['inspect_page', 'capture_screen', 'wait_for_element', 'stop_task'].includes(action.name)) return false;
  if (mode === 'auto' && autoApprove === true) return false;
  if (autoApprove === false) return true;
  // A click or keystroke can submit, purchase, publish, or delete regardless of its label.
  return mode === 'guided' || target === 'desktop' || target === 'extension' || ['compose_text', 'open_application', 'switch_window', 'open_url', 'click_element', 'click_coordinates', 'press_key', 'select_option', 'toggle_checkbox'].includes(action.name);
}
module.exports = { tools, toolsForTarget, validateAction, sensitive, scopedUrl, needsApproval, navigationRequest, agentError };
