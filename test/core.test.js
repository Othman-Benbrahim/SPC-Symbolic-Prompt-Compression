'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const SPC = require('../core');
const db = require('../rosetta.json');
const { RULE_CASES, NO_MATCH } = require('./corpus');

test('corpus de référence : entrée → DSL attendu', async t => {
  for (const c of RULE_CASES) {
    await t.test(c.in, () => assert.equal(SPC.transpile(c.in, db).dsl, c.out));
  }
});

test('entrées sans opérateur → null', () => {
  for (const n of NO_MATCH) assert.equal(SPC.transpile(n, db).dsl, null, n);
});

test('tout DSL produit par les règles est conforme au schéma', () => {
  for (const c of RULE_CASES) {
    const r = SPC.transpile(c.in, db);
    if (!r.dsl) continue;
    const v = SPC.validateDSL(r.dsl, db);
    assert.ok(v.ok, `${c.in} → ${r.dsl} : ${v.errors.join(' ; ')}`);
  }
});

test('raccourcis : chaque phrase redonne exactement son DSL (170 allers-retours)', () => {
  const entries = Object.entries(db.shortcuts);
  assert.ok(entries.length >= 170);
  for (const [phrase, dsl] of entries) {
    const r = SPC.transpile(phrase, db);
    assert.equal(r.dsl, dsl, phrase);
    assert.equal(r.source, 'shortcut', phrase);
  }
});

test('P0-1 : frontières de mots (plus de faux positifs par sous-chaîne)', () => {
  const n = SPC.normalize;
  assert.deepEqual(SPC.findAll(n('because'), 'use'), []);
  assert.deepEqual(SPC.findAll(n('support'), 'port'), []);
  assert.deepEqual(SPC.findAll(n('sensible'), 'sens'), []);
  assert.deepEqual(SPC.findAll(n('checked'), 'check'), []);
  assert.equal(SPC.findAll(n('run the tests'), 'test').length, 1, 'pluriel toléré');
  assert.equal(SPC.findAll(n('⊜ fin'), '⊜').length, 1, 'symboles');
  assert.notEqual(SPC.transpile('the build is broken because of the proxy', db).ops[0], 'APPLY');
  assert.equal(SPC.transpile('add support for csv export', db).ops[0], 'ADD');
});

test('P0-2 : le raccourci le plus long gagne', () => {
  assert.equal(SPC.transpile('copy this component and adapt it for mobile', db).dsl, db.shortcuts['copy this component and adapt it']);
  assert.equal(SPC.transpile('add error handling to all functions', db).dsl, db.shortcuts['add error handling to all']);
});

test('P0-3 : départage indépendant de l\'ordre du tableau', () => {
  const reversed = { ...db, operators: [...db.operators].reverse() };
  for (const c of RULE_CASES) assert.equal(SPC.transpile(c.in, reversed).dsl, c.out, c.in);
});

