(function (G) {
'use strict';
const PB = G.PB = G.PB || {};
const C = (G.crypto && G.crypto.subtle) ? G.crypto
  : (typeof require !== 'undefined' ? require('node:crypto').webcrypto : null);
const enc = new TextEncoder();
const hex = b => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
const unhex = h => new Uint8Array(h.match(/../g).map(x => parseInt(x, 16)));

function canon(o) {
  if (Array.isArray(o)) return '[' + o.map(canon).join(',') + ']';
  if (o && typeof o === 'object') return '{' + Object.keys(o).sort().map(k => JSON.stringify(k) + ':' + canon(o[k])).join(',') + '}';
  return JSON.stringify(o === undefined ? null : o);
}
async function sha(s) { return hex(await C.subtle.digest('SHA-256', enc.encode(s))); }
async function newIdentity(id) {
  const kp = await C.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  return { id, priv: kp.privateKey, pub: kp.publicKey };
}
async function sign(priv, msg) { return hex(await C.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, priv, enc.encode(msg))); }
async function verifySig(pub, sig, msg) {
  try { return await C.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pub, unhex(sig), enc.encode(msg)); }
  catch (e) { return false; }
}

const content = r => ({ seq: r.seq, agent: r.agent, ts: r.ts, kind: r.kind, body: r.body, prev: r.prev });
const hashable = r => Object.assign(content(r), { cosig: r.cosig || null });

async function appendRecord(agent, chain, kind, body, opts) {
  opts = opts || {};
  const seq = chain.length, prev = seq ? chain[seq - 1].hash : 'genesis';
  const rec = { seq, agent: agent.id, ts: opts.ts != null ? opts.ts : 1790000000 + seq * 60, kind, body, prev, cosig: null };
  if (opts.cosigner) {
    const ch = await sha(canon(content(rec)));
    rec.cosig = { by: opts.cosigner.id, sig: await sign(opts.cosigner.priv, ch) };
  }
  rec.hash = await sha(canon(hashable(rec)));
  rec.sig = await sign(agent.priv, rec.hash);
  chain.push(rec);
  return rec;
}

async function checkpoint(witness, agentId, chain) {
  const seq = chain.length - 1, head = chain[seq].hash;
  const dup = witness.log.find(r => r.agent === agentId && r.seq === seq);
  if (dup) return dup;
  const rec = { agent: agentId, seq, head, sig: await sign(witness.priv, canon({ agent: agentId, seq, head })) };
  witness.log.push(rec);
  return rec;
}

const LAYERS = [
  { id: 'L0', label: 'Plain log', short: 'Plain log', cfg: {} },
  { id: 'L1', label: 'Hash chain', short: 'Hash chain', cfg: { chain: 1 } },
  { id: 'L2', label: 'Hash chain + agent signatures', short: '+ Signatures', cfg: { chain: 1, sig: 1 } },
  { id: 'L3', label: '+ Counterparty co-signature on agreements', short: '+ Co-sign', cfg: { chain: 1, sig: 1, cosig: 1 } },
  { id: 'L4', label: '+ Witness checkpoints', short: '+ Witness', cfg: { chain: 1, sig: 1, cosig: 1, anchor: 1 } }
];

