---
name: spc
version: 1.2
description: >
  SPC — Symbolic Prompt Compression. Interprète et exécute les instructions
  en DSL SPC générées par la Pierre de Rosette (rosetta.js / rosetta.html).
  Déclencher dès que le message contient un ou plusieurs opérateurs SPC en
  majuscules (SCAN, ANALYZE, CREATE, ADD, FIND, DEBUG, DEPLOY, VALIDATE, CLONE,
  COMPARE, RESONE, TRANSDUIT, COMPRESS, APPLY, EXPAND, FILTER, ITERATE)
  ou les symboles ◈ § ⊜ ⟶ ▲ ⊘ ↻ ◊ ⌒ ∅.
  Ne pas déclencher sur du langage naturel pur — utiliser la Pierre de Rosette
  pour générer le DSL d'abord.
workflow: rosetta.js → DSL → Claude + SPC skill → output
---

# SPC — Interpréteur DSL

## Rôle

Recevoir des instructions compressées en DSL SPC, les interpréter, les exécuter.
L'utilisateur ne rédige pas le DSL manuellement — il est produit par la Pierre de
Rosette (outil local, zéro token). Ce skill est le moteur d'exécution côté Claude.

Source de vérité du vocabulaire (opérateurs, paramètres, valeurs) : `rosetta.json`.
La section « opérateurs » ci-dessous en est générée (`node build.js`) et vérifiée en CI.

---

## Syntaxe DSL (grammaire v0.3)

```
OPÉRATEUR[arg, param=valeur, ...]      instruction simple
OPÉRATEUR[...] → TYPE                  avec format de sortie
OPÉRATEUR[...] → §N                    stocke le résultat dans l'ancre N
A ⟶ B                                  pipe séquentiel (A puis B)
A ? B : C                              conditionnel (si A réussit → B, sinon C)
A ? B                                  conditionnel sans branche sinon
⊜                                      instruction seule : clôture et archive la session
∅                                      branche vide : ne rien faire
@skill⌒  /  @skill::module⌒            déclaration de skill en lazy load (en tête)
OPÉRATEUR[◈]↻N                         forme courte de ITERATE (interpréteur uniquement)
```

- `?` lie moins fort que `⟶` : dans `A ? B ⟶ C : D`, la branche vraie est `B ⟶ C`.
- Plusieurs instructions peuvent se suivre, **une par ligne**, exécutées dans l'ordre :
  la Pierre de Rosette passe à la ligne dès qu'une phrase contient un conditionnel.
- Un paramètre nommé appartient à la signature de l'opérateur ; s'il a une
  énumération (listée ci-dessous), sa valeur en fait partie. Grammaire formelle : `core.js`.
- `A | B` (ancien alias de `⟶`) est **retiré** de la grammaire.

---

<!-- BEGIN:OPERATORS (généré depuis rosetta.json par build.js — ne pas éditer à la main) -->
## Les 17 opérateurs

### Tier Cognitif

**SCAN**`[input, focus]`
Lecture rapide. Détecte les patterns sans décomposition profonde.
- `focus` : `surface` · `structure` · `anomalies` · `security` · `tests`
- Sortie par défaut : liste de tags

**ANALYZE**`[input, ctx, depth]`
Décomposition profonde selon un registre et une profondeur.
- `ctx` : `technique` · `symbolique` · `narratif` · `rationnel`
- `depth` : `1` · `2` · `3`
- 1 = surface · 2 = standard · 3 = profond (`depth=3` équivaut à `▲`)

**COMPARE**`[a, b, dims]`
Contraste deux éléments sur des dimensions définies.
- `dims` : liste libre de dimensions de comparaison
- Sortie par défaut : table ou delta
- `b=§1` par défaut : si l'ancre §1 est vide, utiliser `◊` (output précédent)

**FIND**`[input, pattern, scope, type]`
Recherche dans la base de code.
- `scope` : `*` · `file` · `function`
- `type` : `usage` · `pattern` · `import` · `definition`

### Tier Transformatif

