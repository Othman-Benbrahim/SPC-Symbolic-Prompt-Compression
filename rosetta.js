#!/usr/bin/env node
/**
 * rosetta.js — Transpileur SPC
 *
 * Mode pattern matching (défaut, zéro IA, zéro token) :
 *   node rosetta.js "analyse ce code en profondeur"
 *
 * Mode IA locale via LM Studio (Gemma 3 4B) :
 *   node rosetta.js --ai "analyse ce code en profondeur"
 *   node rosetta.js --ai --port 1234 "..."
 *
 * Stdin :
 *   echo "fix the bug" | node rosetta.js --ai
 */

const fs   = require('fs');
const path = require('path');
const http = require('http');
const rl   = require('readline');

const RULES = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'rosetta.json'), 'utf8')
);

// ─── FLAGS ────────────────────────────────────────────────────────────────────
const args    = process.argv.slice(2);
const USE_AI  = args.includes('--ai');
const portIdx = args.indexOf('--port');
const LM_PORT = portIdx !== -1 ? parseInt(args[portIdx + 1]) : 1234;
const LM_HOST = 'localhost';
const input   = args.filter(a => !a.startsWith('--') && isNaN(parseInt(a))).join(' ');

// ─── PATTERN MATCHING ─────────────────────────────────────────────────────────
function normalize(str) {
  return str.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/['']/g, "'");
}

function matchShortcut(input) {
  const n = normalize(input);
  for (const [phrase, dsl] of Object.entries(RULES.shortcuts)) {
    if (n.includes(normalize(phrase))) return dsl;
  }
  return null;
}

function detectOperator(input) {
  const n = normalize(input);
  for (const op of RULES.operators) {
    if (op.triggers.some(t => n.includes(normalize(t)))) return op;
  }
  return null;
}

function detectParams(input, op) {
  const n = normalize(input);
  const params = {};
  for (const [pname, vals] of Object.entries(op.params || {})) {
    for (const [val, triggers] of Object.entries(vals)) {
      if (triggers.some(t => n.includes(normalize(t)))) {
        params[pname] = val; break;
      }
    }
  }
  return params;
}

function detectModifiers(input) {
  const n = normalize(input);
  const mods = {};
  for (const [key, triggers] of Object.entries(RULES.modifiers || {})) {
    if (triggers.some(t => n.includes(normalize(t)))) mods[key] = true;
  }
  return mods;
}

function detectOutput(input) {
  const n = normalize(input);
  for (const [type, triggers] of Object.entries(RULES.output_types || {})) {
    if (triggers.some(t => n.includes(normalize(t)))) return type;
  }
  return null;
}

function patternMatch(input) {
  const shortcut = matchShortcut(input);
  if (shortcut) return { dsl: shortcut, source: 'shortcut' };

  const op = detectOperator(input);
  if (!op) return { dsl: null };

  const params = detectParams(input, op);
  const mods   = detectModifiers(input);
  const output = detectOutput(input);

  let subject = '◈';
  const extras = [];
  if (params.skill)  subject = `${params.skill}, ◈`;
  if (params.ctx)    extras.push(`ctx=${params.ctx}`);
  if (params.depth)  extras.push(`depth=${params.depth}`);
  if (params.focus)  extras.push(`focus=${params.focus}`);
  if (params.layers) extras.push(`layers=${params.layers}`);
  if (params.format) extras.push(`format=${params.format}`);
  if (params.ratio)  extras.push(`ratio=${params.ratio}`);
  if (params.from)   extras.push(`from=${params.from}`);
  if (params.to)     extras.push(`to=${params.to}`);
  if (params.scope)  extras.push(`scope=${params.scope}`);
  if (params.env)    extras.push(`env=${params.env}`);
  if (params.adapt)  extras.push(`adapt=${params.adapt}`);
  if (mods['▲_max']) extras.push('▲');

  let dsl = `${op.id}[${subject}${extras.length ? ', ' + extras.join(', ') : ''}]`;
  if (mods.store)          dsl += ' → §1';
  else if (output)         dsl += ` → ${output}`;
  if (mods.session_close)  dsl += ' ⟶ ⊜';

  return { dsl, source: 'rules', op: op.id };
}

