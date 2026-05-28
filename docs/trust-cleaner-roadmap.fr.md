# Trust Cleaner - Roadmap Et MVP

## Decision Produit

On part sur `Trust Cleaner` comme nouvelle piste mini-app Garage.

L'idee n'est pas de "noter les gens" ou d'accuser des profils. L'app doit aider un utilisateur Circles a comprendre son graphe de trust, repere les relations a verifier, puis retirer proprement des trusts qu'il ne veut plus garder.

Positionnement simple :

> Nettoyer son trust graph Circles sans perdre 1000 ans a chercher les relations problematiques une par une.

## Probleme

Dans Circles, trust quelqu'un n'est pas juste un follow social. C'est une relation economique : on accepte son CRC personnel comme credible dans son propre graphe.

Si un utilisateur trust trop de profils faibles, inconnus, inactifs, ou non alignes avec son groupe, il peut rendre son propre graphe moins propre et moins lisible.

Aujourd'hui, le probleme produit est tres concret :

- difficile de voir toutes les personnes que l'on trust ;
- difficile de voir qui nous trust en retour ;
- difficile de separer les relations mutuelles des relations a sens unique ;
- difficile de filtrer par profil, score, backer direct, backer indirect ou aucun signal ;
- difficile de retirer plusieurs trusts sans passer par beaucoup de pages et d'actions manuelles.

## Primitives Circles Utilisees

Trust Cleaner doit etre une vraie mini-app Circles native.

Primitives principales :

- wallet Circles connecte ;
- profil Circles : nom, image, adresse ;
- relations de trust sortantes : les profils que l'utilisateur trust ;
- relations de trust entrantes : les profils qui trust l'utilisateur ;
- relations mutuelles : confiance dans les deux sens ;
- action `untrust` via le SDK Circles ;
- trust score et backer status si disponible ;
- historique local des actions de nettoyage.

Point important : le CRC n'a pas besoin d'etre force dans le MVP. La primitive principale ici est le trust graph.

## MVP Strict

Le MVP doit prouver une seule chose :

> Je connecte mon wallet, je vois clairement mes relations de trust, je selectionne celles que je veux retirer, puis je signe l'untrust.

### MVP 1 - Audit Read-Only

Statut cible : `A faire`.

Objectif : afficher le graphe sans action destructive.

Fonctions :

- connecter un wallet Circles ;
- lire l'adresse depuis le mini-app host ou un flow standalone ;
- recuperer les trusts sortants ;
- recuperer les trusts entrants si la source de donnees le permet proprement ;
- calculer les relations mutuelles et non mutuelles ;
- enrichir les lignes avec profil Circles, trust score et backer status quand disponible ;
- afficher une surface simple avec filtres.

Criteres de validation :

- l'utilisateur voit combien de profils il trust ;
- l'utilisateur voit combien le trust en retour ;
- l'utilisateur voit les relations a sens unique ;
- aucune transaction n'est encore possible dans cette etape.

### MVP 2 - Untrust Manuel

Statut cible : `A faire`.

Objectif : retirer un trust, mais de facon tres controlee.

Fonctions :

- bouton `Review untrust` sur une ligne ;
- modal de confirmation claire ;
- texte qui explique la consequence ;
- signature de la transaction d'untrust ;
- retour succes / erreur ;
- refresh de la liste apres transaction.

Criteres de validation :

- un profil peut etre untrust depuis l'app ;
- la transaction passe dans le Playground ou dans l'app Circles ;
- la ligne disparait ou passe en statut `removed`.

### MVP 3 - Multi-Select

Statut cible : `A faire`.

Objectif : rendre l'app vraiment utile pour les gros graphes.

Fonctions :

- selectionner plusieurs relations ;
- panier d'untrust ;
- review avant signature ;
- batch si le SDK/runner le permet ;
- sinon execution sequentielle avec progression claire ;
- historique des actions effectuees.

Criteres de validation :

- l'utilisateur peut preparer une liste de profils a retirer ;
- aucune action n'est envoyee sans confirmation finale ;
- l'app reste comprehensible si une transaction echoue au milieu.

## Filtres MVP

Filtres prioritaires :

