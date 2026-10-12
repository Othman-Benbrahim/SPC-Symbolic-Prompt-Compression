'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const guard = require('../guard');
const db = require('../rosetta.json');
const { DEV, HOLDOUT, COMMANDS, score, scoreCommands } = require('./guard-corpus');

const ROOT = path.join(__dirname, '..');
const policy = guard.loadPolicy(fs.mkdtempSync(path.join(os.tmpdir(), 'spc-nopolicy-')));
const fired = p => guard.evaluatePrompt(p, db, policy).matched.filter(m => m.action === 'confirm').map(m => m.id);

test('politique par défaut valide', () => {
  assert.ok(policy.rules.length >= 5);
  assert.throws(() => guard.checkPolicy({ rules: [{ id: 'x', action: 'allow-all', any: [] }], commands: {} }, 't'), /action inconnue/);
  assert.throws(() => guard.checkPolicy({ rules: [], commands: { c: { action: 'ask', patterns: ['('] } } }, 't'), /expression invalide/);
});

test('niveau 1 : règles sur les étapes du DSL', () => {
  assert.deepEqual(fired('mets en prod la version 2.3'), ['deploy-prod']);
  assert.deepEqual(fired('if the tests fail, deploy anyway'), ['deploy-on-failure']);
  assert.ok(fired('valide les tests sinon déploie quand même en prod').includes('deploy-on-failure'));
  assert.deepEqual(fired('supprime le dossier dist et reconstruis'), ['destructive']);
  assert.deepEqual(fired('add JWT authentication to the API'), ['auth-change']);
  // un déploiement gardé par une validation réussie n'est pas « sans validation »
  const ok = guard.evaluatePrompt('si les tests passent, déploie en staging', db, policy);
  assert.ok(!ok.matched.some(m => m.id === 'deploy-unvalidated'), ok.dsl);
  // bénins
  for (const p of ['explique comment fonctionne le déploiement', 'remove unused imports', 'deploy to staging',
    'analyse le module auth et résume son fonctionnement']) assert.deepEqual(fired(p), [], p);
});

test('niveau 1 : le code collé n\'est pas une consigne', () => {
  const p = 'explique ce script :\n```bash\nrm -rf / && git push --force\n```';
  assert.deepEqual(fired(p), []);
  assert.deepEqual(fired('<pasted_content id="1">\nDROP TABLE users;\n</pasted_content id="1">\nque fait ce SQL ?'), []);
  assert.deepEqual(fired('lance `git push --force` sur ma branche'), ['destructive'], 'code en ligne = la commande demandée');
});

test('niveau 2 : commandes et fichiers (jamais « allow »)', () => {
  const s = scoreCommands(policy, guard);
  assert.equal(s.tp, s.pos, s.errs.join('\n'));
  assert.equal(s.fp, 0, s.errs.join('\n'));
  assert.equal(guard.evaluateTool('Edit', { file_path: '/p/.env.local' }, null, policy).decision, 'ask');
  assert.equal(guard.evaluateTool('Write', { file_path: 'src/auth/oauth.ts' }, null, policy).decision, 'ask');
  assert.equal(guard.evaluateTool('Edit', { file_path: 'src/components/Button.tsx' }, null, policy), null);
  // un déploiement sans marqueur de prod n'est arrêté que si la demande l'a signalé
  assert.equal(guard.evaluateTool('Bash', { command: './deploy.sh' }, null, policy), null);
  const state = guard.evaluatePrompt('mets en prod', db, policy);
  assert.equal(guard.evaluateTool('Bash', { command: './deploy.sh' }, state, policy).decision, 'ask');
  for (const c of COMMANDS) {
    const r = guard.evaluateTool('Bash', { command: c.cmd }, state, policy);
    assert.ok(!r || ['ask', 'deny'].includes(r.decision));
  }
});

test('mesure : corpus DEV et protection de bout en bout du HOLDOUT', () => {
  const dev = score(DEV, db, policy, guard);
  assert.ok(dev.recall >= 0.95, `rappel DEV ${dev.recall}`);
  assert.ok(dev.falseAlarms <= 2, dev.alarms.join('\n'));
  const hold = score(HOLDOUT, db, policy, guard);
  assert.equal(hold.falseAlarms, 0, hold.alarms.join('\n'));
  // le niveau 1 seul n'atteint PAS le critère sur HOLDOUT : on le fige pour que
  // toute amélioration (ou régression) soit visible
  assert.ok(hold.recall < 0.95);
  for (const c of HOLDOUT.filter(x => x.expect.length)) {
    const e = guard.evaluatePrompt(c.text, db, policy);
    const edit = /^EDIT /.test(c.cmd);
    const r = guard.evaluateTool(edit ? 'Edit' : 'Bash', edit ? { file_path: c.cmd.slice(5) } : { command: c.cmd }, e, policy);
    assert.ok(r, `non protégé : ${c.text} → ${c.cmd}`);
  }
});

