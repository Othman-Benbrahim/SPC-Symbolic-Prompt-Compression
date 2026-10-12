#!/usr/bin/env node
/**
 * validate.js — Contrôle strict de rosetta.json (CI).
 *   - structure de la BDD
 *   - chaque raccourci et chaque défaut d'opérateur conforme à la grammaire et aux énumérations
 *   - aucun déclencheur en double ou partagé entre opérateurs
 *   - SPC_SKILL.md synchronisé avec la BDD (section générée par build.js)
 *
 *   node validate.js [chemin/vers/rosetta.json]
 */
'use strict';
const fs = require('fs');
const path = require('path');
const SPC = require('./core');

const file = process.argv[2] || path.join(__dirname, 'rosetta.json');
let db;
try { db = JSON.parse(fs.readFileSync(file, 'utf8')); }
catch (e) { console.error(`✗ ${file} illisible : ${e.message}`); process.exit(2); }

const structure = SPC.checkDBStructure(db);
if (structure.length) {
  console.error('✗ Structure invalide :\n  - ' + structure.join('\n  - '));
  process.exit(1);
}

const { errors, warnings } = SPC.lintDB(db);

if (path.resolve(file) === path.join(__dirname, 'rosetta.json')) {
  const skill = fs.readFileSync(path.join(__dirname, 'SPC_SKILL.md'), 'utf8');
  for (const o of db.operators) {
    if (!skill.includes(`**${o.id}**\`[${(o.signature || []).join(', ')}]\``)) {
      errors.push(`SPC_SKILL.md ne documente pas ${o.id}[${(o.signature || []).join(', ')}] — lance « node build.js »`);
    }
  }
}

for (const w of warnings) console.warn(`⚠ ${w}`);
if (errors.length) {
  console.error(`✗ ${errors.length} erreur(s) :\n  - ` + errors.join('\n  - '));
  process.exit(1);
}
const triggers = db.operators.reduce((n, o) => n + o.triggers.length, 0);
console.log(`✓ rosetta.json v${db.version} : ${db.operators.length} opérateurs, ${triggers} déclencheurs, ` +
  `${Object.keys(db.shortcuts).length} raccourcis — tous conformes`);
