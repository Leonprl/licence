# Ma Licence

Une appli de bureau (Windows, macOS, Linux) qui se connecte à ton **Moodle** et à ta **boîte mail**, et te fait un tableau de bord :

- **Agenda** : tout ce que tu dois rendre et tous tes examens, jour par jour (« jeudi 12 novembre, 14h : partiel de macro »), avec un compte à rebours.
- **À travailler** : quand un prof écrit « révisez les chapitres 1 à 3 », la phrase apparaît sous l'examen, avec les PDF du cours juste en dessous. Ceux qui correspondent aux chapitres cités sont marqués d'une ★.
- **Statut Moodle** : « Pas encore rendu », « Rendu », « En retard ». Tu peux aussi cocher toi-même ce qui est fait.
- **Semaine** : la vue « tableau » sur 7 jours.
- **Nouveautés** : nouveaux documents déposés sur Moodle, annonces des profs, mails importants.
- **Cours** : tous les documents de chaque cours. Un clic ouvre le PDF ; il est rangé dans un dossier par cours sur ton ordi.
- **Mise à jour automatique** toutes les 20 minutes, au démarrage de l'ordi et à la sortie de veille, avec des **notifications** (nouveau devoir, nouvel examen, nouveaux documents, rappel 24 h avant).

Tout reste sur ton ordinateur : l'appli ne modifie rien sur Moodle ni dans ta boîte mail. Les mots de passe et jetons sont chiffrés avec le trousseau du système.

## Installer

1. Ouvre la page de la dernière version, <https://github.com/Leonprl/licence/releases/latest>, et télécharge le fichier de ton ordinateur :
   - **Windows** : `Ma-Licence-Setup-x.y.z.exe`.
   - **Mac** : le `.dmg` qui finit par `arm64` pour les Mac M1/M2/M3/M4, ou par `x64` pour les anciens Mac Intel.
   - **Linux** : le `.AppImage` ou le `.deb`.
2. Lance l'installateur. L'appli n'est pas signée avec un certificat payant, donc :
   - **Windows** affiche « Windows a protégé votre ordinateur » : clique sur *Informations complémentaires*, puis *Exécuter quand même*.
   - **Mac** : glisse l'appli dans *Applications*. Si macOS dit qu'elle « est endommagée » ou « ne peut pas être ouverte », ouvre le Terminal et tape :
     ```bash
     xattr -cr "/Applications/Ma Licence.app"
     ```
     puis relance-la (clic droit, puis *Ouvrir*).

## Configurer (2 minutes)

Au premier lancement, clique sur **Configurer**.

### Moodle

1. Colle l'adresse de ton Moodle (celle de ton navigateur), puis clique sur **Vérifier**.
   - À **Sorbonne Université**, l'adresse change chaque année : pour 2026-2027 c'est `moodle-lettres-26.sorbonne-universite.fr` (Lettres) ou `moodle-sciences-26.sorbonne-universite.fr` (Sciences). Avec le Moodle de l'an dernier, l'appli ne verra pas tes examens de cette année (elle t'avertit si c'est le cas).
