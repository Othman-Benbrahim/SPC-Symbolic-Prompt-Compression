#!/usr/bin/env node
/**
 * rosetta.js — Transpileur SPC (CLI). Toute la logique vit dans core.js.
 *
 * Mode pattern matching (défaut, zéro IA, zéro token) :
 *   node rosetta.js "analyse ce code en profondeur"
 *
 * Mode IA locale via LM Studio (API OpenAI-compatible, localhost uniquement) :
 *   node rosetta.js --ai "analyse ce code en profondeur"
 *   node rosetta.js --ai --port 1234 --model qwen2.5-coder-7b-instruct "..."
 *
 * Stdin :
 *   echo "fix the bug" | node rosetta.js --ai
 */
'use strict';

const fs   = require('fs');
const path = require('path');
const http = require('http');
const SPC  = require('./core');

const LM_HOST = 'localhost';
const DEFAULT_MODEL = 'google/gemma-3-4b';
const RULES_PATH = path.join(__dirname, 'rosetta.json');

const USAGE = `Usage : rosetta [options] "instruction en prose"
        echo "instruction" | rosetta [options]

Options :
  --ai             Traduire via un modèle local (LM Studio). Les raccourcis de la
                   BDD restent prioritaires ; repli sur les règles si indisponible.
  --port <N>       Port de LM Studio (1-65535, défaut 1234).
  --model <id>     Identifiant du modèle LM Studio (défaut ${DEFAULT_MODEL}).
  --json           Sortie JSON (dsl, source, complete, tokens, avertissements, validation).
  -h, --help       Afficher cette aide.
  --               Fin des options (le reste est de la prose).

Codes de sortie : 0 OK · 1 usage · 2 base de règles invalide · 3 aucun opérateur
                  · 4 DSL produit mais incomplet (une partie de la prose est perdue).`;

class UsageError extends Error {}

// ─── ARGUMENTS ────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const flags = { ai: false, port: 1234, model: DEFAULT_MODEL, json: false, help: false };
  const words = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') { words.push(...argv.slice(i + 1)); break; }
    if (a === '--ai') flags.ai = true;
    else if (a === '--json') flags.json = true;
    else if (a === '-h' || a === '--help') flags.help = true;
    else if (a === '--port' || a.startsWith('--port=')) {
      const v = a.includes('=') ? a.slice(7) : argv[++i];
      const p = Number(v);
      if (v === undefined || !/^\d+$/.test(String(v)) || !Number.isInteger(p) || p < 1 || p > 65535) {
        throw new UsageError(`--port attend un entier entre 1 et 65535 (reçu : ${v === undefined ? 'rien' : v})`);
      }
      flags.port = p;
    } else if (a === '--model' || a.startsWith('--model=')) {
      const v = a.includes('=') ? a.slice(8) : argv[++i];
      if (!v || v.startsWith('--')) throw new UsageError('--model attend un identifiant de modèle');
      flags.model = v;
    } else if (a.startsWith('--')) {
      throw new UsageError(`option inconnue : ${a}`);
    } else {
      words.push(a);   // les nombres sont conservés (« corrige le bug 404 »)
    }
  }
  return { flags, input: words.join(' ') };
}

// ─── BASE DE RÈGLES ───────────────────────────────────────────────────────────
function loadRules(file = RULES_PATH) {
  let db;
  try {
    db = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    const err = new Error(`Impossible de charger ${path.basename(file)} : ${e.message}`);
    err.exitCode = 2;
    throw err;
  }
  try { SPC.assertDB(db); }
  catch (e) { e.exitCode = 2; throw e; }
  return db;
}

// API historique, conservée pour compatibilité (module.exports).
let RULES = null;
const rules = () => (RULES || (RULES = loadRules()));

function patternMatch(input, db = rules()) {
  const r = SPC.transpile(input, db);
  return { dsl: r.dsl, source: r.source, op: r.ops[0], ops: r.ops, warnings: r.warnings, complete: r.complete };
}

// ─── LM STUDIO ────────────────────────────────────────────────────────────────
function callLMStudio(prose, { port = 1234, model = DEFAULT_MODEL, db = rules(), timeout = 20000 } = {}) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model,
      messages: [
        { role: 'system', content: SPC.buildSystemPrompt(db) },
        { role: 'user',   content: prose }
      ],
      temperature: 0,
      max_tokens: 200,
      stream: false
    });
    const req = http.request({
      hostname: LM_HOST, port, path: '/v1/chat/completions', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, res => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (res.statusCode >= 400 || json.error) {
            throw new Error(`HTTP ${res.statusCode} · ${(json.error && json.error.message) || data.slice(0, 200)}`);
          }
          const text = (json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content || '').trim();
          resolve(SPC.parseAIResponse(text, db));
        } catch (e) {
          reject(new Error(`réponse du modèle « ${model} » inexploitable : ${e.message}`));
        }
      });
    });
    req.on('error', e => {
      if (e.code === 'ECONNREFUSED') reject(new Error(`LM Studio introuvable sur ${LM_HOST}:${port}. Vérifie que le serveur local est démarré.`));
      else reject(e);
    });
    req.setTimeout(timeout, () => { req.destroy(new Error(`délai dépassé (${timeout / 1000}s) en attendant LM Studio`)); });
    req.write(body);
    req.end();
  });
}

