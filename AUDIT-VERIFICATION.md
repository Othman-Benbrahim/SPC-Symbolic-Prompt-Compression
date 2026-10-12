# Vérification des audits

## Audit v0.1 (2026-10-12)

Chaque constat de `SPC-AUDIT-REPORT.md` a été rejoué contre le code d'origine (v0.1)
avant correction : CLI exécuté, éditeur chargé dans Chromium (Playwright), données
recomptées. Verdicts : **Confirmé** · **Confirmé, repro inexacte** · **Exact sans effet** ·
**Inexact**.

### Constats de l'audit

| # | Verdict | Vérification | Correction (test associé) |
|---|---|---|---|
| P0-1 | Confirmé | `because` → `APPLY[◈]`, `support` → `TRANSDUIT[◈]` reproduits | Mots entiers dans `core.findAll` (`core.test.js` « P0-1 ») |
| P0-2 | Confirmé | Les deux reproductions donnent le raccourci court | Plus long raccourci gagnant (« P0-2 ») |
| P0-3 | Confirmé | 11 déclencheurs partagés + 3 doublons internes ; `vérifie que les tests passent` → `SCAN` | Collisions retirées, départage déterministe, test d'ordre inversé (« P0-3 », `data.test.js`) |
| P0-4 | Confirmé | Divergences CLI/éditeur reproduites | `core.js` unique inliné par `build.js` (`editor.test.js`, e2e « même DSL que le CLI ») |
| P0-5 | Confirmé | Dans Chromium, réponse simulée de LM Studio → `window.__xss = 1` | Délégation `data-*` + CSP par empreintes (`editor.test.js`, e2e « P0-5 ») |
| P0-6 | Confirmé, détails inexacts | `fix all type errors` n'émet **pas** `scope=error` (il émet `DEBUG ⟶ VALIDATE[scope=types]`) ; `always handle errors` utilise `⟶`, pas `?` | Énumérations complétées, 2 raccourcis réécrits ; les 170 passent `validate.js` |
| P0-7 | Confirmé | Les trois reproductions perdent la 2ᵉ moitié | Pipes, conditionnels, `⌒`, `§N` émis (« P0-7 ») |
| P1-1 | Confirmé, repro inexacte | Entre guillemets, `"corrige le bug 404"` **garde** 404 : le bug touche les mots non cités. Plus grave que décrit : une instruction citée **commençant par un nombre** (`"404 sur la page login, corrige"`) est supprimée en entier, puis le CLI **reste bloqué** sur stdin. `ITERATE[◈]` venait de l'absence d'émission de paramètres, pas de la perte du 3 | Parseur d'arguments explicite (`cli.test.js` « P1-1 ») |
| P1-2 | Confirmé | `port NaN` reproduit | Validation 1–65535 (« P1-2 ») |
| P1-3 | Confirmé | — | `--model`, messages génériques |
| P1-4 | Confirmé, et pire | Le benchmark montre que le DSL est **plus long** que la prose (voir plus bas) | Tokens locaux uniquement, `bench.js` |
| P1-5 | Confirmé | — | Stockage versionné, bandeau, Réinitialiser (e2e « P1-5 ») |
| P1-6 | Confirmé | — | Import validé (e2e « P1-6 ») |
| P1-7 | Confirmé | — | Code 2 + message (« P1-7 ») |
| P1-8 | Exact sans effet | `typeof DB !== 'undefined'` est toujours vrai : la liste de secours incomplète n'est jamais utilisée | Corrigé quand même (liste dérivée de la BDD dans `core.js`) |
| P1-9 | Confirmé | Requête vers `fonts.googleapis.com` observée au chargement | Polices système, zéro requête (e2e) |
| P1-10 | Confirmé | — | Section générée, grammaire, `∅`, `§N` définis |
| P2-1 | Confirmé | En plus, « ~1970 tokens » d'amorçage : mesuré **2 599** (cl100k) en v0.1 | README réécrit, chiffres générés |
| P2-2 | Confirmé | — | `package.json`, tests, CI |
| P2-3 | Confirmé | md5 du README identique dans le zip | Zip supprimé |
| P2-4 | Confirmé | — | Traité, sauf `prompt()` / `confirm()` (conservés, optionnel) |
| P2-5 / P2-6 / P2-7 | Confirmé | — | Tableau des dépendances, note GPL, résumé anglais |

