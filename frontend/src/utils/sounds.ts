let ctx: AudioContext | null = null;

function getCtx(): AudioContext {
  if (!ctx) ctx = new AudioContext();
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function tone(
  freq: number,
  duration: number,
  type: OscillatorType = 'sine',
  gain = 0.3,
  delay = 0,
  endFreq?: number,
) {
  const c = getCtx();
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.connect(g);
  g.connect(c.destination);
  osc.type = type;
  const t = c.currentTime + delay;
  osc.frequency.setValueAtTime(freq, t);
  if (endFreq !== undefined) osc.frequency.linearRampToValueAtTime(endFreq, t + duration);
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
  osc.start(t);
  osc.stop(t + duration + 0.05);
}

// Jeopardy Daily Double fanfare — ascending arpeggio with a held top note
export function playDailyDouble() {
  const notes = [261.63, 329.63, 392, 523.25, 659.25];
  notes.forEach((f, i) => tone(f, i < 4 ? 0.18 : 0.6, 'sine', 0.45, i * 0.13));
}

// Short clear ding when buzzers open
export function playBuzzerReady() {
  tone(880, 0.25, 'sine', 0.4);
  tone(1108, 0.25, 'sine', 0.25, 0.05);
}

// Electronic buzz on press
export function playBuzzIn() {
  tone(110, 0.08, 'sawtooth', 0.5);
  tone(165, 0.08, 'sawtooth', 0.35, 0.06);
  tone(110, 0.1,  'sawtooth', 0.3, 0.12);
}

// Three ascending chime notes — correct answer
export function playCorrect() {
  tone(523.25, 0.2, 'sine', 0.4, 0);
  tone(659.25, 0.2, 'sine', 0.4, 0.12);
  tone(783.99, 0.4, 'sine', 0.5, 0.24);
}

// Descending "wah wah" — wrong answer
export function playWrong() {
  tone(320, 0.28, 'sawtooth', 0.35, 0,    200);
  tone(240, 0.35, 'sawtooth', 0.3,  0.28, 160);
}

// Subtle whoosh when a regular question opens
export function playQuestionOpen() {
  tone(660, 0.12, 'sine', 0.2, 0, 880);
}
