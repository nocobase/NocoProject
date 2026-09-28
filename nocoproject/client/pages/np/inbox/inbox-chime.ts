import { useSyncExternalStore } from 'react';

/**
 * The inbox sound reminder (NP-108): a short two-note chime when the number of decisions waiting on the viewer goes
 * up. The sound is synthesised with Web Audio, so there is no asset to ship.
 *
 * Browsers keep audio suspended until the page has had a user gesture; `armInboxChime` resumes the context on the
 * first pointer or key press, and a chime before that is skipped silently. With several tabs open, only one plays:
 * a Web Lock is held for a few seconds by the tab that chimes, the others see it taken and stay quiet.
 */

// Shared by every tab on this origin; `off` mutes the chime, anything else (including nothing) leaves it on.
const storageKey = 'np:inbox:chime';
const changeEvent = 'np:inbox-chime-change';
const lockName = 'np-inbox-chime';
const lockHoldMs = 3000;

let memoryValue = true;
let memoryOnly = false;
let context: AudioContext | null = null;
let armed = false;

function getSnapshot(): boolean {
  if (memoryOnly) return memoryValue;
  try {
    memoryValue = localStorage.getItem(storageKey) !== 'off';
  } catch {
    // Storage may be unavailable; keep the current session's preference.
  }
  return memoryValue;
}

function subscribe(notify: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key === storageKey || event.key === null) notify();
  };
  window.addEventListener('storage', onStorage);
  window.addEventListener(changeEvent, notify);
  return () => {
    window.removeEventListener('storage', onStorage);
    window.removeEventListener(changeEvent, notify);
  };
}

function setEnabled(enabled: boolean): void {
  memoryValue = enabled;
  try {
    localStorage.setItem(storageKey, enabled ? 'on' : 'off');
  } catch {
    memoryOnly = true;
  }
  window.dispatchEvent(new Event(changeEvent));
}

/** Whether the inbox chime is on for this browser (default on), and a setter. */
export function useInboxChimePreference(): readonly [
  boolean,
  (enabled: boolean) => void,
] {
  const enabled = useSyncExternalStore(subscribe, getSnapshot, () => true);
  return [enabled, setEnabled];
}

function audioContext(): AudioContext | null {
  if (context) return context;
  if (typeof window === 'undefined' || !('AudioContext' in window)) return null;
  try {
    context = new AudioContext();
  } catch {
    return null;
  }
  return context;
}

function unlock(): void {
  const ctx = audioContext();
  if (!ctx || ctx.state === 'running') {
    disarm();
    return;
  }
  void ctx.resume().then(
    () => {
      if (ctx.state === 'running') disarm();
    },
    () => {},
  );
}

function disarm(): void {
  window.removeEventListener('pointerdown', unlock, true);
  window.removeEventListener('keydown', unlock, true);
}

/** Resumes the audio context on the first user gesture, so a later chime can play. Idempotent. */
export function armInboxChime(): void {
  if (armed || typeof window === 'undefined') return;
  armed = true;
  window.addEventListener('pointerdown', unlock, true);
  window.addEventListener('keydown', unlock, true);
}

function ring(ctx: AudioContext): void {
  const start = ctx.currentTime + 0.01;
  // E6 then A6: short, soft, and distinct from system sounds.
  [
    [1318.5, 0],
    [1760, 0.14],
  ].forEach(([frequency, offset]) => {
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    const at = start + offset;
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(frequency, at);
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(0.12, at + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.35);
    oscillator.connect(gain).connect(ctx.destination);
    oscillator.start(at);
    oscillator.stop(at + 0.4);
  });
}

/**
 * Plays the chime once. Skipped when audio is still locked (no user gesture yet) or another tab has just played it.
 * `preview` is for the toggle: it runs inside the click, so it can resume the context itself and skips the lock.
 */
export function playInboxChime({
  preview = false,
}: { readonly preview?: boolean } = {}): void {
  if (preview) {
    const ctx = audioContext();
    void ctx
      ?.resume()
      .then(() => ring(ctx))
      .catch(() => {});
    return;
  }
  // The context is only created inside a gesture (unlock or preview); creating it here would just log a warning.
  const ctx = context;
  if (ctx?.state !== 'running') return;
  const locks = typeof navigator === 'undefined' ? undefined : navigator.locks;
  if (!locks) {
    ring(ctx);
    return;
  }
  void locks
    .request(lockName, { ifAvailable: true }, async (lock) => {
      if (!lock) return;
      ring(ctx);
      await new Promise((resolve) => window.setTimeout(resolve, lockHoldMs));
    })
    .catch(() => {});
}
