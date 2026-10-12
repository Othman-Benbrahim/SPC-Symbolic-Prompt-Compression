# Benchmark SPC — ratio prose / DSL

Généré par `node bench.js --write` · règles v0.4 · tokenizers cl100k_base et o200k_base (gpt-tokenizer).
Le tokenizer de Claude n'est pas public : chiffres indicatifs (même famille BPE octet).

## Raccourcis (phrase → DSL) — 170 paires

| Tokenizer | Σ prose | Σ DSL | ratio global | ratio médian | DSL plus court | gain moyen / instruction |
|---|---:|---:|---:|---:|---:|---:|
| cl100k | 619 | 2356 | ×0.26 | ×0.3 | 0/170 | -10.22 |
| o200k | 626 | 2383 | ×0.26 | ×0.3 | 1/170 | -10.34 |
| estimateur local | 672 | 2401 | ×0.28 | ×0.31 | 1/170 | -10.17 |

## Règles (corpus de test → DSL) — 82 paires

| Tokenizer | Σ prose | Σ DSL | ratio global | ratio médian | DSL plus court | gain moyen / instruction |
|---|---:|---:|---:|---:|---:|---:|
| cl100k | 526 | 1018 | ×0.52 | ×0.5 | 3/82 | -6 |
| o200k | 503 | 1022 | ×0.49 | ×0.5 | 3/82 | -6.33 |
| estimateur local | 480 | 956 | ×0.5 | ×0.54 | 3/82 | -5.8 |

## Consignes réalistes multi-instructions — 24 consignes (FR + EN, 35–50 mots)

| Mesure | Valeur |
|---|---:|
| Σ prose / Σ DSL (cl100k) | 1271 / 893 → **×1.42** |
| Σ prose / Σ DSL (o200k) | 1170 / 936 → **×1.25** |
| Rappel (instructions attendues présentes dans le DSL) | **97 %** |
| Précision (opérateurs émis qui étaient attendus) | **91 %** |
| Consignes entièrement conservées | 22 / 24 |
| Consignes signalées incomplètes (avertissement) | 3 / 24 |

Annotation des opérateurs attendus : manuelle (`test/realistic.js`), donc discutable ; elle est publiée pour être contestée.

| # | langue | rappel | parasites | prose | DSL | DSL émis |
|---:|---|---:|---:|---:|---:|---|
| 1 | fr | 4/4 | 0 | 69 | 46 | `ANALYZE[◈, depth=3] ⟶ FIND[input=*, pattern=◈] ⟶ DEBUG[◈, focus=error] ⟶ VALIDATE[◈, scope=tests]` |
| 2 | fr | 3/3 | 0 | 73 | 30 | `SCAN[◈, focus=surface] ⟶ FILTER[◈, mode=delete] ⟶ COMPRESS[◈] → outline` |
| 3 | fr | 3/3 | 0 | 60 | 37 | `CREATE[◈, type=component, from=scratch] ⟶ ADD[target=◈, what=validation] ⟶ VALIDATE[◈, scope=types]` |
| 4 | fr | 3/3 | 1 | 62 | 42 | `DEPLOY[◈, env=staging]
VALIDATE[◈, scope=tests] ? DEPLOY[◈, env=prod] : DEBUG[◈, focus=error]` |
| 5 | fr | 3/3 | 0 | 61 | 45 | `CLONE[source=◈, adapt=oui, scope=composant] ⟶ TRANSDUIT[◈, from=oop, to=functional] ⟶ VALIDATE[◈, scope=tests]` |
| 6 | fr | 2/2 | 0 | 60 | 36 | `ANALYZE[◈, ctx=symbolique, depth=3] ⟶ COMPRESS[◈, ratio=max, ▲] → STÈLE` |
| 7 | fr | 3/3 | 0 | 62 | 35 | `FIND[input=*, pattern=◈, type=pattern] ⟶ TRANSDUIT[◈] ⟶ VALIDATE[◈, scope=tests]` |
| 8 | fr | 3/3 | 1 | 54 | 44 | `FIND[input=*, pattern=◈] ⟶ DEBUG[◈, focus=performance] ⟶ ADD[target=◈, what=logging] ⟶ DEPLOY[◈, env=prod]` ⚠ |
| 9 | fr | 2/2 | 0 | 59 | 25 | `COMPARE[a=◈, b=§1] ⟶ EXPAND[seed=◈, ctx=docs]` |
| 10 | fr | 3/3 | 0 | 63 | 39 | `APPLY[@metalangage, ◈] ⟶ RESONE[◈, layers=all] ⟶ COMPRESS[◈, format=STÈLE] → §1` |
| 11 | fr | 3/3 | 0 | 58 | 20 | `ITERATE[◈, op=ANALYZE] ⟶ FILTER[◈]` |
| 12 | fr | 4/4 | 0 | 65 | 50 | `CREATE[◈, type=api, from=scratch] ⟶ ADD[target=◈, what=auth] ⟶ VALIDATE[◈, scope=tests] ⟶ DEPLOY[◈, env=staging]` ⚠ |
| 13 | en | 3/4 | 0 | 52 | 39 | `ANALYZE[◈, depth=3] ⟶ FIND[input=*, type=usage, pattern=◈] ⟶ VALIDATE[◈, scope=tests]` |
| 14 | en | 3/3 | 0 | 45 | 28 | `SCAN[◈, focus=security] ⟶ FILTER[◈, mode=delete] ⟶ COMPRESS[◈]` |
| 15 | en | 3/3 | 0 | 43 | 35 | `CREATE[◈, type=component, from=scratch] ⟶ ADD[target=*, what=validation] ⟶ VALIDATE[◈, scope=types]` |
| 16 | en | 3/3 | 1 | 43 | 42 | `DEPLOY[◈, env=staging]
VALIDATE[◈, scope=tests] ? DEPLOY[◈, env=prod] : DEBUG[◈, focus=error]` |
| 17 | en | 3/3 | 0 | 40 | 45 | `CLONE[source=◈, adapt=oui, scope=composant] ⟶ TRANSDUIT[◈, from=oop, to=functional] ⟶ VALIDATE[◈, scope=tests]` |
| 18 | en | 2/3 | 1 | 45 | 41 | `FIND[input=*, pattern=◈, type=pattern] ⟶ FIND[input=*, pattern=◈, type=usage] ⟶ VALIDATE[◈, scope=tests]` |
| 19 | en | 3/3 | 1 | 41 | 44 | `FIND[input=*, pattern=◈] ⟶ DEBUG[◈, focus=performance] ⟶ ADD[target=◈, what=logging] ⟶ DEPLOY[◈, env=prod]` |
| 20 | en | 2/2 | 1 | 40 | 24 | `COMPARE[a=◈, b=§1] ⟶ ITERATE[◈, op=EXPAND]` |
| 21 | en | 3/3 | 0 | 45 | 24 | `ITERATE[◈, op=ANALYZE] ⟶ FILTER[◈, mode=delete]` |
| 22 | en | 4/4 | 0 | 44 | 50 | `CREATE[◈, type=api, from=scratch] ⟶ ADD[target=◈, what=auth] ⟶ VALIDATE[◈, scope=tests] ⟶ DEPLOY[◈, env=staging]` ⚠ |
| 23 | en | 3/3 | 1 | 43 | 37 | `SCAN[◈] ⟶ FIND[input=*, pattern=◈] ⟶ ANALYZE[◈] ⟶ VALIDATE[◈, scope=tests]` |
| 24 | en | 3/3 | 0 | 44 | 35 | `DEBUG[◈, focus=error] ⟶ VALIDATE[◈, scope=tests] ⟶ EXPAND[seed=◈, ctx=docs]` |

