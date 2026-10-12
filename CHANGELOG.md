# Changelog

## 0.4.0 — 2026-10-13

Réorientation : SPC devient un **garde-fou d'intention pour agents**.

### Garde-fou
- `guard.js` : règles de politique appliquées aux **étapes** du DSL (opérateur, paramètres,
  branche d'un conditionnel, validation préalable) et à des mots de la prose ; classes de
  commandes Bash et de fichiers (destructive, déploiement, écriture de données, secrets,
  fichiers d'auth). Ne fait que durcir : `ask` / `deny` / `block`, jamais `allow`.
- `hooks/spc-guard-hook.js` : hook Claude Code `UserPromptSubmit` (lecture de la demande,
  état mémorisé par session, contexte factuel pour l'agent, avertissement pour
  l'utilisateur) et `PreToolUse` (confirmation des commandes). Erreur interne non
  bloquante par défaut, bloquante avec `SPC_GUARD_FAIL_CLOSED=1`.
- `guard.policy.json` + surcharge par projet `.claude/spc-guard.json`, validée au chargement.
- `node guard.js --audit` : relit vos transcripts Claude Code (prompts tapés uniquement)
  et liste ce qui aurait été signalé. `--install` affiche la configuration de hooks.
- Code collé et blocs ``` ignorés (ce ne sont pas des consignes) ; code en ligne conservé.

### Mesure (`GUARD-BENCH.md`)
- Corpus DEV (ajusté) et HOLDOUT (jamais ajusté) écrits avant toute mesure.
- Niveau 1 seul sur HOLDOUT : rappel 59 % — **critère de 95 % non atteint**.
- Bout en bout sur HOLDOUT : 19/20 actions risquées arrêtées (mesure indépendante).

### DSL et données (`rosetta.json` v0.4)
- `FILTER[mode=delete]` distingue la suppression effective de l'exclusion.
- Mise en production en français (« mets en prod », « mise en production », « livre »…).
- **Correction d'un défaut v0.3** : deux phrases conditionnelles jointes par `⟶`
  produisaient un DSL invalide, et `C ? X ⟶ S2` rendait S2 dépendant de C. Les phrases
  sont désormais une instruction par ligne dès qu'un conditionnel est présent
  (grammaire : programme multi-lignes, validé).
- `core.parseSteps()` : lecture structurée d'un DSL en étapes.

## 0.3.0 — 2026-10-13

Corrections issues de l'audit v0.2 (constats R1–R8 ; vérification : `AUDIT-VERIFICATION.md`).

### Aucune perte silencieuse (R1, R5)
- Les conditionnels incomplets ne s'effondrent plus en silence : condition non reconnue →
  action émise **sans garde** + avertissement ; action non reconnue → rien d'émis +
  avertissement. Les avertissements de la condition ne sont plus jetés.
- `transpile()` renvoie `complete` ; le CLI sort en **code 4** quand une partie de la prose
  n'est pas dans le DSL, affiche les avertissements même sans DSL, et l'éditeur affiche
  « INSTRUCTION INCOMPLÈTE ».
- Séparateurs souples `, / et / and` : coupe en `⟶` seulement si chaque partie a son propre
  verbe, distinct, qui n'est pas un paramètre du verbe principal ; une clause sans verbe
  après « et / and » est signalée.
- Phrases (`.`) traitées une par une ; « A, et si C Y » ne place la garde que sur Y ;
  sans « alors », la condition s'arrête au premier verbe d'action.
- Un segment sans verbe après un adverbe de séquence (« ajoute ensuite un système de
  logs ») complète l'étape précédente au lieu d'être ignoré.
- Atténuateurs (« si possible », « if needed ») retirés : ce ne sont pas des gardes.

### Reconnaissance (R2, R3)
- **Racinisation légère FR/EN**, mot à mot (« validation » = « valide », « compilation » =
  « compile », « scanne » = « scan », « refactoring/refactorise » = « refactor »…). Les
  frontières de mots de la v0.2 sont conservées (« use » ≠ « because », « user » ≠ « use »).
- Participes adjectifs (« fichiers générés », « generated files ») et pluriels en -es
  exclus de la lecture comme verbe d'action.
- Classement : un paramètre porté par le mot déclencheur lui-même ne compte plus comme
  preuve (« add tests » → `ADD[…, what=tests]`, plus `VALIDATE`) ; correspondance exacte
  préférée au radical ; position avant priorité.
- Modificateurs et types de sortie : correspondance exacte uniquement (« toutes » n'ajoute
  plus `▲`, « compared » ne produit plus `→ table`).
- `lintDB` détecte les collisions **de radicaux** entre opérateurs (2 trouvées et corrigées :
  `inspect/inspecte`, `active/activates`).

### Conditions négatives (R4)
- Le mot d'échec (« échoue », « fails », « casse ») est masqué pour choisir l'opérateur de
  la garde : « si la validation échoue, déploie » → `VALIDATE[◈] ? ∅ : DEPLOY[◈]` (plus
  `DEBUG`). Avertissement si seul un opérateur de correction reste possible.
- `SPC_SKILL.md` (v1.2) documente les formes émises (`A ? B`, `A ? ∅ : B`, inversion des
  branches pour une condition négative, `X ? ∅ : Y`).

### Données (`rosetta.json` v0.3)
- `ITERATE` : défaut `ITERATE[◈]`, `n` et `op` émis seulement s'ils sont exprimés (R6).
- `ADD.what=tests` ; verbes FR de rédaction pour CREATE ; « summarize » pour COMPRESS ;
  « erreur », « journalisation »… ; retrait de déclencheurs adjectifs (« new », « nouveau »)
  et des marqueurs ambigus (« après », « next », « done », « fini »…).

### Éditeur (R8)
- 44 attributs `style=` remplacés par des classes ; CSP `style-src` hachée, **plus aucun
  `unsafe-inline`** ; `build.js` refuse tout attribut `style=`.

### Mesure (R7)
- `bench.js` : 24 consignes réalistes multi-instructions (FR + EN) avec **rappel** et
  **précision** en plus du ratio : ×1,44 (cl100k), rappel 97 %, précision 91 %.
  Break-even ≈ 270 consignes par session à cause du coût d'amorçage du skill (≈ 4 400 tokens).

### Tests
- 132 tests (`test/residual.test.js` : une assertion par reproduction de l'audit v0.2) ;
  corpus de référence porté à 84 cas.

## 0.2.0 — 2026-10-13

Corrections issues de l'audit technique du 2026-10-12 (détail et vérification :
`AUDIT-VERIFICATION.md`).

### Architecture
- **Noyau unique `core.js`** partagé par le CLI et l'éditeur : transpileur, validateur de
  DSL, contrôle de la BDD, estimateur de tokens, prompt système, parse tolérant des
  réponses de modèles locaux. Plus aucune logique dupliquée (P0-4, P2-4).
- **`rosetta.html` est généré** par `build.js` depuis `src/editor.template.html` +
  `core.js` + `rosetta.json` ; la BDD embarquée ne peut plus diverger (P0-4).
- `SPC_SKILL.md` (section opérateurs) et les chiffres du README sont générés depuis
  `rosetta.json` ; la CI échoue s'ils ne sont pas à jour (P1-10, P2-1).

### Transpileur
- Correspondance **par mots entiers** (pluriel en « s » toléré) : fin des faux positifs
  « use ⊂ because », « port ⊂ support »… (P0-1).
- **Raccourci le plus long** gagnant (P0-2).
- Choix d'opérateur **indépendant de l'ordre du tableau** : locution multi-mots >
  paramètres reconnus > longueur > `priority` > position (P0-3).
- Arguments émis **génériquement** depuis `default` + `params` (+ `bind`), plus de liste
  codée en dur : FIND/CREATE/ADD/ITERATE reçoivent enfin `type`, `what`, `n`, `op`… (P0-4).
- **Multi-instructions** : `⟶` (puis / then / ; …), `A ? B : C` et `A ? ∅ : C`
  (si / sinon, conditions négatives), `⌒` sur le pointeur de skill, `→ §N` numérotés,
  « stocke le résultat » rattaché à l'étape précédente (P0-7).
- `normalize()` unifie réellement les apostrophes typographiques (l'ancienne regex
  remplaçait `'` par `'`).

### Base de règles (`rosetta.json` v0.2)
- 11 déclencheurs partagés entre opérateurs supprimés à la source, 3 doublons internes
  retirés ; la CI interdit toute nouvelle collision (P0-3, P2-4).
- Énumérations complétées pour que **les 170 raccourcis soient conformes** :
  `VALIDATE.scope=error`, `EXPAND.ctx`, `TRANSDUIT.from/to`, `APPLY.skill=@convention`
  (P0-6, P1-10).
- Raccourcis corrigés : `optimize for performance` (paramètre `focus` invalide sur ANALYZE),
  `never ignore errors` (`null` → `∅`).
- Champs ajoutés par opérateur : `tier`, `priority`, `signature`, `summary`, `notes`,
  `bind` ; `modifier_effects` au niveau racine (P2-4).
- Déclencheurs FR ajoutés pour FIND, CREATE, ADD ; symptômes pour DEBUG.
- Types de sortie : retrait des noms communs seuls (« code », « liste », « tableau »,
  « court ») qui produisaient de faux `→ TYPE` ; `store` ne réagit plus à « log ».

### Grammaire DSL / skill (v1.1)
- Grammaire formelle et validateur `core.validateDSL()`.
- Ajout de `∅` (branche vide) ; `A | B` retiré ; sémantique des ancres `§N` définie ;
  `↻N` documenté comme forme d'interpréteur uniquement (P1-10).

### CLI
- Parseur d'arguments explicite : les nombres sont conservés, `--port` validé,
  `--model`, `--json`, `--help`, `--`, options inconnues refusées (P1-1, P1-2, P1-3).
- Plus de blocage sur stdin vide en terminal ; codes de sortie documentés.
- `rosetta.json` absent/invalide → message clair, code 2 (P1-7).
- `--ai` : raccourci prioritaire (comme l'éditeur), réponse réparée et validée,
  messages non liés à Gemma.

### Éditeur
- **XSS corrigée** : plus aucun gestionnaire inline ; `data-*` + délégation ; CSP par
  empreintes SHA-256 interdisant tout script non prévu (P0-5).
- Persistance versionnée `{version, db}`, bandeau de mise à jour, bouton
  **Réinitialiser**, erreurs de quota/stockage signalées (P1-5).
- Import validé avant adoption ; la base courante est conservée en cas d'erreur (P1-6).
- `.spinner` défini ; polices système, **zéro requête externe** (P1-9).
- DSL non conformes signalés (⚠) dans la liste, le testeur et l'onglet IA.
- Navigation au clavier (boutons), libellés ARIA, badge de modèles dérivé, URL blob
  révoquée (P2-4).

### Mesure
- Tokens toujours estimés localement (jamais les chiffres annoncés par le modèle) ;
  estimateur calibré sur cl100k, erreur moyenne ≈ 11 % (P1-4).
- `bench.js` / `BENCH.md` : mesure avec cl100k et o200k. **Résultat : le DSL est plus
  long que la prose sur ce corpus** (×0,26 sur les raccourcis) ; README corrigé.

### Outillage
- `package.json` (bin `rosetta`, engines ≥ 18, GPL-3.0), `.gitignore`, tests `node:test`
  (corpus de référence, CLI, données, éditeur), test navigateur Playwright optionnel,
  CI GitHub Actions (Node 18/20/22) (P2-2).
- `SPC_SKILL.zip` supprimé : arborescence plate (P2-3).

## 0.1 — 2026-05

Version initiale.
