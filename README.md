# SPC — Symbolic Prompt Compression

> Réduire le coût tokenique des sessions LLM par un DSL symbolique minimaliste,
> une pierre de Rosette locale, et un skill Claude d'exécution.

---

## Concept

Les instructions envoyées à un LLM en langage naturel consomment une fraction
croissante de la fenêtre de contexte. **SPC** propose un système en trois couches
pour compresser ces instructions sans perte sémantique :

```
Prose utilisateur
      ↓  (Pierre de Rosette — local, zéro token cloud)
DSL SPC compact
      ↓  (Claude + SPC_SKILL.md)
Exécution et output
```

Le ratio de compression moyen constaté est de **×13** sur les instructions
comportementales. Le break-even est atteint dès **20 instructions** par session.

---

## Architecture

```
spc/
├── README.md                  ← ce fichier
├── SPC_SKILL.md               ← skill Claude (interpréteur DSL)
├── rosetta.json               ← base de règles (BDD enrichissable)
├── rosetta.js                 ← transpileur CLI (Node.js, zéro IA)
└── rosetta-editor.html        ← éditeur visuel de la BDD + IA locale
```

### Responsabilités

| Fichier | Rôle | IA ? | Tokens cloud |
|---------|------|------|-------------|
| `rosetta.json` | Base de règles : opérateurs, shortcuts, modificateurs | Non | 0 |
| `rosetta.js` | Transpilation prose → DSL en ligne de commande | Optionnel (local) | 0 |
| `rosetta-editor.html` | Éditeur visuel + test + IA locale (LM Studio) | Optionnel (local) | 0 |
| `SPC_SKILL.md` | Interprétation et exécution du DSL par Claude | Oui | ~1970 (amorçage) |

---

## Installation

**Prérequis :** Node.js ≥ 18

```bash
# Cloner ou copier les fichiers dans un dossier
mkdir spc && cd spc
# Placer rosetta.json, rosetta.js, rosetta-editor.html, SPC_SKILL.md

# Tester le transpileur
node rosetta.js "analyze this code in depth"
```

**Intégration Claude Code :**
Placer `SPC_SKILL.md` dans le dossier `skills/` de ton projet Claude Code.

---

## Utilisation

### 1 — Transpiler en ligne de commande

```bash
# Mode pattern matching (zéro IA, instantané)
node rosetta.js "create a new react component"
node rosetta.js "find all usages of this function"
node rosetta.js "add error handling to all functions"

# Mode IA locale via LM Studio (Gemma / Qwen / Mistral)
node rosetta.js --ai "create a new react component"
node rosetta.js --ai --port 1234 "refactor this into smaller functions"

# Stdin
echo "validate all tests then deploy to staging" | node rosetta.js
```

### 2 — Éditeur visuel

Ouvrir `rosetta-editor.html` dans un navigateur.

```bash
# Si CORS bloqué (onglet IA locale)
python -m http.server 8080
# → http://localhost:8080/rosetta-editor.html
```

L'éditeur permet de :
- Naviguer et enrichir les raccourcis, opérateurs, modificateurs
- Tester une phrase et voir le DSL produit en temps réel
- Traduire via IA locale (LM Studio) sans consommer de tokens cloud
- Exporter le `rosetta.json` mis à jour
- Importer un `rosetta.json` existant

### 3 — Envoyer le DSL à Claude

Une fois le DSL généré, l'envoyer à Claude avec le skill SPC chargé.
Claude l'interprète et l'exécute selon le protocole défini dans `SPC_SKILL.md`.

```
# Exemple de session
> CREATE[◈, type=component, from=scratch] ⟶ VALIDATE[◈, scope=types]
> FIND[input=*, type=usage, pattern=◈]
> VALIDATE[*, scope=tests] ? ⊜ : DEBUG[*, focus=error]
```

---

## Le DSL SPC

### Syntaxe

```
OPÉRATEUR[param=valeur, ...]           instruction simple
OPÉRATEUR[param=valeur] → TYPE         avec format de sortie
A ⟶ B                                  pipe : A puis B
A ? B : C                              conditionnel
OPÉRATEUR[◈]↻N                         itération courte
@skill::module                         pointeur de skill
```

### Les 17 opérateurs

| # | Opérateur | Rôle |
|---|-----------|------|
| 1 | `SCAN` | Lecture rapide, détection de patterns |
| 2 | `ANALYZE` | Décomposition profonde |
| 3 | `COMPARE` | Contraste dimensionnel |
| 4 | `FIND` | Recherche dans la base de code |
| 5 | `RESONE` | Activation des couches résonantes (symbolique) |
| 6 | `TRANSDUIT` | Changement de registre ou format |
| 7 | `COMPRESS` | Réduction à signature minimale |
| 8 | `CREATE` | Génération depuis zéro |
| 9 | `ADD` | Injection dans de l'existant |
| 10 | `CLONE` | Copie et adaptation d'un pattern |
| 11 | `APPLY` | Invocation d'un skill ou convention |
| 12 | `EXPAND` | Déploiement depuis une graine compressée |
| 13 | `FILTER` | Sélection ou exclusion |
| 14 | `ITERATE` | Boucle avec variation de paramètre |
| 15 | `VALIDATE` | Vérification de conformité |
| 16 | `DEBUG` | Diagnostic et correction |
| 17 | `DEPLOY` | Build et déploiement |