## Coût d'amorçage et break-even

SPC_SKILL.md : **4449 tokens** (cl100k) / **4139** (o200k).

- cl100k : gain moyen par instruction (raccourcis) = -10.22 token(s) → **aucun break-even** : le DSL est en moyenne plus long que la prose.
- o200k : gain moyen par instruction (raccourcis) = -10.34 token(s) → **aucun break-even** : le DSL est en moyenne plus long que la prose.
- cl100k, consignes réalistes : gain moyen par consigne = 15.75 tokens → break-even ≈ **283 consignes** de ce type par session.

## Écart de l'estimateur local

Erreur relative moyenne de `estimateTokens()` vs cl100k : **11 %** (médiane 8 %).

## Paires où le DSL coûte le plus (cl100k)

| prose | tokens | DSL | tokens |
|---|---:|---|---:|
| full feature workflow | 3 | `CREATE[◈, type=component, from=scratch] ⟶ ADD[target=◈, what=validation] ⟶ CREATE[◈, type=test, from=scratch] ⟶ VALIDATE[*, scope=tests]` | 49 |
| full code review | 3 | `SCAN[◈, focus=anomalies] ⟶ ANALYZE[◈, ctx=technique, depth=3] ⟶ VALIDATE[◈, scope=tests] → outline` | 43 |
| optimize this query | 3 | `ANALYZE[◈, ctx=technique, ▲] ⟶ TRANSDUIT[◈, from=slow, to=optimized]` | 33 |
| refactor and document | 4 | `TRANSDUIT[◈, from=complex, to=readable] ⟶ EXPAND[seed=◈, ctx=docs] → prose` | 31 |
| review my changes | 3 | `SCAN[◈, focus=anomalies] ⟶ ANALYZE[◈, ctx=technique, depth=2]` | 29 |
| prepare for code review | 4 | `ANALYZE[◈, ctx=technique, depth=2] ⟶ VALIDATE[◈, scope=tests]` | 29 |
| optimize for performance | 3 | `ANALYZE[◈, ctx=technique, ▲] ⟶ DEBUG[◈, focus=performance]` | 27 |
| rename all instances | 3 | `FIND[input=*, type=usage, pattern=◈] ⟶ TRANSDUIT[*, from=current, to=new]` | 27 |
