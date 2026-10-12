'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const SPC = require('../core');
const db = require('../rosetta.json');
const { build } = require('../build');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

test('rosetta.json : schéma, raccourcis et défauts conformes (lintDB)', () => {
  const { errors, warnings } = SPC.lintDB(db);
  assert.deepEqual(errors, []);
  assert.deepEqual(warnings, []);
});

test('rosetta.json : aucun déclencheur en double ni partagé entre opérateurs', () => {
  const seen = new Map();
  for (const o of db.operators) for (const t of o.triggers) {
    const k = SPC.normalize(t);
    assert.ok(!seen.has(k), `« ${t} » : ${seen.get(k)} et ${o.id}`);
    seen.set(k, o.id);
  }
});

test('rosetta.json : métadonnées complètes et modificateurs réservés présents', () => {
  for (const o of db.operators) {
    assert.ok(o.tier && o.summary && Array.isArray(o.signature) && typeof o.priority === 'number', o.id);
    for (const p of Object.keys(o.params || {})) {
      assert.ok(o.signature.includes(p), `${o.id}.${p} absent de la signature`);
    }
  }
  for (const m of Object.values(SPC.MOD)) assert.ok(db.modifiers[m], m);
  for (const m of Object.keys(db.modifiers)) assert.ok(db.modifier_effects[m], `effet manquant : ${m}`);
});

test('fichiers dérivés à jour (rosetta.html, SPC_SKILL.md, README.md)', () => {
  for (const [f, content] of Object.entries(build())) {
    assert.equal(read(f), content, `${f} n'est pas à jour — lance « node build.js »`);
  }
});

test('SPC_SKILL.md documente chaque opérateur avec sa signature', () => {
  const skill = read('SPC_SKILL.md');
  for (const o of db.operators) assert.ok(skill.includes(`**${o.id}**\`[${o.signature.join(', ')}]\``), o.id);
  assert.ok(!/A \| B\s+pipe/.test(skill), 'alias | retiré de la syntaxe');
  assert.ok(!/rosetta-editor\.html/.test(skill), 'ancien nom de fichier');
});

test('README : chiffres cohérents avec les données', () => {
  const readme = read('README.md');
  assert.ok(readme.includes(`**${Object.keys(db.shortcuts).length} raccourcis**`));
  assert.ok(!/rosetta-editor\.html/.test(readme));
  assert.ok(!/91 shortcuts/.test(readme));
});

test('arborescence plate : pas d\'archive imbriquée', () => {
  assert.ok(!fs.existsSync(path.join(ROOT, 'SPC_SKILL.zip')));
  assert.ok(fs.existsSync(path.join(ROOT, 'SPC_SKILL.md')));
});