2. Clique sur le premier **Se connecter** (page de connexion de l'université). Une fenêtre s'ouvre directement sur la page CAS de ta fac : connecte-toi comme d'habitude, la fenêtre se ferme toute seule. C'est la même méthode que l'appli mobile officielle Moodle, et ton mot de passe n'est pas enregistré.
   - **Identifiant et mot de passe Moodle** : seulement si ton Moodle a des comptes « locaux ». Les comptes CAS (cas de la Sorbonne) n'ont pas de mot de passe Moodle.
   - **Jeton** si rien d'autre ne marche : sur Moodle, va dans ton profil, puis *Préférences*, puis *Clés de sécurité*, et copie la clé « Moodle mobile web service ».

### Mails

Mets **ton adresse mail et ton mot de passe**, puis clique sur **Se connecter** : l'appli trouve toute seule le serveur de ta messagerie. Elle lit ta boîte en lecture seule et continue en arrière-plan, sans te redemander de te connecter.

| Messagerie | Ce qu'il faut savoir |
|---|---|
| **Sorbonne Université** (`…@etu.sorbonne-universite.fr`) | Serveur trouvé automatiquement (`imaps.sorbonne-universite.fr`). Mot de passe : celui de ton compte Sorbonne (ENT). Si l'adresse est refusée, ouvre « Réglages avancés » et mets ton identifiant Sorbonne dans « Identifiant de connexion ». |
| **Gmail** et boîtes hébergées par Google | Il faut un *mot de passe d'application* : active la validation en deux étapes, puis crée-le sur <https://myaccount.google.com/apppasswords>. |
| **Microsoft 365 / Outlook** | Beaucoup d'établissements bloquent la connexion par mot de passe. Si ça échoue, crée dans Outlook Web une règle de **transfert automatique** vers une adresse Gmail, puis connecte ce Gmail. |

Dans « Réglages avancés », le champ « Ne garder que les expéditeurs contenant » (par exemple `sorbonne-universite.fr, moodle`) permet d'ignorer les mails perso.

### Emploi du temps (optionnel)

Si ta fac publie ton emploi du temps ou tes examens dans un agenda en ligne (ADE, ENT, Google Agenda…), copie son lien d'abonnement (`.ics`, « exporter » ou « s'abonner ») et ajoute-le dans **Réglages › Emploi du temps et calendriers**. L'appli n'en garde que les examens et les rendus, sauf si tu coches « tout afficher ».

### Vérifier que tout est pris en compte

En haut des réglages, **Ce que l'appli a vérifié** indique ce qui a été lu : nombre de cours, d'événements Moodle, de devoirs, d'annonces, de pages de cours, de mails et de calendriers, ainsi que les examens et rendus trouvés. Les dates d'examen ne sont pas toujours sur Moodle : elles arrivent souvent par mail ou dans l'emploi du temps, d'où l'intérêt de connecter les trois.

### Analyse par IA (optionnelle)

Sans IA, l'appli repère les dates (« jeudi prochain », « le 12/11 à 14h »…) et les mots-clés (partiel, CC, à rendre, chapitres…). Avec une clé API Anthropic (<https://console.anthropic.com>), Claude lit les mails et les annonces et comprend aussi les consignes plus floues. Ça coûte environ 1 à 2 centimes par mail analysé, et chaque mail n'est analysé qu'une seule fois. Le texte des mails qui parlent de cours est alors envoyé à l'API d'Anthropic.

## Pour les développeurs

```bash
npm install
```

```bash
npm start
```

```bash
npm test
```

```bash
npm run dist
```

`npm start` lance l'appli en mode développement, `npm test` lance les tests et `npm run dist` fabrique l'installateur du système courant dans `dist/`. Sur GitHub, le workflow `.github/workflows/build.yml` lance les tests puis fabrique les installateurs Windows, macOS et Linux à chaque push. Pousser un tag `v0.1.0` crée en plus une *Release* avec les fichiers.

Organisation du code :

- `src/main/moodle.js` : client des web services Moodle (ceux de l'appli mobile officielle).
- `src/main/moodle-sso.js` : connexion par la page de l'université (`launch.php` → `moodlemobile://token=…`).
- `src/main/mail.js` : lecture IMAP (imapflow + mailparser), pièces jointes enregistrées localement.
- `src/main/mail-detect.js` : trouve le serveur IMAP à partir de l'adresse (fournisseurs connus, MX, autoconfig Thunderbird).
- `src/main/ics.js` : lecture des liens d'emploi du temps (`.ics`).
- `src/main/extract.js` : repérage des examens, rendus et « à travailler » dans les mails, annonces et pages de cours en français (chrono-node).
- `src/main/ai.js` : extraction optionnelle avec Claude (sortie JSON structurée).
- `src/main/agenda.js` : fusion Moodle + mails + annonces, doublons, documents recommandés.
- `src/main/sync.js` : synchronisation, cache et notifications.
- `src/renderer/` : interface (HTML/CSS/JS sans framework).

Les données (réglages, cache, documents téléchargés) sont dans le dossier de données de l'appli : `%APPDATA%\Ma Licence` sur Windows, `~/Library/Application Support/Ma Licence` sur macOS, `~/.config/Ma Licence` sur Linux.