async function verify(bundle, cfg) {
  const fails = [], chain = bundle.chain, reg = bundle.registry;
  if (cfg.chain) {
    for (let i = 0; i < chain.length; i++) {
      const r = chain[i];
      if (r.seq !== i) fails.push({ seq: i, layer: 'chain', reason: 'Sequence gap or reorder' });
      const prev = i ? chain[i - 1].hash : 'genesis';
      if (r.prev !== prev) fails.push({ seq: i, layer: 'chain', reason: 'Link to previous record is broken' });
      if (r.hash !== await sha(canon(hashable(r)))) fails.push({ seq: i, layer: 'chain', reason: 'Record contents do not match its hash' });
    }
  }
  if (cfg.sig) {
    for (let i = 0; i < chain.length; i++) {
      const r = chain[i];
      if (!reg[r.agent] || !(await verifySig(reg[r.agent], r.sig, r.hash))) fails.push({ seq: i, layer: 'sig', reason: 'Agent signature is invalid' });
    }
  }
  if (cfg.cosig) {
    for (let i = 0; i < chain.length; i++) {
      const r = chain[i];
      if (r.kind !== 'agreement') continue;
      if (!r.cosig) { fails.push({ seq: i, layer: 'cosig', reason: 'Agreement has no counterparty signature' }); continue; }
      if (r.cosig.by === r.agent || !reg[r.cosig.by]) { fails.push({ seq: i, layer: 'cosig', reason: 'Co-signer is not a known counterparty' }); continue; }
      const ch = await sha(canon(content(r)));
      if (!(await verifySig(reg[r.cosig.by], r.cosig.sig, ch))) fails.push({ seq: i, layer: 'cosig', reason: 'Counterparty signature does not match this record' });
    }
  }
  if (cfg.anchor) {
    for (const rc of bundle.receipts) {
      if (!(await verifySig(bundle.witnessPub, rc.sig, canon({ agent: rc.agent, seq: rc.seq, head: rc.head })))) {
        fails.push({ seq: rc.seq, layer: 'anchor', reason: 'Witness receipt is invalid' }); continue;
      }
      if (chain.length <= rc.seq) fails.push({ seq: rc.seq, layer: 'anchor', reason: 'Records the witness saw are missing' });
      else if (chain[rc.seq].hash !== rc.head) fails.push({ seq: rc.seq, layer: 'anchor', reason: 'History differs from what the witness recorded' });
    }
  }
  return { ok: fails.length === 0, failures: fails };
}

const STEPS = [
  ['tool_call', { tool: 'price_feed', result: 'Seller list price 118.40 per unit' }],
  ['claim', { text: 'Seller list price is 118.40 per unit', source: 'price_feed' }],
  ['tool_call', { tool: 'inventory_api', result: '500 units available' }],
  ['agreement', { text: 'Buy 200 units at 112.00 each, delivery by 2026-12-01', qty: 200, price: 112 }],
  ['tool_call', { tool: 'escrow', result: 'Escrow opened for 22400.00' }],
  ['commitment', { text: 'Seller will ship by 2026-12-01' }],
  ['fulfil', { text: 'Seller reported shipment, tracking TRK-88213' }],
  ['note', { text: 'Buyer confirms receipt of 200 units' }]
];

async function buildScenario(anchorAt) {
  anchorAt = anchorAt == null ? 5 : anchorAt;
  const buyer = await newIdentity('Buyer'), seller = await newIdentity('Seller'), witnessId = await newIdentity('Witness');
  const witness = { id: 'Witness', priv: witnessId.priv, pub: witnessId.pub, log: [] };
  const chain = [];
  for (let i = 0; i < STEPS.length; i++) {
    const [kind, body] = STEPS[i];
    await appendRecord(buyer, chain, kind, JSON.parse(JSON.stringify(body)), kind === 'agreement' ? { cosigner: seller } : {});
    if (i === anchorAt) await checkpoint(witness, 'Buyer', chain);
  }
  const ctx = { buyer, seller, witness };
  return { ctx, chain, receipts: witness.log.slice(), registry: { Buyer: buyer.pub, Seller: seller.pub }, witnessPub: witness.pub };
}

const clone = o => JSON.parse(JSON.stringify(o));
async function reseal(ctx, chain, from, resign) {
  for (let i = from; i < chain.length; i++) {
    const r = chain[i];
    r.seq = i; r.prev = i ? chain[i - 1].hash : 'genesis';
    r.hash = await sha(canon(hashable(r)));
    if (resign) r.sig = await sign(ctx.buyer.priv, r.hash);
  }
}

