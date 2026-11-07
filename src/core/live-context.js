const normalize = text => String(text || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

function detectQuestion(text, followup = false) {
  const lines = String(text || '').split(/\n|(?<=[?])\s+/).map(s => s.trim()).filter(Boolean);
  const explicit = /^(?:(?:question|\d+)[.:)\s]+)?(?:what|why|how|when|where|which|who|can you|could you|would you|do you|have you|is there|are there)\b/i;
  const implicit = /\b(?:explain|describe|tell (?:me|us)|compare|implement|solve|calculate|debug|write (?:a|an|the)|find (?:the|a)|select (?:the|a)|choose (?:the|a))\b/i;
  const found = lines.find(line => line.length >= 12 && (line.includes('?') || explicit.test(line) || implicit.test(line)));
  if (found) return found.slice(0, 1200);
  if (followup && /^(?:and |but |then |also |instead |more |go on|continue|elaborate)/i.test(lines.join(' '))) return lines.join(' ').slice(0, 1200);
  if (/\b(?:exception\b|traceback\b|fatal error\b|error:|failed to\b|not defined\b)/i.test(text)) return `Explain and help fix: ${lines.join(' ').slice(0, 900)}`;
  return null;
}

class LiveContext {
  constructor() { this.clear(); }
  clear() { this.screen = null; this.transcripts = []; this.answers = []; }
  setScreen(screen) { this.screen = { ...screen, at: Date.now() }; }
  addTranscript(text) { this.transcripts.push({ text: text.slice(0, 2000), at: Date.now() }); this.transcripts = this.transcripts.slice(-12); }
  prompt(question) {
    const now = Date.now();
    return JSON.stringify({ question,
      screen: this.screen && now - this.screen.at < 30000 ? { source: this.screen.name, text: this.screen.text.slice(0, 7000) } : null,
      recentSpeech: this.transcripts.filter(t => now - t.at < 90000).map(t => t.text).join('\n').slice(-4000),
      conversation: this.answers.slice(-4).map(a => ({ question: a.question, answer: a.answer.slice(0, 1800) }))
    });
  }
}

// Compare spatial samples, retaining both text strokes and color changes.
function frameChanged(previous, current, threshold = 0.008) {
  if (!previous || previous.length !== current.length) return true;
  let changed = 0;
  for (let i = 0; i < current.length; i += 4) {
    if (Math.abs(previous[i] - current[i]) + Math.abs(previous[i + 1] - current[i + 1]) + Math.abs(previous[i + 2] - current[i + 2]) > 60) changed++;
  }
  return changed / (current.length / 4) >= threshold;
}

module.exports = { LiveContext, detectQuestion, normalize, frameChanged };