### Points de l'audit qui étaient inexacts

- **Point positif n°4 (apostrophes)** : `normalize()` remplaçait `'` par `'` (deux
  apostrophes ASCII, vérifié octet par octet). L'apostrophe typographique `’` n'était
  **jamais** unifiée. C'est corrigé.
- **Point positif n°7 (échappement)** : `esc()` appliqué dans un attribut `onclick='…'`
  ne protège pas : le navigateur décode `&#39;` avant d'exécuter le JS. Résultat
  reproduit : un raccourci contenant une apostrophe (« corrige l'erreur ») ne peut plus
  être modifié ni supprimé (`SyntaxError`). Une phrase forgée dans un JSON importé
  devient une injection de script. `op.id` n'était pas échappé non plus.
- **Correction proposée pour le raccourci « never ignore errors »** (`? ⊜ : DEBUG`) :
  écartée. `⊜` archiverait la session sur une règle permanente. J'ai introduit `∅`
  (branche vide) à la place.

### Problèmes non relevés par l'audit

1. **La compression annoncée est inversée.** Mesuré avec cl100k et o200k, le DSL des
   170 raccourcis fait 2 356 tokens contre 619 pour les phrases (×0,26) ; 0 raccourci
   sur 170 est plus court en DSL (cl100k). Le README v0.1 annonçait « ×13 » et un
   break-even à 20 instructions. La v0.1 donne exactement le même ratio : ce n'est pas
   une régression.
2. **FIND n'avait aucun déclencheur français**, ni CREATE ni ADD (« crée un composant »,
   « ajoute la pagination » → aucun opérateur), alors que le README annonce FR/EN.
