// Fuzz test: thousands of random texts x settings. Each plan must replay on the
// simulator to exactly the input, with no fallback to plain typing.
const P = require('../extension/planner.js');
const rnd = P.mulberry32(12345);
const pick = (a) => a[Math.floor(rnd() * a.length)];
const WORDS = ['the','quick','brown','fox','important','significant','use','show','many','study','people','However','But','also','very','data','I','NASA','results','because','process','world','new','different','help','research','clearly','idea','problem','effect','time','work','example'];
const ODD = ['café','naïve','é','👍','👨‍👩‍👧','中文','—','“quoted”','’s','\t','1️⃣','🇵🇭','ñ','x²','—','…',' ','#','$5.00','(see above)','"q"','e.g.','U.S.'];
function sentence() {
  const k = 3 + Math.floor(rnd() * 14);
  const w = [];
  for (let i = 0; i < k; i++) w.push(rnd() < 0.08 ? pick(ODD) : pick(WORDS));
  if (k > 7 && rnd() < 0.4) w[3] += ',';
  let s = w.join(' ');
  s = s[0].toUpperCase() + s.slice(1);
  return s + pick(['.', '.', '.', '?', '!', '."', '...', '']);
}
function text() {
  const paras = 1 + Math.floor(rnd() * 5);
  const out = [];
  for (let p = 0; p < paras; p++) {
    const ss = [];
    const n = 1 + Math.floor(rnd() * 6);
    for (let i = 0; i < n; i++) ss.push(sentence());
    out.push((rnd() < 0.2 ? '\t' : '') + ss.join(rnd() < 0.1 ? '  ' : ' '));
  }
  return out.join(pick(['\n', '\n\n', '\n \n'])) + (rnd() < 0.2 ? '\n' : '');
}
const FIXED = ['', 'a', '.', 'Hi.', '\n', '\n\n\n', '👍', 'Hello, world, again.', 'one two three, four five six.', 'NASA said so.', 'I think, therefore I am here.'];
let runs = 0, fallbacks = 0;
const totals = {};
const t0 = Date.now();
const N = +process.argv[2] || 4000;
for (let r = 0; r < N; r++) {
  const t = r < FIXED.length ? FIXED[r] : text();
  const opts = {
    wpm: pick([20, 60, 120, 400]), jitter: rnd() * 0.5,
    typos: pick([0, 2, 5, 10, 30]), revisions: pick([0, 2, 5, 10, 30]),
    pauses: pick([0, 5, 10]), goBack: rnd() < 0.7, seed: (rnd() * 2 ** 32) >>> 0,
  };
  const plan = P.buildPlan(t, opts);
  runs++;
  if (plan.fallback) {
    fallbacks++;
    if (fallbacks <= 5) console.log('FALLBACK', plan.fallback, JSON.stringify(t).slice(0, 200), JSON.stringify(opts));
  }
  // independent replay
  const sim = new P.Sim();
  let pausedOk = true;
  for (const a of plan.actions) { sim.apply(a); if (a.d < 0 || !Number.isFinite(a.d)) throw new Error('bad delay'); }
  if (sim.buf.join('') !== t || sim.cur !== sim.buf.length) { console.log('MISMATCH', JSON.stringify(t), opts); process.exit(1); }
  for (const [k, v] of Object.entries(plan.stats)) totals[k] = (totals[k] || 0) + v;
}
console.log(`${runs} plans, ${fallbacks} fallbacks, ${Date.now() - t0} ms`);
console.log(totals);
if (fallbacks) process.exit(1);
