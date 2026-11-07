const { agentError } = require('./automation-policy');

const transient = new Set([408, 429, 500, 502, 503, 504]);

function providerError(status, attempts) {
  const suffix = attempts > 1 ? ` after ${attempts} attempts` : '';
  if ([500, 502, 503, 504, 408].includes(status)) return agentError('AI_UNAVAILABLE', `AI service temporarily unavailable (HTTP ${status})${suffix}. Try again later or choose another model in Settings.`);
  if (status === 429) return agentError('AI_RATE_LIMITED', `AI provider rate limit or quota reached (HTTP 429)${suffix}. Wait before retrying, or check your provider quota and billing.`);
  if ([401, 403].includes(status)) return agentError('AI_AUTH_ERROR', `AI provider denied access (HTTP ${status}). Check the API key and model permissions in Settings.`);
  if (status === 404) return agentError('AI_MODEL_NOT_FOUND', 'AI model was not found (HTTP 404). Select an available model in Settings.');
  return agentError('AI_PROVIDER_ERROR', `AI planning request rejected (HTTP ${status}). Check model compatibility and provider settings.`);
}

function retryDelay(header, attempt) {
  const seconds = header === null || header === undefined || header.trim() === '' ? NaN : Number(header);
  const retryAfter = Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : Date.parse(header) - Date.now();
  // A shared 45-second request signal bounds the complete retry cycle. A long Retry-After
  // waits for that signal rather than issuing another request ahead of the provider's hint.
  return Math.max(1500 * 2 ** attempt, Number.isFinite(retryAfter) ? Math.min(60000, Math.max(0, retryAfter)) : 0);
}

function wait(ms, signal) {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const finish = () => { signal?.removeEventListener('abort', abort); resolve(); };
    const timer = setTimeout(finish, ms);
    const abort = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); reject(signal.reason); };
    signal?.addEventListener('abort', abort, { once: true });
  });
}

async function requestAutomation(url, options, { userSignal, onRetry, sleep = wait } = {}) {
  const maxAttempts = 4;
  let lastStatus;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (userSignal?.aborted) userSignal.throwIfAborted();
    if (options.signal?.aborted) throw lastStatus ? providerError(lastStatus, attempt) : agentError('AI_NETWORK_ERROR', 'AI planning request timed out. Check connectivity or try again later.');
    let response;
    try { response = await fetch(url, options); }
    catch (error) {
      if (userSignal?.aborted) throw error;
      if (options.signal?.aborted || attempt === maxAttempts - 1) throw lastStatus ? providerError(lastStatus, attempt + 1) : agentError('AI_NETWORK_ERROR', 'AI planning request failed or timed out. Check provider connectivity and retry.');
    }
    if (response?.ok) {
      try { return await response.json(); }
      catch (_) { throw agentError('AI_INVALID_RESPONSE', 'AI provider returned an empty or invalid JSON response. Check provider availability and retry.'); }
    }
    if (response) {
      lastStatus = response.status;
      if (!transient.has(lastStatus) || attempt === maxAttempts - 1) {
        await response.body?.cancel().catch(() => {});
        throw providerError(lastStatus, attempt + 1);
      }
    }
    const delayMs = retryDelay(response?.headers?.get('retry-after'), attempt);
    await response?.body?.cancel().catch(() => {});
    onRetry?.({ attempt: attempt + 2, maxAttempts, delayMs, status: response?.status || null });
    try { await sleep(delayMs, options.signal); }
    catch (error) {
      if (userSignal?.aborted) throw error;
      throw lastStatus ? providerError(lastStatus, attempt + 1) : agentError('AI_NETWORK_ERROR', 'AI planning request timed out while waiting to retry. Try again later.');
    }
  }
}

module.exports = { requestAutomation, retryDelay };