- `Not mutual` : je trust, mais la personne ne me trust pas ;
- `Mutual` : trust dans les deux sens ;
- `No profile` : profil Circles absent ou incomplet ;
- `No backer link` : ni direct backer ni indirect backer connu ;
- `Low trust score` : score faible si disponible ;
- `Unknown trust score` : aucun score trouve ;
- `Indirect backer` ;
- `Direct backer`.

Filtres post-MVP :

- relation tres ancienne ;
- relation recente ;
- profil inactif ;
- groupe ou tag custom ;
- deja examine ;
- jamais examiner.

## Labels De Risque

Il faut eviter les mots agressifs comme `malicious`, `scam`, `bad actor`, sauf preuve externe forte.

Labels proposes :

- `Clean` : relation mutuelle ou profil avec signaux solides ;
- `Review` : relation a verifier ;
- `Weak signal` : peu de donnees disponibles ;
- `One-way` : trust non mutuel ;
- `Unknown` : profil ou score manquant ;
- `Remove candidate` : l'utilisateur l'a marque pour review.

L'app doit recommander une verification, pas juger automatiquement.

## Ecrans MVP

### 1. Home / Graph Summary

Surface compacte :

- profil Circles connecte ;
- nombre total de trusts sortants ;
- nombre de trusts entrants ;
- nombre de relations mutuelles ;
- nombre de relations a sens unique ;
- score de proprete simple, par exemple `Graph hygiene`.

### 2. Trust Table

Liste principale :

- avatar ;
- nom Circles ;
- adresse courte ;
- statut relation : `mutual`, `one-way`, `incoming only` ;
- trust score ;
- backer status ;
- badges ;
- derniere date connue si disponible ;
- action `Review`.

La table doit rester lisible sur mobile : des lignes compactes, pas des grosses cards.

### 3. Review Drawer

Avant toute transaction :

- liste des profils selectionnes ;
- explication de l'action ;
- nombre de transactions estimees ;
- bouton final `Untrust selected`.

### 4. Result Screen

Apres action :

- succes ;
- echecs ;
- transactions ;
- bouton `Refresh graph`.

## Sources De Donnees A Confirmer

Officiel Circles :

- SDK `sdk.data.getTrustRelations(address)` pour lire des relations ;
- RPC `rpc.trust.getTrusts(address)`, `getTrustedBy(address)` et `getMutualTrusts(address)` pour separer sortants, entrants et mutuels ;
- Avatar trust helpers : `trust.add`, `trust.remove`, `isTrusting`, `isTrustedBy`, `getAll` ;
- un `ContractRunner` est necessaire pour les appels qui modifient l'etat ;
- `trust.remove(address[])` peut batch plusieurs removals avec un Safe runner ; avec un EOA runner, il faut rester sur une adresse a la fois ou sequencer.

Deja utilise dans CRC Boost :

- `src/lib/garage-trust.ts` pour trust score, backer direct, backer indirect et cache DB ;
- endpoint `/api/garage/trust/status` pour refresh d'un profil ;
- `/api/profiles` et `/api/profiles/search` pour noms/images Circles ;
- badges direct/indirect backer ;
- logique mini-app / Playground ;
- UI mobile responsive.

A verifier avant implementation :

- peut-on recuperer facilement les relations entrantes a grande echelle ;
- est-ce que le runner fourni par le mini-app host permet le batch, ou si on doit sequencer les removals ;
- comportement exact du passkey dans le Playground pour une transaction `untrust` ;
- limites et latence du RPC Circles pour les gros graphes.

## Reutilisation CRC Boost

On peut reprendre :

- provider mini-app et detection Playground ;
- composants profil Circles ;
- badges trust/backer ;
- helper de fetch profile ;
- cache DB `garage_trust_profiles`, a renommer si on cree un repo propre ;
- style general de page mini-app ;
- gestion des etats success/error locaux ;
- fallback mobile/desktop pour le Playground.

On ne reprend pas :

- OAuth X ;
- verification X ;
- payout CRC ;
- campagne creator ;
- referral reward ;
- logique de settlement.

Trust Cleaner doit rester plus simple et plus natif Circles.

## Reutilisation NF Society

Possibles briques a reprendre :

- DA / theme si on veut rester dans l'ecosysteme NF Society ;
- modal profil ;
- assets logo ;
- helpers wallet/profil ;
- wording communautaire.

Mais le MVP doit pouvoir exister comme app autonome.

