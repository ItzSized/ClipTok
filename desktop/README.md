# ClipTok — application Windows

Fenêtre Electron qui lance ClipTok sans terminal : elle démarre l'API (port 4000) et le site (port 3000), ou réutilise ceux déjà lancés par `npm run dev`, puis ouvre l'interface dans sa propre fenêtre.

## Utilisation

```bash
npm run install:desktop   # une fois
npm run app               # lance l'application depuis le dépôt
npm run app:build         # crée l'installeur : desktop/dist/ClipTok Setup <version>.exe
```

L'installeur ajoute ClipTok au menu Démarrer et sur le Bureau. Il enregistre l'emplacement de ce dossier de projet : l'application utilise le code, le venv Python et les données du projet (rien n'est dupliqué). Si le projet est déplacé, l'application demande le nouveau dossier (aussi modifiable depuis l'icône de la zone de notification).

## Détails

- Écran de démarrage pendant le lancement des serveurs ; en cas d'échec : Réessayer / Journaux / Quitter.
- Icône dans la zone de notification : redémarrer les serveurs, ouvrir les journaux, changer de dossier de projet.
- Les serveurs lancés par l'application sont redémarrés s'ils plantent et arrêtés à sa fermeture ; ceux lancés à la main ne sont jamais arrêtés.
- Journaux : `%APPDATA%\ClipTok\logs\api.log` et `site.log`.
- Raccourcis : F5 recharger, F11 plein écran, F12 outils de développement.
