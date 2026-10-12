#!/usr/bin/env node
/**
 * Test navigateur de rosetta.html (optionnel : nécessite Playwright).
 *   npm i -D playwright && npx playwright install chromium   (une fois)
 *   npm run test:e2e
 *
 * Vérifie : zéro requête réseau au chargement, testeur = même DSL que le CLI,
 * réponse d'IA malveillante rendue inerte (P0-5), import invalide refusé sans
 * perte (P1-6), base locale v0.1 détectée (P1-5), stockage bloqué toléré.
 */
'use strict';
const path = require('path');
const assert = require('assert/strict');

let chromium;
try { ({ chromium } = require('playwright')); }
catch (e) { console.log('⏭  Playwright absent — test e2e ignoré.'); process.exit(0); }

const SPC = require('../../core');
const db = require('../../rosetta.json');
const FILE = 'file://' + path.join(__dirname, '..', '..', 'rosetta.html');
const PAYLOAD = 'X"><img src=x onerror="window.__xss=1"><script>window.__xss=2</script>';

(async () => {
  const browser = await chromium.launch();
  const results = [];
  const step = async (name, fn) => {
    try { await fn(); results.push(['✓', name]); }
    catch (e) { results.push(['✗', name + ' — ' + e.message]); }
  };

  try {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const requests = [];
    const errors = [];
    page.on('request', r => { if (!r.url().startsWith('file:') && !r.url().startsWith('data:')) requests.push(r.url()); });
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('dialog', d => d.accept());

    await page.goto(FILE);

    await step('chargement : aucune requête réseau, aucune erreur JS', async () => {
      assert.deepEqual(requests, []);
      assert.deepEqual(errors, []);
      assert.equal(await page.textContent('#cnt-shortcuts'), String(Object.keys(db.shortcuts).length));
    });

    await step('testeur : même DSL que le CLI', async () => {
      await page.click('#nav-tester');
      for (const input of ['analyse le code puis compresse le resultat', 'find usages of this function in this file', 'valide les tests si possible sinon debogue']) {
        await page.fill('#test-input', input);
        await page.press('#test-input', 'Enter');
        assert.equal(await page.textContent('#test-result .result-dsl'), SPC.transpile(input, db).dsl, input);
      }
    });

    await step('IA locale : réponse malveillante rendue inerte (P0-5)', async () => {
      await page.route('http://localhost:1234/**', route => route.fulfill({
        status: 200, contentType: 'application/json',
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ choices: [{ message: { content: JSON.stringify({ dsl: PAYLOAD, explication: '<b>gras</b>' }) } }] })
      }));
      await page.click('#nav-lmstudio');
      await page.fill('#lm-input', "it's \"quoted\" ' and \\ weird");
      await page.click('[data-action="run-ai"]');
      await page.waitForSelector('#lm-result .result-dsl');
      assert.equal(await page.textContent('#lm-result .result-dsl'), PAYLOAD);
      assert.equal(await page.$$eval('#lm-result img, #lm-result script, #lm-result b', n => n.length), 0);
      assert.match(await page.textContent('#lm-result'), /schéma/);
      // les boutons utilisent dataset : la valeur arrive intacte
      assert.equal(await page.getAttribute('#lm-result [data-action="add-to-shortcuts"]', 'data-dsl'), PAYLOAD);
      await page.click('#lm-result [data-action="add-to-shortcuts"]');   // confirm() accepté
      await page.click('#nav-shortcuts');
      await page.fill('#shortcut-filter', 'weird');
      assert.equal(await page.textContent('.shortcut-dsl'), '⚠ ' + PAYLOAD);
      await page.click('[data-action="edit-shortcut"]');                // prompt() accepté (valeur par défaut)
      await page.click('[data-action="delete-shortcut"]');
      assert.match(await page.textContent('#shortcuts-list'), /Aucun raccourci/);
      assert.equal(await page.evaluate(() => window.__xss), undefined);
    });

    await step('import invalide refusé, base conservée (P1-6)', async () => {
      const before = await page.textContent('#cnt-shortcuts');
      let alertText = '';
      page.removeAllListeners('dialog');
      page.on('dialog', d => { alertText = d.message(); d.accept(); });
      await page.setInputFiles('#import-input', { name: 'x.json', mimeType: 'application/json', buffer: Buffer.from('{"version":"9","operators":[]}') });
      await page.waitForTimeout(200);
      assert.match(alertText, /Import refusé/);
      assert.equal(await page.textContent('#cnt-shortcuts'), before);
      page.removeAllListeners('dialog');
      page.on('dialog', d => d.accept());
    });

    await step('base locale v0.1 détectée : bandeau de mise à jour (P1-5)', async () => {
      const legacy = JSON.parse(JSON.stringify(db)); legacy.version = '0.1';
      await page.evaluate(v => localStorage.setItem('rosetta-spc', v), JSON.stringify(legacy));
      await page.reload();
      assert.ok(await page.isVisible('#version-banner'));
      await page.click('[data-action="banner-load"]');
      assert.ok(!(await page.isVisible('#version-banner')));
      await page.reload();
      assert.ok(!(await page.isVisible('#version-banner')));
    });

    await step('stockage local corrompu ou bloqué : la page reste utilisable', async () => {
      await page.evaluate(() => localStorage.setItem('rosetta-spc', '{pas du json'));
      await page.reload();
      assert.equal(await page.textContent('#cnt-operators'), String(db.operators.length));
      const p2 = await ctx.newPage();
      await p2.addInitScript(() => {
        Object.defineProperty(window, 'localStorage', { get() { throw new Error('SecurityError'); } });
      });
      const errs = []; p2.on('pageerror', e => errs.push(e.message));
      await p2.goto(FILE);
      assert.deepEqual(errs, []);
      assert.equal(await p2.textContent('#cnt-operators'), String(db.operators.length));
    });

    await step('aucune requête réseau sur toute la session (hors LM Studio simulé)', async () => {
      assert.deepEqual(requests.filter(u => !u.startsWith('http://localhost:1234')), []);
    });
  } finally {
    await browser.close();
  }
  for (const [s, n] of results) console.log(`${s} ${n}`);
  process.exitCode = results.some(r => r[0] === '✗') ? 1 : 0;
})();
