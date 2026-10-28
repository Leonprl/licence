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

1. Va dans l'onglet **Actions** du dépôt GitHub, ouvre la dernière exécution « Build » réussie (✅), puis télécharge en bas de la page l'artefact de ton système :
   - **Windows** : `Ma-Licence-Windows`, qui contient `Ma-Licence-Setup-x.y.z.exe`.
   - **Mac** : `Ma-Licence-macOS`, qui contient un `.dmg` (`arm64` pour les Mac M1/M2/M3/M4, `x64` pour les anciens Mac Intel).
   - **Linux** : `Ma-Licence-Linux`, qui contient un `.AppImage` ou un `.deb`.

   Si une version est publiée (tag `v…`), les mêmes fichiers sont aussi dans l'onglet **Releases**.
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

1. Colle l'adresse de ton Moodle (celle de ton navigateur, par exemple `moodle.univ-ville.fr`), puis clique sur **Vérifier**.
2. Choisis la méthode de connexion. L'appli met en avant celle qui convient à ton Moodle :
   - **Page de connexion de l'université (ENT, CAS…)** : une fenêtre s'ouvre et tu te connectes comme d'habitude. C'est la même méthode que l'appli mobile officielle Moodle. Ton mot de passe n'est pas enregistré.
   - **Identifiant et mot de passe Moodle**, si ton Moodle a des comptes « locaux ».
   - **Jeton** si rien d'autre ne marche : sur Moodle, va dans ton profil, puis *Préférences*, puis *Clés de sécurité*, et copie la clé « Moodle mobile web service ».

Si ton université a désactivé l'accès de l'appli mobile Moodle, aucune de ces méthodes ne marchera. Dans ce cas, demande au support informatique.

### Mails

L'appli lit ta boîte en **IMAP** (lecture seule) :

| Messagerie | Réglage |
|---|---|
| **Université** (Zimbra, Partage…) | Choisis « Messagerie de l'université ». Le nom du serveur IMAP est dans l'aide de ta messagerie ou sur le site de la DSI (port 993, SSL). |
| **Gmail** | Choisis « Gmail ». Il faut un *mot de passe d'application* : active la validation en deux étapes, puis crée-le sur <https://myaccount.google.com/apppasswords>. |
| **Microsoft 365 / Outlook** (fréquent dans les universités) | Beaucoup d'universités bloquent la connexion IMAP par mot de passe. Si le test échoue, crée dans Outlook Web une règle de **transfert automatique** vers une adresse Gmail, puis connecte ce Gmail. |

Clique sur **Tester la connexion**, puis sur **Enregistrer**. Le champ « Ne garder que les expéditeurs contenant » (par exemple `univ-ville.fr, moodle`) permet d'ignorer les mails perso.

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
- `src/main/extract.js` : repérage des examens, rendus et « à travailler » dans les textes en français (chrono-node).
- `src/main/ai.js` : extraction optionnelle avec Claude (sortie JSON structurée).
- `src/main/agenda.js` : fusion Moodle + mails + annonces, doublons, documents recommandés.
- `src/main/sync.js` : synchronisation, cache et notifications.
- `src/renderer/` : interface (HTML/CSS/JS sans framework).

Les données (réglages, cache, documents téléchargés) sont dans le dossier de données de l'appli : `%APPDATA%\Ma Licence` sur Windows, `~/Library/Application Support/Ma Licence` sur macOS, `~/.config/Ma Licence` sur Linux.
