'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CLI = path.join(ROOT, 'rosetta.js');

function run(args, { stdin, cli = CLI, timeout = 10000 } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [cli, ...args], { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = '';
    p.stdout.on('data', d => out += d);
    p.stderr.on('data', d => err += d);
    const timer = setTimeout(() => { p.kill(); reject(new Error('timeout : le CLI ne rend pas la main')); }, timeout);
    p.on('close', code => { clearTimeout(timer); resolve({ code, out, err }); });
    if (stdin !== undefined) p.stdin.end(stdin); else p.stdin.end();
  });
}

/** Faux LM Studio : renvoie `content` et enregistre les requêtes. */
function fakeLM(content) {
  return new Promise(resolve => {
    const requests = [];
    const srv = http.createServer((req, res) => {
      let body = '';
      req.on('data', c => body += c);
      req.on('end', () => {
        requests.push(JSON.parse(body));
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ choices: [{ message: { content } }] }));
      });
    });
    srv.listen(0, '127.0.0.1', () => resolve({ srv, port: srv.address().port, requests }));
  });
}

test('P1-1 : les nombres sont conservés (mots séparés ou en tête)', async () => {
  let r = await run(['corrige', 'le', 'bug', '404', '--json']);
  assert.equal(r.code, 0);
  assert.equal(JSON.parse(r.out).prose, 'corrige le bug 404');
  r = await run(['404 sur la page login, corrige', '--json']);
  assert.equal(r.code, 0, 'une instruction commençant par un nombre ne doit plus être supprimée');
  assert.equal(JSON.parse(r.out).dsl, 'DEBUG[◈]');
  r = await run(['iterate', '3', 'times', 'on', 'all', 'functions', '--json']);
  assert.equal(JSON.parse(r.out).dsl, 'ITERATE[◈, n=3]');
});

test('P1-2 : --port validé', async () => {
  for (const bad of ['abc', '0', '70000', '12.5']) {
    const r = await run(['--port', bad, 'fix']);
    assert.equal(r.code, 1, bad);
    assert.match(r.err, /--port attend un entier/);
    assert.doesNotMatch(r.err, /NaN/);
  }
  const r = await run(['--port']);
  assert.equal(r.code, 1);
});

test('options inconnues, --help, --model sans valeur', async () => {
  let r = await run(['--nope', 'fix']);
  assert.equal(r.code, 1); assert.match(r.err, /option inconnue/);
  r = await run(['--help']);
  assert.equal(r.code, 0); assert.match(r.out, /Usage/);
  r = await run(['--model']);
  assert.equal(r.code, 1);
});

test('stdin : lecture et entrée vide sans blocage', async () => {
  let r = await run(['--json'], { stdin: 'fix the bug\n' });
  assert.equal(JSON.parse(r.out).dsl, 'DEBUG[◈, focus=error]');
  r = await run([], { stdin: '' });
  assert.equal(r.code, 1);
});

test('aucun opérateur → code 3', async () => {
  const r = await run(['hello world']);
  assert.equal(r.code, 3);
  assert.match(r.out, /Aucun opérateur/);
});

test('P1-7 : rosetta.json absent ou invalide → message clair, code 2', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spc-'));
  fs.copyFileSync(CLI, path.join(dir, 'rosetta.js'));
  fs.copyFileSync(path.join(ROOT, 'core.js'), path.join(dir, 'core.js'));
  let r = await run(['fix'], { cli: path.join(dir, 'rosetta.js') });
  assert.equal(r.code, 2); assert.match(r.err, /Impossible de charger rosetta\.json/);
  fs.writeFileSync(path.join(dir, 'rosetta.json'), '{bad');
  r = await run(['fix'], { cli: path.join(dir, 'rosetta.js') });
  assert.equal(r.code, 2); assert.doesNotMatch(r.err, /at JSON\.parse/);
  fs.writeFileSync(path.join(dir, 'rosetta.json'), '{"version":"x"}');
  r = await run(['fix'], { cli: path.join(dir, 'rosetta.js') });
  assert.equal(r.code, 2); assert.match(r.err, /Base de règles invalide/);
});

test('--ai : modèle transmis, DSL validé, tokens calculés localement', async () => {
  const lm = await fakeLM('```json\n{"dsl":"SCAN[◈, focus=security]","explication":"scan sécurité","tokens_prose":999,"tokens_spc":1}\n```');
  try {
    const r = await run(['--ai', '--port', String(lm.port), '--model', 'qwen-test', '--json', 'regarde la sécurité du login']);
    assert.equal(r.code, 0, r.err);
    const j = JSON.parse(r.out);
    assert.equal(j.dsl, 'SCAN[◈, focus=security]');
    assert.equal(j.validation.ok, true);
    assert.notEqual(j.tokens.prose, 999, 'compte annoncé par le modèle ignoré');
    assert.equal(lm.requests[0].model, 'qwen-test');
  } finally { lm.srv.close(); }
});

test('--ai : un raccourci évite l\'appel au modèle', async () => {
  const lm = await fakeLM('{"dsl":"SCAN[◈]"}');
  try {
    const r = await run(['--ai', '--port', String(lm.port), '--json', 'fix the bug']);
    assert.equal(JSON.parse(r.out).source, 'raccourci');
    assert.equal(lm.requests.length, 0);
  } finally { lm.srv.close(); }
});

test('--ai : DSL non conforme signalé ; serveur absent → repli sur les règles', async () => {
  const lm = await fakeLM('{"dsl":"VALIDATE[◈, scope=nope]"}');
  try {
    const r = await run(['--ai', '--port', String(lm.port), '--json', 'regarde le code']);
    assert.equal(JSON.parse(r.out).validation.ok, false);
  } finally { lm.srv.close(); }
  const closed = await fakeLM('');
  const port = closed.port;
  await new Promise(res => closed.srv.close(res));
  const r = await run(['--ai', '--port', String(port), 'regarde le code']);
  assert.equal(r.code, 0);
  assert.match(r.err, /introuvable sur localhost:\d+/);
  assert.match(r.out, /SCAN\[◈/);
});

test('API module historique conservée', () => {
  const { patternMatch } = require('../rosetta');
  const r = patternMatch('find usages of this function in this file');
  assert.equal(r.op, 'FIND');
  assert.match(r.dsl, /type=usage/);
});

test('R1 : code 4 et avertissements quand une partie de la prose est perdue', async () => {
  let r = await run(['si erreur, débogue']);
  assert.equal(r.code, 4);
  assert.match(r.out, /INCOMPLÈTE/);
  assert.match(r.out, /SANS garde/);
  r = await run(['--json', 'si le build casse, notifie']);
  assert.equal(r.code, 3);
  const j = JSON.parse(r.out);
  assert.equal(j.complete, false);
  assert.match(j.warnings.join(' '), /notifie/);
  r = await run(['si le build casse, notifie']);
  assert.match(r.out, /notifie/, 'avertissements affichés même sans DSL');
});
