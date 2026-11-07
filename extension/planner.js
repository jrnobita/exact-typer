// Exact Typer planner: turns the text into a list of keystrokes (type a
// character, Backspace, Left, Right, wait) with human-looking typos, fake
// revisions and thinking pauses. The plan is checked on a simulated text box
// before it is used: if replaying it does not end with exactly the input text,
// the planner falls back to plain typing. So the final text is always exact.
//
// Works in the extension (service worker and popup) and in Node (tests).

(function (root) {
  'use strict';

  // ---------- random numbers (seeded so tests can replay a run)

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ---------- which characters the cursor may cross or Backspace may delete
  //
  // Arrow keys and Backspace move by "grapheme" (what looks like one
  // character), which for emoji, accents typed as two code points, and many
  // scripts is more than one code point. To keep the count exact, cursor moves
  // and deletes only ever cross plain single-code-point characters.

  const COMBINING = /[\p{M}‍︀-️]/u;
  function safeChar(c) {
    if (c === '\n' || c === '\t') return true;
    if (c.length !== 1) return false; // outside the basic plane (emoji etc.)
    const x = c.charCodeAt(0);
    return (x >= 0x20 && x <= 0x7e) ||
      (x >= 0xa0 && x <= 0xff && x !== 0xad) ||
      (x >= 0x2010 && x <= 0x2027);
  }
  function isSafeAt(arr, j) {
    return j >= 0 && j < arr.length && safeChar(arr[j]) &&
      !(j + 1 < arr.length && COMBINING.test(arr[j + 1]));
  }

  // ---------- simulated text box: the plan is replayed here before use

  class Sim {
    constructor() { this.buf = []; this.cur = 0; }
    fail(msg) { throw new Error('plan check failed: ' + msg + ' at cursor ' + this.cur); }
    apply(a) {
      const b = this.buf;
      switch (a.k) {
        case 't':
          if (Array.from(a.s).length !== 1) this.fail('bad char');
          if (this.cur < b.length && COMBINING.test(b[this.cur])) this.fail('insert before a combining mark');
          b.splice(this.cur, 0, a.s); this.cur++; break;
        case 'bs':
          if (!isSafeAt(b, this.cur - 1)) this.fail('unsafe Backspace');
          b.splice(this.cur - 1, 1); this.cur--; break;
        case 'L':
          if (!isSafeAt(b, this.cur - 1)) this.fail('unsafe Left');
          this.cur--; break;
        case 'R':
          if (!isSafeAt(b, this.cur)) this.fail('unsafe Right');
          this.cur++; break;
        case 'cp':
          if (this.cur !== b.length) this.fail('checkpoint away from the end');
          break;
        case 'w': break;
        default: this.fail('unknown action ' + a.k);
      }
    }
  }

  // ---------- word lists

  const PAIRS = [
    ['big', 'large'], ['small', 'little'], ['show', 'demonstrate'], ['use', 'utilize'],
    ['help', 'assist'], ['get', 'obtain'], ['buy', 'purchase'], ['start', 'begin'],
    ['end', 'finish'], ['important', 'significant'], ['very', 'extremely'], ['many', 'numerous'],
    ['often', 'frequently'], ['also', 'additionally'], ['but', 'however'], ['so', 'therefore'],
    ['because', 'since'], ['about', 'regarding'], ['enough', 'sufficient'], ['need', 'require'],
    ['try', 'attempt'], ['make', 'create'], ['find', 'discover'], ['think', 'believe'],
    ['say', 'state'], ['tell', 'inform'], ['give', 'provide'], ['keep', 'maintain'],
    ['change', 'modify'], ['seem', 'appear'], ['fast', 'quick'], ['hard', 'difficult'],
    ['easy', 'simple'], ['clear', 'obvious'], ['main', 'primary'], ['whole', 'entire'],
    ['part', 'portion'], ['way', 'method'], ['idea', 'concept'], ['problem', 'issue'],
    ['answer', 'response'], ['goal', 'aim'], ['result', 'outcome'], ['effect', 'impact'],
    ['reason', 'cause'], ['choice', 'option'], ['chance', 'opportunity'], ['place', 'location'],
    ['people', 'individuals'], ['kids', 'children'], ['job', 'occupation'], ['money', 'funds'],
    ['rule', 'regulation'], ['area', 'region'], ['study', 'research'], ['test', 'examine'],
    ['check', 'verify'], ['explain', 'describe'], ['improve', 'enhance'], ['increase', 'raise'],
    ['decrease', 'reduce'], ['allow', 'permit'], ['stop', 'prevent'], ['build', 'construct'],
    ['choose', 'select'], ['plan', 'strategy'], ['mostly', 'mainly'], ['nearly', 'almost'],
    ['maybe', 'perhaps'], ['really', 'truly'], ['quickly', 'rapidly'], ['slowly', 'gradually'],
    ['clearly', 'obviously'], ['finally', 'lastly'], ['first', 'initially'], ['now', 'currently'],
    ['around', 'approximately'], ['good', 'positive'], ['bad', 'negative'], ['great', 'excellent'],
    ['new', 'novel'], ['old', 'former'], ['different', 'distinct'], ['same', 'identical'],
    ['common', 'typical'], ['strong', 'powerful'], ['weak', 'limited'], ['high', 'elevated'],
    ['low', 'reduced'], ['specific', 'particular'], ['basic', 'fundamental'], ['complex', 'complicated'],
    ['useful', 'helpful'], ['key', 'essential'], ['overall', 'generally'], ['every', 'each'],
    ['able', 'capable'], ['happen', 'occur'], ['affect', 'influence'], ['suggest', 'propose'],
    ['consider', 'weigh'], ['focus', 'concentrate'], ['include', 'contain'], ['develop', 'grow'],
    ['discuss', 'talk'], ['argue', 'claim'], ['prove', 'confirm'], ['understand', 'grasp'],
    ['remember', 'recall'], ['notice', 'observe'], ['want', 'wish'], ['hope', 'expect'],
    ['work', 'function'], ['task', 'assignment'], ['topic', 'subject'], ['point', 'argument'],
    ['example', 'instance'], ['fact', 'detail'], ['data', 'information'], ['evidence', 'proof'],
    ['source', 'reference'], ['process', 'procedure'], ['system', 'structure'], ['society', 'community'],
    ['country', 'nation'], ['world', 'globe'], ['time', 'period'], ['rich', 'wealthy'],
    ['poor', 'needy'], ['sure', 'certain'], ['true', 'accurate'], ['wrong', 'incorrect'],
    ['right', 'correct'], ['happy', 'glad'], ['sad', 'unhappy'], ['angry', 'upset'],
    ['scared', 'afraid'], ['smart', 'intelligent'], ['huge', 'enormous'], ['tiny', 'minor'],
    ['quite', 'fairly'], ['still', 'yet'], ['though', 'although'], ['while', 'whereas'],
  ];
  const SWAP = new Map();
  for (const [a, b] of PAIRS) {
    if (!SWAP.has(a)) SWAP.set(a, b);
    if (!SWAP.has(b)) SWAP.set(b, a);
  }

  const OPENERS = ['The', 'This', 'In the', 'It is', 'There are', 'One', 'Many', 'When',
    'As a', 'For', 'Another', 'These', 'Some', 'Most', 'Overall', 'At first', 'Because', 'While'];

  const FILLERS = [
    'This is an important point.', 'This matters for several reasons.',
    'It is worth looking at this more closely.', 'There is more to say about this.',
    'This idea comes up again later.', 'This is not always the case.',
    'Many people would agree with this.', 'This shows why it matters.',
    'That is one way to see it.', 'This point is easy to miss.',
    'It is a common example.', 'This needs a closer look.',
    'Some would argue otherwise.', 'This is where it gets interesting.',
    'That part is still debated.', 'It helps to keep this in mind.',
    'This was clear from the start.', 'The reasons for this vary.',
    'This connects to the main idea.', 'In short, it is complicated.',
    'This has a few exceptions.', 'It is not that simple.',
    'This is the key part.', 'That changes the whole picture.',
    'It depends on the situation.', 'This deserves more attention.',
    'There are a few ways to explain this.', 'This happens more than people think.',
  ];

  const NEIGHBORS = {
    q: 'wa', w: 'qeas', e: 'wrds', r: 'etdf', t: 'ryfg', y: 'tugh', u: 'yihj', i: 'uojk',
    o: 'ipkl', p: 'ol', a: 'qwsz', s: 'awedxz', d: 'serfcx', f: 'drtgvc', g: 'ftyhbv',
    h: 'gyujnb', j: 'huikmn', k: 'jiolm', l: 'kop', z: 'asx', x: 'zsdc', c: 'xdfv',
    v: 'cfgb', b: 'vghn', n: 'bhjm', m: 'njk',
  };

  // ---------- helpers

  const isLetter = (c) => c !== undefined && /^[A-Za-z]$/.test(c);
  const isAlnum = (c) => c !== undefined && /^[\p{L}\p{N}]$/u.test(c);
  const SENT_END = /^[.!?]$/;
  const CLOSER = /^["')\]”’]$/;

  function matchCase(word, model) {
    if (model.length > 1 && model === model.toUpperCase()) return word.toUpperCase();
    if (model[0] === model[0].toUpperCase()) return word[0].toUpperCase() + word.slice(1);
    return word;
  }

  function commonPrefix(a, b) {
    let i = 0;
    while (i < a.length && i < b.length && a[i] === b[i]) i++;
    return i;
  }
  function commonSuffix(a, b, max) {
    let i = 0;
    while (i < max && a[a.length - 1 - i] === b[b.length - 1 - i]) i++;
    return i;
  }

  // ---------- text analysis

  function analyze(T) {
    const n = T.length;
    const unsafeBefore = new Int32Array(n + 1);
    for (let i = 0; i < n; i++) unsafeBefore[i + 1] = unsafeBefore[i] + (isSafeAt(T, i) ? 0 : 1);
    const rangeSafe = (a, b) => a >= 0 && b <= n && unsafeBefore[b] - unsafeBefore[a] === 0;

    // ASCII letter words, as [start, end).
    const words = [];
    for (let i = 0; i < n;) {
      if (isLetter(T[i]) && !isAlnum(T[i - 1])) {
        let j = i;
        while (j < n && isLetter(T[j])) j++;
        if (!isAlnum(T[j]) && !COMBINING.test(T[j] || '')) words.push([i, j]);
        i = j;
      } else i++;
    }

    // Sentences: [start, end) where end is just after the closing punctuation
    // (or the end of the line for a heading without a period).
    const sentences = [];
    const ws = (c) => c === ' ' || c === '\n' || c === '\t' || c === ' ';
    let i = 0;
    while (i < n) {
      while (i < n && ws(T[i])) i++;
      if (i >= n) break;
      const start = i;
      let end = -1;
      while (i < n) {
        if (T[i] === '\n') { end = i; break; }
        if (SENT_END.test(T[i])) {
          let j = i + 1;
          while (j < n && (SENT_END.test(T[j]) || CLOSER.test(T[j]))) j++;
          if (j >= n || ws(T[j])) { end = j; i = j; break; }
          i = j; continue;
        }
        i++;
      }
      if (end < 0) end = n;
      // trim trailing spaces of a heading line
      let e = end;
      while (e > start && ws(T[e - 1])) e--;
      const para = start === 0 || T.slice(0, start).lastIndexOf('\n') >= (sentences.length ? sentences[sentences.length - 1].end : 0);
      sentences.push({ start, end: e, punct: SENT_END.test(T[e - 1]) || CLOSER.test(T[e - 1]), para });
      i = Math.max(i, end);
    }
    const wordCount = (T.join('').match(/\S+/g) || []).length;
    return { n, rangeSafe, words, sentences, wordCount };
  }

  // ---------- the planner

  const DEFAULTS = {
    wpm: 60, jitter: 0.2, typos: 0, revisions: 0, pauses: 0, goBack: true,
    seed: undefined, timeScale: 1, maxBack: 600,
  };

  function buildPlan(text, options) {
    const o = Object.assign({}, DEFAULTS, options || {});
    if (o.seed === undefined) o.seed = (Math.random() * 2 ** 32) >>> 0;
    const T = Array.from(text);
    let plan;
    try {
      plan = build(T, o, false);
      verify(T, plan.actions);
    } catch (e) {
      plan = build(T, o, true);
      verify(T, plan.actions);
      plan.fallback = String(e.message || e);
    }
    plan.seed = o.seed;
    return plan;
  }

  function verify(T, actions) {
    const sim = new Sim();
    for (const a of actions) sim.apply(a);
    if (sim.cur !== sim.buf.length) throw new Error('plan check failed: cursor not at the end');
    if (sim.buf.length !== T.length || sim.buf.join('') !== T.join('')) {
      throw new Error('plan check failed: final text differs');
    }
  }

  function build(T, o, plain) {
    const rnd = mulberry32(o.seed);
    const R = (lo, hi) => lo + rnd() * (hi - lo);
    const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
    const chance = (p) => rnd() < p;
    const scale = o.timeScale;
    const baseMs = 60000 / (Math.max(1, o.wpm) * 5); // 1 word = 5 characters

    const A = analyze(T);
    const n = A.n;
    const sim = new Sim();
    const actions = [];
    const stats = { typos: 0, lateTypos: 0, swaps: 0, falseStarts: 0, flips: 0, fillers: 0, omits: 0, goBacks: 0, pauses: 0 };

    const emit = (k, d, s) => {
      const a = { k, d: Math.max(0, Math.round(d * scale)) };
      if (s !== undefined) a.s = s;
      sim.apply(a);
      actions.push(a);
    };
    const keyDelay = () => baseMs * (1 + (rnd() * 2 - 1) * o.jitter);
    const typeStr = (chars) => { for (const c of chars) emit('t', keyDelay(), c); };
    const wait = (lo, hi) => emit('w', R(lo, hi));
    // A run of Backspace / arrow presses: taps when short, a held key when long.
    const press = (k, count) => {
      if (count <= 0) return;
      if (count <= 3) { for (let i = 0; i < count; i++) emit(k, Math.max(baseMs * 1.3, 110) * R(0.8, 1.25)); return; }
      emit(k, R(260, 380));
      for (let i = 1; i < count; i++) emit(k, R(30, 42));
    };
    const checkpoint = () => emit('cp', 0);

    // Thinking pauses (level 0 to 10, 5 = medium).
    const pauseLevel = Math.max(0, Math.min(10, o.pauses)) / 5;
    const sentStarts = new Map(A.sentences.map((s, idx) => [s.start, idx]));
    function thinkBefore(i) {
      if (!pauseLevel || i === 0) return;
      const si = sentStarts.get(i);
      if (si !== undefined) {
        if (A.sentences[si].para) { emit('w', pauseLevel * R(1500, 5000)); stats.pauses++; }
        else if (chance(0.75)) { emit('w', pauseLevel * R(400, 1800)); stats.pauses++; }
      } else if (T[i - 1] === ' ' && T[i - 2] === ',' && chance(0.2)) {
        emit('w', pauseLevel * R(200, 800)); stats.pauses++;
      }
    }

    if (plain) {
      for (let i = 0; i < n; i++) {
        thinkBefore(i);
        emit('t', keyDelay(), T[i]);
        if (/\s/.test(T[i])) checkpoint();
      }
      return { actions, stats, totalMs: total(actions), fallback: null };
    }

    // ----- pick where revisions and typos happen

    const events = new Map(); // text index -> event
    const owned = [];
    const isFree = (a, b) => owned.every(([x, y]) => b + 1 <= x || a >= y + 1);
    const own = (a, b) => owned.push([a, b]);
    const sentStartList = A.sentences.map((s) => s.start);

    // A later point to come back and fix a draft: the start of one of the
    // next three sentences (or the end of the text), close enough to reach
    // with the arrow keys, with only plain characters in between.
    function pickTrigger(siteStart, siteEnd) {
      const opts = [];
      for (const s of sentStartList) {
        if (s <= siteEnd) continue;
        opts.push(s);
        if (opts.length === 3) break;
      }
      if (opts.length < 3 && n > siteEnd) opts.push(n);
      const ok = opts.filter((s) => s - siteStart <= o.maxBack && A.rangeSafe(siteStart, s));
      return ok.length ? pick(ok) : -1;
    }

    const rate = (perHundred) => {
      const x = Math.max(0, perHundred) * A.wordCount / 100;
      return Math.floor(x) + (chance(x - Math.floor(x)) ? 1 : 0);
    };

    const revCands = { swap: [], omit: [], falseStart: [], flip: [], filler: [] };
    for (const [a, b] of A.words) {
      if (!A.rangeSafe(a, b)) continue;
      const w = T.slice(a, b).join('');
      if (SWAP.has(w.toLowerCase())) revCands.swap.push([a, b]);
      if (o.goBack && b - a >= 2 && T[a - 1] === ' ' && T[b] === ' ' && !sentStarts.has(a)) revCands.omit.push([a, b]);
    }
    for (const s of A.sentences) {
      if (isLetter(T[s.start]) && A.rangeSafe(s.start, s.start + 1)) revCands.falseStart.push(s);
      if (s.punct && SENT_END.test(T[s.end - 1]) && (s.end >= n || /\s/.test(T[s.end])) && A.rangeSafe(s.start, s.end)) {
        revCands.filler.push(s);
        const body = T.slice(s.start, s.end - 1).join('');
        const parts = body.split(', ');
        if (parts.length === 2 && !body.includes('\n')) {
          const wa = parts[0].split(' ').length, wb = parts[1].split(' ').length;
          if (wa >= 3 && wb >= 3) revCands.flip.push(s);
        }
      }
    }

    const weights = { swap: 3, omit: 2, falseStart: 2, flip: 1, filler: 1.5 };
    let wantRev = rate(o.revisions);
    for (let tries = 0; wantRev > 0 && tries < 4000; tries++) {
      const types = Object.keys(weights).filter((t) => revCands[t].length);
      if (!types.length) break;
      let r = rnd() * types.reduce((s, t) => s + weights[t], 0);
      let type = types[0];
      for (const t of types) { r -= weights[t]; if (r < 0) { type = t; break; } }
      const list = revCands[type];
      const c = list.splice(Math.floor(rnd() * list.length), 1)[0];

      let ev = null;
      if (type === 'swap' || type === 'omit') {
        const [a, b] = c;
        const end = type === 'omit' ? b + 1 : b;
        if (!isFree(a, end) || events.has(a)) continue;
        let trigger = -1;
        const defer = o.goBack && (type === 'omit' || chance(0.35));
        if (defer) trigger = pickTrigger(a, end);
        if (type === 'omit' && trigger < 0) continue;
        ev = { type, a, b: end, trigger };
        own(a, end);
      } else if (type === 'falseStart') {
        if (!isFree(c.start, c.start + 1) || events.has(c.start)) continue;
        ev = { type, a: c.start, b: c.start + 1, trigger: -1 };
        own(c.start, c.start + 1);
      } else if (type === 'flip') {
        if (!isFree(c.start, c.end) || events.has(c.start)) continue;
        const trigger = o.goBack && chance(0.5) ? pickTrigger(c.start, c.end) : -1;
        ev = { type, a: c.start, b: c.end, trigger };
        own(c.start, c.end);
      } else if (type === 'filler') {
        if (!isFree(c.end - 1, c.end) || events.has(c.end)) continue;
        const trigger = o.goBack && c.end < n && chance(0.5) ? pickTrigger(c.end - 1, c.end) : -1;
        ev = { type, a: c.end, b: c.end, trigger };
        own(c.end - 1, c.end);
      }
      events.set(ev.a, ev);
      wantRev--;
    }

    let wantTypos = rate(o.typos);
    const typoCands = A.words.filter(([a, b]) => b - a >= 3 && A.rangeSafe(a, b));
    for (let tries = 0; wantTypos > 0 && typoCands.length && tries < 4000; tries++) {
      const [a, b] = typoCands.splice(Math.floor(rnd() * typoCands.length), 1)[0];
      if (!isFree(a, b) || events.has(a)) continue;
      events.set(a, { type: 'typo', a, b });
      own(a, b);
      wantTypos--;
    }

    // Text indexes where something happens (no late-typo run may cross them).
    const busy = new Set(events.keys());
    for (const ev of events.values()) if (ev.trigger >= 0) busy.add(ev.trigger);
    for (const s of sentStartList) busy.add(s);

    // ----- deferred drafts waiting to be fixed

    const pending = []; // { bufStart, D, R, trigger }
    function fixDraft(d) {
      const p = commonPrefix(d.D, d.R);
      const s = commonSuffix(d.D, d.R, Math.min(d.D.length, d.R.length) - p);
      const target = d.bufStart + d.D.length - s;
      const back = sim.buf.length - target;
      wait(700, 2200);
      press('L', back);
      wait(200, 600);
      press('bs', d.D.length - p - s);
      typeStr(d.R.slice(p, d.R.length - s));
      const delta = d.R.length - d.D.length;
      for (const o2 of pending) if (o2 !== d && o2.bufStart > d.bufStart) o2.bufStart += delta;
      wait(250, 800);
      press('R', sim.buf.length - sim.cur);
      checkpoint();
      stats.goBacks++;
    }
    function fixesAt(i) {
      const due = pending.filter((d) => d.trigger === i);
      due.sort((x, y) => y.bufStart - x.bufStart);
      for (const d of due) {
        fixDraft(d);
        pending.splice(pending.indexOf(d), 1);
      }
    }
    function defer(D, R, trigger) {
      pending.push({ bufStart: sim.cur, D, R, trigger });
    }

    // ----- events

    function runEvent(ev, i) {
      const real = T.slice(ev.a, ev.b);
      switch (ev.type) {
        case 'swap': {
          const w = real.join('');
          const D = Array.from(matchCase(SWAP.get(w.toLowerCase()), w));
          stats.swaps++;
          if (ev.trigger >= 0) { defer(D, real, ev.trigger); typeStr(D); return ev.b; }
          typeStr(D);
          wait(350, 1300);
          const p = commonPrefix(D, real);
          press('bs', D.length - p);
          return ev.a + p;
        }
        case 'omit': {
          stats.omits++;
          defer([], real, ev.trigger);
          return ev.b;
        }
        case 'falseStart': {
          const first = (T.slice(ev.a).join('').match(/^[A-Za-z]+/) || [''])[0].toLowerCase();
          const choices = OPENERS.filter((x) => x.split(' ')[0].toLowerCase() !== first);
          let D = Array.from(pick(choices) + (chance(0.5) ? ' ' : ''));
          if (chance(0.3) && D.length > 3) D = D.slice(0, 2 + Math.floor(rnd() * (D.length - 2)));
          stats.falseStarts++;
          typeStr(D);
          wait(500, 1600);
          const p = commonPrefix(D, T.slice(ev.a, ev.a + D.length));
          press('bs', D.length - p);
          return ev.a + p;
        }
        case 'flip': {
          const body = T.slice(ev.a, ev.b - 1).join('');
          const [x, y] = body.split(', ');
          const decap = /^I\b/.test(x) || (x.length > 1 && x[1] === x[1].toUpperCase() && /[A-Z]/.test(x[1])) ? x : x[0].toLowerCase() + x.slice(1);
          const D = Array.from(y[0].toUpperCase() + y.slice(1) + ', ' + decap + T[ev.b - 1]);
          stats.flips++;
          if (ev.trigger >= 0) { defer(D, real, ev.trigger); typeStr(D); return ev.b; }
          typeStr(D);
          wait(800, 2200);
          const p = commonPrefix(D, real);
          press('bs', D.length - p);
          return ev.a + p;
        }
        case 'filler': {
          const D = Array.from(' ' + pick(FILLERS));
          stats.fillers++;
          if (ev.trigger >= 0) { defer(D, [], ev.trigger); typeStr(D); return ev.a; }
          typeStr(D);
          wait(700, 2000);
          press('bs', D.length);
          return ev.a;
        }
        case 'typo': return runTypo(ev);
      }
      throw new Error('unknown event');
    }

    function runTypo(ev) {
      const { a, b } = ev;
      const w = T.slice(a, b);
      let W = null;
      for (let tries = 0; tries < 8 && !W; tries++) {
        const j = 1 + Math.floor(rnd() * (w.length - 1));
        const c = w[j];
        const lower = c.toLowerCase();
        const kind = pick(['neighbor', 'neighbor', 'double', 'transpose', 'skip']);
        let cand = null;
        if (kind === 'neighbor' && NEIGHBORS[lower]) {
          let nb = pick(Array.from(NEIGHBORS[lower]));
          if (c !== lower) nb = nb.toUpperCase();
          cand = w.slice(0, j).concat([nb], w.slice(j + 1));
        } else if (kind === 'double') {
          cand = w.slice(0, j + 1).concat([c], w.slice(j + 1));
        } else if (kind === 'transpose' && j + 1 < w.length && w[j] !== w[j + 1]) {
          cand = w.slice(0, j).concat([w[j + 1], w[j]], w.slice(j + 2));
        } else if (kind === 'skip' && w.length > 3) {
          cand = w.slice(0, j).concat(w.slice(j + 1));
        }
        if (cand && cand.join('') !== w.join('')) W = cand;
      }
      if (!W) return a; // nothing sensible; type the word normally

      // Late fix: keep typing 1 or 2 more words before noticing. Only for
      // same-length typos (wrong key, swapped letters): if an editor's
      // autocorrect fixes the word when the space is typed, the Backspace
      // count still matches and the retyped text is still exact.
      let tail = [];
      if (W.length === w.length && chance(0.45)) {
        let m = b, words = 1 + Math.floor(rnd() * 2), ok = true;
        for (let k = 0; k < words; k++) {
          if (T[m] !== ' ' || !isLetter(T[m + 1])) { ok = k > 0; break; }
          m++;
          while (m < n && isLetter(T[m])) m++;
        }
        if (ok && m > b && A.rangeSafe(b, m)) {
          for (let k = a + 1; k <= m; k++) if (busy.has(k)) { ok = false; break; }
          if (ok) tail = T.slice(b, m);
        }
      }
      const Wc = W.concat(tail);
      const C = T.slice(a, a + Wc.length + 2);
      const e = commonPrefix(Wc, C);
      let stop;
      if (tail.length) { stop = Wc.length; stats.lateTypos++; }
      else stop = Math.min(W.length, e + 1 + Math.floor(rnd() * 3));
      stats.typos++;
      typeStr(Wc.slice(0, stop));
      if (tail.length) wait(400, 1200); else wait(150, 500);
      press('bs', stop - e);
      return a + e;
    }

    // ----- main pass over the text

    const thought = new Set();
    let i = 0;
    while (i < n) {
      fixesAt(i);
      if (!thought.has(i)) { thought.add(i); thinkBefore(i); }
      const ev = events.get(i);
      if (ev && !ev.done) {
        ev.done = true;
        i = runEvent(ev, i);
        continue;
      }
      emit('t', keyDelay(), T[i]);
      i++;
      if (/\s/.test(T[i - 1])) checkpoint();
    }
    const last = events.get(n);
    if (last && !last.done) { last.done = true; runEvent(last, n); }
    fixesAt(n);
    if (pending.length) throw new Error('unfixed drafts left');

    return { actions, stats, totalMs: total(actions), fallback: null };
  }

  function total(actions) {
    let t = 0;
    for (const a of actions) t += a.d;
    return t;
  }

  const api = { buildPlan, Sim, isSafeAt, analyze, mulberry32, SWAP, FILLERS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ExactTyperPlanner = api;
})(typeof self !== 'undefined' ? self : this);