**RESONE**`[target, layers]`
Active les couches résonantes. Hérité du Métalangage des Résonances.
- `layers` : `sémantique` · `émotionnel` · `symbolique` · `narratif` · `all`

**TRANSDUIT**`[input, from, to]`
Change de registre ou de format.
- `from` : `technique` · `symbolique` · `prose` · `rationnel` · `narratif` · `current` · `verbose` · `generic` · `oop` · `complex` · `inline` · `slow` · `monolithic`
- `to` : `STÈLE` · `symbolique` · `prose` · `SPC` · `narratif` · `clean` · `minimal` · `idiomatic` · `functional` · `readable` · `module` · `modular` · `optimized` · `new`
- `current` / `new` : valeurs génériques (état actuel / nouvel état), sans déclencheur

**COMPRESS**`[input, format, ratio]`
Réduit à signature minimale.
- `format` : `STÈLE` · `SPC`
- `ratio` : `max` · `balanced` · `light`

### Tier Création

**CREATE**`[target, type, from]`
Génère depuis zéro.
- `type` : `component` · `function` · `api` · `schema` · `test` · `config`
- `from` : `scratch` · `template`

**ADD**`[target, what, scope]`
Injecte dans de l'existant.
- `what` : `feature` · `error-handling` · `logging` · `validation` · `pagination` · `auth` · `field` · `tests`
- `scope` : `*` · `◈`
- La Pierre de Rosette émet `scope` dans `target` (`target=*` ou `target=◈`)

**CLONE**`[source, target, adapt, scope]`
Copie et adapte un pattern existant.
- `adapt` : `oui` · `non`
- `scope` : `composant` · `fonction` · `structure`

### Tier Flux

**APPLY**`[skill, input, mode]`
Invoque un skill ou une convention par pointeur.
- `skill` : `@stele` · `@fractales` · `@metalangage` · `@ler` · `@convention`
- `skill` : `@nom` ou `@nom::sous-module` (ex. `@convention::clean-code`) ; suffixe `⌒` = lazy load

**EXPAND**`[seed, ctx, depth]`
Déploie une graine compressée vers un output étendu.
- `ctx` : `docs` · `jsdoc` · `git` · `changelog` · `structure` · `explicit`
- `seed` : chaîne STÈLE · référence `§N` · `◈`

**FILTER**`[input, keep, drop, mode]`
Sélectionne ou exclut selon des critères.
- `mode` : `delete`
- `⊘x` en position libre équivaut à `drop=[x]` (ex. `FILTER[◈, ⊘deprecated]`)
- `mode=delete` : suppression effective (fichiers, données, historique), par opposition à une simple exclusion

**ITERATE**`[op, n, var]`
Exécute un opérateur N fois avec variation d'un paramètre.
- Sortie : stack ordonné des résultats
- `op` et `n` ne sont émis que s'ils sont exprimés : `op` absent → l'opérateur précédent du pipe, sinon demander ; `n` absent → une passe par élément de `◈`
- Forme courte `OP[◈]↻N` acceptée par l'interpréteur ; la Pierre de Rosette émet toujours la forme longue

### Tier Validation & Déploiement

**VALIDATE**`[input, scope]`
Vérifie la conformité.
- `scope` : `types` · `tests` · `security` · `schema` · `error`

**DEBUG**`[input, focus]`
Diagnostique et corrige.
- `focus` : `error` · `performance` · `logic`

**DEPLOY**`[input, env]`
Build et déploie.
- `env` : `prod` · `staging` · `dev`
<!-- END:OPERATORS -->

---

## Symboles interface

