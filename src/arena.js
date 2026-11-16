(function (G) {
'use strict';
const PB = G.PB = G.PB || {};

// Seeded PRNG so the browser and Node produce identical worlds.
function rng(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

const ATTACKS = {
  farm: {
    label: 'Copy farm', copy: 0.9, camAcc: 0.95, leak: 0.1,
    desc: 'Sybils share one answer sheet, answer most untargeted claims correctly, and cite each other.'
  },
  decor: {
    label: 'Decorrelated mimic', copy: 0, camAcc: 0.85, leak: 0.1,
    desc: 'Each Sybil answers untargeted claims independently at about honest accuracy. Only the targeted claims are coordinated.'
  },
  sleeper: {
    label: 'Sleeper with inbound links', copy: 0, camAcc: 0.92, leak: 0.6,
    desc: 'High-accuracy camouflage, plus enough honest inbound citations to look established.'
  }
};

const DEFAULTS = { nHonest: 50, nClaims: 300, nTarget: 30, cover: 0.5, audit: 40, cites: 4 };

const METHODS = [
  { id: 'none', label: 'No tool (plain majority)' },
  { id: 'pagerank', label: 'Citation rank' },
  { id: 'consensus', label: 'Agreement with majority' },
  { id: 'truth', label: 'Truth discovery' },
  { id: 'audit', label: 'Random audit' },
  { id: 'anchored', label: 'Targeted audit + independence' }
];

function makeWorld(p, atk, K, seed) {
  const nH = p.nHonest, nC = p.nClaims, nT = p.nTarget, n = nH + K;
  const rH = rng(seed * 1000003 + 17), rS = rng(seed * 7919 + K * 104729 + 101), rG = rng(seed * 31 + K * 977 + 7);
  const truth = new Uint8Array(nC);
  for (let c = 0; c < nC; c++) truth[c] = rH() < 0.5 ? 1 : 0;
  const votes = new Int8Array(n * nC).fill(-1);
  const q = new Float64Array(nH);
  for (let i = 0; i < nH; i++) {
    q[i] = 0.55 + 0.37 * rH();
    for (let c = 0; c < nC; c++) if (rH() < p.cover) votes[i * nC + c] = (rH() < q[i]) ? truth[c] : 1 - truth[c];
  }
  if (K > 0) {
    const master = new Uint8Array(nC);
    for (let c = 0; c < nC; c++) master[c] = c < nT ? 1 - truth[c] : (rS() < atk.camAcc ? truth[c] : 1 - truth[c]);
    for (let s = 0; s < K; s++) {
      const i = nH + s;
      for (let c = 0; c < nC; c++) {
        if (c < nT) votes[i * nC + c] = 1 - truth[c];
        else if (rS() < p.cover) votes[i * nC + c] = rS() < atk.copy ? master[c] : (rS() < atk.camAcc ? truth[c] : 1 - truth[c]);
      }
    }
  }
  // Citation graph: honest sources cite quality-preferentially; Sybils cite each other.
  const wts = new Float64Array(n); let mean = 0;
  for (let i = 0; i < nH; i++) { wts[i] = q[i] * q[i] * q[i]; mean += wts[i]; }
  mean /= nH;
  for (let i = nH; i < n; i++) wts[i] = atk.leak * mean;
  const out = [];
  for (let i = 0; i < nH; i++) {
    const set = new Set(); let guard = 0;
    while (set.size < Math.min(p.cites, n - 1) && guard++ < 200) {
      let tot = 0; for (let j = 0; j < n; j++) if (j !== i) tot += wts[j];
      let x = rG() * tot, pick = -1;
      for (let j = 0; j < n; j++) { if (j === i) continue; x -= wts[j]; if (x <= 0) { pick = j; break; } }
      if (pick < 0) pick = n - 1;
      set.add(pick);
    }
    out.push([...set]);
  }
  for (let s = 0; s < K; s++) {
    const i = nH + s, set = new Set(), m = Math.min(8, K - 1); let g = 0;
    while (set.size < m && g++ < 200) { const j = nH + Math.floor(rG() * K); if (j !== i) set.add(j); }
    out.push([...set]);
  }
  return { n, nH, K, nC, nT, truth, votes, q, out };
}

function pagerank(out, n) {
  let r = new Float64Array(n).fill(1 / n); const d = 0.85;
  for (let it = 0; it < 50; it++) {
    const nr = new Float64Array(n).fill((1 - d) / n); let dang = 0;
    for (let i = 0; i < n; i++) {
      const o = out[i];
      if (!o.length) { dang += r[i]; continue; }
      const share = d * r[i] / o.length;
      for (const j of o) nr[j] += share;
    }
    const add = d * dang / n;
    for (let i = 0; i < n; i++) nr[i] += add;
    r = nr;
  }
  return r;
}

function verdict(W, w) {
  const { n, nC, votes } = W; const v = new Uint8Array(nC);
  for (let c = 0; c < nC; c++) {
    let s = 0;
    for (let i = 0; i < n; i++) { const x = votes[i * nC + c]; if (x >= 0) s += w[i] * (x ? 1 : -1); }
    v[c] = s >= 0 ? 1 : 0;
  }
  return v;
}

function agreeRates(W, V) {
  const { n, nC, votes } = W; const r = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let a = 0, m = 0;
    for (let c = 0; c < nC; c++) { const x = votes[i * nC + c]; if (x < 0) continue; m++; if (x === V[c]) a++; }
    r[i] = (a + 1) / (m + 2);
  }
  return r;
}

function wilsonWeight(k, m) {
  if (m === 0) return 0;
  const z = 1.645, ph = k / m;
  const lb = (ph + z * z / (2 * m) - z * Math.sqrt((ph * (1 - ph) + z * z / (4 * m)) / m)) / (1 + z * z / m);
  if (lb <= 0.5) return 0;
  return Math.log(lb / (1 - lb));
}

function auditWeights(W, set) {
  const { n, nC, votes, truth } = W; const w = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let k = 0, m = 0;
    for (const c of set) { const x = votes[i * nC + c]; if (x < 0) continue; m++; if (x === truth[c]) k++; }
    w[i] = wilsonWeight(k, m);
  }
  return w;
}

function randomSet(nC, A, r, exclude) {
  const idx = []; for (let c = 0; c < nC; c++) if (!exclude || !exclude.has(c)) idx.push(c);
  for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); const t = idx[i]; idx[i] = idx[j]; idx[j] = t; }
  return idx.slice(0, Math.min(A, idx.length));
}

