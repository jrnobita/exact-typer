// End-to-end test: loads the real extension into Chrome for Testing, types
// into a textarea, a contenteditable box, and a contenteditable inside an
// iframe (like Google Docs), and checks the final text matches exactly.
//
//   node e2e.test.js [trials] [--headful] [--real-speed]

const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');
const puppeteer = require('puppeteer');

const EXT = process.env.EXACT_TYPER_EXT || path.resolve(__dirname, '../extension');
const args = process.argv.slice(2);
const TRIALS = +(args.find((a) => /^\d+$/.test(a)) || 30);
const HEADFUL = args.includes('--headful');

function chromePath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const base = path.join(os.homedir(), '.cache/puppeteer/chrome');
  const v = fs.readdirSync(base).sort().pop();
  const mac = path.join(base, v, 'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
  if (fs.existsSync(mac)) return mac;
  return path.join(base, v, 'chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
}

// Editors insert a real tab on Tab, like Google Docs does.
const TAB_JS = `function tabs(doc){doc.addEventListener('keydown',e=>{if(e.key==='Tab'){e.preventDefault();
  const t=doc.activeElement; if(t&&t.tagName==='TEXTAREA'){t.setRangeText('\\t',t.selectionStart,t.selectionEnd,'end');}
  else doc.execCommand('insertText',false,'\\t');}},true);}`;
const PAGE = `<!doctype html><meta charset="utf-8"><body>
<textarea id="ta" style="width:600px;height:200px"></textarea>
<div id="ce" contenteditable="true" style="width:600px;min-height:100px;border:1px solid #999;white-space:pre-wrap"></div>
<iframe id="fr" style="width:620px;height:150px"></iframe>
<script>${TAB_JS}
tabs(document);
const fd=document.getElementById('fr').contentDocument;
fd.open();fd.write('<!doctype html><meta charset="utf-8"><body><div id="ce" contenteditable="true" style="min-height:100px;white-space:pre-wrap"></div></body>');fd.close();
tabs(fd);
</script></body>`;

const P = require('../extension/planner.js');
const rnd = P.mulberry32(99);
const pick = (a) => a[Math.floor(rnd() * a.length)];
const WORDS = ['the', 'study', 'shows', 'many', 'people', 'use', 'important', 'data', 'However', 'results', 'very', 'different', 'problem', 'time', 'world', 'help', 'because', 'research', 'example', 'idea', 'I', 'NASA'];
const ODD = ['café', '👍', '中文', '—', '“quoted”', 'é', '…', 'naïve', '$5.00', '(see)', '#1'];
function sentence() {
  const k = 3 + Math.floor(rnd() * 12);
  const w = [];
  for (let i = 0; i < k; i++) w.push(rnd() < 0.07 ? pick(ODD) : pick(WORDS));
  if (k > 7 && rnd() < 0.5) w[3] += ',';
  const s = w.join(' ');
  return s[0].toUpperCase() + s.slice(1) + pick(['.', '.', '?', '!']);
}
function genText() {
  const out = [];
  const paras = 1 + Math.floor(rnd() * 3);
  for (let p = 0; p < paras; p++) {
    const ss = [];
    for (let i = 0, n = 1 + Math.floor(rnd() * 4); i < n; i++) ss.push(sentence());
    out.push((rnd() < 0.25 ? '\t' : '') + ss.join(' '));
  }
  return out.join(rnd() < 0.5 ? '\n' : '\n\n');
}

async function main() {
  const server = http.createServer((req, res) => { res.setHeader('content-type', 'text/html; charset=utf-8'); res.end(PAGE); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}/`;

  const browser = await puppeteer.launch({
    executablePath: chromePath(),
    headless: !HEADFUL,
    pipe: true,
    enableExtensions: [EXT],
    args: ['--no-first-run', '--no-default-browser-check'],
  });
  const swTarget = await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().includes('background.js'), { timeout: 15000 });
  const sw = await swTarget.worker();
  const page = await browser.newPage();
  await page.goto(url);
  await page.bringToFront();
  const tabId = await sw.evaluate(async (u) => (await chrome.tabs.query({ url: u + '*' }))[0].id, url);

  async function focusTarget(target) {
    if (target === 'ta') {
      await page.$eval('#ta', (el) => { el.value = ''; el.focus(); });
    } else if (target === 'ce') {
      await page.$eval('#ce', (el) => { el.innerHTML = ''; el.focus(); });
    } else {
      const frame = page.frames().find((f) => f !== page.mainFrame());
      await page.$eval('#fr', (el) => el.focus());
      await frame.$eval('#ce', (el) => { el.innerHTML = ''; el.focus(); });
    }
  }
  async function readTarget(target) {
    if (target === 'ta') return page.$eval('#ta', (el) => el.value);
    const frame = target === 'ce' ? page.mainFrame() : page.frames().find((f) => f !== page.mainFrame());
    // Rebuild the text from the editor's lines: Chrome puts each new line in a
    // <div>, and an empty line is <div><br></div>.
    return frame.$eval('#ce', (el) => {
      const line = (n) => (n.childNodes.length === 1 && n.firstChild.nodeName === 'BR' ? '' : n.textContent);
      let out = '';
      el.childNodes.forEach((n, idx) => {
        if (n.nodeType === 3) out += n.data;
        else if (n.nodeName === 'DIV' || n.nodeName === 'P') out += (idx === 0 ? '' : '\n') + line(n);
        else if (n.nodeName === 'BR') { if (idx !== el.childNodes.length - 1) out += '\n'; }
        else out += n.textContent;
      });
      return out;
    });
  }
  const norm = (s, target) => (target === 'ta' ? s : s.replace(/ /g, ' ').replace(/\n$/, ''));

  async function startTyping(opts) {
    return sw.evaluate((o) => start(o), { tabId, countdown: 1, wpm: 60, jitter: 0.3, ...opts });
  }
  const status = () => sw.evaluate(() => ({ ...state }));
  async function waitIdle(timeoutMs) {
    const t0 = Date.now();
    for (;;) {
      const st = await status();
      if (st.phase === 'idle') return st;
      if (Date.now() - t0 > timeoutMs) throw new Error('timeout, phase ' + st.phase);
      await new Promise((r) => setTimeout(r, 50));
    }
  }

  let pass = 0, fail = 0;
  const targets = ['ta', 'ce', 'frame'];
  const stats = {};
  async function trial(name, target, text, opts, between) {
    await focusTarget(target);
    const res = await startTyping({ text, ...opts });
    if (!res.ok) throw new Error('start failed: ' + res.error);
    if (res.fallback) console.log('  (plan fell back to plain typing: ' + res.fallback + ')');
    for (const [k, v] of Object.entries(res.stats || {})) stats[k] = (stats[k] || 0) + v;
    if (between) await between();
    const st = await waitIdle(600000);
    const got = norm(await readTarget(target), target);
    const want = norm(text, target);
    if (got === want && st.lastResult === 'Done.') { pass++; }
    else {
      fail++;
      console.log(`FAIL ${name} [${target}] result=${st.lastResult}`);
      console.log('  want: ' + JSON.stringify(want));
      console.log('  got:  ' + JSON.stringify(got));
      console.log('  opts: ' + JSON.stringify(opts));
    }
  }

  const t0 = Date.now();
  // 0) Plain typing control (no typos or revisions).
  for (const target of targets) await trial('plain', target, 'One.\n\nTwo two.\n\tThree, four.\n\n\nFive 👍 café e\u0301 中文', { timeScale: 0.02 });
  console.log(`plain control: ${pass} pass, ${fail} fail`);

  // 1) Many fast runs with heavy typos and revisions.
  for (let i = 0; i < TRIALS; i++) {
    const target = targets[i % 3];
    const opts = {
      typos: pick([3, 6, 10]), revisions: pick([3, 6, 10]), pauses: pick([0, 5]),
      goBack: rnd() < 0.8, seed: (rnd() * 2 ** 32) >>> 0, timeScale: 0.02, wpm: pick([60, 120]),
    };
    await trial('fast#' + i, target, genText(), opts);
  }
  console.log(`fast runs: ${pass} pass, ${fail} fail (${((Date.now() - t0) / 1000).toFixed(0)} s)`);

  // 2) Pause, wait, resume.
  for (const target of targets) {
    await trial('pause', target, genText(), { typos: 8, revisions: 8, goBack: true, seed: 5, timeScale: 0.1 }, async () => {
      await new Promise((r) => setTimeout(r, 1800));
      await sw.evaluate(() => { pauseRequested = true; state.phase = 'pausing'; });
      for (let k = 0; k < 200; k++) { if ((await status()).phase === 'paused') break; await new Promise((r) => setTimeout(r, 50)); }
      const st = await status();
      if (st.phase !== 'paused' && st.phase !== 'idle') throw new Error('did not pause: ' + st.phase);
      await new Promise((r) => setTimeout(r, 1500));
      await sw.evaluate(() => { if (state.phase === 'paused') resumeRequested = true; });
    });
  }
  console.log(`after pause tests: ${pass} pass, ${fail} fail`);

  // 3) Stop mid-way must leave things idle and detached.
  await focusTarget('ta');
  await startTyping({ text: genText() + ' ' + genText(), typos: 5, revisions: 5, timeScale: 0.3 });
  await new Promise((r) => setTimeout(r, 2500));
  await sw.evaluate(() => requestStop('Stopped'));
  const st = await waitIdle(10000);
  const again = await startTyping({ text: 'ok', timeScale: 0.05 });
  if (/^Stopped at \d+%\.$/.test(st.lastResult) && again.ok) pass++; else { fail++; console.log('FAIL stop test', st.lastResult, again); }
  await waitIdle(10000);

  // 4) A few runs at real speed.
  if (args.includes('--real-speed')) {
    for (const target of targets) {
      await trial('real', target, 'The study shows that many people use phones every day. However, the main problem is time, and most students know it.\nIn the second part, we look at the results.',
        { wpm: 120, typos: 6, revisions: 8, pauses: 3, goBack: true, seed: 11 });
    }
  }

  console.log(`TOTAL: ${pass} pass, ${fail} fail in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  console.log('events exercised:', stats);
  await browser.close();
  server.close();
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(2); });