| Symbole | Nom | Résolution |
|---------|-----|-----------|
| `◈` | FOCUS | Input courant — objet d'attention du message |
| `§N` | ANCRE | Registre nommé N (voir « Ancres ») |
| `?` | BIFURQUE | Conditionnel — `A ? B : C` |
| `*` | TOUT | Wildcard — tous les éléments de l'ensemble |
| `▲` | MAX | Profondeur ou ratio maximum |
| `⊘` | NEG | Exclusion — `⊘x` équivaut à `drop=[x]` |
| `↻` | CYCLE | Forme courte d'ITERATE — `OP[◈]↻N` |
| `⟶` | PIPE | Séquence — passe l'output à l'opérateur suivant |
| `⊜` | SCELLER | Clôture et archive la session |
| `◊` | TRACE | État ou output de l'échange précédent |
| `⌒` | PLIER | Lazy load — charge le skill à l'usage seulement |
| `∅` | VIDE | Branche sans action (« ne rien faire ») |

### Ancres `§N`

- Un registre global par session, indexé par entier N ≥ 1.
- `→ §N` écrit le résultat dans le registre N (écrase la valeur précédente).
- `§N` en argument (`seed=§1`, `b=§1`) lit le registre N.
- La Pierre de Rosette numérote les stockages d'une même instruction dans l'ordre
  (`§1`, `§2`, …).
- Lecture d'une ancre vide : utiliser `◊` (output précédent) s'il existe, sinon
  poser une question de clarification.

---

## Types de sortie

| Type | Format |
|------|--------|
| `prose` | Paragraphes en langue naturelle |
| `outline` | Liste hiérarchique structurée |
| `STÈLE` | Chaîne de glyphes + transcription mots-codes |
| `table` | Tableau markdown |
| `signature` | Chaîne courte ≤ 12 signes STÈLE |
| `code` | Bloc de code avec langage spécifié |

Si aucun type spécifié après `→` : prose courte.

---

## Protocole d'exécution

À chaque instruction SPC reçue :

1. **Identifier** l'opérateur, extraire les paramètres entre `[]`, noter le type après `→`
2. **Résoudre** les symboles (`◈`, `§N`, `▲`, `⊘`…) selon la table ci-dessus
3. **Décomposer** les pipes `⟶` et conditionnels `?` en étapes séquentielles
4. **Exécuter** chaque étape dans l'ordre
5. **Retourner** dans le format spécifié, ou prose courte si absent

**En cas d'ambiguïté :** poser une seule question de clarification, ne pas interpréter arbitrairement.

**En cas de pipe :** le résultat de l'étape N est l'input implicite de l'étape N+1.

**En cas de conditionnel :** évaluer A ; A « réussit » si son résultat est non vide et
sans échec (tests verts, validation OK). Prendre B si A réussit, C sinon. `∅` = ne rien
faire. Si `:` est absent et que A échoue : ne rien faire.

### Conditionnels émis par la Pierre de Rosette

La règle est toujours la même : **A est la vérification, `?` = « A réussit »**. Quand la
prose formule la condition à l'échec, la Pierre de Rosette **inverse les branches** au lieu
d'inverser la vérification :

| Prose | DSL émis | Lecture |
|---|---|---|
| « si les tests passent, déploie » | `VALIDATE[◈, scope=tests] ? DEPLOY[◈]` | tests OK → déployer |
| « si les tests échouent, déploie » | `VALIDATE[◈, scope=tests] ? ∅ : DEPLOY[◈]` | tests OK → rien ; en échec → déployer |
| « si le build échoue, corrige sinon déploie » | `DEPLOY[◈] ? DEPLOY[◈] : DEBUG[◈]` | build OK → déployer ; en échec → corriger |
| « X si possible, sinon Y » / « X, sinon Y » | `X ? ∅ : Y` | X sert de condition : réussi → rien de plus ; en échec → Y |

- `A ? ∅ : B` ne signifie donc jamais « si A réussit, ne rien faire, puis B » : B ne
  s'exécute **que si A échoue**.
- Le mot d'échec (« échoue », « fails », « casse ») n'est pas un opérateur : la garde est
  l'action vérifiée (`VALIDATE`, `DEPLOY` pour un build…). Si la seule lecture possible
  était un opérateur de correction (`DEBUG`), la Pierre de Rosette le signale par un
  avertissement.
