# Trust Cleaner - Recap Nouvelle Session

Ce document sert de passation pour reprendre le projet dans une nouvelle session Codex sans perdre le contexte.

## Situation Actuelle

CRC Boosts a ete soumis au Garage Circles et a gagne la premiere semaine du cycle 01.

On ne veut pas forcer une grosse v2 de CRC Boosts si les ajouts ne rendent pas l'app beaucoup plus utile. La nouvelle piste principale est donc `Trust Cleaner`, une mini-app Circles centree sur le graphe de confiance.

Repo actuel utilise pour les notes et references :

- `C:\Projects\crc-boost-market`

Fichiers deja crees :

- `docs/cycle-02-strategy.fr.md`
- `docs/trust-cleaner-roadmap.fr.md`
- `docs/trust-cleaner-session-recap.fr.md`

## Idee Produit

Trust Cleaner aide un utilisateur Circles a auditer et nettoyer son trust graph.

Le probleme :

- dans Circles, trust quelqu'un n'est pas juste un follow social ;
- trust quelqu'un signifie accepter son CRC/personnal token dans son graphe ;
- trop de trusts faibles, inconnus ou non mutuels peuvent rendre le graphe personnel moins propre ;
- aujourd'hui, verifier et retirer ces relations prend trop de temps.

Phrase produit :

> Nettoyer son trust graph Circles sans perdre 1000 ans a chercher les relations problematiques une par une.

## Positionnement Garage

Trust Cleaner est plus natif Circles que CRC Boosts sur un point cle : il utilise directement le trust graph comme primitive principale.

Pourquoi ca peut bien marcher pour Garage :

- `Circles integration quality` : trust graph, profils Circles, relations mutuelles, action untrust ;
- `Usefulness` : un utilisateur comprend vite l'interet de nettoyer ses relations ;
- `UX` : app tres concrete, pas besoin de mecanique crypto compliquee ;
- `Activity` : les gens peuvent revenir quand leur graphe grossit ;
- `Referrals` : pas prioritaire au MVP.

## MVP Valide A Construire

Le MVP doit prouver une seule chose :

> Je connecte mon wallet, je vois clairement mes relations de trust, je selectionne celles que je veux retirer, puis je signe l'untrust.

### MVP 1 - Audit Read-Only

Construire d'abord une version sans transaction.

Fonctions :

- connecter wallet Circles ;
- recuperer les trusts sortants ;
- recuperer les trusts entrants ;
- separer `mutual`, `one-way`, `incoming only` ;
- enrichir avec profil Circles : nom, image, adresse ;
- enrichir avec trust score et backer status quand disponible ;
- afficher un resume du graphe ;
- afficher une table compacte avec filtres.

Validation :

- l'utilisateur voit combien de profils il trust ;
- l'utilisateur voit combien le trustent en retour ;
- l'utilisateur voit les relations non mutuelles ;
- aucune action destructive n'est possible a cette etape.

### MVP 2 - Untrust Manuel

Ajouter ensuite une action sur une seule relation.

Fonctions :

- bouton `Review untrust` ;
- modal de confirmation ;
- explication claire de la consequence ;
- signature de la transaction `untrust` ;
- refresh apres succes ;
- affichage des erreurs.

Validation :

- un profil peut etre untrust depuis l'app ;
- transaction OK dans Circles / Playground ;
- la ligne est retiree ou marquee comme removed.

### MVP 3 - Multi-Select Cleaner

Rendre l'app vraiment utile pour les gros graphes.

Fonctions :

- selection multiple ;
- panier d'untrust ;
- review finale ;
- batch si possible ;
- sequence transactionnelle si batch impossible ;
- progression claire ;
- historique simple.

Validation :

- l'utilisateur peut preparer plusieurs removals ;
- rien n'est signe sans confirmation ;
- si une transaction echoue, l'app reste comprehensible.

## Sources Techniques Confirmees Localement

Le repo CRC Boost contient deja `@aboutcircles/sdk`.

Dans le SDK local, on a repere :

- `sdk.data.getTrustRelations(address)` ;
- `rpc.trust.getTrusts(address)` ;
- `rpc.trust.getTrustedBy(address)` ;
- `rpc.trust.getMutualTrusts(address)` ;
- `avatar.trust.remove(address)` ;
- `avatar.trust.remove(address[])`.

Point important :

- `trust.remove(address[])` peut batch avec un Safe runner ;
- avec un EOA runner, il faut rester sur une adresse ou sequencer ;
- a verifier avec le runner/passkey du mini-app host Circles.

## Code A Reutiliser Depuis CRC Boosts

Pieces utiles :