// ─── LM STUDIO — prompt dynamique depuis RULES ───────────────────────────────
function buildSystemPrompt() {
  const ops = RULES.operators.map(o => o.id).join(' ');

  const modifiers = Object.entries(RULES.modifiers || {})
    .map(([name, triggers]) => {
      const samples = triggers.slice(0, 3).join('/');
      const effects = {
        '▲_max':        '→ ajoute ▲ (profondeur max)',
        'pipe':         '→ enchaîne avec ⟶',
        'conditional':  '→ structure A ? B : C',
        'else':         '→ branche : C',
        'store':        '→ ajoute → §1',
        'session_close':'→ termine par ⊜',
        'lazy_load':    '→ ajoute ⌒'
      };
      return `${name}(${samples}) ${effects[name] || ''}`;
    }).join('\n  ');

  const outputs = Object.entries(RULES.output_types || {})
    .map(([type, triggers]) => `${type}(${triggers.slice(0, 2).join('/')})`)
    .join(' ');

  return `Tu es un transpileur DSL SPC (Symbolic Prompt Compression).
Convertis les instructions en langage naturel (français ou anglais) vers le DSL SPC.

OPÉRATEURS: ${ops}

MODIFICATEURS:
  ${modifiers}

TYPES DE SORTIE (après →): ${outputs}

SYMBOLES: ◈=input courant §N=référence ?=conditionnel *=wildcard ▲=max ⊘=exclure ↻=répéter ⟶=pipe ⊜=clôture ◊=trace ⌒=lazy load
SYNTAXE: OP[param=val] → TYPE | A ⟶ B | A ? B : C

EXEMPLES:
"analyze this code in depth" → {"dsl":"ANALYZE[◈, ▲]","explication":"analyse profonde","tokens_prose":5,"tokens_spc":2}
"add error handling to all functions" → {"dsl":"ADD[target=*, what=error-handling]","explication":"injecte gestion erreurs","tokens_prose":7,"tokens_spc":4}
"create a new react component" → {"dsl":"CREATE[◈, type=component, from=scratch]","explication":"génère composant","tokens_prose":6,"tokens_spc":4}
"find all usages of this function" → {"dsl":"FIND[input=*, type=usage, pattern=◈]","explication":"recherche utilisations","tokens_prose":7,"tokens_spc":5}
"validate all tests then archive" → {"dsl":"VALIDATE[*, scope=tests] ? ⊜ : DEBUG[*, focus=error]","explication":"valide puis archive ou debug","tokens_prose":5,"tokens_spc":6}

FORMAT EXACT (JSON strict, rien d'autre):
{"dsl":"...","explication":"...","tokens_prose":N,"tokens_spc":N}`;
}

function callLMStudio(prose) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: 'google/gemma-3-4b',
      messages: [
        { role: 'system', content: buildSystemPrompt() },
        { role: 'user',   content: prose }
      ],
      temperature: 0.1,
      max_tokens: 200,
      stream: false
    });

    const req = http.request({
      hostname: LM_HOST,
      port: LM_PORT,
      path: '/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          const text = json.choices?.[0]?.message?.content?.trim() || '';
          const clean = text.replace(/```json|```/g, '').trim();
          resolve(JSON.parse(clean));
        } catch(e) {
          reject(new Error('Réponse Gemma invalide : ' + data.substring(0, 200)));
        }
      });
    });

    req.on('error', e => {
      if (e.code === 'ECONNREFUSED')
        reject(new Error(`LM Studio introuvable sur le port ${LM_PORT}. Vérifie que le serveur local est démarré.`));
      else reject(e);
    });
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('Timeout LM Studio')); });
    req.write(body);
    req.end();
  });
}

// ─── AFFICHAGE ────────────────────────────────────────────────────────────────
function display(prose, result, mode) {
  const tP = result.tokens_prose || Math.ceil(prose.length / 4);
  const tD = result.tokens_spc   || Math.ceil((result.dsl||'').length / 4);
  const ratio = Math.round(tP / Math.max(tD, 1));
  const modeLabel = mode === 'ai' ? '[Gemma 3 4B]' : result.source === 'shortcut' ? '[raccourci]' : '[pattern]';

  console.log('');
  console.log('─'.repeat(52));
  console.log(`PROSE   (~${tP} tokens)`);
  console.log(`  ${prose.trim()}`);
  console.log('');
  console.log(`DSL     (~${tD} tokens — ratio ×${ratio})  ${modeLabel}`);
  console.log(`  ${result.dsl}`);
  if (result.explication) {
    console.log('');
    console.log(`  → ${result.explication}`);
  }
  console.log('─'.repeat(52));
  console.log('');
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
async function run(prose) {
  if (!prose || !prose.trim()) {
    console.error('Usage: node rosetta.js [--ai] [--port 1234] "ton instruction"');
    process.exit(1);
  }

  if (USE_AI) {
    // Tentative Gemma, fallback pattern si LM Studio indisponible
    try {
      const result = await callLMStudio(prose.trim());
      display(prose, result, 'ai');
    } catch(e) {
      console.error(`⚠  IA locale : ${e.message}`);
      console.error('   Fallback → pattern matching\n');
      const result = patternMatch(prose.trim());
      if (!result.dsl) {
        console.log('⚠  Aucun opérateur reconnu.');
        return;
      }
      display(prose, result, 'pattern');
    }
  } else {
    const result = patternMatch(prose.trim());
    if (!result.dsl) {
      console.log('⚠  Aucun opérateur reconnu. Essaie --ai pour l\'IA locale.');
      console.log('   Verbes reconnus: analyse · scan · fix · validate · deploy · clone…');
      return;
    }
    display(prose, result, 'pattern');
  }
}

if (require.main === module) {
  if (input) {
    run(input).catch(e => { console.error(e.message); process.exit(1); });
  } else {
    const iface = rl.createInterface({ input: process.stdin });
    const lines = [];
    iface.on('line', l => lines.push(l));
    iface.on('close', () => run(lines.join(' ')));
  }
}

module.exports = { patternMatch, callLMStudio };