### Symboles interface

| Symbole | Nom | Sens |
|---------|-----|------|
| `◈` | FOCUS | Input courant |
| `§N` | ANCRE | Référence nommée (store/recall) |
| `?` | BIFURQUE | Conditionnel if/else |
| `*` | TOUT | Wildcard — tous les éléments |
| `▲` | MAX | Profondeur ou ratio maximum |
| `⊘` | NEG | Exclusion |
| `↻` | CYCLE | Itération courte |
| `⟶` | PIPE | Séquence |
| `⊜` | SCELLER | Clôture et archive de session |
| `◊` | TRACE | État ou output précédent |
| `⌒` | PLIER | Lazy load |

---

## La Pierre de Rosette

`rosetta.json` est la base de règles qui alimente le transpileur.
Elle contient :

- **17 opérateurs** avec leurs déclencheurs FR/EN et paramètres contextuels
- **91 shortcuts** — phrases fréquentes avec leur DSL exact
- **7 modificateurs** — mots qui affectent la forme du DSL produit
- **6 types de sortie** — formats reconnus après `→`
- **293 triggers** au total — issus de l'analyse de 213 fichiers
  de la communauté ([PatrickJS/awesome-cursorrules](https://github.com/PatrickJS/awesome-cursorrules))

### Enrichir la BDD

**Via l'éditeur visuel :** ouvrir `rosetta-editor.html`, naviguer dans les sections,
cliquer `+ Ajouter` ou `+ mot`. Les modifications sont sauvegardées automatiquement
dans le navigateur. Exporter avec le bouton `↓ Exporter JSON`.

**Via le JSON directement :**

```json
// Ajouter un raccourci
"shortcuts": {
  "ma phrase habituelle": "ANALYZE[◈, ctx=technique, ▲]"
}

// Ajouter un déclencheur à un opérateur existant
{
  "id": "ANALYZE",
  "triggers": ["analyse", "examine", "mon nouveau mot"]
}
```

**Règle de langue :** les shortcuts techniques sont en anglais.
Les shortcuts liés aux skills symboliques personnels restent en français.

---

## IA locale (LM Studio)

SPC supporte l'utilisation d'un modèle local comme moteur de traduction,
via l'API OpenAI-compatible de LM Studio.

**Modèles testés :** Gemma 3 4B · Qwen2.5-Coder 7B

**Architecture :**
```
Prose → LM Studio (local, zéro token cloud) → DSL → Claude
```

**Hiérarchie de résolution dans l'éditeur :**
```
1. Raccourcis BDD      → réponse immédiate, IA non consultée
2. Pattern matching    → réponse immédiate, IA non consultée
3. IA locale           → consultée uniquement si rien ne correspond
```

**Configuration :**
- URL par défaut : `http://localhost:1234`
- Endpoint : `/v1/chat/completions`
- Format : OpenAI-compatible

---

## Limites connues

**Break-even long :** le skill d'amorçage coûte ~1970 tokens.
Rentable sur les sessions longues (>20 instructions), pas sur les échanges ponctuels.

**Ambiguïté des paramètres :** certains paramètres comme `target=tests` ne sont pas
des paramètres officiels de leur opérateur (`COMPARE` utilise `a=` et `b=`).
La Pierre de Rosette peut produire des syntaxes approximatives — Claude les comprend
généralement mais la rigueur DSL n'est pas garantie sur les cas limites.

**IA locale et CORS :** l'onglet IA locale de l'éditeur peut être bloqué si le fichier
est ouvert en `file://`. Solution : `python -m http.server 8080`.

**Couverture ~90% :** les opérations restantes non couvertes (RENAME, REVERT, MOCK)
sont à enrichir selon les besoins réels rencontrés en session.

---

## Roadmap

```
Phase 1 — Fondations ✓
  Cadre conceptuel · 17 opérateurs · couche opérationnelle STÈLE

Phase 2 — Tests (à venir)
  P1 Break-even tokenique · P2 Fidélité · P3 Résonance latente
  P4 Comparaison A/B · P5 Dégradation progressive

Phase 3 — Formalisation ✓
  SPC_SKILL.md · rosetta.json · rosetta.js · rosetta-editor.html

Phase 4 — Publication (à venir)
  Repository GitHub public · benchmark public · documentation étendue
```

---

## Connexion aux travaux existants

SPC s'inscrit dans un écosystème de skills symboliques :

- **STÈLE** — alphabet de 25 primitives, base de la couche symbolique SPC
- **Métalangage des Résonances** — origine de l'opérateur `RESONE`
- **LÉR** — origine de l'opérateur `TRANSDUIT`
- **Fractales du Destin** — invocable via `APPLY[@fractales::TIRAGE]`

La convergence entre compression symbolique (SPC) et Karpathy's tokenizer design :
les deux maximisent la densité sémantique par token — l'un au niveau du modèle,
l'autre au niveau du prompt.

---

## Auteur

**Othman BEN BRAHIM**
[github.com/Othman-Benbrahim](https://github.com/Othman-Benbrahim)

---

*SPC v1.0 — Mai 2026*