3. **Types de sortie déclenchés par des noms communs** : « analyse le code » →
   `→ code` (le constat est noté puis abandonné dans l'audit, P0-7) ; idem « liste »,
   « tableau », « court ».
4. **`store` déclenché par « log »** : « add log » ajoutait `→ §1`.
5. **README, ordre de résolution** : il annonçait « raccourcis → règles → IA » pour
   l'éditeur. En réalité, l'éditeur sautait les règles et le CLI `--ai` sautait les
   raccourcis. Les deux suivent maintenant le même ordre : raccourci → IA → repli
   sur les règles.

### Écarts assumés par rapport au plan de l'audit

- Ordre des arguments : `FIND[input=*, pattern=◈, scope=file, type=usage]` plutôt que
  l'ordre exact du critère T-03. Les arguments sont les mêmes ; l'ordre suit
  `default` puis `params`.
- Coût d'amorçage du skill : il passe de 2 599 à environ 3 700 tokens. C'est le prix
  des énumérations complètes, nécessaires pour que le DSL soit vérifiable.
- `prompt()` / `confirm()` conservés dans l'éditeur (P2-4, marqué optionnel).
- La CSP de l'éditeur limite LM Studio à `localhost` / `127.0.0.1` ; c'est modifiable
  dans `build.js`.

---

## Audit v0.2 (2026-10-13) — constats R1–R8

Toutes les reproductions de `SPC-AUDIT-REPORT-v0.2.md` ont été rejouées sur la v0.2
livrée avant correction ; chacune est maintenant un test (`test/residual.test.js`).

| # | Verdict | Vérification sur v0.2 | Correction v0.3 |
|---|---|---|---|
| R1 | Confirmé | Les 3 entrées donnent `DEPLOY[◈]`, `DEBUG[◈]`, `DEBUG[◈]` sans aucun avertissement | Avertissements conservés, garde perdue signalée, `complete:false`, code 4 |
| R2 | Confirmé | « add tests » → `VALIDATE[◈, scope=tests]` | Preuve hors mot déclencheur → `ADD[target=◈, what=tests]` |
| R3 | Confirmé | `scanne`, `refactoring`, `deploying`, `analysis`… → NULL | Racinisation mot à mot ; tous reconnus |
| R4 | Confirmé | `inversion` / `négatif` absents de SPC_SKILL.md ; « la validation échoue » → `DEBUG` | Doc + masquage du mot d'échec → `VALIDATE … ? ∅ : …` |
| R5 | Confirmé | « compile le projet et redige le rapport » → `DEPLOY[◈]` | `DEPLOY[◈] ⟶ CREATE[◈]` |
| R6 | Confirmé | « repete » → `ITERATE[op=ANALYZE, n=3]` | `ITERATE[◈]` |
| R7 | Confirmé (chiffres exacts) | ×0,26 / ×0,51, 3 729 tokens reproduits | Corpus réaliste mesuré (×1,44, rappel 97 %) |
| R8 | Confirmé | `style-src 'unsafe-inline'`, 44 attributs `style=` | CSP hachée, zéro attribut |

### Imprécisions de l'audit v0.2

- **R2, sortie attendue invalide** : `ADD[target=◈, what=tests]` aurait été rejeté par le
  schéma v0.2 (`tests` n'était pas dans `ADD.what`). La valeur a été ajoutée.
- **R2, correctif proposé écarté** : placer la preuve après la longueur et la priorité
  fait régresser « analyse en profondeur sur le plan symbolique » (→ `RESONE`). La cause
  réelle était un double comptage : le paramètre de VALIDATE venait du mot déclencheur
  lui-même. C'est ce point qui est corrigé.
- **R1, point 3 écarté** : émettre « l'autre moitié avec une garde `∅` »
  (`DEPLOY[◈] ? ∅ : …`) inventerait une condition. On émet l'action sans garde, avec un
  avertissement explicite, `complete:false` et le code 4.
- **Matrice §3** :
  - P0-2 : la sortie réelle est `→ §1`, pas `⟶ ⊜`.
  - P0-1 : « because the input is malformed » donne NULL, pas `DEBUG[◈]`.
  - P1-4 v0.1 : il portait sur les comptes de tokens inventés par le modèle (corrigé en
    v0.2), pas sur la longueur du DSL.
  - CLI : le CLI refuse de lire stdin quand c'est un terminal, et non « when not a TTY ».
  - Le score « 23 + 2 + 1 + 1 » totalise 27 pour 25 constats.

### Problèmes trouvés en corrigeant (non relevés par l'audit)

Mesurés sur le nouveau corpus réaliste :
- **Virgule entre deux instructions** : « debug the NPE, validate the fix » perdait DEBUG
  sans avertissement. Même mécanisme que R5 ; corrigé par le même séparateur souple.
- **Phrases fusionnées** : « Deploy X. If tests fail, debug…; otherwise… » produisait un
  conditionnel absurde. Les phrases sont maintenant traitées une par une.
- **Déclencheurs adjectifs ou adverbiaux** ajoutés en v0.2 (« new », « nouveau ») ou
  hérités (« après », « next », « done ») : « the new HTTP client » → CREATE, « once that is
  done » → `⊜`. Retirés.
- **Adverbe de séquence au milieu d'une proposition** (« ajoute ensuite un système de logs ») :
  le complément était ignoré. Il complète maintenant l'étape précédente.
- **Coût du skill** : il passe à ≈ 4 400 tokens avec la documentation R4 demandée. Le
  break-even sur consignes réalistes est d'environ 270 consignes : c'est publié.

### Limites restantes (mesurées, non corrigées)

- Précision de 91 % sur le corpus réaliste. Les opérateurs parasites viennent de noms
  (« la requête de **recherche** » → FIND) et de noms d'agent anglais (« compiler » →
  DEPLOY). Une analyse morphosyntaxique dépasserait le périmètre d'un transpileur à règles.
- Une garde formulée sans verbe d'action (« si tout est vert ») n'est pas reconnue.
  Elle est signalée, pas devinée.