test('P0-7 : modificateurs structurels émis', () => {
  assert.match(SPC.transpile('analyse le code puis compresse le resultat', db).dsl, / ⟶ COMPRESS\[/);
  assert.match(SPC.transpile('valide les tests si possible sinon debogue', db).dsl, / \? ∅ : DEBUG\[/);
  assert.match(SPC.transpile('charge le skill stele si besoin', db).dsl, /@stele⌒/);
  assert.match(SPC.transpile('analyse ceci et stocke le résultat', db).dsl, / → §1$/);
  assert.equal(SPC.transpile('archive la session', db).dsl, '⊜');
});

test('ancres §N numérotées dans une même instruction', () => {
  const r = SPC.transpile('analyse ce texte et garde le résultat puis compresse et mémorise', db);
  assert.match(r.dsl, /§1/);
  assert.match(r.dsl, /§2/);
});

test('source = shortcut uniquement si tout vient d\'un raccourci', () => {
  assert.equal(SPC.transpile('fix the bug', db).source, 'shortcut');
  assert.equal(SPC.transpile('fix the bug then deploy to staging', db).source, 'rules');
  assert.equal(SPC.transpile('analyse ce code', db).source, 'rules');
});

test('normalize : accents, apostrophes typographiques, espaces', () => {
  assert.equal(SPC.normalize('  Vérifie   l’ÉTAT  '), "verifie l'etat");
  assert.equal(SPC.normalize('s‘il'), "s'il");
  assert.equal(SPC.transpile('don’t use var', db).dsl, SPC.transpile("don't use var", db).dsl);
});

test('validateDSL : exemples valides du skill', () => {
  for (const d of [
    'SCAN[◈, focus=anomalies] → outline',
    'ANALYZE[◈, ctx=technique, ▲] ⟶ COMPRESS[◈, format=STÈLE] → §1',
    'VALIDATE[*, scope=tests] ? ⊜ : DEBUG[*, focus=error]',
    'VALIDATE[◈, scope=error] ? ∅ : DEBUG[◈, focus=error]',
    'FIND[input=*, type=usage, pattern=◈] ⟶ ANALYZE[◈, ctx=technique, depth=2]',
    '@stele⌒ @metalangage⌒ SCAN[◈] ? RESONE[◈, layers=all] ⟶ COMPRESS[◈, format=STÈLE] → §1 : ⊜',
    'APPLY[@convention::clean-code, ◈]',
    'FILTER[◈, ⊘deprecated]',
    'ITERATE[op=SCAN, n=5]',
    'ANALYZE[◈]↻3',
    '⊜'
  ]) {
    const v = SPC.validateDSL(d, db);
    assert.ok(v.ok, `${d} : ${v.errors.join(' ; ')}`);
  }
});

test('validateDSL : rejets', () => {
  const bad = {
    'FOO[◈]': /opérateur inconnu/,
    'VALIDATE[◈, scope=nope]': /hors énumération/,
    'ANALYZE[◈, focus=performance]': /paramètre inconnu/,
    'VALIDATE[◈] ? null : DEBUG[◈]': /opérateur attendu/,
    'SCAN[◈] | DEBUG[◈]': /texte inattendu/,
    'SCAN[◈] → nowhere': /type de sortie inconnu/,
    'ITERATE[op=NOPE, n=x]': /n'est pas un opérateur/,
    'SCAN[◈, bareword]': /argument positionnel invalide/,
    'SCAN[◈': /manquant/,
    'X"><img src=x onerror=alert(1)>': /opérateur (attendu|inconnu)|texte inattendu/
  };
  for (const [d, re] of Object.entries(bad)) {
    const v = SPC.validateDSL(d, db);
    assert.equal(v.ok, false, d);
    assert.match(v.errors.join(' | '), re, d);
  }
});

test('estimateTokens : déterministe, symboles multi-octets comptés', () => {
  assert.equal(SPC.estimateTokens('analyze the codebase'), SPC.estimateTokens('analyze the codebase'));
  assert.ok(SPC.estimateTokens('◈') >= 2);
  assert.ok(SPC.estimateTokens('⟶') >= 2);
  assert.equal(SPC.estimateTokens(''), 0);
});

test('parseAIResponse : réponses de modèles locaux mal formées', () => {
  const cases = [
    '```json\n{"dsl":"SCAN[◈]","explication":"x"}\n```',
    'Voici : {"dsl": "SCAN[◈]", "explication": "x"} — fin',
    '{dsl: "SCAN[◈]", explication: "x",}',
    '{“dsl”: “SCAN[◈]”}',
    'Le DSL est SCAN[◈] évidemment'
  ];
  for (const c of cases) assert.equal(SPC.parseAIResponse(c, db).dsl, 'SCAN[◈]', c);
  const xss = SPC.parseAIResponse('{"dsl":"X\\"><img src=q onerror=alert(1)>"}', db);
  assert.equal(xss.dsl, 'X"><img src=q onerror=alert(1)>', 'valeur conservée telle quelle (échappée au rendu)');
  assert.equal(xss.validation.ok, false);
  assert.throws(() => SPC.parseAIResponse('rien du tout', db));
  // les compteurs de tokens annoncés par le modèle sont ignorés
  assert.equal(SPC.parseAIResponse('{"dsl":"SCAN[◈]","tokens_prose":999}', db).tokens_prose, undefined);
});

test('buildSystemPrompt : dérivé de la BDD', () => {
  const p = SPC.buildSystemPrompt(db);
  for (const o of db.operators) assert.ok(p.includes(o.id), o.id);
  for (const m of Object.keys(db.modifiers)) assert.ok(p.includes(m), m);
  assert.ok(!/tokens_prose/.test(p), 'le modèle ne doit plus inventer de comptes de tokens');
});

test('checkDBStructure / assertDB : BDD importée invalide', () => {
  assert.deepEqual(SPC.checkDBStructure(db), []);
  assert.ok(SPC.checkDBStructure({}).length > 0);
  assert.ok(SPC.checkDBStructure({ ...db, shortcuts: undefined }).some(e => /shortcuts/.test(e)));
  assert.ok(SPC.checkDBStructure({ ...db, operators: [{ id: 'X', triggers: 'nope', default: 'X[◈]' }] }).length > 0);
  assert.ok(SPC.checkDBStructure([]).length > 0);
  assert.throws(() => SPC.assertDB({ version: '1' }), /Base de règles invalide/);
});
