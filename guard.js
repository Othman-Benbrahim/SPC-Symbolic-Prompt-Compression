#!/usr/bin/env node
/**
 * guard.js — Garde-fou d'intention SPC pour agents.
 *
 * Deux niveaux, indépendants :
 *   1. evaluatePrompt(prose) : la Pierre de Rosette lit la demande (localement,
 *      sans IA) et la politique est appliquée aux ÉTAPES du DSL (opérateur,
 *      paramètres, position dans un conditionnel) et à quelques mots de la prose.
 *   2. evaluateTool(tool, input, state) : chaque commande Bash / écriture de fichier
 *      est classée (destructive, déploiement, secrets, fichiers d'auth). Ce niveau
 *      rattrape ce que la lecture de la prose a manqué.
 *
 * Le garde-fou ne fait que DURCIR : il peut demander une confirmation (« ask ») ou
 * bloquer, jamais autoriser à la place de l'utilisateur.
 *
 *   node guard.js "mets en prod la v2"            décision pour une demande
 *   node guard.js --command "git push --force"    décision pour une commande
 *   node guard.js --audit <fichier|dossier>       audit de vrais prompts (texte ou transcripts .jsonl)
 *   node guard.js --bench                         rappel / faux positifs sur le corpus annoté
 *   node guard.js --install                       affiche la configuration de hooks Claude Code
 */
'use strict';
const fs = require('fs');
const path = require('path');
const SPC = require('./core');

const ROOT = __dirname;
const SEVERITY = { allow: 0, note: 1, confirm: 2, block: 3 };

// ─── CHARGEMENT ───────────────────────────────────────────────────────────────
function loadJSON(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }

/** Politique : <projet>/.claude/spc-guard.json si présent, sinon guard.policy.json. */
function loadPolicy(projectDir) {
  const candidates = [];
  if (projectDir) candidates.push(path.join(projectDir, '.claude', 'spc-guard.json'));
  candidates.push(path.join(ROOT, 'guard.policy.json'));
  for (const f of candidates) {
    if (fs.existsSync(f)) {
      const p = loadJSON(f);
      checkPolicy(p, f);
      return Object.assign(p, { _file: f });
    }
  }
  throw new Error('aucune politique trouvée (guard.policy.json)');
}

function checkPolicy(p, file) {
  const e = [];
  if (!Array.isArray(p.rules)) e.push('« rules » doit être un tableau');
  for (const r of p.rules || []) {
    if (!r.id) e.push('règle sans id');
    if (!(r.action in SEVERITY)) e.push(`${r.id} : action inconnue « ${r.action} » (note | confirm | block)`);
    if (!Array.isArray(r.any) || !r.any.length) e.push(`${r.id} : « any » doit être un tableau non vide`);
    for (const c of r.commands || []) if (!(p.commands || {})[c]) e.push(`${r.id} : classe de commandes inconnue « ${c} »`);
  }
  for (const [k, c] of Object.entries(p.commands || {})) {
    try {
      for (const pat of c.patterns || []) new RegExp(pat, 'i');
      if (c.paths) new RegExp(c.paths, 'i');
      if (c.prod_markers) new RegExp(c.prod_markers, 'i');
    } catch (err) { e.push(`commands.${k} : expression invalide (${err.message})`); }
    if (!['ask', 'deny'].includes(c.action)) e.push(`commands.${k}.action doit valoir ask ou deny`);
  }
  if (e.length) throw new Error(`politique invalide (${file}) :\n- ${e.join('\n- ')}`);
}

