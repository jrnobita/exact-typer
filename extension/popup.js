const $ = (id) => document.getElementById(id);
const SLIDERS = ['wpm', 'jitter', 'countdown', 'typos', 'revisions', 'pauses'];
const els = Object.fromEntries(SLIDERS.map((k) => [k, $(k)]));
els.text = $('text');
els.goBack = $('goBack');
let phase = 'idle';

const text = () => els.text.value.replace(/\r\n?/g, '\n');
const LEVEL = ['Off', 'Very light', 'Very light', 'Light', 'Light', 'Medium', 'Medium', 'More', 'More', 'Heavy', 'Heavy'];

function fmtTime(ms) {
  const sec = Math.round(ms / 1000);
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  if (h) return `${h} h ${m} min`;
  return m ? `${m} min ${s} s` : `${s} s`;
}

function settings() {
  return {
    wpm: +els.wpm.value, jitter: els.jitter.value / 100, countdown: +els.countdown.value,
    typos: +els.typos.value, revisions: +els.revisions.value, pauses: +els.pauses.value,
    goBack: els.goBack.checked,
  };
}

let etaTimer = null;
function refresh() {
  $('wpmOut').textContent = els.wpm.value + ' WPM';
  $('jitterOut').textContent = '±' + els.jitter.value + '%';
  $('countdownOut').textContent = els.countdown.value + ' s';
  $('typosOut').textContent = +els.typos.value ? els.typos.value + ' per 100 words' : 'Off';
  $('revisionsOut').textContent = +els.revisions.value ? els.revisions.value + ' per 100 words' : 'Off';
  $('pausesOut').textContent = LEVEL[+els.pauses.value];
  els.goBack.disabled = !+els.revisions.value;
  const n = Array.from(text()).length;
  $('count').textContent = n + ' characters';
  clearTimeout(etaTimer);
  etaTimer = setTimeout(() => {
    if (!n) { $('eta').textContent = ''; return; }
    try {
      const plan = ExactTyperPlanner.buildPlan(text(), settings());
      $('eta').textContent = 'About ' + fmtTime(plan.totalMs) + ' to type.';
    } catch (_) { $('eta').textContent = ''; }
  }, 150);
}

function save() {
  const s = { text: els.text.value, goBack: els.goBack.checked };
  for (const k of SLIDERS) s[k] = +els[k].value;
  chrome.storage.local.set(s);
}

function setStatus(msg, isErr) {
  $('status').textContent = msg;
  $('status').className = isErr ? 'err' : '';
}

function render(st) {
  phase = st.phase;
  const running = phase !== 'idle';
  $('go').textContent = running ? 'Stop' : 'Start';
  $('go').className = running ? 'stop' : '';
  const p = $('pause');
  p.hidden = !running;
  p.disabled = phase === 'pausing' || phase === 'countdown';
  p.textContent = phase === 'paused' ? 'Resume' : phase === 'pausing' ? 'Pausing…' : 'Pause';
  p.className = phase === 'paused' ? '' : 'pause';
  if (phase === 'countdown') {
    setStatus(st.resuming
      ? `Resuming in ${st.secondsLeft} s… if you clicked elsewhere, click right after the last typed character.`
      : `Click where you want to type… starting in ${st.secondsLeft} s`);
  } else if (phase === 'typing') setStatus(`Typing ${st.pct}%, about ${fmtTime(st.remainingMs)} left`);
  else if (phase === 'pausing') setStatus('Pausing at the next safe point…');
  else if (phase === 'paused') setStatus(`Paused at ${st.pct}%. Don't edit the page; press Resume to continue.`);
  else if (st.lastResult) setStatus(st.lastResult);
}

async function poll() {
  try { render(await chrome.runtime.sendMessage({ type: 'status' })); } catch (_) {}
}

$('go').addEventListener('click', async () => {
  if (phase !== 'idle') { await chrome.runtime.sendMessage({ type: 'stop' }); return poll(); }
  const t = text();
  if (!t) return setStatus('Type or paste some text first.', true);
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const res = await chrome.runtime.sendMessage({ type: 'start', tabId: tab.id, text: t, ...settings() });
  if (!res.ok) return setStatus(res.error, true);
  poll();
});

$('pause').addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: phase === 'paused' ? 'resume' : 'pause' });
  poll();
});

// Tab inside the box inserts a tab instead of moving to the next control.
els.text.addEventListener('keydown', (e) => {
  if (e.key === 'Tab' && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
    e.preventDefault();
    els.text.setRangeText('\t', els.text.selectionStart, els.text.selectionEnd, 'end');
    refresh(); save();
  }
});

for (const el of Object.values(els)) el.addEventListener('input', () => { refresh(); save(); });
els.goBack.addEventListener('change', () => { refresh(); save(); });

chrome.storage.local.get([...SLIDERS, 'text', 'goBack']).then((s) => {
  if (s.text != null) els.text.value = s.text;
  for (const k of SLIDERS) if (s[k] != null) els[k].value = s[k];
  if (s.goBack != null) els.goBack.checked = s.goBack;
  refresh();
});

poll();
setInterval(poll, 300);