// ─── AFFICHAGE ────────────────────────────────────────────────────────────────
function report(prose, result, label) {
  const tP = SPC.estimateTokens(prose);
  const tD = SPC.estimateTokens(result.dsl);
  return {
    prose, dsl: result.dsl, source: label, explication: result.explication || null,
    tokens: { prose: tP, dsl: tD, ratio: Math.round((tP / Math.max(tD, 1)) * 10) / 10 },
    warnings: result.warnings || [],
    complete: result.complete !== false,
    validation: SPC.validateDSL(result.dsl, rules())
  };
}

function display(r) {
  const out = [];
  out.push('', '─'.repeat(52));
  out.push(`PROSE   (~${r.tokens.prose} tokens, estimation locale)`);
  out.push(`  ${r.prose.trim()}`, '');
  out.push(`DSL     (~${r.tokens.dsl} tokens — ratio ×${r.tokens.ratio})  [${r.source}]`);
  out.push(`  ${r.dsl}`);
  if (r.explication) out.push('', `  → ${r.explication}`);
  if (!r.complete) out.push('', '  ⚠ INSTRUCTION INCOMPLÈTE : une partie de la prose n\'est pas dans le DSL (voir ci-dessous)');
  if (!r.validation.ok) out.push('', '  ⚠ DSL non conforme au schéma :', ...r.validation.errors.map(e => `    · ${e}`));
  for (const w of r.warnings) out.push(`  ⚠ ${w}`);
  out.push('─'.repeat(52), '');
  console.log(out.join('\n'));
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
async function run(prose, flags) {
  prose = String(prose || '').trim();
  if (!prose) throw new UsageError('instruction vide');
  const db = rules();
  const rule = patternMatch(prose, db);
  let result = null;

  if (flags.ai && rule.source !== 'shortcut') {
    try {
      const ai = await callLMStudio(prose, { port: flags.port, model: flags.model, db });
      result = report(prose, { ...ai, warnings: [], complete: true }, `IA locale · ${flags.model}`);
    } catch (e) {
      console.error(`⚠  IA locale : ${e.message}`);
      console.error('   Repli → pattern matching\n');
    }
  }
  if (!result) {
    if (!rule.dsl) {
      if (flags.json) console.log(JSON.stringify({ prose, dsl: null, complete: false, warnings: rule.warnings }, null, 2));
      else {
        console.log('⚠  Aucun opérateur reconnu.' + (flags.ai ? '' : ' Essaie --ai pour l\'IA locale.'));
        for (const w of rule.warnings) console.log(`   · ${w}`);
        console.log('   Verbes reconnus : analyse · scan · fix · validate · deploy · clone…');
      }
      return 3;
    }
    result = report(prose, rule, rule.source === 'shortcut' ? 'raccourci' : 'règles');
  }
  if (flags.json) console.log(JSON.stringify(result, null, 2));
  else display(result);
  return result.complete ? 0 : 4;
}

function readStdin() {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', c => data += c);
    process.stdin.on('end', () => resolve(data.replace(/\s+/g, ' ')));
    process.stdin.on('error', reject);
  });
}

async function main(argv) {
  let parsed;
  try { parsed = parseArgs(argv); }
  catch (e) { console.error(`Erreur : ${e.message}\n\n${USAGE}`); return 1; }
  const { flags } = parsed;
  if (flags.help) { console.log(USAGE); return 0; }

  let input = parsed.input;
  if (!input) {
    if (process.stdin.isTTY) { console.error(USAGE); return 1; }   // pas de blocage sur un TTY vide
    input = await readStdin();
  }
  try {
    rules();
    return await run(input, flags);
  } catch (e) {
    if (e instanceof UsageError) { console.error(`Erreur : ${e.message}\n\n${USAGE}`); return 1; }
    console.error(e.message);
    return e.exitCode || 1;
  }
}

if (require.main === module) {
  main(process.argv.slice(2)).then(code => { process.exitCode = code; });
}

module.exports = { patternMatch, callLMStudio, parseArgs, loadRules, main };
