(function (G) {
'use strict';
const PB = G.PB = G.PB || {};

const PROC = /^(?:thank you|thanks|welcome|please see|roll call|call to order|pledge of allegiance|adjourn|next item|public comment)\b|\b(?:called to order|was adjourned|were adjourned|moved to|moved by|seconded by|seconded the motion)\b/i;

const EVID = [
  /https?:\/\/\S+|\bwww\.\S+|\bdoi:\s*\S+|\bdoi\.org\//i,
  /\baccording to\b|\bas reported by\b|\breported by\b|\bsource:|\bcited in\b|\bper the\s+\w/i,
  /\bet al\.?|\(\s*[A-Z][A-Za-z-]+(?: et al\.?)?,?\s*(?:19|20)\d{2}\s*\)|\[\d+(?:[,–-]\d+)*\]/,
  /\b(?:Resolution|Ordinance|Bill|Motion|Item|Section|Docket|Case)\s*(?:No\.?|#)?\s*\d[\w.()-]*/,
  /\b(?:Appendix|Exhibit|Table|Figure)\s+[A-Z0-9]\w*/,
  /\bForm\s+[0-9A-Z][\w-]*/,
  /\b(?:study|trial|review|report|survey|analysis|filing)\s+(?:published\s+)?(?:in|from|by)\s+(?:the\s+)?[A-Z]/
];
const OPIN = /\b(?:should|must|ought|believe[sd]?|think[s]?|feel[s]?|hope[sd]?|worr(?:y|ies|ied)|concern(?:s|ed)?|support(?:s|ed)?|oppos(?:e|es|ed)|great|best|worst|terrible|wonderful|important|vital|unfortunately|hopefully|clearly|obviously|arguably|thrilled|pleased|happy|disappointed|excited|proud|optimistic|pessimistic|cautious)\b/i;
const HEDGE = /\b(?:will|may|might|could|would|likely|probably|possibly|expects?|expected|seems?|appears?|suggests?)\b/i;
const FACT = /\b(?:is|are|was|were|has|have|had|did|does|shows?|showed|found|reported|said|says|say|stated|announced|approved|voted|passed|rejected|increased|decreased|rose|fell|dropped|grew|cooled|held|reduces?|reduced|causes?|caused|prevents?|raised|cut|issued|signed|awarded|totaled|reached|exceeded|closed|opened|gained|lost|contains?|requires?|presented|valued)\b/i;

function sentences(text) {
  return text.replace(/\r/g, '').split(/\n+/).flatMap(line =>
    line.trim().split(/(?<=[.!?])\s+(?=[A-Z0-9"“(\[])/)
  ).map(s => s.trim()).filter(Boolean);
}

function classify(s) {
  const words = s.split(/\s+/).length;
  if (words < 4 || /\?\s*$/.test(s) || PROC.test(s)) return 'procedural';
  if (EVID.some(r => r.test(s))) return 'bound';
  if (OPIN.test(s) || HEDGE.test(s)) return 'opinion';
  if (/\d/.test(s)) return 'bindable';
  const rest = s.replace(/^\S+\s+/, '');
  const proper = /\b[A-Z][a-z]+/.test(rest);
  if (proper && FACT.test(s)) return 'bindable';
  if (FACT.test(s)) return 'vague';
  return 'procedural';
}

const CLASSES = ['bound', 'bindable', 'vague', 'opinion', 'procedural'];

function analyze(text) {
  const items = sentences(text).map(s => ({ text: s, cls: classify(s) }));
  const counts = {}; CLASSES.forEach(c => counts[c] = 0);
  items.forEach(i => counts[i.cls]++);
  const claims = items.length - counts.procedural;
  return { items, counts, claims,
    boundShare: claims ? counts.bound / claims : 0,
    bindableShare: claims ? counts.bindable / claims : 0,
    vagueShare: claims ? counts.vague / claims : 0,
    opinionShare: claims ? counts.opinion / claims : 0 };
}

// Invented specimens. They illustrate the three domains named in the track brief and are not real documents.
const SPECIMENS = {
  council: { label: 'Council minutes (invented)', text:
`The meeting was called to order at 7:02 p.m. by Mayor Okafor.
Council approved Resolution 24-118, authorizing a $412,000 contract with Delta Paving for the Mill Street resurfacing.
The vote passed 5 to 2.
Public Works reported that 38 percent of the city's roads are rated poor or worse.
Councilmember Reyes said the new bike lanes have cut collisions on Harbor Avenue.
According to the 2025 Annual Road Condition Report, the repaving backlog is $19.6 million.
Several residents were concerned about construction noise.
The city expects the project will finish early next spring.
The water rate increase of 4.5 percent takes effect on January 1.
Councilmember Dube moved to table Item 9 until the next session.
The budget deficit grew last year.
Staff presented the traffic study (see Appendix C) showing 12,400 daily vehicle trips on Harbor Avenue.
The meeting was adjourned at 9:14 p.m.` },
  health: { label: 'Health advice (invented)', text:
`Regular exercise reduces the risk of heart disease.
Adults should get at least 150 minutes of moderate activity each week, according to the WHO physical activity guidelines.
A 2023 trial published in The Lancet found that a Mediterranean diet cut cardiovascular events by 30 percent [1].
Many people feel better when they sleep more.
Vitamin D supplements prevent colds.
The CDC recommends that adults over 65 receive an annual influenza vaccine (CDC, 2024).
You might want to try meditation to manage stress.
Drinking eight glasses of water a day is essential.
Smoking causes about 480,000 deaths per year in the United States.
Honey is a natural remedy that may soothe a cough.
Blood pressure above 130/80 mmHg is classified as stage 1 hypertension.
Stress is bad for you.` },
  finance: { label: 'Financial news (invented)', text:
`Shares of Northwind Energy rose 6.2 percent on Tuesday after the company raised its full-year guidance.
The company reported third-quarter revenue of $3.4 billion, according to its regulatory filing (Form 10-Q).
Analysts expect the stock could reach $140 by year end.
The Federal Reserve held rates steady at 4.25 percent, the central bank said in a statement.
Markets were optimistic about the outlook.
Oil prices fell 2 percent as inventories grew.
Northwind's chief executive Dana Whitfield said demand remains strong.
The deal, valued at $2.1 billion, is the largest in the sector this year.
Inflation cooled to 2.9 percent in October, the Bureau of Labor Statistics reported.
Investors should be cautious about valuations.
The merger will probably close in the first half of 2027.
Trading volume was twice the 30-day average.` }
};

// Labels written by the builder, in order of the specimen sentences above.
const DEV_LABELS = {
  council: ['procedural', 'bound', 'bindable', 'bindable', 'bindable', 'bound', 'opinion', 'opinion', 'bindable', 'procedural', 'vague', 'bound', 'procedural'],
  health: ['vague', 'bound', 'bound', 'vague', 'vague', 'bound', 'opinion', 'vague', 'bindable', 'opinion', 'bindable', 'vague'],
  finance: ['bindable', 'bound', 'opinion', 'bindable', 'opinion', 'bindable', 'bindable', 'bindable', 'bindable', 'opinion', 'opinion', 'bindable']
};

// Held-out sentences, written and labelled before the first run of the classifier.
const HELDOUT = [
  ['The county reported 1,204 new permits issued in March, up from 980 a year earlier.', 'bindable'],
  ['Please see the attached schedule.', 'procedural'],
  ['A review in BMJ (Smith et al., 2022) found no benefit from the supplement.', 'bound'],
  ['Everyone knows coffee is unhealthy.', 'vague'],
  ['Revenue climbed 11 percent to $812 million.', 'bindable'],
  ['The mayor will announce the plan next week.', 'opinion'],
  ['Per the 2024 audit report, overtime spending hit $6.1 million.', 'bound'],
  ['Drinking alcohol is harmful.', 'vague'],
  ['The agency published its methodology at https://data.example.gov/method.', 'bound'],
  ['We are thrilled by this result.', 'opinion'],
  ['Unemployment fell to 3.8 percent last quarter.', 'bindable'],
  ['The new law requires employers to post wage ranges, per Section 12(b) of the Act.', 'bound'],
  ['Cholesterol levels dropped by 18 percent in the treatment group.', 'bindable'],
  ['Some experts say the market is overvalued.', 'vague'],
  ['Thank you all for coming.', 'procedural'],
  ['Shipping costs doubled between 2021 and 2023 according to the Drewry index.', 'bound']
];

function score(pairs) {
  let ok = 0; const conf = {}; const miss = [];
  for (const [text, label] of pairs) {
    const got = classify(text);
    conf[label + '>' + got] = (conf[label + '>' + got] || 0) + 1;
    if (got === label) ok++; else miss.push({ text, label, got });
  }
  return { n: pairs.length, ok, acc: ok / pairs.length, miss };
}

function devPairs() {
  const out = [];
  for (const k of Object.keys(SPECIMENS)) {
    const s = sentences(SPECIMENS[k].text);
    if (s.length !== DEV_LABELS[k].length) throw new Error('label count mismatch for ' + k + ': ' + s.length + ' vs ' + DEV_LABELS[k].length);
    s.forEach((x, i) => out.push([x, DEV_LABELS[k][i]]));
  }
  return out;
}

PB.meter = { sentences, classify, analyze, CLASSES, SPECIMENS, HELDOUT, score, devPairs };
})(globalThis);