## Roadmap Par Etapes

### Phase 0 - Recherche Technique

Statut : `A faire`.

Objectif : verifier le read/write exact du trust graph.

Checklist :

- confirmer la methode SDK pour lire les trusts sortants ;
- confirmer la source pour les trusts entrants ;
- tester `trust.remove` sur un wallet de test ;
- comprendre si le batch est possible ;
- documenter la limite RPC.

Sortie attendue : une note courte avec les methodes exactes, les risques et la decision d'architecture.

### Phase 1 - Read-Only Audit

Statut : `A faire`.

Objectif : app utilisable sans transaction.

Livrable :

- page connect wallet ;
- graph summary ;
- table des trusts ;
- filtres de base ;
- profils enrichis ;
- refresh manuel.

### Phase 2 - Manual Untrust

Statut : `A faire`.

Objectif : retirer un seul trust de maniere sure.

Livrable :

- modal de review ;
- transaction d'untrust ;
- refresh post-transaction ;
- messages d'erreur propres.

### Phase 3 - Multi-Select Cleaner

Statut : `A faire`.

Objectif : vraie valeur produit.

Livrable :

- selection multiple ;
- panier ;
- review finale ;
- batch ou sequence ;
- progression ;
- historique.

### Phase 4 - Risk Signals

Statut : `A faire`.

Objectif : aider a prioriser sans juger automatiquement.

Livrable :

- labels `mutual`, `one-way`, `unknown`, `weak signal` ;
- tri par priorite ;
- score hygiene simple ;
- explication de chaque signal.

### Phase 5 - Saved Decisions

Statut : `A faire`.

Objectif : eviter de revoir toujours les memes profils.

Livrable :

- marquer `keep`, `review later`, `remove candidate` ;
- historique local ou DB ;
- export CSV simple.

### Phase 6 - Group Mode

Statut : `A garder de cote`.

Objectif : nettoyer un graphe communautaire ou DAO.

Idees :

- comparer les trusts de plusieurs membres ;
- detecter les profils trustes par beaucoup de membres mais avec peu de signaux ;
- proposer une liste commune de review ;
- jamais auto-untrust.

## Pitch Garage

Version courte :

> Trust Cleaner helps Circles users audit and clean their trust graph. Connect your wallet, review mutual and one-way trust relationships, then safely untrust profiles you no longer want in your graph.

Version FR :

> Trust Cleaner aide les utilisateurs Circles a auditer et nettoyer leur graphe de confiance. Connecte ton wallet, visualise les trusts mutuels ou a sens unique, puis retire proprement les relations que tu ne veux plus garder.

Pourquoi ca colle aux criteres Garage :

- `Circles integration quality` : l'app utilise directement le trust graph et les transactions d'untrust ;
- `Usefulness` : un utilisateur non-crypto peut comprendre le besoin : nettoyer ses relations de confiance ;
- `UX` : la valeur est dans une table claire et une action controlee ;
- `Activity` : les gens peuvent revenir quand leur graphe grossit ;
- `Referrals` : pas prioritaire au MVP, mais peut venir plus tard avec des audits partages.

## Questions Ouvertes

- Est-ce qu'on cree un nouveau repo ou on part d'une copie propre du squelette CRC Boost ?
- Est-ce que l'app doit etre strictement mini-app embedded, ou aussi standalone ?
- Est-ce qu'on stocke l'historique en DB des le MVP, ou seulement apres la premiere demo ?
- Quels signaux sont justes a afficher sans creer de jugement injuste ?
- Est-ce qu'on affiche les incoming-only trusts, meme si l'action principale est sur les outgoing trusts ?
- Est-ce qu'on veut un branding NF Society visible, ou une app plus neutre ?

## Prochaine Action

Avant de coder, faire une spike technique :

1. creer une route/page de test qui lit `getTrustRelations` pour le wallet connecte ;
2. afficher les relations brutes dans une table debug ;
3. verifier qu'on peut enrichir les adresses avec profils Circles ;
4. tester une transaction `trust.remove` sur un wallet de test ;
5. decider si on cree un nouveau repo Trust Cleaner ou si on part d'un dossier temporaire dans CRC Boost.

La premiere version a construire doit etre `read-only audit`, pas le bulk untrust direct.
