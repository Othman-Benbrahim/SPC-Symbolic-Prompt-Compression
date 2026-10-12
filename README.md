# SPC — Symbolic Prompt Compression

> Un garde-fou d'intention pour agents : SPC lit localement ce qu'une demande va faire
> faire à l'agent (déployer, supprimer, toucher à l'authentification…) et exige une
> confirmation avant les commandes risquées. Il repose sur un DSL symbolique vérifiable
> et une Pierre de Rosette locale (prose → DSL, zéro token cloud).

*English summary at the end.*

---

## Concept

SPC a d'abord été conçu pour compresser les consignes envoyées à un LLM. Mesure faite,
il ne fait pas économiser de tokens en pratique (voir [Performance mesurée](#performance-mesurée)).
Ce qu'il sait faire de rare : **lire une demande de façon déterministe, sans IA et hors
cloud, en disant ce qu'il n'a pas compris**. C'est la base d'un garde-fou.

```
Demande de l'utilisateur
      ↓  niveau 1 — la Pierre de Rosette lit la demande → DSL → règles
      │           (prévient l'utilisateur et l'agent, peut bloquer)
Agent (Claude Code)
      ↓  niveau 2 — chaque commande Bash / écriture de fichier est classée
      │           (destructive, déploiement, secrets, fichiers d'auth) → confirmation
Exécution
```

Le niveau 2 est celui qui protège : il ne dépend pas de la compréhension de la prose.
Le niveau 1 la durcit (un `./deploy.sh` anodin demande confirmation si la demande parlait
de production) et explique à l'agent ce qui a été relevé. Le garde-fou ne fait que
**durcir** : il peut demander une confirmation ou bloquer, jamais autoriser à votre place.

---

## Garde-fou pour Claude Code

### Installation

```bash
node guard.js --install     # affiche le bloc à copier dans ~/.claude/settings.json
```

Le bloc branche `hooks/spc-guard-hook.js` sur deux événements Claude Code :
`UserPromptSubmit` (lecture de la demande) et `PreToolUse` pour `Bash|Edit|Write|MultiEdit|NotebookEdit`
(arrêt des commandes). Aucune dépendance, ≈ 50 ms par commande, < 1 s pour une demande de 18 Ko.
En cas d'erreur interne, le hook n'empêche rien (erreur non bloquante) ; `SPC_GUARD_FAIL_CLOSED=1`
(ou `"onFailure": "block"` dans la configuration du hook) le rend bloquant.

### Ce qu'il fait par défaut (`guard.policy.json`)

| Règle (niveau 1, sur le DSL) | Exemple | Effet |
|---|---|---|
| `deploy-prod` | « mets en prod la v2 » → `DEPLOY[◈, env=prod]` | confirmation sur les commandes de déploiement |
| `deploy-on-failure` | « valide les tests sinon déploie » → `VALIDATE … ? ∅ : DEPLOY …` | idem |
| `deploy-unvalidated` | « deploy to staging » sans `VALIDATE` avant | note pour l'agent |
| `destructive` | « supprime le dossier dist » → `FILTER[◈, mode=delete]` | confirmation sur les commandes destructives et d'écriture de données |
| `auth-change` | « add JWT authentication » | confirmation sur les fichiers d'auth |

| Classe de commandes (niveau 2) | Exemples | Toujours active ? |
|---|---|---|
| `destructive` | `rm -rf`, `git reset --hard`, `git push --force`, `git push --delete`, `DROP/TRUNCATE`, `terraform destroy` | oui |
| `deploy` | `git push`, `vercel`, `npm publish`, `kubectl apply`, `deploy.sh` | si la commande vise la prod (`--prod`, `main`, `production`) ou si la demande l'a signalé |
| `data-write` | `DELETE FROM`, `UPDATE … SET`, `ALTER TABLE` | si la demande est destructive |
| `secrets` | écriture dans `.env`, `*.pem`, `credentials` | oui |
| `auth-files` | écriture dans un fichier `*auth*`, `*login*`, `*jwt*`, `*permission*` | oui |

Politique propre à un projet : copier `guard.policy.json` vers `<projet>/.claude/spc-guard.json`
et l'adapter (action `block` pour refuser une demande, `deny` pour refuser une commande,
mots, opérateurs, motifs). `node guard.js "demande"` et `node guard.js --command "cmd"` montrent
la décision sans passer par Claude Code.

### Ce qui est mesuré (`npm run guard:bench`, détail : [GUARD-BENCH.md](GUARD-BENCH.md))

| Mesure | Résultat |
|---|---|
| Niveau 1 seul, corpus de contrôle jamais ajusté (22 intentions risquées) | **rappel 59 %** — critère fixé à 95 % **non atteint** |
| Niveau 1, fausses alertes sur demandes bénignes (contrôle) | 0 / 10 |
| Niveau 2, commandes (21 risquées, 9 anodines) | 21 / 21 détectées, 0 fausse alerte |
| Bout en bout (la commande risquée est-elle arrêtée ?), contrôle | **19 / 20** mesure indépendante (20/20 après un correctif fait en voyant l'échec) |

Lecture honnête : **la lecture de la prose ne suffit pas à protéger seule** — elle rate
les formulations qu'elle n'a jamais vues (« vire les fichiers », « get rid of »,
« implement OAuth »). La protection tient parce que le niveau 2 regarde les commandes.
Le corpus est petit et annoté par l'auteur : **la vraie mesure se fait sur vos sessions** :

```bash
node guard.js --audit ~/.claude/projects    # lit vos transcripts, liste ce qui aurait été signalé
```

### Limites

- Une action risquée qui ne passe ni par une commande reconnue ni par un fichier sensible
  (un script maison au nom anodin, un appel d'API via MCP) n'est arrêtée que si la
  demande a été lue correctement.
- Les motifs de commandes sont des expressions régulières : une commande obscurcie
  (`eval`, variables) leur échappe. Ce n'est pas un bac à sable.
- La confirmation est celle de Claude Code : elle protège contre l'erreur et
  l'emballement de l'agent, pas contre un utilisateur qui valide sans lire.

---

## Le DSL et la Pierre de Rosette

Le reste de ce document décrit le socle : le DSL, sa base de règles, le CLI `rosetta.js`,
l'éditeur et le skill d'exécution. Ils restent utilisables seuls (normaliser une consigne,
la vérifier, l'envoyer à un agent), mais ce n'est plus l'usage principal.

## Architecture

```
spc/
├── README.md                ← ce fichier
├── SPC_SKILL.md             ← skill Claude (interpréteur DSL) — section opérateurs générée
├── rosetta.json             ← base de règles : SOURCE UNIQUE du vocabulaire
├── core.js                  ← noyau partagé : transpileur, validateur, estimateur de tokens
├── rosetta.js               ← CLI (Node.js, zéro dépendance)
├── rosetta.html             ← éditeur visuel autonome — GÉNÉRÉ par build.js
├── src/editor.template.html ← gabarit de l'éditeur (à éditer à la place de rosetta.html)
├── build.js                 ← génère rosetta.html + sections dérivées des docs
├── validate.js              ← contrôle de schéma (raccourcis, défauts, docs synchronisées)
├── guard.js                 ← garde-fou : règles sur le DSL, classes de commandes, audit, mesure
├── guard.policy.json        ← politique par défaut du garde-fou
├── hooks/spc-guard-hook.js  ← hook Claude Code (UserPromptSubmit + PreToolUse)
├── GUARD-BENCH.md           ← mesure du garde-fou (rappel, fausses alertes, bout en bout)
├── bench.js / BENCH.md      ← benchmark tokens reproductible
├── test/                    ← tests node:test (+ test navigateur optionnel)
└── .github/workflows/ci.yml ← CI : tests, validation, fichiers générés à jour
```

| Fichier | Rôle | IA ? | Tokens cloud |
|---------|------|------|-------------|
| `guard.js` + hook | Garde-fou d'intention (lecture de la demande + arrêt des commandes) | Non | 0 |
| `rosetta.json` | Opérateurs, raccourcis, modificateurs, types de sortie | Non | 0 |
| `core.js` | Logique unique partagée par le CLI et l'éditeur | Non | 0 |
| `rosetta.js` | Transpilation prose → DSL en ligne de commande | Optionnel (local) | 0 |
| `rosetta.html` | Éditeur visuel + test + IA locale (LM Studio) | Optionnel (local) | 0 |
| `SPC_SKILL.md` | Interprétation et exécution du DSL par Claude | Oui | ≈ 4 400 (amorçage, cl100k — voir BENCH.md) |

Le CLI et l'éditeur exécutent **le même code** (`core.js`) sur **la même base**
(`rosetta.json`) : `build.js` les inline dans `rosetta.html`, et un test vérifie qu'ils
ne divergent pas.

---

## Installation

**Prérequis :** Node.js ≥ 18. Le CLI n'a aucune dépendance.

```bash
git clone https://github.com/Othman-Benbrahim/SPC-Symbolic-Prompt-Compression spc && cd spc
node rosetta.js "analyze this code in depth"

# Développement (tests, benchmark)
npm install        # installe gpt-tokenizer (dev, pour bench.js uniquement)
npm test
```

**Intégration Claude Code :** placer `SPC_SKILL.md` dans le dossier `skills/` du projet.

---

## Utilisation

### 1 — CLI

```bash
# Mode règles (zéro IA, instantané)
node rosetta.js "create a new react component"
node rosetta.js "find all usages of this function"
node rosetta.js "analyse le code puis compresse le résultat"
node rosetta.js corrige le bug 404          # les nombres sont conservés

# Mode IA locale via LM Studio (localhost uniquement)
node rosetta.js --ai "refactor this into smaller functions"
node rosetta.js --ai --port 1234 --model qwen2.5-coder-7b-instruct "..."

# Stdin, sortie JSON (dsl, source, tokens estimés, avertissements, validation)
echo "validate all tests then deploy to staging" | node rosetta.js --json
```

| Option | Effet |
|--------|-------|
| `--ai` | IA locale (les raccourcis restent prioritaires ; repli sur les règles si LM Studio est indisponible) |
| `--port <N>` | Port LM Studio (1–65535, défaut 1234) |
| `--model <id>` | Modèle LM Studio (défaut `google/gemma-3-4b`) |
| `--json` | Sortie machine |
| `-h`, `--help` | Aide |

Codes de sortie : `0` OK · `1` usage · `2` base de règles illisible ou invalide · `3` aucun opérateur reconnu
· `4` DSL produit mais **incomplet** (une partie de la prose n'a pas pu être encodée ; les avertissements disent laquelle).

### 2 — Éditeur visuel

Ouvrir `rosetta.html` dans un navigateur (fichier unique, aucune requête réseau hors LM Studio).

```bash
# Si CORS bloque l'onglet IA locale en file://
python -m http.server 8080
# → http://localhost:8080/rosetta.html
```

L'éditeur permet de naviguer et enrichir les raccourcis, opérateurs et modificateurs,
tester une phrase (même moteur que le CLI), traduire via IA locale, importer / exporter
`rosetta.json` et revenir à la base embarquée (**⟲ Réinitialiser**). Les DSL non conformes
au schéma sont signalés par ⚠. Les modifications sont conservées dans le navigateur ;
si la base embarquée change de version, un bandeau propose de la charger.

> Pour modifier l'éditeur : éditer `src/editor.template.html`, puis `node build.js`.

### 3 — Envoyer le DSL à Claude

```
> CREATE[◈, type=component, from=scratch] ⟶ VALIDATE[◈, scope=types]
> FIND[input=*, type=usage, pattern=◈]
> VALIDATE[*, scope=tests] ? ⊜ : DEBUG[*, focus=error]
```

---

## Le DSL SPC

### Syntaxe

```
OPÉRATEUR[arg, param=valeur, ...]      instruction simple
OPÉRATEUR[...] → TYPE | → §N           format de sortie | stockage dans une ancre
A ⟶ B                                  pipe : A puis B
A ? B : C   /   A ? B                  conditionnel
⊜   ∅                                  clôture de session | branche vide
@skill::module⌒                        pointeur de skill (lazy load)
OPÉRATEUR[◈]↻N                         itération courte (interpréteur uniquement)
```

La grammaire formelle, la sémantique des ancres `§N` et la liste des opérateurs sont dans
`SPC_SKILL.md`. `core.validateDSL()` vérifie un DSL contre la grammaire et les
énumérations de `rosetta.json`.

### Les 17 opérateurs

| Tier | Opérateurs |
|------|-----------|
| Cognitif | `SCAN` · `ANALYZE` · `COMPARE` · `FIND` |
| Transformatif | `RESONE` · `TRANSDUIT` · `COMPRESS` |
| Création | `CREATE` · `ADD` · `CLONE` |
| Flux | `APPLY` · `EXPAND` · `FILTER` · `ITERATE` |
| Validation & déploiement | `VALIDATE` · `DEBUG` · `DEPLOY` |

### Symboles

| Symbole | Nom | Sens |
|---------|-----|------|
| `◈` | FOCUS | Input courant |
| `§N` | ANCRE | Registre nommé (`→ §N` écrit, `§N` lit) |
| `?` | BIFURQUE | Conditionnel |
| `*` | TOUT | Wildcard |
| `▲` | MAX | Profondeur ou ratio maximum |
| `⊘` | NEG | Exclusion (`⊘x` = `drop=[x]`) |
| `↻` | CYCLE | Itération courte |
| `⟶` | PIPE | Séquence |
| `⊜` | SCELLER | Clôture et archive de session |
| `◊` | TRACE | Output précédent |
| `⌒` | PLIER | Lazy load |
| `∅` | VIDE | Ne rien faire (branche de conditionnel) |

---

## La Pierre de Rosette

<!-- BEGIN:STATS (généré depuis rosetta.json par build.js) -->
- **17 opérateurs** avec leurs déclencheurs FR/EN, paramètres, signature et priorité
- **170 raccourcis** — phrases fréquentes avec leur DSL exact (tous validés contre le schéma)
- **7 modificateurs** — mots qui affectent la forme du DSL produit
- **6 types de sortie** — formats reconnus après `→`
- **327 déclencheurs d'opérateurs** au total, sans collision entre opérateurs
- Version des règles : `0.4`
<!-- END:STATS -->

Une partie des déclencheurs anglais provient de l'analyse de fichiers de règles
communautaires ([PatrickJS/awesome-cursorrules](https://github.com/PatrickJS/awesome-cursorrules)).

### Comment la prose est lue (mode règles)

1. **Raccourcis** : la phrase connue **la plus longue** contenue dans l'entrée gagne.
2. **Structure** : phrases (`.`), conditionnels `si … (alors) … sinon …` (→ `A ? B`,
   `A ? B : C`, `A ? ∅ : C` — voir « Conditionnels émis » dans `SPC_SKILL.md`), pipes
   `puis / then / ensuite / ;…` (→ `⟶`), puis séparateurs souples `, / et / and` : coupe
   seulement si chaque partie a son propre verbe (« compile et rédige le rapport » →
   `DEPLOY ⟶ CREATE`, mais « copie et adapte » reste `CLONE[adapt=oui]`). Lazy-load (→ `⌒`),
   stockage (→ `§N`), clôture (→ `⊜`). Les atténuateurs (« si possible », « if needed »)
   ne sont pas des conditions.
3. **Opérateur** de chaque segment : correspondance **par mots entiers**, puis **par
   radicaux** (racinisation FR/EN légère, mot à mot : « validation » = « valide »,
   « scanne » = « scan », « refactoring » = « refactor » ; « use » ne matche toujours pas
   « because », et un participe adjectif comme « fichiers générés » n'est pas un verbe).
   Départage : locution multi-mots > paramètres reconnus hors du mot déclencheur >
   correspondance exacte > déclencheur le plus long > position > `priority`. L'ordre du
   tableau `operators` n'a pas d'effet.
4. **Arguments** : partent du `default` de l'opérateur, puis chaque paramètre détecté est
   émis (`bind` permet d'émettre un paramètre sous un autre nom, ex. `ADD.scope → target`).
   Aucune valeur n'est inventée : `ITERATE` n'a ni `n` ni `op` s'ils ne sont pas exprimés.
5. **Rien n'est perdu en silence** : segment ignoré, condition ou action non reconnue,
   clause sans verbe après « et » → avertissement ; `complete: false` et code de sortie 4
   quand une partie de la prose manque au DSL.

### Enrichir la BDD

**Via l'éditeur :** `+ Ajouter` / `+ mot`, puis `↓ Exporter JSON` et remplacer `rosetta.json`.

**Via le JSON :** éditer `rosetta.json`, puis :

```bash
node validate.js   # schéma, collisions de déclencheurs, raccourcis conformes
node build.js      # régénère rosetta.html et les sections dérivées des docs
npm test
```

Un nouvel opérateur demande `id`, `tier`, `priority`, `signature`, `summary`,
`triggers`, `default` et `params` (énumérations `valeur → [déclencheurs]`).

**Règle de langue :** les raccourcis techniques sont en anglais ; ceux liés aux skills
symboliques personnels restent en français. Les opérateurs ont des déclencheurs FR et EN.

---

## IA locale (LM Studio)

**Ordre de résolution (CLI `--ai` et éditeur) :**

```
1. Raccourci de la BDD  → réponse immédiate, IA non consultée
2. IA locale            → DSL validé contre le schéma, écarts signalés
3. Règles               → repli si l'IA est indisponible ou répond mal
```

Le prompt système est dérivé de `rosetta.json` (opérateurs, signatures, valeurs admises),
la réponse est réparée si besoin (fences, guillemets typographiques, clés non citées,
prose autour). Les comptes de tokens affichés sont **toujours calculés localement** —
le modèle n'est plus invité à les inventer.

- URL par défaut : `http://localhost:1234`, endpoint `/v1/chat/completions`
- Modèles prévus : Gemma 3 4B · Mistral Nemo · Qwen2.5-Coder 7B (ou tout identifiant)
- L'éditeur n'autorise (CSP) que des connexions vers `localhost` / `127.0.0.1`.
  Pour un LM Studio sur une autre machine, adapter `connect-src` dans `build.js`.

---

## Performance mesurée

`npm run bench` (détail : [BENCH.md](BENCH.md)) — tokenizers BPE publics cl100k / o200k ;
celui de Claude n'est pas public, les chiffres sont donc indicatifs.

| Corpus | Σ prose | Σ DSL | ratio prose/DSL (cl100k) | Fidélité |
|---|---:|---:|---:|---|
| 24 consignes réalistes multi-instructions (FR + EN) | 1 271 | 893 | **×1,42** (o200k ×1,25) | rappel **97 %**, précision **91 %**, 22/24 complètes |
| 82 phrases courtes du corpus de test (→ règles) | 526 | 1 018 | **×0,52** | — |
| 170 raccourcis (phrase → DSL) | 619 | 2 356 | **×0,26** | — |

- **Phrases courtes** (3–8 mots) : le DSL est 2 à 4× **plus long** que la prose (crochets,
  `param=valeur`, symboles Unicode à 2–3 tokens). C'est structurel, pas un bug.
- **Consignes réalistes** (35–50 mots, 2–4 instructions) : le DSL est plus court, et il
  conserve 97 % des instructions attendues (annotation manuelle publiée dans
  `test/realistic.js`, à contester). Les cas perdus ou douteux sont **signalés**.
- **Coût d'amorçage du skill** : ≈ 4 400 tokens (cl100k), en hausse (2 600 en v0.1, 3 700
  en v0.2) parce que les énumérations complètes et la sémantique des conditionnels y sont
  documentées. Avec un gain moyen de ≈ 16 tokens par consigne réaliste, le break-even est
  vers **280 consignes par session** : en pratique, SPC n'économise pas de tokens.

**Conséquence :** la promesse « ×13 / break-even à 20 instructions » de la v0.1 n'était
adossée à aucune mesure et reste infirmée. L'intérêt actuel de SPC est d'encoder une
intention **sans ambiguïté et de façon vérifiable** pour un LLM exécutant. Pistes pour une
vraie économie : skill d'amorçage minimal chargé par opérateur (lazy load réel), symboles
ASCII, paramètres positionnels, valeurs par défaut implicites.

---

## Limites connues

- **Mode règles = lecture de surface.** Il reconnaît des verbes et des locutions ; il ne
  comprend pas la phrase. Les instructions longues ou ambiguës sont mieux servies par `--ai`.
- **Conditionnels :** reconnus pour les formes `si … (alors) … sinon …`, `X si C`,
  `X sinon Y`, `A, et si C Y` et leurs équivalents anglais. Une condition sans opérateur
  reconnaissable (« si tout est vert ») est **signalée** : l'action est émise sans garde
  et le CLI sort en code 4.
- **Racinisation :** volontairement légère (suffixes FR/EN). Un nom d'agent anglais
  (« compiler ») peut encore être lu comme un verbe ; un nom comme « recherche » peut
  déclencher FIND. Ce sont les opérateurs parasites mesurés dans BENCH.md (précision 91 %).
- **IA locale et CORS :** l'onglet IA locale peut être bloqué en `file://` →
  `python -m http.server 8080`.
- **Couverture :** les opérations non couvertes (RENAME, REVERT, MOCK…) sont à ajouter
  selon les besoins rencontrés.
- **Estimation de tokens :** `estimateTokens()` est une heuristique calibrée sur cl100k
  (écart mesuré dans BENCH.md) ; pour des chiffres exacts, utiliser `bench.js`.

---

## Développement

```bash
npm test             # tests unitaires, CLI, données, éditeur (statique)
npm run check        # fichiers générés à jour + validation du schéma (utilisé en CI)
npm run test:e2e     # test navigateur de l'éditeur (nécessite Playwright, optionnel)
npm run bench        # benchmark tokens
npm run guard:bench  # mesure du garde-fou
```

Voir [CHANGELOG.md](CHANGELOG.md) pour le détail des corrections et [AUDIT-VERIFICATION.md](AUDIT-VERIFICATION.md) pour la vérification des deux audits (v0.1 et v0.2).

---

## Roadmap

```
Phase 1 — Fondations ✓
  Cadre conceptuel · 17 opérateurs · couche opérationnelle STÈLE

Phase 2 — Tests (en cours)
  ✓ Tests unitaires, CLI, schéma, CI · ✓ Benchmark tokens (cl100k / o200k)
  ✓ Fidélité de transpilation (rappel / précision sur consignes réalistes)
  P2 Fidélité d'exécution · P3 Résonance latente · P4 Comparaison A/B · P5 Dégradation

Phase 3 — Formalisation ✓
  SPC_SKILL.md · rosetta.json · core.js · rosetta.js · rosetta.html · grammaire validée

Phase 5 — Garde-fou d'intention (v0.4) ✓
  Hook Claude Code à deux niveaux · politique JSON · mesure sur corpus de contrôle
  À faire : mesurer sur de vraies sessions (guard.js --audit), étendre les classes de commandes

Phase 4 — Publication (à venir)
  Repository GitHub public · benchmark public · documentation étendue
```

---

## Connexion aux travaux existants

SPC s'inscrit dans un écosystème de skills symboliques. Dépendances d'interface :

| Élément SPC | Dépend de | Nature du lien |
|-------------|-----------|----------------|
| `RESONE[layers=…]` | Métalangage des Résonances | Les couches (sémantique, émotionnel, symbolique, narratif) sont celles de ce skill |
| `TRANSDUIT`, `COMPRESS[format=STÈLE]`, sortie `STÈLE` / `signature` | STÈLE | Alphabet de 25 primitives ; l'exécution suppose le skill STÈLE chargé |
| `TRANSDUIT` (origine) | LÉR | Instruction LÉR reprise comme opérateur |
| `APPLY[@stele / @fractales / @metalangage / @ler]` | Skills correspondants | Pointeurs ; sans le skill, Claude doit signaler son absence |

Ces skills ne sont pas inclus ici et ne sont pas versionnés avec SPC : les opérateurs
correspondants ne sont exécutables que si le skill visé est disponible.

---

## Licence

**GPL-3.0** — s'applique à tout le dépôt, y compris `rosetta.json` (la base de règles) et
`SPC_SKILL.md`. Intégrer ces fichiers dans un pipeline distribué implique de respecter le
copyleft (distribution des sources sous la même licence). Texte complet : `LICENSE`.

---

## Auteur

**Othman BEN BRAHIM**
[github.com/Othman-Benbrahim](https://github.com/Othman-Benbrahim)

---

## English summary

SPC is now primarily an **intent guard for coding agents**: a Claude Code hook reads each
request locally (no LLM, no cloud), flags risky intents (production deploy, deletion, auth
changes) and makes Claude Code ask for confirmation before the matching Bash commands or file
writes; a second, command-level layer stops destructive or production commands regardless of
how the request was phrased. Measured honestly: the prose reader alone catches 59 % of risky
intents on a held-out set (target 95 % not met); end to end, 19/20 risky actions are stopped
(see GUARD-BENCH.md). Install with `node guard.js --install`.

Underneath, SPC is a small symbolic DSL for LLM instructions (17 operators such as `ANALYZE`,
`FIND`, `VALIDATE`; pipes `⟶`; conditionals `A ? B : C`), a local "Rosetta Stone" that
translates French/English prose into that DSL without any cloud call (rule-based, or via a
local model in LM Studio), and a Claude skill (`SPC_SKILL.md`) that executes it.

- `node rosetta.js "find all usages of this function"` → `FIND[input=*, type=usage, pattern=◈]`
- `rosetta.html` is a self-contained editor for the rule base (`rosetta.json`) built from
  the same core (`core.js`) as the CLI.
- Every shortcut and generated DSL is validated against the operator schemas.
- Measured with public BPE tokenizers: on short phrases the DSL is 2–4× *longer* than the
  prose; on realistic multi-instruction prompts it is ≈1.4× shorter with 97 % instruction
  recall, but the ≈4.4k-token skill prompt pushes break-even to ~280 prompts per session
  (see BENCH.md). The value today is unambiguous, verifiable intent encoding, and any part
  of the prose that could not be encoded is reported (`complete: false`, exit code 4).
- License: GPL-3.0 (covers the rule base and the skill too).

---

*SPC v0.4 — règles v0.4 · grammaire v0.4 · skill v1.2 · garde-fou v1*