function contestedSet(W, count, r, exclude) {
  const { n, nC, votes } = W; const sc = [];
  for (let c = 0; c < nC; c++) {
    if (exclude.has(c)) continue;
    let a = 0, b = 0;
    for (let i = 0; i < n; i++) { const x = votes[i * nC + c]; if (x === 1) a++; else if (x === 0) b++; }
    const tot = a + b;
    sc.push([(tot >= 5 ? Math.min(a, b) / tot : -1) + r() * 1e-6, c]);
  }
  sc.sort((x, y) => y[0] - x[0]);
  return sc.slice(0, count).map(x => x[1]);
}

function clusterSizes(W, thr, minOverlap) {
  const { n, nC, votes } = W; const par = new Int32Array(n);
  for (let i = 0; i < n; i++) par[i] = i;
  const find = x => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; };
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      let ov = 0, ag = 0;
      const bi = i * nC, bj = j * nC;
      for (let c = 0; c < nC; c++) {
        const a = votes[bi + c]; if (a < 0) continue;
        const b = votes[bj + c]; if (b < 0) continue;
        ov++; if (a === b) ag++;
      }
      if (ov >= minOverlap && ag / ov >= thr) { const x = find(i), y = find(j); if (x !== y) par[x] = y; }
    }
  }
  const cnt = new Int32Array(n);
  for (let i = 0; i < n; i++) cnt[find(i)]++;
  const size = new Float64Array(n);
  for (let i = 0; i < n; i++) size[i] = cnt[find(i)];
  return size;
}

