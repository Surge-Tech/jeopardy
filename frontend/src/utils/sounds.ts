let ctx: AudioContext | null = null;
let output: GainNode | null = null;

function getCtx(): AudioContext {
  if (!ctx) {
    ctx = new AudioContext();
    output = ctx.createGain();
    // Keep every cue at a restrained, consistent listening level.
    output.gain.value = 0.85;
    output.connect(ctx.destination);
  }
  return ctx;
}

// Call directly from a board interaction so browsers can unlock audio playback.
export async function enableSounds(): Promise<void> {
  const c = getCtx();
  if (c.state !== 'running') await c.resume();
  if (c.state !== 'running') throw new Error('Audio is not running');
}

function tone(
  freq: number,
  duration: number,
  gain = 0.16,
  delay = 0,
  endFreq?: number,
  attack = 0.012,
) {
  const c = getCtx();
  // Drop blocked cues instead of replaying a backlog after audio is enabled.
  if (c.state !== 'running') {
    void c.resume().catch(() => {});
    return;
  }
  const osc = c.createOscillator();
  const envelope = c.createGain();
  osc.connect(envelope);
  envelope.connect(output!);
  osc.type = 'sine';
  const t = c.currentTime + delay;
  osc.frequency.setValueAtTime(freq, t);
  if (endFreq !== undefined) osc.frequency.linearRampToValueAtTime(endFreq, t + duration);
  // Ease into each note and fade all the way to silence to avoid clicks.
  envelope.gain.setValueAtTime(0, t);
  envelope.gain.linearRampToValueAtTime(gain, t + attack);
  envelope.gain.exponentialRampToValueAtTime(0.0001, t + duration);
  envelope.gain.linearRampToValueAtTime(0, t + duration + 0.025);
  osc.onended = () => {
    osc.disconnect();
    envelope.disconnect();
  };
  osc.start(t);
  osc.stop(t + duration + 0.03);
}

// A short, rounded arpeggio for a Daily Double.
export function playDailyDouble() {
  [392, 523.25, 659.25, 783.99].forEach((freq, i) => {
    tone(freq, i === 3 ? 0.5 : 0.25, 0.17, i * 0.11);
  });
}

// A single light chime when buzzers become available.
export function playBuzzerReady() {
  tone(659.25, 0.2, 0.13);
}

// A low, rounded tap acknowledges the first buzz.
export function playBuzzIn() {
  tone(293.66, 0.16, 0.21, 0, 261.63, 0.006);
}

// A soft descending pair for an incorrect answer.
export function playWrong() {
  tone(329.63, 0.22, 0.16);
  tone(261.63, 0.3, 0.16, 0.14);
}

// A warm, slowly unfolding chord introduces Final Jeopardy.
export function playFinalJeopardy() {
  tone(261.63, 1.1, 0.12, 0, undefined, 0.09);
  tone(392, 1, 0.09, 0.14, undefined, 0.09);
  tone(523.25, 0.9, 0.1, 0.28, undefined, 0.09);
}

// A muted tick for the last five seconds of the final timer.
export function playTick() {
  tone(784, 0.055, 0.07, 0, undefined, 0.004);
}

// A brief, low falling tone marks the end of the timer.
export function playTimesUp() {
  tone(293.66, 0.38, 0.19, 0, 196, 0.02);
}

// A small upward chime accompanies each reveal.
export function playReveal() {
  tone(392, 0.18, 0.11);
  tone(523.25, 0.26, 0.12, 0.09);
}

// A restrained celebratory phrase for the final scoreboard.
export function playWinnerFanfare() {
  [392, 493.88, 587.33, 783.99].forEach((freq, i) => {
    tone(freq, i === 3 ? 0.65 : 0.28, 0.17, i * 0.15);
  });
  tone(392, 0.6, 0.07, 0.45);
  tone(493.88, 0.6, 0.06, 0.45);
}

// A barely-there, original ambient pulse during the final countdown.
let thinkingInterval: number | null = null;
export function playThinkingPulse() {
  if (thinkingInterval !== null) return;
  const beat = () => tone(196, 0.38, 0.035, 0, undefined, 0.06);
  beat();
  thinkingInterval = window.setInterval(beat, 1200);
}
export function stopThinkingPulse() {
  if (thinkingInterval !== null) {
    window.clearInterval(thinkingInterval);
    thinkingInterval = null;
  }
}