- mini-app provider / detection Playground ;
- connexion wallet ;
- affichage profil Circles ;
- `/api/profiles` et `/api/profiles/search` ;
- `src/lib/garage-trust.ts` pour trust score, direct backer, indirect backer ;
- table/cache `garage_trust_profiles` si on garde Neon ;
- badges direct/indirect backer ;
- styles responsive mobile ;
- copy de fallback Playground.

Pieces a ne pas reprendre :

- OAuth X ;
- verification X ;
- payout CRC ;
- campagnes createur ;
- referral rewards ;
- settlement.

Trust Cleaner doit rester plus simple et plus Circles-native.

## Code A Reutiliser Depuis NF Society

Possibles reprises :

- direction artistique ;
- composants profil ;
- helpers wallet/profil ;
- assets NF Society si on veut signer l'app ;
- wording communautaire.

Attention :

- ne pas melanger trop tot avec NF Society ;
- le MVP doit pouvoir exister comme mini-app autonome.

## Filtres MVP

Filtres importants :

- `Not mutual` : je trust, mais la personne ne me trust pas ;
- `Mutual` : trust dans les deux sens ;
- `Incoming only` : la personne me trust, mais je ne la trust pas ;
- `No profile` : profil Circles absent ou incomplet ;
- `No backer link` ;
- `Direct backer` ;
- `Indirect backer` ;
- `Low trust score` ;
- `Unknown trust score`.

## Wording Produit Important

Ne pas dire :

- scam ;
- malicious ;
- bad actor ;
- dangerous ;
- a supprimer automatiquement.

Dire plutot :

- `Review` ;
- `Weak signal` ;
- `One-way` ;
- `Unknown` ;
- `Remove candidate`.

L'app doit aider l'utilisateur a decider, pas accuser les autres profils.

## UX MVP

Interface conseillee :

- page compacte, pas landing page ;
- table claire, pas grosses cards ;
- lignes simples avec avatar, nom, relation, trust score, backer status ;
- filtres visibles ;
- detail en drawer/modal ;
- confirmation obligatoire avant untrust ;
- aucune action automatique ;
- mobile-first pour le Playground Circles.

## Roadmap De Travail

### Phase 0 - Spike Technique

Objectif : confirmer le read/write du trust graph.

Checklist :

- creer une page ou route de test ;
- lire les relations du wallet connecte ;
- afficher les relations brutes ;
- confirmer les champs retournes par `getTrusts`, `getTrustedBy`, `getMutualTrusts` ;
- tester l'enrichissement profil ;
- tester une transaction `trust.remove` sur un wallet de test ;
- verifier batch vs sequence.

### Phase 1 - Read-Only App

Objectif : app utilisable sans transaction.

Livrable :

- page Trust Cleaner ;
- connect wallet ;
- summary du graphe ;
- table des relations ;
- filtres ;
- profils enrichis ;
- refresh manuel.

### Phase 2 - Manual Untrust

Objectif : retirer une relation de trust.

Livrable :

- modal review ;
- transaction untrust ;
- retour success/error ;
- refresh liste.

### Phase 3 - Multi-Select

Objectif : nettoyer plusieurs relations.

Livrable :

- multi-select ;
- panier ;
- review finale ;
- batch/sequencing ;
- historique.

## Questions A Trancher

- Nouveau repo dedie ou copie propre du squelette CRC Boost ?
- Branding `Trust Cleaner` seul ou `Trust Cleaner by NF Society` ?
- Mini-app embedded uniquement ou standalone aussi ?
- Neon des le debut ou read-only sans DB pour MVP 1 ?
- Historique local ou DB ?
- Est-ce qu'on veut afficher aussi les incoming-only, meme si on ne peut pas les untrust ?
- Est-ce qu'on soumet une version read-only ou on attend manual untrust ?

## Proposition De Prochaine Session

Commencer par la Phase 0.

Premiere tache concrete :

> Construire une page de test Trust Cleaner qui connecte le wallet et affiche les relations brutes `trusts`, `trustedBy`, `mutualTrusts` pour l'adresse connectee.

Ne pas commencer par le design complet.
Ne pas commencer par le multi-select.
Ne pas commencer par une DB.

On doit d'abord verifier que la lecture du trust graph est fiable et rapide.

## Prompt Court Pour Reprendre

Copier ce resume dans la nouvelle session si besoin :

> On reprend Trust Cleaner, une nouvelle mini-app Garage Circles. Le but est d'auditer et nettoyer le trust graph d'un wallet : trusts sortants, entrants, mutuels, non mutuels, profils Circles, trust score/backer status, puis untrust manuel et multi-select plus tard. Le document de reference est `C:\Projects\crc-boost-market\docs\trust-cleaner-session-recap.fr.md`, et la roadmap detaillee est `C:\Projects\crc-boost-market\docs\trust-cleaner-roadmap.fr.md`. Commencer par la Phase 0 : lire et afficher les relations brutes du wallet connecte avec le SDK Circles, sans DB ni design complet.
