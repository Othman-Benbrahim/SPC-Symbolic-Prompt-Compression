#!/usr/bin/env node
/**
 * bench.js — Mesure reproductible du ratio prose/DSL avec de vrais tokenizers BPE.
 *
 *   npm install          (installe gpt-tokenizer, dépendance de dev)
 *   node bench.js        affiche le rapport
 *   node bench.js --write  écrit BENCH.md
 *
 * Tokenizers : cl100k_base (GPT-4) et o200k_base (GPT-4o), via gpt-tokenizer.
 * Le tokenizer de Claude n'est pas public : ces chiffres sont des approximations
 * de même famille (BPE octet), pas une mesure Claude.
 *
 * Corpus : les phrases des raccourcis de rosetta.json (→ leur DSL), le corpus
 * « règles » de test/corpus.js, et 24 consignes réalistes multi-instructions
 * (test/realistic.js) pour lesquelles on mesure aussi le RAPPEL (instructions
 * conservées) et la PRÉCISION (opérateurs parasites) : une compression qui perd
 * des instructions n'en est pas une.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const SPC = require('./core');
const db = require('./rosetta.json');
const { RULE_CASES } = require('./test/corpus');
const { REALISTIC } = require('./test/realistic');

let enc;
try {
  enc = {
    cl100k: require('gpt-tokenizer/encoding/cl100k_base').encode,
    o200k: require('gpt-tokenizer/encoding/o200k_base').encode
  };
} catch (e) {
  console.error('gpt-tokenizer absent : lance « npm install » (dépendance de dev).');
  process.exit(2);
}

const median = a => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
const r2 = x => Math.round(x * 100) / 100;

function measure(pairs, name) {
  const rows = pairs.map(([prose, dsl]) => {
    const t = {};
    for (const [k, f] of Object.entries(enc)) t[k] = { p: f(prose).length, d: f(dsl).length };
    t.est = { p: SPC.estimateTokens(prose), d: SPC.estimateTokens(dsl) };
    return { prose, dsl, t };
  });
  const stat = {};
  for (const k of [...Object.keys(enc), 'est']) {
    const P = rows.map(r => r.t[k].p), D = rows.map(r => r.t[k].d);
    stat[k] = {
      prose: P.reduce((a, b) => a + b, 0), dsl: D.reduce((a, b) => a + b, 0),
      aggRatio: P.reduce((a, b) => a + b, 0) / D.reduce((a, b) => a + b, 0),
      medRatio: median(rows.map(r => r.t[k].p / r.t[k].d)),
      shorter: rows.filter(r => r.t[k].d < r.t[k].p).length,
      saving: mean(rows.map(r => r.t[k].p - r.t[k].d))
    };
  }
  return { name, rows, stat, n: rows.length };
}

function report() {
  const shortcutPairs = Object.entries(db.shortcuts);
  const rulePairs = RULE_CASES.map(c => [c.in, SPC.transpile(c.in, db).dsl]).filter(p => p[1]);
  const sets = [measure(shortcutPairs, 'Raccourcis (phrase → DSL)'), measure(rulePairs, 'Règles (corpus de test → DSL)')];
  const skill = fs.readFileSync(path.join(__dirname, 'SPC_SKILL.md'), 'utf8');
  const seed = { cl100k: enc.cl100k(skill).length, o200k: enc.o200k(skill).length };

  const L = [];
  L.push('# Benchmark SPC — ratio prose / DSL', '');
  L.push(`Généré par \`node bench.js --write\` · règles v${db.version} · tokenizers cl100k_base et o200k_base (gpt-tokenizer).`);
  L.push('Le tokenizer de Claude n\'est pas public : chiffres indicatifs (même famille BPE octet).', '');
  for (const s of sets) {
    L.push(`## ${s.name} — ${s.n} paires`, '');
    L.push('| Tokenizer | Σ prose | Σ DSL | ratio global | ratio médian | DSL plus court | gain moyen / instruction |');
    L.push('|---|---:|---:|---:|---:|---:|---:|');
    for (const [k, v] of Object.entries(s.stat)) {
      L.push(`| ${k === 'est' ? 'estimateur local' : k} | ${v.prose} | ${v.dsl} | ×${r2(v.aggRatio)} | ×${r2(v.medRatio)} | ${v.shorter}/${s.n} | ${r2(v.saving)} |`);
    }
    L.push('');
  }
  // Consignes réalistes : compression + fidélité
  const real = REALISTIC.map(r => {
    const t = SPC.transpile(r.text, db);
    const got = [...t.ops];
    let hit = 0;
    for (const o of r.ops) { const i = got.indexOf(o); if (i >= 0) { got.splice(i, 1); hit++; } }
    return { r, t, hit, extra: got.length, p: enc.cl100k(r.text).length, d: t.dsl ? enc.cl100k(t.dsl).length : 0,
      po: enc.o200k(r.text).length, do: t.dsl ? enc.o200k(t.dsl).length : 0 };
  });
  const sum = f => real.reduce((a, x) => a + f(x), 0);
  const nOps = sum(x => x.t.ops.length);
  const recall = sum(x => x.hit) / sum(x => x.r.ops.length);
  const precision = nOps ? (nOps - sum(x => x.extra)) / nOps : 0;
  L.push(`## Consignes réalistes multi-instructions — ${real.length} consignes (FR + EN, 35–50 mots)`, '');
  L.push('| Mesure | Valeur |', '|---|---:|');
  L.push(`| Σ prose / Σ DSL (cl100k) | ${sum(x => x.p)} / ${sum(x => x.d)} → **×${r2(sum(x => x.p) / sum(x => x.d))}** |`);
  L.push(`| Σ prose / Σ DSL (o200k) | ${sum(x => x.po)} / ${sum(x => x.do)} → **×${r2(sum(x => x.po) / sum(x => x.do))}** |`);
  L.push(`| Rappel (instructions attendues présentes dans le DSL) | **${Math.round(recall * 100)} %** |`);
  L.push(`| Précision (opérateurs émis qui étaient attendus) | **${Math.round(precision * 100)} %** |`);
  L.push(`| Consignes entièrement conservées | ${real.filter(x => x.hit === x.r.ops.length).length} / ${real.length} |`);
  L.push(`| Consignes signalées incomplètes (avertissement) | ${real.filter(x => !x.t.complete).length} / ${real.length} |`);
  L.push('', 'Annotation des opérateurs attendus : manuelle (`test/realistic.js`), donc discutable ; elle est publiée pour être contestée.', '');
  L.push('| # | langue | rappel | parasites | prose | DSL | DSL émis |', '|---:|---|---:|---:|---:|---:|---|');
  real.forEach((x, i) => L.push(`| ${i + 1} | ${x.r.lang} | ${x.hit}/${x.r.ops.length} | ${x.extra} | ${x.p} | ${x.d} | \`${x.t.dsl}\`${x.t.complete ? '' : ' ⚠'} |`));
  L.push('');

  const sc = sets[0].stat;
  L.push('## Coût d\'amorçage et break-even', '');
  L.push(`SPC_SKILL.md : **${seed.cl100k} tokens** (cl100k) / **${seed.o200k}** (o200k).`, '');
  for (const k of ['cl100k', 'o200k']) {
    const g = sc[k].saving;
    L.push(`- ${k} : gain moyen par instruction (raccourcis) = ${r2(g)} token(s) → ` +
      (g > 0 ? `break-even ≈ **${Math.ceil(seed[k] / g)} instructions**.` : '**aucun break-even** : le DSL est en moyenne plus long que la prose.'));
  }
  const gr = (sum(x => x.p) - sum(x => x.d)) / real.length;
  L.push(`- cl100k, consignes réalistes : gain moyen par consigne = ${r2(gr)} tokens → ` +
    (gr > 0 ? `break-even ≈ **${Math.ceil(seed.cl100k / gr)} consignes** de ce type par session.` : '**aucun break-even**.'));
  L.push('', '## Écart de l\'estimateur local', '');
  const all = sets.flatMap(s => s.rows);
  const errs = all.flatMap(r => [Math.abs(r.t.est.p - r.t.cl100k.p) / r.t.cl100k.p, Math.abs(r.t.est.d - r.t.cl100k.d) / r.t.cl100k.d]);
  L.push(`Erreur relative moyenne de \`estimateTokens()\` vs cl100k : **${Math.round(mean(errs) * 100)} %** (médiane ${Math.round(median(errs) * 100)} %).`, '');
  L.push('## Paires où le DSL coûte le plus (cl100k)', '');
  L.push('| prose | tokens | DSL | tokens |', '|---|---:|---|---:|');
  for (const r of [...all].sort((a, b) => (b.t.cl100k.d - b.t.cl100k.p) - (a.t.cl100k.d - a.t.cl100k.p)).slice(0, 8)) {
    L.push(`| ${r.prose} | ${r.t.cl100k.p} | \`${r.dsl}\` | ${r.t.cl100k.d} |`);
  }
  return L.join('\n') + '\n';
}

if (require.main === module) {
  const md = report();
  if (process.argv.includes('--write')) { fs.writeFileSync(path.join(__dirname, 'BENCH.md'), md); console.log('→ BENCH.md écrit'); }
  else process.stdout.write(md);
}
module.exports = { report };
