import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as sounds from '../src/utils/sounds';

class FakeParam {
  value = 0;
  events: Array<{ value: number; time: number }> = [];
  setValueAtTime(value: number, time: number) { this.events.push({ value, time }); }
  linearRampToValueAtTime(value: number, time: number) { this.events.push({ value, time }); }
  exponentialRampToValueAtTime(value: number, time: number) { this.events.push({ value, time }); }
}
class FakeNode {
  target: unknown;
  disconnected = false;
  connect(target: unknown) { this.target = target; }
  disconnect() { this.disconnected = true; }
}
class FakeGain extends FakeNode {
  gain = new FakeParam();
}
class FakeOscillator extends FakeNode {
  type = '';
  frequency = new FakeParam();
  onended?: () => void;
  startTime = 0;
  stopTime = 0;
  start(time: number) { this.startTime = time; }
  stop(time: number) { this.stopTime = time; }
}
class FakeContext {
  state = 'suspended';
  currentTime = 10;
  destination = {};
  allowResume = false;
  gains: FakeGain[] = [];
  oscillators: FakeOscillator[] = [];
  createGain() { const node = new FakeGain(); this.gains.push(node); return node; }
  createOscillator() { const node = new FakeOscillator(); this.oscillators.push(node); return node; }
  async resume() { if (this.allowResume) this.state = 'running'; }
}

test('audio unlocks before playback, all cues reach the output, and envelopes fade cleanly', async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'AudioContext');
  const context = new FakeContext();
  Object.defineProperty(globalThis, 'AudioContext', { configurable: true, value: class { constructor() { return context; } } });
  try {
    sounds.playCorrect();
    assert.equal(context.oscillators.length, 0, 'blocked events must not queue stale sounds');
    await assert.rejects(sounds.enableSounds(), /Audio is not running/);
    context.allowResume = true;
    await sounds.enableSounds();
    assert.equal(context.state, 'running');

    for (const play of [sounds.playDailyDouble, sounds.playBuzzerReady, sounds.playBuzzIn,
      sounds.playCorrect, sounds.playWrong, sounds.playFinalJeopardy, sounds.playTick,
      sounds.playTimesUp, sounds.playReveal, sounds.playWinnerFanfare]) {
      const count = context.oscillators.length;
      play();
      assert.ok(context.oscillators.length > count, `${play.name} should produce audio`);
    }
    const output = context.gains[0];
    assert.equal(output.target, context.destination);
    assert.equal(output.gain.value, 0.85);
    for (const oscillator of context.oscillators) {
      const envelope = oscillator.target as FakeGain;
      assert.equal(envelope.target, output);
      assert.equal(oscillator.type, 'sine');
      assert.equal(envelope.gain.events[0].value, 0);
      assert.equal(envelope.gain.events.at(-1)?.value, 0);
      assert.ok(envelope.gain.events.some(event => event.value > 0));
      assert.ok(oscillator.stopTime > oscillator.startTime);
      oscillator.onended?.();
      assert.ok(oscillator.disconnected && envelope.disconnected);
    }
  } finally {
    if (original) Object.defineProperty(globalThis, 'AudioContext', original);
    else Reflect.deleteProperty(globalThis, 'AudioContext');
  }
});
