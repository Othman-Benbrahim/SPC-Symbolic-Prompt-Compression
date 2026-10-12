'use strict';
/**
 * Consignes réalistes multi-instructions (FR + EN, ~40–80 mots) pour bench.js (audit v0.2, R7).
 * `ops` = opérateurs attendus par un lecteur humain, dans l'ordre (annotation manuelle).
 * Sert à mesurer la compression ET le rappel : un DSL court qui perd des instructions
 * n'est pas une compression.
 */
const REALISTIC = [
  { lang: 'fr', ops: ['ANALYZE', 'FIND', 'DEBUG', 'VALIDATE'],
    text: "Analyse le module d'authentification en profondeur, puis cherche toutes les utilisations de la fonction checkToken dans le projet. Ensuite corrige le bug de session qui déconnecte les utilisateurs au bout de cinq minutes, et pour finir vérifie que les tests unitaires passent toujours après la correction." },
  { lang: 'fr', ops: ['SCAN', 'FILTER', 'COMPRESS'],
    text: "Parcours rapidement les fichiers de configuration du serveur pour repérer les problèmes de sécurité évidents. Ensuite supprime toutes les clés d'API qui traînent en clair dans le dépôt, puis résume ce que tu as trouvé en liste courte pour que je puisse le transmettre à l'équipe." },
  { lang: 'fr', ops: ['CREATE', 'ADD', 'VALIDATE'],
    text: "Crée un nouveau composant de formulaire d'inscription à partir de zéro, avec les champs nom, email et mot de passe. Puis ajoute une validation côté client sur chaque champ, et enfin valide les types TypeScript de l'ensemble avant que je fasse la revue." },
  { lang: 'fr', ops: ['DEPLOY', 'VALIDATE', 'DEBUG'],
    text: "Déploie la branche de correction en staging. Si les tests d'intégration échouent sur l'environnement de staging, débogue les erreurs une par une et note la cause de chacune ; sinon prépare la mise en production pour demain matin." },
  { lang: 'fr', ops: ['CLONE', 'TRANSDUIT', 'VALIDATE'],
    text: "Copie le composant de tableau de bord existant et adapte-le pour l'affichage mobile, en gardant la même structure de données. Ensuite transforme les classes restantes en composants fonctionnels, puis assure-toi que les tests de rendu passent sur les deux versions." },
  { lang: 'fr', ops: ['ANALYZE', 'COMPRESS'],
    text: "Analyse ce récit sur le plan symbolique en t'attardant sur les archétypes et le sens profond des personnages principaux, puis compresse le tout en chaîne stèle au maximum pour que je puisse l'archiver dans mon journal de session." },
  { lang: 'fr', ops: ['FIND', 'TRANSDUIT', 'VALIDATE'],
    text: "Trouve toutes les occurrences de l'ancienne API de paiement dans le code, puis migre chaque appel vers la nouvelle version du client HTTP. Une fois que c'est fait, vérifie que les tests passent et signale-moi les fichiers où la migration n'a pas été possible." },
  { lang: 'fr', ops: ['DEBUG', 'ADD', 'DEPLOY'],
    text: "La requête de recherche est beaucoup trop lente en production, corrige le problème de performance. Ajoute ensuite un système de journalisation pour mesurer le temps de réponse de chaque requête, puis déploie la correction en production quand tout est prêt." },
  { lang: 'fr', ops: ['COMPARE', 'EXPAND'],
    text: "Compare la version actuelle du schéma de base de données avec celle du mois dernier et liste toutes les différences de colonnes. Ensuite documente les changements dans le changelog en expliquant pour chacun la raison et l'impact sur les clients existants." },
  { lang: 'fr', ops: ['APPLY', 'RESONE', 'COMPRESS'],
    text: "Applique le métalangage des résonances à ce texte, puis active la résonance sur toutes les couches, émotionnelle et narrative comprises. Pour finir, stocke le résultat compressé en stèle afin que je le réutilise dans la séance suivante." },
  { lang: 'fr', ops: ['ITERATE', 'ANALYZE', 'FILTER'],
    text: "Pour chaque fichier du dossier src, analyse les dépendances importées et repère celles qui ne sont plus utilisées. Ensuite enlève les imports inutiles partout, mais ne touche surtout pas aux fichiers générés automatiquement par le compilateur." },
  { lang: 'fr', ops: ['CREATE', 'ADD', 'VALIDATE', 'DEPLOY'],
    text: "Génère un nouvel endpoint REST pour exporter les factures au format CSV, puis ajoute l'authentification JWT dessus. Écris aussi les tests d'intégration correspondants, valide-les, et si tout est vert déploie en staging pour que la comptabilité puisse tester." },
  { lang: 'en', ops: ['ANALYZE', 'FIND', 'DEBUG', 'VALIDATE'],
    text: "Analyze the payment module in depth, then find all usages of the processRefund function across the codebase. After that, fix the race condition that sometimes double-charges customers, and finally make sure all the unit tests still pass after your change." },
  { lang: 'en', ops: ['SCAN', 'FILTER', 'COMPRESS'],
    text: "Quickly scan the server configuration files for obvious security issues. Then remove any API keys that are committed in plain text, and summarize what you found as a short list so I can forward it to the security team this afternoon." },
  { lang: 'en', ops: ['CREATE', 'ADD', 'VALIDATE'],
    text: "Create a new signup form component from scratch with name, email and password fields. Then add client-side validation on every field, and validate the TypeScript types across the whole feature before I open the pull request for review." },
  { lang: 'en', ops: ['DEPLOY', 'VALIDATE', 'DEBUG'],
    text: "Deploy the hotfix branch to staging. If the integration tests fail on staging, debug the errors one at a time and write down the root cause of each; otherwise get everything ready for the production release tomorrow morning." },
  { lang: 'en', ops: ['CLONE', 'TRANSDUIT', 'VALIDATE'],
    text: "Copy the existing dashboard component and adapt it for mobile, keeping the same data structure. Then refactor the remaining class components into functional components, and make sure the rendering tests pass on both versions before merging." },
  { lang: 'en', ops: ['FIND', 'TRANSDUIT', 'VALIDATE'],
    text: "Find every occurrence of the legacy billing API in the code, then migrate each call to the new HTTP client. Once that is done, verify that the tests pass and tell me which files could not be migrated automatically and why." },
  { lang: 'en', ops: ['DEBUG', 'ADD', 'DEPLOY'],
    text: "The search query is far too slow in production, so fix the performance problem first. Then add logging to measure the response time of every request, and deploy the fix to production once everything has been checked." },
  { lang: 'en', ops: ['COMPARE', 'EXPAND'],
    text: "Compare the current database schema with last month's version and list every column difference. Then document the changes in the changelog, explaining for each one the reason behind it and the impact on existing customers." },
  { lang: 'en', ops: ['ITERATE', 'ANALYZE', 'FILTER'],
    text: "For each file in the src folder, analyze the imported dependencies and spot the ones that are no longer used. Then remove the unused imports everywhere, but do not touch any of the files that are generated automatically by the compiler." },
  { lang: 'en', ops: ['CREATE', 'ADD', 'VALIDATE', 'DEPLOY'],
    text: "Generate a new REST endpoint that exports invoices as CSV, then add JWT authentication to it. Also write the matching integration tests, validate them, and if everything is green deploy to staging so the accounting team can try it." },
  { lang: 'en', ops: ['SCAN', 'ANALYZE', 'VALIDATE'],
    text: "Review my latest changes to the caching layer and look for anything that could break existing behaviour. Then analyze the impact on memory usage under load, and check that the test coverage did not drop compared to the main branch." },
  { lang: 'en', ops: ['DEBUG', 'VALIDATE', 'EXPAND'],
    text: "Debug the null pointer exception that crashes the export job every night, validate the fix with a regression test, and then write a short explanation in the documentation so the on-call team knows what happened and how it was resolved." }
];

module.exports = { REALISTIC };