function weightsFor(m, W, p, seed) {
  const { n, nC } = W;
  const ones = new Float64Array(n).fill(1);
  if (m === 'none') return ones;
  if (m === 'pagerank') return pagerank(W.out, n);
  if (m === 'consensus') {
    const r = agreeRates(W, verdict(W, ones)); const w = new Float64Array(n);
    for (let i = 0; i < n; i++) w[i] = Math.max(1e-6, r[i] - 0.5);
    return w;
  }
  if (m === 'truth') {
    let w = ones;
    for (let it = 0; it < 10; it++) {
      const r = agreeRates(W, verdict(W, w)); const nw = new Float64Array(n);
      for (let i = 0; i < n; i++) nw[i] = Math.max(0, Math.log(r[i] / (1 - r[i])));
      w = nw;
    }
    return w;
  }
  if (m === 'audit') {
    const rA = rng(seed * 13 + 99);
    return auditWeights(W, randomSet(nC, p.audit, rA));
  }
  if (m === 'anchored') {
    const rA = rng(seed * 13 + 99);
    const half = Math.floor(p.audit / 2);
    const rs = randomSet(nC, p.audit - half, rA);
    const cs = contestedSet(W, half, rA, new Set(rs));
    const w = auditWeights(W, rs.concat(cs));
    const size = clusterSizes(W, 0.9, 30);
    for (let i = 0; i < n; i++) w[i] = w[i] / size[i];
    return w;
  }
  throw new Error('unknown method ' + m);
}

function evalWeights(W, w) {
  const { n, nH, nC, nT, votes, truth } = W;
  let cT = 0, cA = 0;
  for (let c = 0; c < nC; c++) {
    let s = 0;
    for (let i = 0; i < n; i++) { const x = votes[i * nC + c]; if (x >= 0) s += w[i] * (x ? 1 : -1); }
    const ok = Math.abs(s) < 1e-12 ? 0.5 : (((s > 0 ? 1 : 0) === truth[c]) ? 1 : 0);
    cA += ok; if (c < nT) cT += ok;
  }
  let tot = 0, syb = 0;
  for (let i = 0; i < n; i++) { tot += w[i]; if (i >= nH) syb += w[i]; }
  return { accT: cT / nT, accAll: cA / nC, share: tot > 0 ? syb / tot : 0 };
}

function sweep(p, atk, Ks, seeds, methodIds) {
  const raw = {};
  for (const m of methodIds) raw[m] = { accT: Ks.map(() => []), accAll: Ks.map(() => []), share: Ks.map(() => []) };
  for (let ki = 0; ki < Ks.length; ki++) {
    for (let s = 1; s <= seeds; s++) {
      const W = makeWorld(p, atk, Ks[ki], s);
      for (const m of methodIds) {
        const r = evalWeights(W, weightsFor(m, W, p, s));
        raw[m].accT[ki].push(r.accT); raw[m].accAll[ki].push(r.accAll); raw[m].share[ki].push(r.share);
      }
    }
  }
  const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
  const se = a => { const mu = mean(a); return Math.sqrt(a.reduce((x, y) => x + (y - mu) * (y - mu), 0) / Math.max(1, a.length - 1) / a.length); };
  const res = {};
  for (const m of methodIds) {
    res[m] = {
      accT: raw[m].accT.map(mean), accTse: raw[m].accT.map(se),
      accAll: raw[m].accAll.map(mean), share: raw[m].share.map(mean)
    };
  }
  return { Ks, seeds, methods: res };
}

// Smallest Sybil count in the sweep at which targeted-claim accuracy drops below thr (null if never).
function costToFlip(accT, Ks, thr) {
  thr = thr == null ? 0.5 : thr;
  for (let i = 0; i < Ks.length; i++) if (accT[i] < thr) return Ks[i];
  return null;
}

// Share of the most contested claims (by minority-vote fraction) that are the attacker's targeted claims.
function contestedTargetShare(p, atk, K, seeds, count) {
  let hit = 0, tot = 0;
  for (let s = 1; s <= seeds; s++) {
    const W = makeWorld(p, atk, K, s);
    const { n, nC, votes } = W, sc = [];
    for (let c = 0; c < nC; c++) {
      let a = 0, b = 0;
      for (let i = 0; i < n; i++) { const x = votes[i * nC + c]; if (x === 1) a++; else if (x === 0) b++; }
      const t = a + b; sc.push([t >= 5 ? Math.min(a, b) / t : -1, c]);
    }
    sc.sort((x, y) => y[0] - x[0]);
    for (const e of sc.slice(0, count)) { tot++; if (e[1] < W.nT) hit++; }
  }
  return hit / tot;
}

PB.arena = { ATTACKS, DEFAULTS, METHODS, makeWorld, weightsFor, evalWeights, sweep, costToFlip, rng, contestedTargetShare };
})(globalThis);
