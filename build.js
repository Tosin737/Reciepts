'use strict';
const fs = require('fs'), path = require('path');
const root = __dirname;
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const src = ['src/arena.js', 'src/ledger.js', 'src/meter.js'].map(read).join('\n');
const results = fs.readFileSync(path.join(root, 'dist/results.json'), 'utf8');
if (/<\/script/i.test(src) || /<\/script/i.test(results)) throw new Error('embedded text contains a closing script tag');
let html = read('template.html');
html = html.replace('/*@@SRC@@*/', () => 'globalThis.PB = {};\n' + src).replace('/*@@RESULTS@@*/', () => 'const R = ' + results + ';');
fs.writeFileSync(path.join(root, 'dist/index.html'), html);
// Syntax check of both inline scripts.
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
scripts.forEach((s, i) => { fs.writeFileSync(path.join(root, 'dist/_s' + i + '.js'), s); });
console.log('built dist/index.html', (html.length / 1024).toFixed(1) + ' KB', scripts.length + ' scripts');
