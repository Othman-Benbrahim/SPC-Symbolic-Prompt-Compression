#!/usr/bin/env node
/**
 * build.js — Génère les fichiers dérivés depuis les sources uniques :
 *
 *   core.js + rosetta.json + src/editor.template.html  →  rosetta.html  (fichier unique autonome)
 *   rosetta.json                                       →  SPC_SKILL.md  (section opérateurs)
 *   rosetta.json                                       →  README.md     (section chiffres)
 *
 *   node build.js          écrit les fichiers
 *   node build.js --check  échoue (code 1) si un fichier dérivé n'est pas à jour (CI)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = __dirname;
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

const TIERS = {
  'cognitif': 'Tier Cognitif',
  'transformatif': 'Tier Transformatif',
  'création': 'Tier Création',
  'flux': 'Tier Flux',
  'validation': 'Tier Validation & Déploiement'
};

function buildEditor(core, rulesText) {
  const tpl = read('src/editor.template.html');
  if (/<\/script/i.test(core)) throw new Error('core.js ne doit pas contenir « </script »');
  const rules = JSON.stringify(JSON.parse(rulesText)).replace(/</g, '\\u003c');
  let html = tpl.replace('@@CORE@@', () => core.trim()).replace('@@RULES@@', () => rules);
  // CSP : seuls les 3 scripts et la feuille de style inline (hachés) sont admis ; aucun gestionnaire
  // d'événement inline, aucune ressource externe, réseau limité à localhost.
  const sha = t => `'sha256-${crypto.createHash('sha256').update(t, 'utf8').digest('base64')}'`;
  const hashes = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => sha(m[1]));
  // style-src : la feuille <style> unique est hachée ; aucun attribut style= n'est admis
  if (/\sstyle\s*=/i.test(html)) throw new Error('attribut style= interdit dans le gabarit (CSP) : utiliser une classe');
  const styles = [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map(m => sha(m[1]));
  const csp = [
    "default-src 'none'",
    `script-src ${hashes.join(' ')}`,
    `style-src ${styles.join(' ')}`,
    'connect-src http://localhost:* http://127.0.0.1:*',
    'img-src data:',
    "base-uri 'none'",
    "form-action 'none'"
  ].join('; ');
  html = html.replace('@@CSP@@', csp);
  html = html.replace(/<!--\s*\n\s*GABARIT[\s\S]*?-->\n/, '<!-- FICHIER GÉNÉRÉ par `node build.js` depuis src/editor.template.html + core.js + rosetta.json — ne pas éditer. -->\n');
  return html;
}

function operatorsMarkdown(db) {
  const out = [`## Les ${db.operators.length} opérateurs`, ''];
  let tier = null;
  for (const op of db.operators) {
    if (op.tier !== tier) {
      tier = op.tier;
      out.push(`### ${TIERS[tier] || tier}`, '');
    }
    out.push(`**${op.id}**\`[${(op.signature || []).join(', ')}]\``);
    if (op.summary) out.push(op.summary);
    for (const [p, vals] of Object.entries(op.params || {})) {
      const keys = Object.keys(vals);
      if (keys.length) out.push(`- \`${p}\` : ${keys.map(k => '`' + k + '`').join(' · ')}`);
    }
    for (const n of op.notes || []) out.push(`- ${n}`);
    out.push('');
  }
  return out.join('\n').trim();
}

function statsMarkdown(db) {
  const triggers = db.operators.reduce((n, o) => n + o.triggers.length, 0);
  return [
    `- **${db.operators.length} opérateurs** avec leurs déclencheurs FR/EN, paramètres, signature et priorité`,
    `- **${Object.keys(db.shortcuts).length} raccourcis** — phrases fréquentes avec leur DSL exact (tous validés contre le schéma)`,
    `- **${Object.keys(db.modifiers).length} modificateurs** — mots qui affectent la forme du DSL produit`,
    `- **${Object.keys(db.output_types).length} types de sortie** — formats reconnus après \`→\``,
    `- **${triggers} déclencheurs d'opérateurs** au total, sans collision entre opérateurs`,
    `- Version des règles : \`${db.version}\``
  ].join('\n');
}

function replaceBlock(text, name, content, file) {
  const re = new RegExp(`(<!-- BEGIN:${name}[^>]*-->)[\\s\\S]*?(<!-- END:${name} -->)`);
  if (!re.test(text)) throw new Error(`marqueurs BEGIN/END:${name} absents de ${file}`);
  return text.replace(re, (_, a, b) => `${a}\n${content}\n${b}`);
}

function build() {
  const core = read('core.js');
  const rulesText = read('rosetta.json');
  const db = JSON.parse(rulesText);
  return {
    'rosetta.html': buildEditor(core, rulesText),
    'SPC_SKILL.md': replaceBlock(read('SPC_SKILL.md'), 'OPERATORS', operatorsMarkdown(db), 'SPC_SKILL.md'),
    'README.md': replaceBlock(read('README.md'), 'STATS', statsMarkdown(db), 'README.md')
  };
}

if (require.main === module) {
  const check = process.argv.includes('--check');
  const files = build();
  let stale = 0;
  for (const [f, content] of Object.entries(files)) {
    const p = path.join(ROOT, f);
    const current = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
    if (current === content) { console.log(`✓ ${f} à jour`); continue; }
    if (check) { console.error(`✗ ${f} n'est pas à jour — lance « node build.js »`); stale++; }
    else { fs.writeFileSync(p, content); console.log(`→ ${f} régénéré`); }
  }
  process.exitCode = stale ? 1 : 0;
}

module.exports = { build, buildEditor, operatorsMarkdown };