- Une condition ou une action non reconnue n'est jamais supprimée en silence : la Pierre
  de Rosette avertit (et le CLI sort en code 4). Un DSL reçu sans garde alors que la
  demande en contenait une doit être exécuté tel quel, sans garde inventée.

**`ITERATE` sans `n` ni `op` :** ils ne sont émis que s'ils sont exprimés. `n` absent =
une passe par élément de `◈` ; `op` absent = l'opérateur précédent du pipe, sinon demander.

**Paramètre inconnu ou valeur hors énumération :** le signaler en une ligne, puis
exécuter au plus près de l'intention (le DSL produit par la Pierre de Rosette est
toujours conforme ; un DSL écrit à la main ou par une IA locale peut ne pas l'être).

---

## Exemples d'exécution

```
SCAN[◈, focus=anomalies] → outline
```
→ Lire l'input courant, chercher les anomalies, retourner une liste structurée.

---

```
ANALYZE[◈, ctx=technique, ▲] ⟶ COMPRESS[◈, format=STÈLE] → §1
```
→ Analyse technique profonde, puis comprimer en chaîne STÈLE, stocker en §1.

---

```
VALIDATE[*, scope=tests] ? ⊜ : DEBUG[*, focus=error]
```
→ Valider tous les tests. Si OK → archiver. Sinon → déboguer les erreurs.

---

```
VALIDATE[◈, scope=error] ? ∅ : DEBUG[◈, focus=error]
```
→ Vérifier la gestion d'erreurs. Si OK → rien. Sinon → corriger.

---

```
CREATE[◈, type=component, from=scratch] ⟶ VALIDATE[◈, scope=types]
```
→ Créer le composant depuis zéro, puis valider les types.

---

```
FIND[input=*, type=usage, pattern=◈] ⟶ ANALYZE[◈, ctx=technique, depth=2]
```
→ Trouver toutes les utilisations du pattern courant, puis les analyser.

---

```
ADD[target=*, what=error-handling] ⟶ VALIDATE[*, scope=error]
```
→ Ajouter la gestion d'erreurs à tous les éléments, puis valider.

---

```
@stele⌒ @metalangage⌒
SCAN[◈] ? RESONE[◈, layers=all] ⟶ COMPRESS[◈, format=STÈLE] → §1 : ⊜
```
→ Déclarer les skills en lazy load. Scanner l'input. Si résultat : activer
  la résonance complète, comprimer en STÈLE, stocker. Sinon : archiver.

---

## Intégration Pierre de Rosette

```
[Local — zéro token]           [Cloud — Claude]
Prose utilisateur
      ↓
  rosetta.js                   SPC_SKILL.md chargé
  (pattern match               (interprète et exécute
   ou IA locale)                le DSL reçu)
      ↓                               ↑
    DSL SPC  ─────────────────────────┘
```

La Pierre de Rosette génère le DSL.
Ce skill l'exécute.
Aucun token cloud n'est consommé pour la traduction.

Ce que la Pierre de Rosette (mode règles) émet : opérateurs avec paramètres détectés,
`▲`, `→ TYPE`, `→ §N`, `⟶` (découpage sur « puis / then / ; » et sur « et / and » quand
chaque clause a son propre verbe), `A ? B`, `A ? B : C` et `A ? ∅ : C` (voir
« Conditionnels émis »), `⌒` sur un pointeur de skill, `⊜`. Elle n'émet jamais `↻N`.

---

## Notes de maintenance

- Tout nouvel opérateur s'ajoute dans `rosetta.json` (avec `tier`, `signature`,
  `summary`) puis `node build.js` régénère la section opérateurs de ce fichier.
- `node validate.js` vérifie que chaque raccourci et chaque défaut est conforme
  au schéma, et que ce fichier est synchronisé.
- Les shortcuts de la Pierre de Rosette n'ont pas à être reproduits dans ce skill
  — ils appartiennent à la couche de traduction, pas d'exécution.
- En cas de conflit entre un paramètre explicite et un symbole implicite,
  le paramètre explicite a priorité.
