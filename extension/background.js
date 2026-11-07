// Exact Typer: types text into the focused element of one tab through the
// Chrome DevTools protocol (chrome.debugger). Events sent this way are
// "trusted", so Google Docs treats them like real keystrokes, and they only
// ever reach the tab that was active when you pressed Start.
//
// planner.js turns the text into a checked list of keystrokes (with typos,
// revisions and pauses if turned on); this file plays that list back.

importScripts('planner.js');

const state = {
  phase: 'idle', // idle | countdown | typing | pausing | paused
  resuming: false,
  tabId: null,
  pct: 0,
  remainingMs: 0,
  secondsLeft: 0,
  lastResult: '',
};
let stopRequested = false;
let stopReason = '';
let pauseRequested = false;
let resumeRequested = false;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// A wait that ends early when Stop is pressed.
async function wait(ms) {
  const end = performance.now() + ms;
  while (!stopRequested) {
    const left = end - performance.now();
    if (left <= 0) return;
    await sleep(Math.min(left, 100));
  }
}

// ---------- key mapping (US layout, so keydown codes look like a real keyboard)

const SHIFTED = {
  '!': '1', '@': '2', '#': '3', '$': '4', '%': '5', '^': '6', '&': '7',
  '*': '8', '(': '9', ')': '0', '_': '-', '+': '=', '{': '[', '}': ']',
  '|': '\\', ':': ';', '"': "'", '<': ',', '>': '.', '?': '/', '~': '`',
};
const PUNCT = {
  ';': [186, 'Semicolon'], '=': [187, 'Equal'], ',': [188, 'Comma'],
  '-': [189, 'Minus'], '.': [190, 'Period'], '/': [191, 'Slash'],
  '`': [192, 'Backquote'], '[': [219, 'BracketLeft'], '\\': [220, 'Backslash'],
  ']': [221, 'BracketRight'], "'": [222, 'Quote'],
};
const SHIFT = 8;

function keyFor(ch) {
  if (ch === '\n') return { key: 'Enter', code: 'Enter', vk: 13, text: '\r', mod: 0 };
  if (ch === '\t') return { key: 'Tab', code: 'Tab', vk: 9, text: '\t', mod: 0 };
  if (ch === ' ') return { key: ' ', code: 'Space', vk: 32, text: ' ', mod: 0 };
  if (/^[a-z]$/.test(ch)) return { key: ch, code: 'Key' + ch.toUpperCase(), vk: ch.toUpperCase().charCodeAt(0), text: ch, mod: 0 };
  if (/^[A-Z]$/.test(ch)) return { key: ch, code: 'Key' + ch, vk: ch.charCodeAt(0), text: ch, mod: SHIFT };
  if (/^[0-9]$/.test(ch)) return { key: ch, code: 'Digit' + ch, vk: ch.charCodeAt(0), text: ch, mod: 0 };
  const base = SHIFTED[ch];
  if (base !== undefined) {
    const k = /[0-9]/.test(base) ? [base.charCodeAt(0), 'Digit' + base] : PUNCT[base];
    return { key: ch, code: k[1], vk: k[0], text: ch, mod: SHIFT };
  }
  if (PUNCT[ch]) return { key: ch, code: PUNCT[ch][1], vk: PUNCT[ch][0], text: ch, mod: 0 };
  // Anything else (accents, emoji, other scripts): no physical key, just the text.
  return { key: ch, code: '', vk: 0, text: ch, mod: 0 };
}

const NAV = {
  bs: { key: 'Backspace', code: 'Backspace', vk: 8 },
  L: { key: 'ArrowLeft', code: 'ArrowLeft', vk: 37 },
  R: { key: 'ArrowRight', code: 'ArrowRight', vk: 39 },
};

function cmd(method, params) {
  return chrome.debugger.sendCommand({ tabId: state.tabId }, method, params);
}

async function typeChar(ch) {
  const k = keyFor(ch);
  const common = { key: k.key, code: k.code, windowsVirtualKeyCode: k.vk, nativeVirtualKeyCode: k.vk, modifiers: k.mod };
  await cmd('Input.dispatchKeyEvent', { type: 'keyDown', text: k.text, unmodifiedText: k.text, ...common });
  await cmd('Input.dispatchKeyEvent', { type: 'keyUp', ...common });
}

async function pressKey(name) {
  const k = NAV[name];
  const common = { key: k.key, code: k.code, windowsVirtualKeyCode: k.vk, nativeVirtualKeyCode: k.vk, modifiers: 0 };
  await cmd('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...common });
  await cmd('Input.dispatchKeyEvent', { type: 'keyUp', ...common });
}

// ---------- badge

function badge(text, color) {
  chrome.action.setBadgeText({ text });
  if (color) chrome.action.setBadgeBackgroundColor({ color });
}

// ---------- Esc to stop: a tiny listener injected into the tab's frames

async function installEscListener(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: () => {
        if (window.__exactTyperEsc) return;
        window.__exactTyperEsc = true;
        window.addEventListener('keydown', (e) => {
          // Only a real key press from the person stops it, not our own keys.
          if (e.key === 'Escape') {
            try { chrome.runtime.sendMessage({ type: 'esc' }); } catch (_) {}
          }
        }, true);
      },
    });
  } catch (_) {
    // Some pages refuse injection; Stop in the popup and the banner's Cancel still work.
  }
}

