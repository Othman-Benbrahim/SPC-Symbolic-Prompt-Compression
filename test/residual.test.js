'use strict';
/** Constats résiduels de l'audit v0.2 (R1–R8) — chaque reproduction de l'audit est un test. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const SPC = require('../core');
const db = require('../rosetta.json');

const T = p => SPC.transpile(p, db);

/** Aucune perte silencieuse : soit tout est dans le DSL, soit un avertissement le dit. */
function assertNoSilentLoss(prose) {
  const r = T(prose);
  if (r.complete) assert.ok(r.dsl, `${prose} : complete=true sans DSL`);
  else assert.ok(r.warnings.length > 0, `${prose} : perte sans avertissement`);
  return r;
}

test('R1 : un conditionnel ne disparaît plus en silence', () => {
  assert.equal(T('si la validation passe, deploie').dsl, 'VALIDATE[◈] ? DEPLOY[◈]');
  assert.equal(T('quand la compilation echoue, redige le rapport').dsl, 'DEPLOY[◈] ? ∅ : CREATE[◈]');
  const r = assertNoSilentLoss('si le build casse, notifie');
  assert.equal(r.complete, false);
  assert.match(r.warnings.join(' '), /action « notifie » non reconnue/);
  const g = assertNoSilentLoss('si erreur, débogue');
  assert.equal(g.complete, false);
  assert.match(g.warnings.join(' '), /SANS garde/);
  for (const p of ['si foo bar, deploie', 'deploie quand le vent tourne', 'si les tests passent, blabla',
    'valide les tests sinon blabla', 'si la validation passe, deploie sinon blabla']) assertNoSilentLoss(p);
});

test('R1 : les atténuateurs ne sont pas des gardes', () => {
  for (const p of ['analyse ce texte si possible', 'fix the bug if needed']) {
    const r = T(p);
    assert.equal(r.complete, true, p);
    assert.deepEqual(r.warnings, [], p);
  }
});

test('R2 : le verbe l\'emporte sur un paramètre porté par le même mot', () => {
  for (const p of ['add tests', 'ajoute des tests', 'add tests to the parser']) {
    assert.equal(T(p).dsl, 'ADD[target=◈, what=tests]', p);
  }
  assert.equal(T('inject logging').dsl, 'ADD[target=◈, what=logging]');
  assert.equal(T('add validation').dsl, 'ADD[target=◈, what=validation]');
  assert.equal(T('run integration tests').ops[0], 'VALIDATE');
  assert.equal(T('analyse en profondeur sur le plan symbolique').ops[0], 'ANALYZE');
  assert.equal(T('active la résonance symbolique sur tout le texte').ops[0], 'RESONE');
});

test('R3 : racinisation FR/EN, mot à mot', () => {
  const same = [['validation', 'valide'], ['validation', 'validate'], ['compilation', 'compile'],
    ['scanne', 'scan'], ['scanning', 'scan'], ['refactorise', 'refactor'], ['refactoring', 'refactore'],
    ['deploying', 'deploy'], ['analyzing', 'analyze'], ['analysis', 'analyse'], ['echouent', 'echoue']];
  for (const [a, b] of same) assert.equal(SPC.stem(a), SPC.stem(b), `${a} / ${b}`);
  const differ = [['user', 'use'], ['because', 'use'], ['pass', 'pas'], ['cas', 'casse'], ['support', 'port']];
  for (const [a, b] of differ) assert.notEqual(SPC.stem(a), SPC.stem(b), `${a} / ${b}`);
  assert.equal(T('scanne §1').ops[0], 'SCAN');
  assert.equal(T('refactorise le module de parsing').ops[0], 'TRANSDUIT');
  assert.equal(T('deploying to staging').dsl, 'DEPLOY[◈, env=staging]');
  assert.equal(T('analysis of code in depth').ops[0], 'ANALYZE');
  // la racinisation ne rouvre pas les faux positifs P0-1
  assert.equal(T('the user list').dsl, null);
  assert.equal(T('because the input is malformed').dsl, null);
  assert.equal(T('dans ce cas, deploie').dsl, 'DEPLOY[◈]');
  // les modificateurs restent exacts : « toutes » n'ajoute pas ▲
  assert.doesNotMatch(T('cherche toutes les occurrences de foo').dsl, /▲/);
});

test('R4 : polarité des conditions et garde vérifiante', () => {
  assert.equal(T('si la validation echoue, deploie').dsl, 'VALIDATE[◈] ? ∅ : DEPLOY[◈]');
  assert.equal(T('quand les tests échouent, deploie').dsl, 'VALIDATE[◈, scope=tests] ? ∅ : DEPLOY[◈]');
  assert.equal(T('si le build échoue, exécute les tests').dsl, 'DEPLOY[◈] ? ∅ : VALIDATE[◈, scope=tests]');
  assert.equal(T('si le build échoue, alors corrige sinon deploie').dsl, 'DEPLOY[◈] ? DEPLOY[◈] : DEBUG[◈]');
  const skill = fs.readFileSync(path.join(__dirname, '..', 'SPC_SKILL.md'), 'utf8');
  assert.match(skill, /Conditionnels émis par la Pierre de Rosette/);
  assert.match(skill, /inverse les branches/);
});

test('R5 : « et / and » ne perd plus la seconde instruction', () => {
  assert.equal(T('compile le projet et redige le rapport').dsl, 'DEPLOY[◈] ⟶ CREATE[◈]');
  assert.equal(T('add logging and deploy to staging').dsl, 'ADD[target=◈, what=logging] ⟶ DEPLOY[◈, env=staging]');
  // pas de coupe quand le second verbe est un paramètre du premier, ou dans un raccourci
  assert.equal(T('copie ce composant et adapte-le pour mobile').dsl, 'CLONE[source=◈, adapt=oui, scope=composant]');
  assert.equal(T('copy this component and adapt it for mobile').dsl, db.shortcuts['copy this component and adapt it']);
  assert.equal(T('compile and ship').dsl, 'DEPLOY[◈]');
  // clause sans verbe : pas de coupe, mais signalée
  const r = T('analyse la sécurité et la performance');
  assert.equal(r.ops.length, 1);
  assert.match(r.warnings.join(' '), /« la performance » sans opérateur/);
});

test('R6 : aucune valeur par défaut inventée pour ITERATE', () => {
  assert.equal(T('repete').dsl, 'ITERATE[◈]');
  assert.equal(T('tests unitaires pour chaque fonction').dsl, 'ITERATE[◈, op=VALIDATE]');
  assert.equal(T('iterate 3 times on all functions').dsl, 'ITERATE[◈, n=3]');
  assert.ok(SPC.validateDSL('ITERATE[◈]', db).ok);
});

test('R8 : CSP sans unsafe-inline, aucun attribut style', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'rosetta.html'), 'utf8');
  const csp = /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html)[1];
  assert.doesNotMatch(csp, /unsafe-/);
  assert.match(csp, /style-src 'sha256-[^']+'/);
  assert.doesNotMatch(html, /<[^>]+\sstyle\s*=\s*["']/i);
});

test('lint : aucune collision de radicaux entre opérateurs', () => {
  const { errors } = SPC.lintDB(db);
  assert.deepEqual(errors.filter(e => /radical/.test(e)), []);
  const bad = JSON.parse(JSON.stringify(db));
  bad.operators.find(o => o.id === 'SCAN').triggers.push('compilation');
  assert.ok(SPC.lintDB(bad).errors.some(e => /radical « compil »/.test(e)));
});