const ATTACKS = [
  { id: 'A1', who: 'outsider', label: 'Edit the agreed price in place',
    run: async (b) => { b.chain[3].body.price = 90; b.chain[3].body.text = 'Buy 200 units at 90.00 each, delivery by 2026-12-01'; } },
  { id: 'A2', who: 'outsider', label: 'Edit the price and recompute every later hash',
    run: async (b, ctx) => { b.chain[3].body.price = 90; b.chain[3].body.text = 'Buy 200 units at 90.00 each, delivery by 2026-12-01'; await reseal(ctx, b.chain, 3, false); } },
  { id: 'A3', who: 'outsider', label: 'Delete the inventory check and repair the links',
    run: async (b, ctx) => { b.chain.splice(2, 1); await reseal(ctx, b.chain, 2, false); } },
  { id: 'A4', who: 'insider', label: 'Cut off the last two records (after the last checkpoint)',
    run: async (b) => { b.chain.length = b.chain.length - 2; } },
  { id: 'A5', who: 'insider', label: 'Cut off four records (past the last checkpoint)',
    run: async (b) => { b.chain.length = b.chain.length - 4; } },
  { id: 'A6', who: 'insider', label: 'Rewrite the escrow record and re-sign the chain',
    run: async (b, ctx) => { b.chain[4].body.result = 'Escrow opened for 11200.00'; await reseal(ctx, b.chain, 4, true); } },
  { id: 'A7', who: 'insider', label: 'Rewrite the agreement terms and re-sign',
    run: async (b, ctx) => { b.chain[3].body.price = 90; b.chain[3].body.text = 'Buy 200 units at 90.00 each, delivery by 2026-12-01'; await reseal(ctx, b.chain, 3, true); } },
  { id: 'A8', who: 'insider', label: 'Rewrite the terms and forge the counterparty signature',
    run: async (b, ctx) => {
      const r = b.chain[3];
      r.body.price = 90; r.body.text = 'Buy 200 units at 90.00 each, delivery by 2026-12-01';
      const ch = await sha(canon(content(r)));
      r.cosig = { by: 'Seller', sig: await sign(ctx.buyer.priv, ch) };
      await reseal(ctx, b.chain, 3, true);
    } },
  { id: 'A9', who: 'insider', label: 'Rewrite a record from before the agreement and re-sign',
    run: async (b, ctx) => { b.chain[1].body.text = 'Seller list price is 131.00 per unit'; await reseal(ctx, b.chain, 1, true); } },
  { id: 'A10', who: 'insider', label: 'Rewrite the final record (after the last checkpoint)',
    run: async (b, ctx) => { const i = b.chain.length - 1; b.chain[i].body.text = 'Buyer disputes receipt of 200 units'; await reseal(ctx, b.chain, i, true); } }
];

async function runMatrix() {
  const base = await buildScenario(5);
  const snapshot = () => ({ chain: clone(base.chain), receipts: clone(base.receipts), registry: base.registry, witnessPub: base.witnessPub });
  const rows = [];
  const ctl = [];
  for (const L of LAYERS) ctl.push((await verify(snapshot(), L.cfg)).ok);
  for (const A of ATTACKS) {
    const b = snapshot();
    await A.run(b, base.ctx);
    const caught = [], detail = [];
    for (const L of LAYERS) {
      const v = await verify(b, L.cfg);
      caught.push(!v.ok); detail.push(v.failures.slice(0, 3));
    }
    rows.push({ id: A.id, who: A.who, label: A.label, caught, firstLayer: caught.indexOf(true), detail });
  }
  return { layers: LAYERS.map(l => ({ id: l.id, short: l.short, label: l.label })), controlPass: ctl, rows };
}

PB.ledger = { canon, sha, newIdentity, appendRecord, checkpoint, verify, buildScenario, ATTACKS, LAYERS, runMatrix, clone, STEPS };
})(globalThis);
