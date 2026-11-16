# Provenance Bench

Prototypes for the AI for epistemics sprint, Trust Infrastructure track.

- src/arena.js   Sybil attack simulation and six source-reliability scoring methods
- src/ledger.js  Tamper-evident agent ledger (hash chain, signatures, co-signing, witness checkpoints)
- src/meter.js   Evidence-coverage meter and labelled test sentences
- test/run.js    Runs every experiment and writes dist/results.json
- template.html, build.js   Bundle everything into dist/index.html

Reproduce (Node 19 or newer):

    node test/run.js
    node build.js

Then open dist/index.html in a browser. It runs offline.
