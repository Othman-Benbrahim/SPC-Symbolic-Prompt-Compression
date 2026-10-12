'use strict';
/**
 * Contrôles statiques de rosetta.html (le test navigateur complet est
 * test/e2e/editor.e2e.js, lancé avec `npm run test:e2e`).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'rosetta.html'), 'utf8');
const core = fs.readFileSync(path.join(ROOT, 'core.js'), 'utf8');

test('P0-4 : l\'éditeur embarque le même noyau que le CLI, et la même BDD', () => {
  assert.ok(html.includes(core.trim()), 'core.js inliné tel quel');
  const m = /const DEFAULT = (\{[\s\S]*?\});\n<\/script>/.exec(html);
  assert.ok(m, 'DEFAULT présent');
  assert.deepEqual(JSON.parse(m[1]), require('../rosetta.json'));
  assert.ok(!/function transpile\(input\)/.test(html.replace(core, '')), 'aucun second transpileur');
});

test('P0-5 : aucun gestionnaire d\'événement inline', () => {
  assert.doesNotMatch(html, /\son[a-z]+\s*=\s*["']/i);
  assert.doesNotMatch(html, /javascript:/i);
});

test('CSP : scripts inline hachés, aucune ressource externe', () => {
  const csp = /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html);
  assert.ok(csp, 'CSP présente');
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  assert.equal(scripts.length, 3);
  for (const s of scripts) {
    const h = crypto.createHash('sha256').update(s, 'utf8').digest('base64');
    assert.ok(csp[1].includes(`'sha256-${h}'`), 'empreinte de script');
  }
  assert.ok(!/unsafe-inline'[^;]*script|script-src[^;]*unsafe/.test(csp[1]));
  assert.doesNotMatch(html, /fonts\.googleapis|<link[^>]+href="https?:/i, 'P1-9 : pas de police distante');
  assert.doesNotMatch(html, /<script[^>]+src=/i);
});

test('P1-9 : spinner défini', () => {
  assert.match(html, /\.spinner\s*\{/);
  assert.match(html, /@keyframes spin/);
});
