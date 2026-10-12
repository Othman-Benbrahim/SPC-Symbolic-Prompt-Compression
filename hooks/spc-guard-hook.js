#!/usr/bin/env node
/**
 * Hook Claude Code du garde-fou SPC — un seul script pour deux événements :
 *
 *   UserPromptSubmit : lit la demande, applique la politique, mémorise le résultat
 *                      pour la session ; « block » arrête la demande, « confirm »
 *                      prévient l'utilisateur et informe l'agent.
 *   PreToolUse       : classe la commande Bash / le fichier écrit ; peut exiger une
 *                      confirmation (« ask ») ou refuser (« deny »). Ne répond jamais
 *                      « allow » : sans objection, le flux de permissions normal s'applique.
 *
 * Installation : `node guard.js --install` affiche le bloc à copier dans settings.json.
 * En cas d'erreur interne, le hook sort en code 1 (erreur non bloquante : l'action
 * continue). SPC_GUARD_FAIL_CLOSED=1 le fait sortir en code 2 (bloquant).
 */
'use strict';
const path = require('path');
const fs = require('fs');
const ROOT = path.join(__dirname, '..');
const guard = require(path.join(ROOT, 'guard.js'));

function readStdin() {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', c => data += c);
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });
}

function emit(obj) { process.stdout.write(JSON.stringify(obj)); }

async function main() {
  const input = JSON.parse(await readStdin());
  const db = JSON.parse(fs.readFileSync(path.join(ROOT, 'rosetta.json'), 'utf8'));
  const policy = guard.loadPolicy(process.env.CLAUDE_PROJECT_DIR || input.cwd);
  const event = input.hook_event_name;

  if (event === 'UserPromptSubmit') {
    const e = guard.evaluatePrompt(input.prompt || '', db, policy);
    guard.saveState(input.session_id, e);
    if (e.decision === 'allow') return;
    const items = e.matched.map(m => `${m.message} [${m.id}]`);
    if (e.decision === 'block') {
      emit({ decision: 'block', reason: `Garde-fou SPC : demande bloquée par la politique du projet — ${items.join(' ; ')}. DSL lu : ${e.dsl}` });
      return;
    }
    const confirmCmds = e.commands.length
      ? ` La politique du projet exige une confirmation explicite de l'utilisateur avant les commandes de type ${e.commands.join(', ')} de cette demande ; le hook PreToolUse la demandera.`
      : '';
    const out = {
      hookSpecificOutput: {
        hookEventName: 'UserPromptSubmit',
        additionalContext: `Lecture locale de la demande par le garde-fou SPC : ${e.dsl || '(aucun opérateur reconnu)'}. Points signalés : ${items.join(' ; ')}.${confirmCmds}`
      }
    };
    if (e.decision === 'confirm') out.systemMessage = `⚠ SPC : ${e.matched.filter(m => m.action === 'confirm').map(m => m.message).join(' · ')} — confirmation requise avant exécution.`;
    emit(out);
    return;
  }

  if (event === 'PreToolUse') {
    const state = guard.loadState(input.session_id);
    const r = guard.evaluateTool(input.tool_name, input.tool_input || {}, state, policy);
    if (!r) return;
    emit({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: r.decision, permissionDecisionReason: r.reason } });
  }
}

main().catch(err => {
  process.stderr.write(`spc-guard : ${err.message}\n`);
  process.exitCode = process.env.SPC_GUARD_FAIL_CLOSED === '1' ? 2 : 1;
});