// ─── NIVEAU 1 : LA DEMANDE ────────────────────────────────────────────────────
/** Retire le code et les contenus collés : ce ne sont pas des consignes. */
function proseOnly(text) {
  return String(text || '')
    .replace(/<pasted_content[^>]*>[\s\S]*?<\/pasted_content[^>]*>/g, ' ')
    .replace(/```[\s\S]*?(```|$)/g, ' ')
    .replace(/`([^`\n]*)`/g, '$1')            // code en ligne : souvent la commande elle-même
    .slice(0, 6000);
}

function hasWord(n, words) {
  return (words || []).some(w => SPC.findAll(n, SPC.normalize(w)).length > 0);
}

function opMatches(step, want) {
  return !want || (Array.isArray(want) ? want.includes(step.op) : step.op === want);
}

/** Une condition de règle (élément de « any ») est-elle satisfaite ? */
function conditionHolds(cond, steps, n) {
  if (!cond.op) return hasWord(n, cond.words);
  return steps.some((s, i) => {
    if (!opMatches(s, cond.op)) return false;
    if (cond.params && !Object.entries(cond.params).every(([k, v]) => s.args[k] === v)) return false;
    if (cond.words && !hasWord(n, cond.words)) return false;
    if (cond.on_failure === true && !s.onFailure) return false;
    if (cond.requires_before) {
      // satisfait si l'opérateur requis précède dans la séquence, ou garde la branche « alors »
      const before = steps.slice(0, i).some(p => p.op === cond.requires_before && !p.onFailure) ||
        (s.role === 'then' && s.guardedBy.includes(cond.requires_before));
      if (before) return false;
    }
    return true;
  });
}

/**
 * @returns {{decision:'allow'|'note'|'confirm'|'block', dsl, complete, warnings,
 *            matched:[{id,message,action,commands}], commands:string[]}}
 */
function evaluatePrompt(prompt, db, policy) {
  const text = proseOnly(prompt);
  const r = SPC.transpile(text, db);
  const steps = SPC.parseSteps(r.dsl);
  const n = SPC.normalize(text);
  const matched = [];
  for (const rule of policy.rules) {
    if (rule.any.some(c => conditionHolds(c, steps, n))) {
      matched.push({ id: rule.id, message: rule.message, action: rule.action, commands: rule.commands || [] });
    }
  }
  if (!r.complete && r.dsl && policy.incomplete && policy.incomplete !== 'ignore') {
    matched.push({ id: 'incomplete', message: 'Lecture incomplète de la demande : ' + r.warnings.join(' ; '), action: policy.incomplete, commands: [] });
  }
  const decision = matched.reduce((d, m) => (SEVERITY[m.action] > SEVERITY[d] ? m.action : d), 'allow');
  const commands = [...new Set(matched.filter(m => SEVERITY[m.action] >= SEVERITY.confirm).flatMap(m => m.commands))];
  return { decision, dsl: r.dsl, complete: r.complete, warnings: r.warnings, steps, matched, commands };
}

// ─── NIVEAU 2 : LES COMMANDES ─────────────────────────────────────────────────
function classifyCommand(command, policy) {
  const out = [];
  for (const [cls, c] of Object.entries(policy.commands || {})) {
    if (!c.patterns) continue;
    if (c.patterns.some(p => new RegExp(p, 'i').test(command))) {
      out.push({ cls, prod: c.prod_markers ? new RegExp(c.prod_markers, 'i').test(command) : false });
    }
  }
  return out;
}

/**
 * Décision pour un appel d'outil. `state` = dernière évaluation de la demande dans la
 * session (ou null). Retourne null (aucune objection : flux de permissions normal)
 * ou { decision: 'ask'|'deny', reason }.
 */
function evaluateTool(toolName, toolInput, state, policy) {
  const flagged = new Set((state && state.commands) || []);
  const reasons = [];
  let decision = null;
  const raise = (d, why) => { reasons.push(why); if (!decision || d === 'deny') decision = d; };
  const ctx = state && state.matched && state.matched.length
    ? ` — demande lue comme : ${state.dsl}` : '';

  if (toolName === 'Bash') {
    const cmd = String((toolInput && toolInput.command) || '');
    for (const { cls, prod } of classifyCommand(cmd, policy)) {
      const c = policy.commands[cls];
      if (c.always) raise(c.action, `commande ${cls === 'destructive' ? 'destructive' : cls} : ${cmd.slice(0, 120)}`);
      else if (flagged.has(cls)) raise(c.action, `commande de type « ${cls} » alors que la demande ${describe(state, cls)}`);
      else if (prod) raise(c.action, `commande de type « ${cls} » visant la production : ${cmd.slice(0, 120)}`);
    }
  }
  const file = toolInput && (toolInput.file_path || toolInput.notebook_path || toolInput.path);
  if (file && /^(Edit|Write|MultiEdit|NotebookEdit)$/.test(toolName)) {
    for (const [cls, c] of Object.entries(policy.commands || {})) {
      if (!c.paths || !new RegExp(c.paths, 'i').test(file)) continue;
      if (c.always) raise(c.action, `écriture dans un fichier sensible : ${file}`);
      else if (flagged.has(cls)) raise(c.action, `écriture dans ${file} alors que la demande ${describe(state, cls)}`);
    }
  }
  return decision ? { decision, reason: 'Garde-fou SPC : ' + reasons.join(' ; ') + ctx } : null;
}

function describe(state, cls) {
  const m = (state.matched || []).filter(x => (x.commands || []).includes(cls)).map(x => x.message.toLowerCase());
  return m.length ? `contient : ${m.join(', ')}` : 'a été signalée';
}

// ─── ÉTAT PAR SESSION (pour le hook) ──────────────────────────────────────────
function stateDir() {
  return process.env.SPC_GUARD_STATE_DIR || path.join(require('os').tmpdir(), 'spc-guard');
}
function stateFile(sessionId) {
  return path.join(stateDir(), String(sessionId || 'default').replace(/[^\w.-]/g, '_') + '.json');
}
function saveState(sessionId, evaluation) {
  fs.mkdirSync(stateDir(), { recursive: true });
  const { decision, dsl, complete, matched, commands } = evaluation;
  fs.writeFileSync(stateFile(sessionId), JSON.stringify({ at: Date.now(), decision, dsl, complete, matched, commands }));
}
function loadState(sessionId) {
  try { return loadJSON(stateFile(sessionId)); } catch (_) { return null; }
}

// ─── AUDIT DE VRAIS PROMPTS ───────────────────────────────────────────────────
/** Prompts utilisateur d'un fichier texte (un par ligne) ou de transcripts Claude Code (.jsonl). */
function collectPrompts(target) {
  const files = [];
  // fichier passé explicitement : .txt (un prompt par ligne) ou .jsonl ; dans un dossier,
  // seuls les transcripts .jsonl (les .txt y sont des sorties d'outils enregistrées)
  const walk = (p, explicit) => {
    const st = fs.statSync(p);
    if (st.isDirectory()) for (const f of fs.readdirSync(p)) walk(path.join(p, f), false);
    else if (/\.jsonl$/.test(p) || (explicit && /\.txt$/.test(p))) files.push(p);
  };
  walk(target, true);
  const prompts = [];
  for (const f of files) {
    const raw = fs.readFileSync(f, 'utf8');
    if (f.endsWith('.txt')) { raw.split('\n').map(l => l.trim()).filter(Boolean).forEach(t => prompts.push({ text: t, src: f })); continue; }
    for (const line of raw.split('\n')) {
      let o; try { o = JSON.parse(line); } catch (_) { continue; }
      if (o.type !== 'user' || !o.message || o.isMeta || o.toolUseResult || o.isCompactSummary) continue;
      const c = o.message.content;
      const blocks = typeof c === 'string' ? [c]
        : Array.isArray(c) ? c.filter(b => b.type === 'text').map(b => b.text) : [];
      // retire ce que l'application injecte (rappels système, commandes locales)
      const text = blocks.map(b => b.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, ''))
        .filter(b => !/^\s*<(command-|local-command)/.test(b)).join('\n').trim();
      if (!text) continue;
      prompts.push({ text, src: f });
    }
  }
  return prompts;
}

// ─── CLI ──────────────────────────────────────────────────────────────────────
function installSnippet() {
  const hook = path.join(ROOT, 'hooks', 'spc-guard-hook.js');
  const cmd = `node "${hook}"`;
  return JSON.stringify({
    hooks: {
      UserPromptSubmit: [{ hooks: [{ type: 'command', command: cmd, timeout: 10 }] }],
      PreToolUse: [{ matcher: 'Bash|Edit|Write|MultiEdit|NotebookEdit', hooks: [{ type: 'command', command: cmd, timeout: 10 }] }]
    }
  }, null, 2);
}

function main(argv) {
  const db = loadJSON(path.join(ROOT, 'rosetta.json'));
  const policy = loadPolicy(process.env.CLAUDE_PROJECT_DIR || process.cwd());
  const flag = argv[0];
  if (!flag || flag === '-h' || flag === '--help') {
    console.log('Usage : node guard.js "demande" | --command "cmd" | --audit <fichier|dossier> | --bench | --install');
    return 0;
  }
  if (flag === '--install') {
    console.log('Ajoute ceci à ~/.claude/settings.json (ou .claude/settings.json du projet) :\n');
    console.log(installSnippet());
    return 0;
  }
  if (flag === '--command') {
    const r = evaluateTool('Bash', { command: argv.slice(1).join(' ') }, null, policy);
    console.log(r ? `${r.decision.toUpperCase()} — ${r.reason}` : 'aucune objection');
    return 0;
  }
  if (flag === '--bench') return require('./test/guard-corpus').report(db, policy);
  if (flag === '--audit') {
    const prompts = collectPrompts(argv[1] || path.join(require('os').homedir(), '.claude', 'projects'));
    const counts = { allow: 0, note: 0, confirm: 0, block: 0 };
    const rows = [];
    for (const p of prompts) {
      const e = evaluatePrompt(p.text, db, policy);
      counts[e.decision]++;
      if (e.decision !== 'allow') rows.push({ e, p });
    }
    for (const { e, p } of rows) {
      console.log(`[${e.decision}] ${e.matched.map(m => m.id).join(', ')}\n  « ${p.text.replace(/\s+/g, ' ').slice(0, 160)} »\n  ${e.dsl || '(aucun DSL)'}\n`);
    }
    console.log(`${prompts.length} prompts : ${counts.allow} sans objection · ${counts.note} note · ${counts.confirm} confirmation · ${counts.block} bloqués`);
    console.log('À annoter : parmi les prompts SANS objection, lesquels auraient dû déclencher une confirmation ? (rappel réel)');
    return 0;
  }
  const e = evaluatePrompt(argv.join(' '), db, policy);
  console.log(`DÉCISION : ${e.decision}`);
  console.log(`DSL      : ${e.dsl || '(aucun)'}`);
  for (const m of e.matched) console.log(`  · [${m.action}] ${m.id} — ${m.message}${m.commands.length ? ` (commandes : ${m.commands.join(', ')})` : ''}`);
  return 0;
}

module.exports = { loadPolicy, checkPolicy, evaluatePrompt, evaluateTool, classifyCommand, proseOnly,
  saveState, loadState, stateFile, collectPrompts, installSnippet, SEVERITY };

if (require.main === module) {
  try { process.exitCode = main(process.argv.slice(2)); }
  catch (e) { console.error(e.message); process.exitCode = 2; }
}
