'use strict';
globalThis.PB = {};
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
require(path.join(root, 'src/arena.js'));
require(path.join(root, 'src/ledger.js'));
require(path.join(root, 'src/meter.js'));
const { arena, ledger, meter } = PB;

(async () => {
  const out = { generated: new Date().toISOString() };
  const methods = arena.METHODS.map(m => m.id);
  const Ks = [0, 8, 16, 32, 64, 128], SEEDS = 30;

  // ---- Arena
  let t0 = Date.now();
  out.arena = { params: arena.DEFAULTS, Ks, seeds: SEEDS, attacks: {} };
  for (const key of Object.keys(arena.ATTACKS)) {
    const sw = arena.sweep(arena.DEFAULTS, arena.ATTACKS[key], Ks, SEEDS, methods);
    for (const m of methods) sw.methods[m].flipAt = arena.costToFlip(sw.methods[m].accT, Ks, 0.5);
    out.arena.attacks[key] = sw;
  }
  const A_LIST = [10, 20, 40, 80, 160];
  out.arena.auditSweep = { attack: 'decor', K: 32, audits: A_LIST, audit: [], anchored: [] };
  for (const A of A_LIST) {
    const p = Object.assign({}, arena.DEFAULTS, { audit: A });
    const sw = arena.sweep(p, arena.ATTACKS.decor, [32], SEEDS, ['audit', 'anchored']);
    out.arena.auditSweep.audit.push(sw.methods.audit.accT[0]);
    out.arena.auditSweep.anchored.push(sw.methods.anchored.accT[0]);
  }
  out.arena.contested = {};
  for (const key of Object.keys(arena.ATTACKS)) {
    out.arena.contested[key] = Ks.slice(1).map(K => arena.contestedTargetShare(arena.DEFAULTS, arena.ATTACKS[key], K, SEEDS, 20));
  }
  out.arena.seconds = (Date.now() - t0) / 1000;

  // ---- Ledger
  out.ledger = await ledger.runMatrix();
  // expectations written down before looking at output
  const expectFirst = { A1: 1, A2: 2, A3: 2, A4: -1, A5: 4, A6: 4, A7: 3, A8: 3, A9: 3, A10: -1 };
  const wrong = out.ledger.rows.filter(r => r.firstLayer !== expectFirst[r.id]);
  out.ledger.expectationMismatches = wrong.map(r => ({ id: r.id, expected: expectFirst[r.id], got: r.firstLayer }));
  // perf
  {
    const a = await ledger.newIdentity('A'); const chain = [];
    let t = Date.now();
    for (let i = 0; i < 200; i++) await ledger.appendRecord(a, chain, 'tool_call', { tool: 'x', result: 'r' + i });
    const appendMs = (Date.now() - t) / 200;
    const bundle = { chain, receipts: [], registry: { A: a.pub } };
    t = Date.now();
    await ledger.verify(bundle, { chain: 1, sig: 1 });
    const verifyMs = (Date.now() - t) / 200;
    out.ledger.perf = { records: 200, appendMsPerRecord: +appendMs.toFixed(3), verifyMsPerRecord: +verifyMs.toFixed(3), runtime: process.version };
  }

  // ---- Meter
  const dev = meter.score(meter.devPairs());
  const held = meter.score(meter.HELDOUT);
  out.meter = { dev: { n: dev.n, ok: dev.ok, acc: dev.acc, miss: dev.miss }, heldout: { n: held.n, ok: held.ok, acc: held.acc, miss: held.miss }, specimens: {} };
  for (const k of Object.keys(meter.SPECIMENS)) {
    const a = meter.analyze(meter.SPECIMENS[k].text);
    out.meter.specimens[k] = { label: meter.SPECIMENS[k].label, counts: a.counts, claims: a.claims, boundShare: a.boundShare, bindableShare: a.bindableShare, vagueShare: a.vagueShare, opinionShare: a.opinionShare };
  }

  fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
  fs.writeFileSync(path.join(root, 'dist/results.json'), JSON.stringify(out));

  // ---- Print summary
  const f = x => (x == null ? '  >' + Ks[Ks.length - 1] : String(x).padStart(5));
  console.log('Arena seconds:', out.arena.seconds);
  for (const key of Object.keys(out.arena.attacks)) {
    console.log('\n== ' + key + ' : accuracy on targeted claims by Sybil count', JSON.stringify(Ks));
    const sw = out.arena.attacks[key];
    for (const m of methods) console.log(m.padEnd(10), sw.methods[m].accT.map(x => x.toFixed(2)).join(' '), ' flipAt', f(sw.methods[m].flipAt), ' share@64', sw.methods[m].share[4].toFixed(2), ' accAll@0', sw.methods[m].accAll[0].toFixed(3));
  }
  console.log('\nAudit sweep (decor, K=32)', JSON.stringify(out.arena.auditSweep));
  console.log('\nLedger control passes:', out.ledger.controlPass);
  for (const r of out.ledger.rows) console.log(r.id, r.who.padEnd(8), r.caught.map(c => c ? 'Y' : '.').join(' '), 'first=' + r.firstLayer, r.label);
  console.log('Ledger expectation mismatches:', JSON.stringify(out.ledger.expectationMismatches));
  console.log('Ledger perf:', JSON.stringify(out.ledger.perf));
  console.log('\nMeter dev', dev.ok + '/' + dev.n, JSON.stringify(dev.miss));
  console.log('Meter heldout', held.ok + '/' + held.n, JSON.stringify(held.miss));
  for (const k of Object.keys(out.meter.specimens)) console.log(k, JSON.stringify(out.meter.specimens[k].counts), 'claims', out.meter.specimens[k].claims, 'bound%', (out.meter.specimens[k].boundShare * 100).toFixed(0));
})().catch(e => { console.error(e); process.exit(1); });