// ---------- start / stop / pause

async function start(opts) {
  const { tabId, text } = opts;
  if (state.phase !== 'idle') return { ok: false, error: 'Already running.' };
  if (!text) return { ok: false, error: 'Nothing to type.' };

  const tab = await chrome.tabs.get(tabId);
  if (!/^(https?|file):/.test(tab.url || '')) {
    return { ok: false, error: 'Chrome does not allow typing on this kind of page. Open a normal web page.' };
  }

  let plan;
  try {
    plan = ExactTyperPlanner.buildPlan(text, {
      wpm: opts.wpm, jitter: opts.jitter, typos: opts.typos || 0, revisions: opts.revisions || 0,
      pauses: opts.pauses || 0, goBack: !!opts.goBack, seed: opts.seed, timeScale: opts.timeScale || 1,
    });
  } catch (e) {
    return { ok: false, error: 'Could not plan the typing: ' + (e.message || e) };
  }

  try {
    await chrome.debugger.attach({ tabId }, '1.3');
  } catch (e) {
    return { ok: false, error: 'Could not attach to this tab: ' + (e.message || e) };
  }

  stopRequested = false;
  stopReason = '';
  pauseRequested = false;
  resumeRequested = false;
  Object.assign(state, {
    phase: 'countdown', resuming: false, tabId, pct: 0,
    remainingMs: plan.totalMs, secondsLeft: opts.countdown, lastResult: '',
  });
  installEscListener(tabId);
  run(plan, opts.countdown); // keeps going after the popup closes
  return { ok: true, fallback: plan.fallback, stats: plan.stats };
}

function requestStop(reason) {
  if (state.phase === 'idle') return;
  stopRequested = true;
  stopReason = reason;
}

async function countdown(seconds) {
  for (let s = seconds; s > 0 && !stopRequested; s--) {
    state.secondsLeft = s;
    badge(String(s), '#d97706');
    await wait(1000);
  }
}

async function run(plan, countdownSec) {
  const acts = plan.actions;
  const total = Math.max(1, plan.totalMs);
  let doneMs = 0;
  let finished = false;
  try {
    await countdown(countdownSec);
    if (stopRequested) return;

    state.phase = 'typing';
    badge('0%', '#15803d');
    let lastPct = -1;

    for (let i = 0; i < acts.length && !stopRequested; i++) {
      const a = acts[i];

      // Pauses only happen at safe points: the cursor is at the end of the
      // typed text and no correction is half done.
      if (a.k === 'cp' && pauseRequested) {
        pauseRequested = false;
        state.phase = 'paused';
        badge('||', '#6b7280');
        while (!resumeRequested && !stopRequested) await sleep(100);
        resumeRequested = false;
        if (stopRequested) break;
        state.phase = 'countdown';
        state.resuming = true;
        await countdown(countdownSec);
        state.resuming = false;
        if (stopRequested) break;
        state.phase = 'typing';
        lastPct = -1;
      }

      const t0 = performance.now();
      if (a.k === 't') await typeChar(a.s);
      else if (a.k === 'bs' || a.k === 'L' || a.k === 'R') await pressKey(a.k);

      doneMs += a.d;
      state.remainingMs = total - doneMs;
      const pct = Math.floor((doneMs / total) * 100);
      state.pct = pct;
      if (pct !== lastPct && state.phase === 'typing') { lastPct = pct; badge(pct + '%', '#15803d'); }

      const left = a.d - (performance.now() - t0);
      if (left > 0) await wait(left);
    }
    finished = !stopRequested;
  } catch (e) {
    if (!stopRequested) { stopRequested = true; stopReason = 'Error: ' + (e.message || e); }
  } finally {
    state.lastResult = finished
      ? 'Done.'
      : `${stopReason || 'Stopped'} at ${state.pct}%.`;
    state.phase = 'idle';
    state.resuming = false;
    pauseRequested = false;
    resumeRequested = false;
    try { await chrome.debugger.detach({ tabId: state.tabId }); } catch (_) {}
    badge('');
  }
}

// The user closed the tab, or pressed "Cancel" on Chrome's debugging banner.
chrome.debugger.onDetach.addListener((source, reason) => {
  if (source.tabId === state.tabId) {
    requestStop(reason === 'canceled_by_user' ? 'Cancelled from the banner' : 'Tab closed');
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'start') {
    start(msg).then(sendResponse, (e) => sendResponse({ ok: false, error: String(e.message || e) }));
    return true;
  }
  if (msg.type === 'stop') { requestStop('Stopped'); sendResponse({ ok: true }); return; }
  if (msg.type === 'pause') {
    if (state.phase === 'typing') { pauseRequested = true; state.phase = 'pausing'; }
    sendResponse({ ok: true }); return;
  }
  if (msg.type === 'resume') {
    if (state.phase === 'paused') resumeRequested = true;
    sendResponse({ ok: true }); return;
  }
  if (msg.type === 'esc') {
    if (sender.tab && sender.tab.id === state.tabId) requestStop('Esc pressed');
    return;
  }
  if (msg.type === 'status') { sendResponse({ ...state }); return; }
});
