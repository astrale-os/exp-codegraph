# SDK + Codegraph checkpoint — 2026-10-04

La branche `checkpoint/linter-codegraph-20261004` et le tag commun `checkpoint-linter-codegraph-20261004` figent les changements retenus dans chacun des deux dépôts. Les prototypes écartés sont archivés localement. Aucun dépôt 1Pact n’est modifié ni poussé.

Sources qualifiées : SDK `8a2470cac32f5ef80a89e2f81dd03cec815dfca0`, Codegraph `41adb45c1c24fda1ef3218ac40084fe23fd76765`. Les commits de documentation suivants ne changent pas le binaire natif. Les layouts Codegraph déclarent désormais ses fichiers natifs et le protocole body-demand.

| Mesure | SDK | Codegraph |
| --- | ---: | ---: |
| Lignes de production initiales | 35 520 | 74 262 |
| Lignes de production retenues | 41 068 | 92 996 |
| Delta de production | +5 548 | +18 734 |
| JS + déclarations construits, hors dépendances | 1 693 084 octets | 2 066 610 octets |

Les baselines restent `cad2f224ddcb4ff5137231584fc25208d28611fc` pour SDK et `f35484f143ca31ad6f2b4c4a9d93a4fffbbd890a` pour Codegraph. Comptage physique des sources suivies : SDK src TS/TSX, Codegraph TS/TSX/Go du dépôt ; tests, fixtures, spécifications, qualification et fichiers générés exclus de la production. Le sous-total historique analysis/typescript reste +18 100 ; le total Codegraph inclut aussi +634 hors de ce sous-arbre.

La croissance globale est donc **+24 282 lignes de production**. Les derniers nettoyages remplacent certains chemins, mais aucune réduction de 10 000 lignes depuis l’initial n’est démontrée. Les ratios Source86 comparent un checkpoint intermédiaire C2 à Source73 : ils ne démontrent pas 10× depuis l’initial. La comparaison fiable de RAM reste à faire.

Validation Codegraph : build et typechecks passent ; check global, 44 spécifications, 0 diagnostic ; suite complète, 124 fichiers et 995 tests passent. Le noyau Go final passe : 341 tests racine démarrés, 4 skips historiques, 1 326 sous-tests/actions PASS. Les packages complémentaires observabledecision et sourcepolicy ont 57 + 5 racines et 104 + 8 PASS.

Validation SDK : build, onze typechecks, 460 tests linter ciblés, test Node Server V1 et 56 tests de scripts passent. La composition privée macOS SDK + Codegraph conserve huit rapports complets identiques sur une copie d’Operations, hors durée, y compris éditions ID/body, analyses fraîches et réparations ; aucun import du bootstrap legacy. Cela ne qualifie ni douze projets ni une distribution publique. La dernière suite SDK complète reste en échec : 1 749 tests passent, un test de membership de répertoire ne reçoit pas son événement. Les reprises isolées restent instables ; des sondes indépendantes Node/Bun manquent également des événements. Un délai de test plus long n’a pas résolu le problème et a été écarté. Ce checkpoint ne revendique donc pas une suite SDK entièrement verte.

Nettoyage : 42 caches Go standard retirés (~75,9 Gio alloués avant suppression), huit worktrees d’essais archivés puis retirés, quatre inscriptions Git absentes purgées. Les archives vérifient la présence de chaque fichier inclus, ses octets, permissions et liens. Après les nouveaux builds et le cache recréé, le périmètre perf + consolidation passe de 210,6 à 142,8 Gio alloués (du), soit environ 67,7 Gio de moins. Les caches sont reproductibles ; les sources et preuves retenues sont conservées.

Pour reproduire les gates source, utiliser Node 26.7.0, Go 1.26.5, TTSC 0.25.0, le pnpm déclaré par chaque dépôt et Bun 1.4.0 pour SDK. Installer avec `pnpm install --frozen-lockfile`, puis lancer `pnpm build`, `pnpm typecheck`, `pnpm check` (Codegraph), `pnpm test`. Pour la suite source Codegraph, construire avec `node scripts/native/build.mjs --output <répertoire-local> --cache-directory <cache-local>` et définir `CODEGRAPH_TEST_NATIVE_BINARY=<répertoire-local>/bin/codegraph-native`. La qualification Go principale utilise `node scripts/native/test.mjs --files-json '["."]' --options-json '["-json","-timeout","180s","-owned-artifact","<archive-owned-oxlint-1.81>"]'`.

Le SDK dépend ici d’un lien local vers la distribution privée Codegraph construite depuis les sources ci-dessus. Son package.json ne déclare pas encore cette dépendance, et le manifeste de release Codegraph suivi par Git n’est pas actualisé sur toutes les plateformes. Les commandes SDK sur une installation isolée requièrent donc encore cette liaison locale ; les résultats de composition ne prouvent pas une release npm prête. Le manifeste adjacent conserve les identités et résultats. L’exécution shell est rétablie et vérifiée après renouvellement de la session/du daemon ; la prévention durable de l’accumulation de descripteurs reste à qualifier. Les logs détaillés, archives et commandes exactes restent dans le dossier coordonné local `linter-consolidation-20261004/evidence`.

Prochaines priorités : finaliser la validation des watchers SDK ; rapprocher ce checkpoint du main actuel de chaque dépôt ; préparer une paire de packages compatible avec dépendance SDK explicite et assets natifs/Rust complets ; qualifier l’installation consommateur. Ensuite, comparer réellement cold/warm/noop, RSS et qualité des diagnostics sur les projets figés, puis reprendre les refontes structurelles en retirant les chemins remplacés après preuve d’équivalence. Le gain >10× et la réduction nette de code restent ouverts.
