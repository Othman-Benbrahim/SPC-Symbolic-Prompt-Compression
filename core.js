/**
 * core.js — Noyau partagé de la Pierre de Rosette SPC.
 *
 * Fonctions pures, sans I/O ni DOM. Utilisé tel quel par :
 *   - rosetta.js   (CLI Node : require('./core'))
 *   - rosetta.html (éditeur : inliné par build.js, exposé en global `SPC`)
 *
 * Shared core of the SPC Rosetta Stone (prose → DSL transpiler, DSL validator,
 * token estimator, tolerant parser for local-LLM answers).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SPC = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Noms de modificateurs à sémantique fixe (réservés).
  const MOD = {
    MAX: '▲_max', PIPE: 'pipe', COND: 'conditional', ELSE: 'else',
    STORE: 'store', CLOSE: 'session_close', LAZY: 'lazy_load'
  };
  // Marqueurs structurels intégrés (en plus de ceux de la BDD).
  const BUILTIN_PIPE = [';'];
  const THEN_MARKERS = ['alors', 'then', ','];
  // Condition formulée à l'échec (« si les tests échouent ») : la branche part dans « sinon ».
  const NEGATIVE = new Set(['fail', 'fails', 'failed', 'failing', 'echoue', 'echouent', 'echoues', 'echec', 'echecs',
    'not', 'pas', "n't", 'broken', 'casse', 'cassee', 'cassent', 'plante', 'plantent', 'crash', 'crashes', 'ko',
    'error', 'errors', 'erreur', 'erreurs']);
  // mots entiers uniquement (sans racinisation : « pass » ≠ « pas »)
  const isNegative = text => text.split(/[^\p{L}\p{N}']+/u).some(w => NEGATIVE.has(w) || w.endsWith("n't"));
  /** Spans des mots négatifs d'un texte (masqués lors du choix de l'opérateur d'une condition négative). */
  function negativeSpans(text) {
    const out = [];
    const re = /[\p{L}\p{N}']+/gu;
    let m;
    while ((m = re.exec(text))) if (NEGATIVE.has(m[0]) || m[0].endsWith("n't")) out.push({ start: m.index, end: m.index + m[0].length });
    return out;
  }
  // Atténuateurs (« si possible ») : pas des conditions, retirés avant l'analyse.
  const SOFTENERS = ['si possible', 'if possible', 'si necessaire', 'if necessary', 'if needed',
    'when possible', 'dans la mesure du possible', 'au besoin'];
  // Coordination « , / et / and » : séparateurs souples (voir splitCoordination).
  const AND_MARKERS = ['et', 'and'];
  const SOFT_MARKERS = [',', ...AND_MARKERS];
  const NUM_RE = /(\d+)\s*(?:fois|times|x|passes?|iterations?|tours?)\b/;

  // Symboles positionnels admis dans un argument d'opérateur.
  const REF_RE = /^(◈|\*|◊|▲|§\d+)$/;
  const NEG_RE = /^⊘[\p{L}\p{N}_\-.:]+$/u;
  const SKILL_RE = /^@[\p{L}\p{N}_\-]+(?:::[\p{L}\p{N}_\-]+)?⌒?$/u;

  // ─── NORMALISATION ─────────────────────────────────────────────────────────
  /** Minuscules, sans diacritiques, apostrophes unifiées, espaces compactés. */
  function normalize(str) {
    return String(str == null ? '' : str)
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[\u2018\u2019\u02BC\u0060\u00B4]/g, "'")
      .replace(/\s+/g, ' ')
      .trim();
  }

  const WORD_CH = /[\p{L}\p{N}]/u;
  const isWord = c => !!c && WORD_CH.test(c);

  /**
   * Toutes les occurrences de `term` dans `n` (déjà normalisés) qui respectent
   * les frontières de mots. Un « s » final de pluriel est toléré
   * (« test » trouve « tests », mais « use » ne trouve plus « because »).
   */
  function findAll(n, term) {
    const out = [];
    if (!term) return out;
    const first = term[0], last = term[term.length - 1];
    let i = n.indexOf(term);
    while (i !== -1) {
      const end = i + term.length;
      const leftOk = i === 0 || !isWord(first) || !isWord(n[i - 1]);
      if (leftOk) {
        if (end === n.length || !isWord(last) || !isWord(n[end])) {
          out.push({ start: i, end });
        } else if (n[end] === 's' && isWord(last) && !isWord(n[end + 1])) {
          out.push({ start: i, end: end + 1 });
        }
      }
      i = n.indexOf(term, i + 1);
    }
    return out;
  }

  // ─── RACINISATION LÉGÈRE (FR + EN) ─────────────────────────────────────────
  // Suffixes retirés (le plus long d'abord) avec la longueur minimale du radical
  // restant ; jusqu'à 3 passes. Comparaison mot à mot uniquement : un radical ne
  // peut pas matcher l'intérieur d'un autre mot (« use » ≠ « because »).
  //   validation/valide/validate/validated → valid · compilation/compile → compil
  //   scanne/scanner/scanning → scan · refactorise/refactoring → refactor
  const SUFFIXES = [
    ['ations', 4], ['ation', 4], ['ements', 4], ['ement', 4], ['ments', 4], ['ment', 4],
    ['ings', 3], ['ing', 3], ['ions', 4], ['ion', 4], ['ises', 4], ['ise', 4], ['izes', 4], ['ize', 4],
    ['ated', 4], ['ates', 4], ['ate', 4], ['ers', 4], ['er', 4], ['ed', 3], ['ent', 4], ['ez', 4],
    ['is', 4], ['es', 3], ['e', 3], ['s', 3]
  ];
  const STEM_CACHE = new Map();
  function stem(word) {
    let w = word;
    if (STEM_CACHE.has(w)) return STEM_CACHE.get(w);
    if (w.length >= 4 && !/^\d+$/.test(w)) {
      for (let pass = 0; pass < 3; pass++) {
        let changed = false;
        for (const [suf, min] of SUFFIXES) {
          if (w.endsWith(suf) && w.length - suf.length >= min && !(suf === 's' && /(ss|us)$/.test(w))) {
            w = w.slice(0, -suf.length); changed = true; break;
          }
        }
        // consonne finale doublée (scann → scan, committ → commit), radical ≥ 4
        if (w.length >= 5 && w[w.length - 1] === w[w.length - 2] && /[b-df-hj-np-tv-z]/.test(w[w.length - 1])) w = w.slice(0, -1);
        if (!changed) break;
      }
    }
    if (STEM_CACHE.size > 5000) STEM_CACHE.clear();
    STEM_CACHE.set(word, w);
    return w;
  }

  /** Mots d'un texte avec leur position et leur radical. */
  let tokCache = { text: null, toks: null };
  function tokens(text) {
    if (tokCache.text === text) return tokCache.toks;
    const toks = [];
    const re = /[\p{L}\p{N}]+/gu;
    let m;
    while ((m = re.exec(text))) toks.push({ start: m.index, end: m.index + m[0].length, s: stem(m[0]) });
    tokCache = { text, toks };
    return toks;
  }

  /**
   * Correspondances par radicaux, mot à mot (locutions comprises : « looking for »
   * trouve « look for »). Uniquement pour les termes faits de mots, espaces,
   * apostrophes et tirets ; les mots doivent être contigus dans le texte.
   */
  // Participes passés employés comme adjectifs (« fichiers générés », « generated files ») :
  // jamais lus comme un verbe d'action par radical (la correspondance exacte reste possible).
  const PARTICIPLE = /(?:ees|es|ed)$/;
  function findStem(n, term, verbal) {
    if (!/^[\p{L}\p{N}\s'\-]+$/u.test(term)) return [];
    const want = (term.match(/[\p{L}\p{N}]+/gu) || []).map(stem);
    if (!want.length) return [];
    const toks = tokens(n), out = [];
    for (let i = 0; i + want.length <= toks.length; i++) {
      let ok = true;
      for (let k = 0; k < want.length && ok; k++) {
        if (toks[i + k].s !== want[k]) ok = false;
        else if (verbal && k === 0 && PARTICIPLE.test(n.slice(toks[i].start, toks[i].end)) && !PARTICIPLE.test(term.split(/[\s'\-]/)[0])) ok = false;
        else if (k > 0 && !/^[\s'\-]+$/.test(n.slice(toks[i + k - 1].end, toks[i + k].start))) ok = false;
      }
      if (ok) out.push({ start: toks[i].start, end: toks[i + want.length - 1].end, stem: true });
    }
    return out;
  }

  /** Correspondances exactes (frontières de mots, pluriel en s) puis par radicaux. */
  function matchTerm(n, term, verbal) {
    const exact = findAll(n, term);
    const st = findStem(n, term, verbal).filter(m => !exact.some(e => e.start === m.start));
    return exact.concat(st);
  }

  const overlaps = (a, b) => a.start < b.end && b.start < a.end;
  const overlapsAny = (span, spans) => spans.some(s => overlaps(span, s));

  /**
   * Meilleure correspondance parmi `terms` : la plus longue gagne,
   * puis la plus à gauche. `exclude` : spans à ignorer.
   */
  function bestMatch(n, terms, exclude, exactOnly) {
    let best = null;
    for (const raw of terms) {
      const t = normalize(raw);
      for (const m of (exactOnly ? findAll(n, t) : matchTerm(n, t))) {
        if (exclude && overlapsAny(m, exclude)) continue;
        const len = m.end - m.start;
        const exact = !m.stem;
        if (!best || len > best.len || (len === best.len && (exact && !best.exact || (exact === best.exact && m.start < best.start)))) {
          best = { term: t, raw, start: m.start, end: m.end, len, exact };
        }
      }
    }
    return best;
  }

  /** Toutes les occurrences non chevauchantes de `terms` (plus longue d'abord). */
  function allMatches(n, terms) {
    const hits = [];
    for (const raw of terms) {
      const t = normalize(raw);
      for (const m of findAll(n, t)) hits.push({ start: m.start, end: m.end, term: t });
    }
    hits.sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start));
    const out = [];
    for (const h of hits) if (!out.length || h.start >= out[out.length - 1].end) out.push(h);
    return out;
  }

  // ─── DSL : PARSE DES DÉFAUTS ───────────────────────────────────────────────
  /** "OP[a, b=c]" → [{name:null,value:'a'},{name:'b',value:'c'}] */
  function parseArgs(defaultDsl) {
    const m = /\[(.*)\]/.exec(defaultDsl || '');
    if (!m || !m[1].trim()) return [];
    return m[1].split(',').map(s => s.trim()).filter(Boolean).map(s => {
      const eq = s.indexOf('=');
      return eq > 0 ? { name: s.slice(0, eq).trim(), value: s.slice(eq + 1).trim() }
                    : { name: null, value: s };
    });
  }

  const mods = db => db.modifiers || {};

  // ─── TRANSPILATION ─────────────────────────────────────────────────────────
  function bestShortcut(n, db) {
    let best = null;
    for (const [phrase, dsl] of Object.entries(db.shortcuts || {})) {
      const m = bestMatch(n, [phrase]);
      if (m && (!best || m.len > best.len)) best = { phrase, dsl, start: m.start, end: m.end, len: m.len };
    }
    return best;
  }

  function detectParams(n, op) {
    const params = {}, spans = [];
    for (const [pname, vals] of Object.entries(op.params || {})) {
      let best = null;
      for (const [val, triggers] of Object.entries(vals || {})) {
        const m = bestMatch(n, triggers || []);
        if (m && (!best || m.len > best.m.len)) best = { val, m };
      }
      if (best) { params[pname] = best.val; spans.push(best.m); }
    }
    return { params, spans };
  }

  /** Ordre entre deux correspondances d'un même opérateur (négatif = a meilleur). */
  function cmpMatch(a, b) {
    return (b.words - a.words) || (b.evidence - a.evidence) || (b.exact - a.exact) || (b.len - a.len) || (a.start - b.start);
  }

  /** Classement des opérateurs candidats d'un segment. */
  function rankOperators(n, db, exclude) {
    const closeSpans = allMatches(n, mods(db)[MOD.CLOSE] || []);
    const cands = [];
    for (const op of db.operators || []) {
      const det = detectParams(n, op);
      // preuve = paramètres reconnus hors du mot déclencheur lui-même (R2)
      const ev = m => det.spans.filter(sp => !overlaps(sp, m)).length;
      let best = null;
      for (const raw of op.triggers || []) {
        const t = normalize(raw);
        const words = t.split(' ').length;
        for (const m of matchTerm(n, t, true)) {
          const len = m.end - m.start;
          if (!m.stem && len > t.length && /es$/.test(n.slice(m.start, m.end))) continue;
          // une phrase de clôture plus longue (« archive la session ») l'emporte
          if (closeSpans.some(c => overlaps(c, m) && (c.end - c.start) > len)) continue;
          if (exclude && overlapsAny(m, exclude)) continue;
          const cand = { start: m.start, end: m.end, len, term: t, words, exact: !m.stem };
          cand.evidence = ev(cand);
          if (!best || cmpMatch(cand, best) < 0) best = cand;
        }
      }
      // R2 : un paramètre porté par le mot déclencheur lui-même (« tests » pour
      // VALIDATE) n'est pas une preuve supplémentaire.
      if (best) cands.push({ op, match: best, evidence: best.evidence, det });
    }
    // locution multi-mots > paramètres reconnus (hors mot déclencheur) > correspondance
    // exacte plutôt que par radical > trigger le plus long > position (verbe en tête) > priorité
    cands.sort((a, b) =>
      b.match.words - a.match.words ||
      b.evidence - a.evidence ||
      (b.match.exact - a.match.exact) ||
      b.match.len - a.match.len ||
      a.match.start - b.match.start ||
      (b.op.priority || 0) - (a.op.priority || 0));
    return { cands, closeSpans };
  }

  function transpileSegment(seg, db, ctx, opts) {
    const n = seg;
    const warnings = ctx.warnings;
    if (!opts || !opts.requireOp) {
      const sc = bestShortcut(n, db);
      if (sc) { ctx.sources.add('shortcut'); ctx.ops.push(...opIds(sc.dsl, db)); ctx.meta = { op: null, match: sc, paramSpans: [] }; return sc.dsl; }
    }
    let { cands, closeSpans } = rankOperators(n, db, opts && opts.negative ? negativeSpans(n) : null);
    if (!cands.length && opts && opts.negative) {
      // R4 : la condition ne se rattache qu'au mot d'échec (« échoue » → DEBUG)
      ({ cands, closeSpans } = rankOperators(n, db));
      if (cands.length) warnings.push(`condition négative rattachée à ${cands[0].op.id} par le mot d'échec : vérifier que la garde ne devait pas être une vérification (« ${seg} »)`);
    }
    if (!cands.length) {
      if (closeSpans.length && !(opts && opts.requireOp)) { ctx.sources.add('rules'); return '⊜'; }
      return null;
    }
    const { op, match, det } = cands[0];
    const { params, spans: paramSpans } = det;
    const taken = [match, ...paramSpans];

    // modificateurs = mots-outils : correspondance exacte uniquement (« toutes » ≠ « tout »)
    const hit = name => bestMatch(n, mods(db)[name] || [], taken, true);
    const maxHit = hit(MOD.MAX);
    const storeHit = hit(MOD.STORE);
    const closeHit = closeSpans.find(c => !overlapsAny(c, taken));
    let outHit = null;
    for (const [type, triggers] of Object.entries(db.output_types || {})) {
      const m = bestMatch(n, triggers || [], taken, true);
      if (m && (!outHit || m.len > outHit.m.len)) outHit = { type, m };
    }

    // Arguments : défaut de l'opérateur, puis paramètres détectés.
    const args = parseArgs(op.default);
    const bind = op.bind || {};
    const sig = op.signature || [];
    const setArg = (name, value) => {
      const a = args.find(x => x.name === name);
      if (a) a.value = value; else args.push({ name, value });
    };
    // placeholders positionnels "@param" (ex. APPLY[@skill, ◈])
    for (let i = args.length - 1; i >= 0; i--) {
      const a = args[i];
      if (!a.name && /^@/.test(a.value) && (op.params || {})[a.value.slice(1)]) {
        const pname = a.value.slice(1);
        if (params[pname]) { a.value = params[pname]; delete params[pname]; }
        else args.splice(i, 1);
      }
    }
    for (const pname of Object.keys(op.params || {})) {
      if (params[pname] != null) setArg(bind[pname] || pname, params[pname]);
    }
    if (sig.includes('n')) {
      const num = NUM_RE.exec(n);
      if (num) setArg('n', num[1]);
    }
    const absorbed = [...paramSpans];
    if (sig.includes('op')) {
      const inner = cands.find(c => c.op.id !== op.id);
      if (inner) { setArg('op', inner.op.id); absorbed.push(inner.match); ctx.ops.push(inner.op.id); }
    }
    if (n.includes('⌒')) {
      const skillArg = args.find(a => /^@/.test(a.value));
      if (skillArg) { if (!skillArg.value.endsWith('⌒')) skillArg.value += '⌒'; }
      else warnings.push('lazy load (⌒) ignoré : aucun pointeur de skill dans « ' + seg + ' »');
    }
    if (maxHit && !args.some(a => a.value === '▲')) args.push({ name: null, value: '▲' });

    let dsl = `${op.id}[${args.map(a => a.name ? `${a.name}=${a.value}` : a.value).join(', ')}]`;
    if (storeHit) dsl += ` → §${++ctx.anchor}`;
    else if (outHit) dsl += ` → ${outHit.type}`;
    if (closeHit) dsl += ' ⟶ ⊜';

    ctx.sources.add('rules');
    ctx.ops.push(op.id);
    ctx.meta = { op: op.id, match, paramSpans: absorbed };
    return dsl;
  }

  function opIds(dsl, db) {
    const ids = new Set((db.operators || []).map(o => o.id));
    return (String(dsl).match(/\b[A-Z]+(?=\[)/g) || []).filter(x => ids.has(x));
  }

  const isBlank = s => !s || !/[\p{L}\p{N}◈⊜⌒▲§]/u.test(s);

  const subCtx = (ctx, anchor) => ({ ...ctx, warnings: [], ops: [], sources: new Set(), anchor: anchor == null ? ctx.anchor : anchor, meta: null, lost: false });
  function mergeCtx(ctx, sub) {
    ctx.warnings.push(...sub.warnings); ctx.ops.push(...sub.ops);
    sub.sources.forEach(x => ctx.sources.add(x)); ctx.anchor = sub.anchor;
    if (sub.lost) ctx.lost = true;
    if (sub.structured) ctx.structured = true;
  }

  /**
   * R5 — « , / et / and » comme séparateurs souples. Le segment est découpé en
   * clauses ; une clause sans opérateur se rattache à la précédente (« nom, email
   * et mot de passe »), deux clauses voisines du même opérateur fusionnent
   * (« compile and ship »). On ne coupe que s'il reste plusieurs groupes à opérateurs
   * distincts dont le verbe n'est pas un paramètre de l'opérateur principal
   * (« copie et adapte » reste CLONE[adapt=oui]). Une clause sans opérateur
   * introduite par « et / and » est signalée.
   * @returns {string[]|null} les DSL des groupes, ou null si pas de coupe
   */
  function splitCoordination(seg, db, ctx, opts) {
    let markers = allMatches(seg, SOFT_MARKERS);
    if (!markers.length) return null;
    const sc = bestShortcut(seg, db);
    if (sc) markers = markers.filter(m => !overlaps(m, sc));
    if (!markers.length) return null;
    const whole = subCtx(ctx);
    transpileSegment(seg, db, whole, opts);
    const absorbed = whole.meta ? whole.meta.paramSpans : [];

    // clauses et leur opérateur (analyse d'essai, sans effet sur ctx)
    const clauses = [];
    let pos = 0, prevMarker = null;
    for (const m of [...markers, null]) {
      const end = m ? m.start : seg.length;
      clauses.push({ start: pos, end, text: seg.slice(pos, end).trim(), marker: prevMarker });
      if (m) { pos = m.end; prevMarker = m.term; }
    }
    for (const c of clauses) {
      const sub = subCtx(ctx);
      const d = isBlank(c.text) ? null : transpileSegment(c.text, db, sub, opts);
      const lead = seg.slice(c.start, c.end).length - seg.slice(c.start, c.end).trimStart().length;
      c.op = d && d !== '⊜' ? sub.ops.join(',') : null;
      c.span = sub.meta && sub.meta.match ? { start: sub.meta.match.start + c.start + lead, end: sub.meta.match.end + c.start + lead } : null;
      c.absorbed = c.op && c.span && overlapsAny(c.span, absorbed);
    }
    // regroupement
    const groups = [];
    for (const c of clauses) {
      const g = groups[groups.length - 1];
      const startsGroup = c.op && !c.absorbed && (!g || g.op !== c.op);
      if (startsGroup || !g) groups.push({ start: c.start, end: c.end, op: c.op && !c.absorbed ? c.op : null });
      else { g.end = c.end; if (!g.op && c.op && !c.absorbed) g.op = c.op; }
    }
    const opGroups = groups.filter(g => g.op);
    if (opGroups.length > 1 && groups.every(g => g.op)) {
      const out = [];
      for (const g of groups) {
        const text = seg.slice(g.start, g.end).replace(/^[\s,]+|[\s,]+$/g, '').replace(/^(et|and)\s+/, '');
        const d = transpileSegment(text, db, ctx, opts);
        if (d) out.push(d);
      }
      return out;
    }
    for (const c of clauses) {
      if (!c.op && c.marker && AND_MARKERS.includes(c.marker) && !isBlank(c.text)) {
        ctx.warnings.push(`clause « ${c.text} » sans opérateur après « ${c.marker} » : rattachée à l'instruction voisine — vérifier qu'aucune action n'est perdue`);
      }
    }
    return null;
  }

  /** Séquence A ⟶ B ⟶ C (découpage sur les marqueurs de pipe). */
  function parseSequence(n, db, ctx, opts) {
    if (isBlank(n)) return null;
    let markers = allMatches(n, [...(mods(db)[MOD.PIPE] || []), ...BUILTIN_PIPE]);
    const whole = (!opts || !opts.requireOp) ? bestShortcut(n, db) : null;
    if (whole) markers = markers.filter(m => !overlaps(m, whole));
    const segs = [];
    let pos = 0;
    for (const m of markers) { segs.push(n.slice(pos, m.start)); pos = m.end; }
    segs.push(n.slice(pos));
    const parts = [];
    const snap = () => ({ ops: ctx.ops.length, anchor: ctx.anchor, warnings: ctx.warnings.length });
    const restore = st => { ctx.ops.length = st.ops; ctx.anchor = st.anchor; ctx.warnings.length = st.warnings; };
    let last = null;   // { text, snap, count } : dernier segment émis
    for (const s of segs) {
      const seg = s.trim();
      if (isBlank(seg)) continue;
      const before = snap(), n0 = parts.length;
      const split = splitCoordination(seg, db, ctx, opts);
      if (split) { parts.push(...split); last = { text: seg, snap: before, count: parts.length - n0 }; continue; }
      const d = transpileSegment(seg, db, ctx, opts);
      if (d) { parts.push(d); last = { text: seg, snap: before, count: 1 }; continue; }
      const prev = parts.length - 1;
      if (prev >= 0 && bestMatch(seg, mods(db)[MOD.STORE] || [], null, true) && !/→ [^⟶]*$/.test(parts[prev])) {
        parts[prev] += ` → §${++ctx.anchor}`;          // « … puis stocke le résultat »
        continue;
      }
      if (last) {
        // marqueur adverbial (« ajoute ensuite un système de logs ») : le segment sans
        // opérateur complète l'étape précédente, qui est réanalysée avec lui
        const merged = last.text + ' ' + seg;
        const saved = { parts: parts.splice(parts.length - last.count), state: snap() };
        restore(last.snap);
        const d2 = transpileSegment(merged, db, ctx, opts);
        if (d2) { parts.push(d2); last = { text: merged, snap: last.snap, count: 1 }; continue; }
        parts.push(...saved.parts); restore(saved.state);
      }
      ctx.warnings.push('segment non reconnu, ignoré : « ' + seg + ' »');
      ctx.lost = true;
    }
    if (opts && opts.requireOp && !parts.some(p => p !== '⊜')) return null;
    return parts.length ? parts.join(' ⟶ ') : null;
  }

  /** Phrases (« . » suivi d'un espace) : chacune est une expression, jointes par ⟶. */
  function parseSentences(n, db, ctx) {
    const sentences = n.split(/(?<=[.!])\s+/).map(x => x.replace(/[.!]+$/, '').trim()).filter(x => !isBlank(x));
    if (sentences.length < 2) return parseExpr(n.replace(/[.!]+$/, ''), db, ctx);
    const parts = sentences.map(x => parseExpr(x, db, ctx)).filter(Boolean);
    // « ? » lie moins fort que « ⟶ » : dès qu'une phrase est conditionnelle, chaque
    // phrase devient une instruction sur sa propre ligne (exécutées dans l'ordre),
    // sinon « C ? X ⟶ S2 » ferait dépendre S2 de C.
    if (!parts.length) return null;
    return parts.some(x => / \? /.test(x)) ? parts.join('\n') : parts.join(' ⟶ ');
  }

  /** Expression complète : conditionnels (si … alors … sinon …) puis séquences. */
  function parseExpr(n, db, ctx) {
    const elseHit = allMatches(n, mods(db)[MOD.ELSE] || [])[0];
    const condTerms = mods(db)[MOD.COND] || [];

    const splitCond = text => {
      const c = allMatches(text, condTerms)[0];
      if (!c) return { X: text, C: '' };
      const before = text.slice(0, c.start), after = text.slice(c.end);
      if (isBlank(before)) {
        const t = allMatches(after, THEN_MARKERS)[0];
        if (t) return { C: after.slice(0, t.start), X: after.slice(t.end) };
        // « si tout est vert déploie » : la condition s'arrête au verbe d'action
        const { cands } = rankOperators(after, db);
        const first = cands.map(c => c.match.start).filter(p => p > 0 && !isBlank(after.slice(0, p))).sort((a, b) => a - b)[0];
        return first != null ? { C: after.slice(0, first), X: after.slice(first) } : { C: after, X: '' };
      }
      return { X: before, C: after };
    };
    // la condition est un essai : ses avertissements ne sont fusionnés que si elle est retenue
    const parseCond = C => {
      const sub = subCtx(ctx);
      const Cd = isBlank(C) ? null : parseSequence(C.trim(), db, sub, { requireOp: true, negative: isNegative(C) });
      if (Cd) mergeCtx(ctx, sub);
      return Cd;
    };

    if (elseHit) {
      const L = n.slice(0, elseHit.start), R = n.slice(elseHit.end);
      const { X, C } = splitCond(L);
      const Cd = parseCond(C);
      const Xd = parseSequence(X.trim(), db, ctx);
      const Rd = parseSequence(R.trim(), db, ctx);
      ctx.structured = true;
      if (Cd) return isNegative(C)
        ? `${Cd} ? ${Rd || '∅'} : ${Xd || '∅'}`
        : `${Cd} ? ${Xd || '∅'} : ${Rd || '∅'}`;
      if (!isBlank(C)) ctx.warnings.push(`condition « ${C.trim()} » sans opérateur : ${Xd ? 'l\'action principale sert de condition (X ? ∅ : sinon)' : 'ignorée'}`);
      if (Xd && Rd) return `${Xd} ? ∅ : ${Rd}`;
      if (!Xd || !Rd) { ctx.warnings.push('conditionnel incomplet : une branche n\'a pas d\'opérateur'); ctx.lost = true; }
      return Xd || Rd;
    }

    const c = allMatches(n, condTerms)[0];
    if (c) {
      const head = n.slice(0, c.start);
      const conn = /(?:^|[\s,;])(?:et|and|puis|then|ensuite)\s*$|[,;]\s*$/.exec(head);
      if (conn && !isBlank(head.slice(0, conn.index))) {
        const pre = parseSequence(head.slice(0, conn.index).trim(), db, ctx);
        const post = parseExpr(n.slice(c.start), db, ctx);
        if (pre && post) return `${pre} ⟶ ${post}`;
        return pre || post;
      }
      const { X, C } = splitCond(n);
      const Cd = parseCond(C);
      if (Cd) {
        const sub = subCtx(ctx);
        const Xd = isBlank(X) ? null : parseSequence(X.trim(), db, sub);
        if (Xd) {
          mergeCtx(ctx, sub);
          ctx.structured = true;
          return isNegative(C) ? `${Cd} ? ∅ : ${Xd}` : `${Cd} ? ${Xd}`;
        }
        // R1 : action introuvable → rien d'exécutable ; on ne rend pas la condition seule
        ctx.warnings.push(`conditionnel incomplet : action « ${X.trim()} » non reconnue — l'instruction est perdue (condition : ${Cd})`);
        ctx.lost = true;
        return null;
      }
      if (!isBlank(C) && !isBlank(X)) {
        // R1 : condition introuvable → l'action est conservée, la garde perdue est signalée
        const Xd = parseSequence(X.trim(), db, ctx);
        if (Xd) {
          ctx.warnings.push(`conditionnel incomplet : condition « ${C.trim()} » non reconnue — l'action est émise SANS garde`);
          ctx.lost = true;
          return Xd;
        }
      }
    }
    return parseSequence(n, db, ctx);
  }

  /**
   * prose → DSL.
   * @returns {{dsl:string|null, source:'shortcut'|'rules'|null, ops:string[], warnings:string[], complete:boolean}}
   *   complete === false si une partie de l'instruction a été perdue (segment ignoré,
   *   conditionnel incomplet) ; les avertissements disent laquelle.
   *   source === 'shortcut' uniquement si tout le DSL provient de raccourcis (aucune règle).
   */
  function transpile(input, db) {
    const ctx = { anchor: 0, warnings: [], ops: [], sources: new Set(), structured: false, lost: false, meta: null };
    let n = normalize(input);
    // ⌒ : les phrases lazy-load sont réduites au symbole (évite que « si besoin »
    // soit lu comme un conditionnel).
    for (const m of allMatches(n, mods(db)[MOD.LAZY] || []).reverse()) {
      n = n.slice(0, m.start) + ' ⌒ ' + n.slice(m.end);
    }
    for (const m of allMatches(n, SOFTENERS).reverse()) n = n.slice(0, m.start) + ' ' + n.slice(m.end);
    n = n.replace(/\s+/g, ' ').trim();
    const dsl = isBlank(n) ? null : parseSentences(n, db, ctx);
    const source = !dsl ? null
      : (ctx.sources.size === 1 && ctx.sources.has('shortcut') && !ctx.structured ? 'shortcut' : 'rules');
    return { dsl, source, ops: ctx.ops, warnings: [...new Set(ctx.warnings)], complete: !!dsl && !ctx.lost };
  }

  // ─── VALIDATION DU DSL ─────────────────────────────────────────────────────
  /**
   * Vérifie un DSL contre la grammaire SPC et les schémas d'opérateurs de `db`.
   * Grammaire :
   *   prog  := expr ( ⏎ expr )*        une instruction par ligne, exécutées dans l'ordre
   *   expr  := decl* cond
   *   decl  := @skill(::mod)?⌒
   *   cond  := seq ( '?' seq ( ':' seq )? )?
   *   seq   := term ( '⟶' term )*
   *   term  := ( OP '[' args? ']' ('↻' N)? | '⊜' | '∅' ) ( '→' (TYPE | §N) )?
   */
  function validateDSL(dsl, db) {
    const lines = String(dsl || '').split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length > 1) {
      const errors = [];
      lines.forEach((l, k) => {
        if (/^(@[\p{L}\p{N}_\-]+(?:::[\p{L}\p{N}_\-]+)?⌒\s*)+$/u.test(l)) return;   // ligne de déclarations
        const r = validateLine(l, db);
        errors.push(...r.errors.map(e => `ligne ${k + 1} : ${e}`));
      });
      return { ok: errors.length === 0, errors };
    }
    return validateLine(lines[0] || '', db);
  }

  function validateLine(dsl, db) {
    const errors = [];
    const ops = new Map((db.operators || []).map(o => [o.id, o]));
    const outputs = new Set(Object.keys(db.output_types || {}));
    let s = String(dsl || '').trim();
    if (!s) return { ok: false, errors: ['DSL vide'] };

    // déclarations de skills en tête (lazy load)
    while (true) {
      const m = /^@[\p{L}\p{N}_\-]+(?:::[\p{L}\p{N}_\-]+)?⌒\s+/u.exec(s);
      if (!m) break;
      s = s.slice(m[0].length);
    }

    let i = 0;
    const ws = () => { while (i < s.length && /\s/.test(s[i])) i++; };
    const peek = str => { ws(); return s.startsWith(str, i); };
    const eat = str => { if (peek(str)) { i += str.length; return true; } return false; };
    const fail = msg => { errors.push(`${msg} (position ${i})`); throw new Error('stop'); };

    function term() {
      ws();
      if (eat('⊜') || eat('∅')) { /* instruction nue */ }
      else {
        const m = /^[A-Z][A-Z_]*/.exec(s.slice(i));
        if (!m) fail(`opérateur attendu, trouvé « ${s.slice(i, i + 12)} »`);
        const id = m[0]; i += id.length;
        const op = ops.get(id);
        if (!op) fail(`opérateur inconnu « ${id} »`);
        if (!eat('[')) fail(`« [ » attendu après ${id}`);
        const close = s.indexOf(']', i);
        if (close === -1) fail(`« ] » manquant pour ${id}`);
        const inner = s.slice(i, close);
        if (inner.includes('[')) fail(`crochets imbriqués dans ${id}`);
        i = close + 1;
        checkArgs(op, inner);
        if (eat('↻')) { const k = /^\d+/.exec(s.slice(i)); if (!k) fail('nombre attendu après ↻'); i += k[0].length; }
      }
      if (eat('→')) {
        ws();
        const m = /^(§\d+|[\p{L}\p{N}_\-]+)/u.exec(s.slice(i));
        if (!m) fail('cible attendue après →');
        if (!m[1].startsWith('§') && !outputs.has(m[1])) errors.push(`type de sortie inconnu « ${m[1]} »`);
        i += m[1].length;
      }
    }
    function seq() { term(); while (eat('⟶')) term(); }
    function checkArgs(op, inner) {
      const sig = new Set(op.signature || []);
      const params = op.params || {};
      const parts = inner.split(',').map(x => x.trim());
      if (inner.trim() === '') return;
      for (const a of parts) {
        if (!a) { errors.push(`${op.id} : argument vide`); continue; }
        const eq = a.indexOf('=');
        if (eq > 0) {
          const name = a.slice(0, eq).trim(), value = a.slice(eq + 1).trim();
          if (!value) { errors.push(`${op.id} : valeur manquante pour ${name}`); continue; }
          if (!sig.has(name) && !params[name]) { errors.push(`${op.id} : paramètre inconnu « ${name} »`); continue; }
          const en = params[name];
          if (en && Object.keys(en).length) {
            const base = value.replace(/⌒$/, '').replace(/::.*$/, '');
            if (!(value in en) && !(base in en)) errors.push(`${op.id} : ${name}=${value} hors énumération (${Object.keys(en).join(', ')})`);
          } else if (name === 'op') {
            if (!ops.has(value)) errors.push(`${op.id} : op=${value} n'est pas un opérateur`);
          } else if (name === 'n') {
            if (!/^\d+$/.test(value)) errors.push(`${op.id} : n=${value} doit être un entier`);
          }
        } else if (REF_RE.test(a) || NEG_RE.test(a)) {
          /* symbole positionnel */
        } else if (SKILL_RE.test(a)) {
          const en = params.skill;
          const base = a.replace(/⌒$/, '').replace(/::.*$/, '');
          if (!sig.has('skill')) errors.push(`${op.id} : pointeur de skill non admis`);
          else if (en && !(base in en)) errors.push(`${op.id} : skill ${a} hors énumération (${Object.keys(en).join(', ')})`);
        } else {
          errors.push(`${op.id} : argument positionnel invalide « ${a} »`);
        }
      }
    }
    try {
      seq();
      if (eat('?')) { seq(); if (eat(':')) seq(); }
      ws();
      if (i < s.length) fail(`texte inattendu « ${s.slice(i, i + 16)} »`);
    } catch (e) { if (e.message !== 'stop') throw e; }
    return { ok: errors.length === 0, errors };
  }

  // ─── LECTURE STRUCTURÉE D'UN DSL ───────────────────────────────────────────
  /**
   * DSL → étapes dans l'ordre de lecture.
   *   { op, args: {nom: valeur}, positional: [], line, role, onFailure, guardedBy: [op] }
   * role : 'seq' (hors conditionnel) | 'cond' | 'then' (si la condition réussit) | 'else'.
   * onFailure : l'étape ne s'exécute que si la condition échoue (branche « : »).
   */
  function parseSteps(dsl) {
    const steps = [];
    String(dsl || '').split('\n').forEach((line, li) => {
      // découpe top-level sur « ? » et « : » hors crochets
      let depth = 0, q = -1, c = -1;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '[') depth++;
        else if (ch === ']') depth--;
        else if (depth === 0 && ch === '?' && q < 0) q = i;
        else if (depth === 0 && ch === ':' && q >= 0 && c < 0 && line[i + 1] !== ':' && line[i - 1] !== ':') c = i;
      }
      const zones = q < 0 ? [[line, 'seq']]
        : [[line.slice(0, q), 'cond'], [line.slice(q + 1, c < 0 ? line.length : c), 'then'], ...(c < 0 ? [] : [[line.slice(c + 1), 'else']])];
      const condOps = [];
      for (const [text, role] of zones) {
        for (const m of text.matchAll(/\b([A-Z][A-Z_]*)\[([^\]]*)\]/g)) {
          const args = {}, positional = [];
          for (const a of m[2].split(',').map(x => x.trim()).filter(Boolean)) {
            const eq = a.indexOf('=');
            if (eq > 0) args[a.slice(0, eq).trim()] = a.slice(eq + 1).trim(); else positional.push(a);
          }
          if (role === 'cond') condOps.push(m[1]);
          steps.push({ op: m[1], args, positional, line: li, role, onFailure: role === 'else',
            guardedBy: role === 'then' || role === 'else' ? condOps.slice() : [] });
        }
      }
    });
    return steps;
  }

  // ─── VALIDATION DE LA BDD ──────────────────────────────────────────────────
  const isStrArr = a => Array.isArray(a) && a.every(x => typeof x === 'string');
  const isObj = o => o && typeof o === 'object' && !Array.isArray(o);

  /** Erreurs structurelles (la BDD est-elle utilisable ?). */
  function checkDBStructure(db) {
    const e = [];
    if (!isObj(db)) return ['la racine doit être un objet JSON'];
    if (typeof db.version !== 'string') e.push('« version » (chaîne) manquante');
    if (!Array.isArray(db.operators) || !db.operators.length) e.push('« operators » doit être un tableau non vide');
    else {
      const seen = new Set();
      db.operators.forEach((o, k) => {
        const w = `operators[${k}]`;
        if (!isObj(o)) { e.push(`${w} n'est pas un objet`); return; }
        if (typeof o.id !== 'string' || !/^[A-Z][A-Z_]*$/.test(o.id)) e.push(`${w}.id invalide`);
        else if (seen.has(o.id)) e.push(`opérateur en double : ${o.id}`); else seen.add(o.id);
        if (!isStrArr(o.triggers)) e.push(`${w}.triggers doit être un tableau de chaînes`);
        if (typeof o.default !== 'string' || !o.default.startsWith(o.id + '[')) e.push(`${w}.default doit commencer par « ${o.id}[ »`);
        if (o.params != null && !isObj(o.params)) e.push(`${w}.params doit être un objet`);
        else for (const [p, vals] of Object.entries(o.params || {})) {
          if (!isObj(vals)) { e.push(`${w}.params.${p} doit être un objet`); continue; }
          for (const [v, t] of Object.entries(vals)) if (!isStrArr(t)) e.push(`${w}.params.${p}.${v} doit être un tableau de chaînes`);
        }
        if (o.signature != null && !isStrArr(o.signature)) e.push(`${w}.signature doit être un tableau de chaînes`);
        if (o.priority != null && typeof o.priority !== 'number') e.push(`${w}.priority doit être un nombre`);
      });
    }
    for (const key of ['modifiers', 'output_types']) {
      if (!isObj(db[key])) { e.push(`« ${key} » doit être un objet`); continue; }
      for (const [k, v] of Object.entries(db[key])) if (!isStrArr(v)) e.push(`${key}.${k} doit être un tableau de chaînes`);
    }
    if (!isObj(db.shortcuts)) e.push('« shortcuts » doit être un objet');
    else for (const [k, v] of Object.entries(db.shortcuts)) if (typeof v !== 'string') e.push(`shortcuts["${k}"] doit être une chaîne`);
    return e;
  }

  function assertDB(db) {
    const e = checkDBStructure(db);
    if (e.length) { const err = new Error('Base de règles invalide :\n- ' + e.join('\n- ')); err.details = e; throw err; }
    return db;
  }

  /** Contrôles sémantiques : DSL des raccourcis et défauts, collisions de déclencheurs. */
  function lintDB(db) {
    const errors = [], warnings = [];
    for (const o of db.operators) {
      // placeholders "@param" du défaut (ex. APPLY[@skill, ◈]) : remplacés par une valeur admise
      const def = o.default.replace(/@([\p{L}_]+)/gu, (m, p) =>
        (o.params || {})[p] && Object.keys(o.params[p])[0] ? Object.keys(o.params[p])[0] : m);
      const r = validateDSL(def, db);
      if (!r.ok) errors.push(`défaut de ${o.id} : ${r.errors.join(' ; ')}`);
    }
    for (const [phrase, dsl] of Object.entries(db.shortcuts)) {
      const r = validateDSL(dsl, db);
      if (!r.ok) errors.push(`raccourci « ${phrase} » → ${dsl} : ${r.errors.join(' ; ')}`);
    }
    const owner = new Map();
    for (const o of db.operators) {
      const local = new Set();
      for (const t of o.triggers) {
        const k = normalize(t);
        if (local.has(k)) errors.push(`déclencheur en double dans ${o.id} : « ${t} »`);
        local.add(k);
        if (owner.has(k) && owner.get(k) !== o.id) errors.push(`déclencheur partagé par ${owner.get(k)} et ${o.id} : « ${t} »`);
        else owner.set(k, o.id);
      }
    }
    // collisions après racinisation (« compile » / « compilation » dans deux opérateurs)
    const stemOwner = new Map();
    for (const o of db.operators) for (const t of o.triggers) {
      const k = normalize(t);
      if (!/^[\p{L}\p{N}\s'\-]+$/u.test(k)) continue;
      const sk = (k.match(/[\p{L}\p{N}]+/gu) || []).map(stem).join(' ');
      const prev = stemOwner.get(sk);
      if (prev && prev.id !== o.id) errors.push(`déclencheurs de même radical « ${sk} » dans ${prev.id} (« ${prev.t} ») et ${o.id} (« ${t} »)`);
      else stemOwner.set(sk, { id: o.id, t });
    }
    const scKeys = new Map();
    for (const p of Object.keys(db.shortcuts)) {
      const k = normalize(p);
      if (scKeys.has(k)) warnings.push(`raccourcis équivalents après normalisation : « ${scKeys.get(k)} » / « ${p} »`);
      scKeys.set(k, p);
    }
    for (const name of Object.values(MOD)) if (!(db.modifiers || {})[name]) warnings.push(`modificateur réservé absent : ${name}`);
    return { errors, warnings };
  }

  // ─── ESTIMATION DE TOKENS ──────────────────────────────────────────────────
  /**
   * Estimation locale, identique dans tous les modes (jamais les chiffres
   * déclarés par un modèle). Calibrée sur cl100k (voir bench.js, erreur moyenne
   * mesurée dans BENCH.md) : un mot ASCII ≈ 1 token par tranche de 8 caractères,
   * une lettre accentuée ≈ +1, une ponctuation ASCII = 1, un symbole non ASCII
   * ≈ 1 token par octet UTF-8 au-delà du premier.
   */
  function estimateTokens(text) {
    const s = String(text || '');
    let t = 0;
    const re = /[\p{L}\p{N}_]+|\s+|[^\s\p{L}\p{N}_]/gu;
    let m;
    while ((m = re.exec(s))) {
      const p = m[0];
      if (/^\s+$/.test(p)) continue;
      if (/^[\p{L}\p{N}_]+$/u.test(p)) {
        const ascii = p.replace(/[^\x00-\x7f]/g, '');
        t += Math.max(1, Math.ceil(ascii.length / 8)) + (p.length - ascii.length);
      } else if (p.charCodeAt(0) < 128) {
        t += 1;
      } else {
        const bytes = new TextEncoder().encode(p).length;
        t += Math.max(1, bytes - 1);
      }
    }
    return t;
  }

  // ─── IA LOCALE ─────────────────────────────────────────────────────────────
  function buildSystemPrompt(db) {
    const ops = db.operators.map(o => {
      const ps = Object.entries(o.params || {}).map(([p, v]) => `${p}=${Object.keys(v).join('|')}`);
      return `${o.id}(${(o.signature || []).join(',')})${ps.length ? ' ' + ps.join(' ') : ''}`;
    }).join('\n  ');
    const effects = db.modifier_effects || {};
    const modifiers = Object.entries(db.modifiers || {})
      .map(([name, triggers]) => `${name}(${triggers.slice(0, 3).join('/')}) ${effects[name] || ''}`.trim())
      .join('\n  ');
    const outputs = Object.entries(db.output_types || {})
      .map(([type, triggers]) => `${type}(${triggers.slice(0, 2).join('/')})`).join(' ');

    return `Tu es un transpileur DSL SPC (Symbolic Prompt Compression).
Convertis l'instruction en langage naturel (français ou anglais) vers le DSL SPC.
N'utilise QUE les opérateurs, paramètres et valeurs listés.

OPÉRATEURS (signature, valeurs admises):
  ${ops}

MODIFICATEURS:
  ${modifiers}

TYPES DE SORTIE (après →): ${outputs}

SYMBOLES: ◈=input courant §N=ancre ?=conditionnel *=wildcard ▲=max ⊘x=exclure x ↻=répéter ⟶=pipe ⊜=clôture ◊=output précédent ⌒=lazy load ∅=ne rien faire
SYNTAXE: OP[arg, param=val] → TYPE | A ⟶ B | A ? B : C

EXEMPLES:
"analyze this code in depth" → {"dsl":"ANALYZE[◈, ▲]","explication":"analyse profonde"}
"add error handling to all functions" → {"dsl":"ADD[target=*, what=error-handling]","explication":"injecte la gestion d'erreurs partout"}
"find all usages of this function" → {"dsl":"FIND[input=*, type=usage, pattern=◈]","explication":"recherche des utilisations"}
"validate all tests, otherwise debug" → {"dsl":"VALIDATE[*, scope=tests] ? ∅ : DEBUG[*, focus=error]","explication":"valide, sinon débogue"}
"fix the bug then deploy to staging" → {"dsl":"DEBUG[◈, focus=error] ⟶ DEPLOY[◈, env=staging]","explication":"corrige puis déploie"}

RÈGLE CRITIQUE: JSON strict uniquement, rien avant ni après.
FORMAT EXACT: {"dsl":"...","explication":"..."}`;
  }

  /** Parse tolérant (fences, guillemets typographiques, clés non citées, virgules finales, prose autour). */
  function parseJSONTolerant(candidate, db) {
    const txt = String(candidate || '').trim();
    if (!txt) throw new Error('Réponse JSON vide.');
    try { return JSON.parse(txt); } catch (_) {}
    const repaired = txt
      .replace(/[\u201C\u201D]/g, '"')
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/,\s*([}\]])/g, '$1')
      .replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_-]*)\s*:/g, '$1"$2":')
      .replace(/:\s*'([^'\\]*(?:\\.[^'\\]*)*)'/g, (_, v) => ':"' + v.replace(/"/g, '\\"') + '"');
    try { return JSON.parse(repaired); } catch (_) {}
    const dslMatch = txt.match(/["']?dsl["']?\s*:\s*["']([^"']+)["']/i);
    if (dslMatch) return { dsl: dslMatch[1].trim(), explication: 'DSL extrait d\'une réponse JSON non stricte.' };
    const ids = ((db && db.operators) || []).map(o => o.id);
    if (ids.length) {
      const opMatch = txt.match(new RegExp('\\b(' + ids.join('|') + ')\\[[^\\n{}]+\\](?:\\s*(?:→|⟶)\\s*[^\\n{}]+)?'));
      if (opMatch) return { dsl: opMatch[0].trim(), explication: 'DSL extrait d\'une réponse non JSON du modèle local.' };
    }
    throw new Error('Réponse impossible à convertir en JSON : ' + txt.slice(0, 180));
  }

  function extractFirstJSONObject(text, db) {
    if (!text) throw new Error('Réponse vide du modèle local.');
    const cleaned = String(text).replace(/```json/gi, '').replace(/```/g, '').trim();
    try { return parseJSONTolerant(cleaned, db); } catch (_) {}
    const start = cleaned.indexOf('{');
    if (start !== -1) {
      let depth = 0, inString = false, escaped = false, quote = null;
      for (let i = start; i < cleaned.length; i++) {
        const ch = cleaned[i];
        if (escaped) { escaped = false; continue; }
        if (ch === '\\') { escaped = true; continue; }
        if ((ch === '"' || ch === "'") && !inString) { inString = true; quote = ch; continue; }
        if (ch === quote && inString) { inString = false; quote = null; continue; }
        if (inString) continue;
        if (ch === '{') depth++;
        if (ch === '}') depth--;
        if (depth === 0) return parseJSONTolerant(cleaned.slice(start, i + 1), db);
      }
    }
    return parseJSONTolerant(cleaned, db);
  }

  /** Réponse brute du modèle → {dsl, explication, validation}. */
  function parseAIResponse(text, db) {
    const parsed = extractFirstJSONObject(text, db);
    if (!parsed || typeof parsed !== 'object') throw new Error('Le modèle n\'a pas renvoyé un objet JSON.');
    const dsl = String(parsed.dsl || '').replace(/\s+/g, ' ').trim();
    if (!dsl) throw new Error('Le JSON reçu ne contient pas de champ "dsl".');
    return {
      dsl,
      explication: String(parsed.explication || parsed.explanation || ''),
      validation: validateDSL(dsl, db)
    };
  }

  return {
    VERSION: '0.4.0', MOD,
    normalize, findAll, matchTerm, stem, transpile, validateDSL, parseSteps,
    checkDBStructure, assertDB, lintDB,
    estimateTokens, buildSystemPrompt, parseJSONTolerant, extractFirstJSONObject, parseAIResponse
  };
});