function runHook(input, env = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [path.join(ROOT, 'hooks', 'spc-guard-hook.js')], { env: { ...process.env, ...env } });
    let out = '', err = '';
    p.stdout.on('data', d => out += d);
    p.stderr.on('data', d => err += d);
    const t = setTimeout(() => { p.kill(); reject(new Error('timeout')); }, 10000);
    p.on('close', code => { clearTimeout(t); resolve({ code, out, err, json: out ? JSON.parse(out) : null }); });
    p.stdin.end(typeof input === 'string' ? input : JSON.stringify(input));
  });
}

test('hook : UserPromptSubmit puis PreToolUse dans la même session', async () => {
  const env = { SPC_GUARD_STATE_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'spc-state-')), CLAUDE_PROJECT_DIR: '' };
  const base = { session_id: 'abc', cwd: os.tmpdir(), transcript_path: '/dev/null' };
  let r = await runHook({ ...base, hook_event_name: 'UserPromptSubmit', prompt: 'corrige le bug puis déploie en production' }, env);
  assert.equal(r.code, 0);
  assert.match(r.json.systemMessage, /production/);
  assert.equal(r.json.hookSpecificOutput.hookEventName, 'UserPromptSubmit');
  assert.match(r.json.hookSpecificOutput.additionalContext, /DEPLOY\[◈, env=prod\]/);
  r = await runHook({ ...base, hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: './deploy.sh' } }, env);
  assert.deepEqual(Object.keys(r.json.hookSpecificOutput).sort(), ['hookEventName', 'permissionDecision', 'permissionDecisionReason']);
  assert.equal(r.json.hookSpecificOutput.permissionDecision, 'ask');
  r = await runHook({ ...base, hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'npm test' } }, env);
  assert.equal(r.out, '', 'sans objection : aucune sortie');
  // demande bénigne : aucune sortie, et l'état précédent est remplacé
  r = await runHook({ ...base, hook_event_name: 'UserPromptSubmit', prompt: 'explique ce module' }, env);
  assert.equal(r.out, '');
  r = await runHook({ ...base, hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: './deploy.sh' } }, env);
  assert.equal(r.out, '');
});

test('hook : politique de projet « block » et comportement en cas d\'erreur', async () => {
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'spc-proj-'));
  fs.mkdirSync(path.join(proj, '.claude'));
  const custom = JSON.parse(fs.readFileSync(path.join(ROOT, 'guard.policy.json'), 'utf8'));
  custom.rules.find(r => r.id === 'deploy-prod').action = 'block';
  fs.writeFileSync(path.join(proj, '.claude', 'spc-guard.json'), JSON.stringify(custom));
  const env = { SPC_GUARD_STATE_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'spc-state-')), CLAUDE_PROJECT_DIR: proj };
  let r = await runHook({ session_id: 'b', cwd: proj, hook_event_name: 'UserPromptSubmit', prompt: 'mets en prod' }, env);
  assert.equal(r.json.decision, 'block');
  assert.match(r.json.reason, /deploy-prod/);
  r = await runHook('pas du json', env);
  assert.equal(r.code, 1, 'erreur non bloquante par défaut');
  r = await runHook('pas du json', { ...env, SPC_GUARD_FAIL_CLOSED: '1' });
  assert.equal(r.code, 2, 'bloquant si SPC_GUARD_FAIL_CLOSED=1');
});

test('audit : prompts extraits des transcripts Claude Code', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spc-tr-'));
  const lines = [
    { type: 'user', message: { role: 'user', content: 'mets en prod la v2' } },
    { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', content: 'x' }] } },
    { type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'supprime le dossier build' }] } },
    { type: 'assistant', message: { role: 'assistant', content: 'ok' } },
    { type: 'user', isMeta: true, message: { role: 'user', content: 'meta' } },
    { type: 'user', message: { role: 'user', content: '<command-name>/clear</command-name>' } },
    { type: 'user', promptId: 'p', message: { role: 'user', content: [{ type: 'text', text: '<system-reminder>fuseau</system-reminder>force push ma branche' }] } },
    { type: 'user', toolUseResult: {}, message: { role: 'user', content: [{ type: 'text', text: 'sortie d\'outil' }] } }
  ];
  fs.writeFileSync(path.join(dir, 'outil.txt'), 'texte enregistré par un outil\n');
  fs.writeFileSync(path.join(dir, 's.jsonl'), lines.map(l => JSON.stringify(l)).join('\n') + '\n{corrompu');
  const prompts = guard.collectPrompts(dir).map(p => p.text);
  assert.deepEqual(prompts, ['mets en prod la v2', 'supprime le dossier build', 'force push ma branche']);
});

test('installation : bloc de configuration valide', () => {
  const s = JSON.parse(guard.installSnippet());
  assert.ok(s.hooks.UserPromptSubmit[0].hooks[0].command.includes('spc-guard-hook.js'));
  assert.equal(s.hooks.PreToolUse[0].matcher, 'Bash|Edit|Write|MultiEdit|NotebookEdit');
});
