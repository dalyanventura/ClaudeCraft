# ClaudeCraft — Claude Code par-dessus World of Warcraft

Une fenêtre superposée (overlay), toujours au premier plan, qui s'affiche et se masque
avec un raccourci global. Vous pouvez y travailler avec Claude Code pendant que vous jouez.

## Pourquoi une application et pas un addon ?

Les addons WoW tournent dans un environnement Lua isolé : pas d'accès réseau, pas de
lancement de programmes, pas de fichiers (hors SavedVariables au `/reload`). Un addon ne
peut donc pas dialoguer avec Claude Code. L'overlay est une application Windows
indépendante : elle ne lit pas la mémoire du jeu et n'envoie aucune frappe à WoW.

## Fonctionnalités

- **Liste des projets et sessions** existants (`~/.claude/projects`). Elle inclut aussi
  les sessions de l'onglet Code de l'application Claude Desktop.
  - clic sur une session : la reprendre (`claude --resume`) ;
  - `+ Nouvelle` : nouvelle conversation dans ce projet ;
  - `↻` : reprendre la conversation la plus récente du projet (`claude --continue`).
- **Nouveau projet** : crée un dossier dans `~/ClaudeProjects` et y lance Claude.
- **Ouvrir un dossier…** : lance Claude dans n'importe quel dossier.
- **Onglets** : plusieurs sessions en parallèle, avec une pastille d'état
  (bleu = travaille, vert = attend votre réponse, orange = demande une autorisation).
- **Signal sonore** quand Claude a fini (arpège montant) ou demande une autorisation
  (double appel). Le son est coupé si vous regardez déjà l'onglet concerné.
- **Bouton flottant** « ◆ Claude », toujours affiché en jeu, que la fenêtre soit
  ouverte ou réduite (« — »). Il indique l'état de Claude (travaille, vous attend,
  demande une autorisation). Un clic ouvre ou réduit la fenêtre ; glissez-le pour le
  déplacer (sa position est mémorisée). Il ne prend jamais le clavier au jeu.
- **Mode jeu** (bouton 🎮, activé par défaut) : la fenêtre et le bouton ne s'affichent
  que par-dessus WoW. Dès que Steam, Discord, le navigateur, etc. passent au premier
  plan, ils deviennent invisibles et ne réagissent plus aux clics ni au raccourci ;
  ils réapparaissent instantanément quand vous revenez dans le jeu (rien n'est fermé
  ni rouvert). Désactivez le bouton pour garder l'overlay au-dessus de tout.
- ClaudeCraft n'apparaît ni dans la barre des tâches ni dans Alt+Tab : on y accède
  par le bouton flottant ou le raccourci, depuis le jeu.
- Opacité réglable, position et taille mémorisées.

## Raccourcis

| Action | Touche |
|---|---|
| Afficher / masquer l'overlay (global) | `Ctrl+Alt+C` |
| Coller du texte | `Ctrl+V` ou clic droit |
| Copier la sélection | `Ctrl+C` (avec sélection) ou clic droit |
| Interrompre Claude | `Échap` |
| Coller une image dans Claude | `Alt+V` |

Le raccourci alterne entre la fenêtre et le bouton flottant. Il fonctionne aussi hors
du jeu.

## Réglage de WoW

Dans *Système → Graphismes*, choisissez **Mode d'affichage : Plein écran fenêtré**.
En plein écran exclusif, Windows ne peut pas afficher d'autre fenêtre par-dessus le jeu.

## Installation

Prérequis :

1. [Node.js LTS](https://nodejs.org), par exemple : `winget install OpenJS.NodeJS.LTS`.
2. Claude Code (CLI). L'application cherche dans cet ordre :
   - `claude.exe` de l'installation native (`~/.local/bin`) ;
   - `claude` dans le PATH ou installé via npm ;
   - le binaire fourni avec l'application Claude Desktop.

   Installation officielle : `irm https://claude.ai/install.ps1 | iex`.

Puis, dans ce dossier :

```powershell
npm install
npm start
```

Au premier lancement d'une session, Claude Code demande de choisir un thème, puis de
**se connecter** (option 1 : compte Claude avec abonnement). La connexion du CLI est
distincte de celle de l'application Claude Desktop. Il ne faut la faire qu'une fois.

Si `npm start` indique qu'Electron n'est pas installé (certaines versions de npm ne lancent
pas les scripts d'installation), exécutez `node node_modules/electron/install.js`.

Évitez de placer ce projet dans un dossier synchronisé par OneDrive : des fichiers y ont
disparu pendant le développement.

## Configuration

Le fichier `%APPDATA%\ClaudeCraft\config.json` est créé au premier réglage.
Clés utiles :

- `hotkey` : par ex. `"Control+Alt+C"` ou `"Alt+F12"` ;
- `overlayMode` : `"wow"` (passe derrière les autres applications) ou `"always"` ;
- `bubblePos` : position du bouton flottant (mémorisée automatiquement) ;
- `gameProcesses` : exécutables considérés comme le jeu
  (par défaut `Wow.exe`, `WowClassic.exe`… ; WoW Forever utilise `Wow.exe`) ;
- `projectsDir` : dossier des nouveaux projets ;
- `claudePath` : chemin forcé vers `claude.exe` ;
- `volume` : de `0` à `1`.

## Fonctionnement du signal sonore

Chaque session lancée par l'overlay reçoit un fichier de réglages (`--settings`) qui
ajoute des *hooks* Claude Code (`SessionStart`, `UserPromptSubmit`, `Stop`, `Notification`).
Ces hooks envoient l'événement à un petit serveur local de l'overlay (`127.0.0.1`, port
aléatoire, jeton secret). Vos réglages Claude habituels ne sont pas modifiés.

## Développement

`CC_DEV_SCRIPT=<fichier.js>` exécute un script de test dans le processus principal
(captures d'écran, état de l'overlay…). Voir `runDevScript` dans `src/main.js`.

## Avertissement

Projet personnel non officiel, sans lien avec Anthropic ni Blizzard Entertainment.
Claude et Claude Code sont des marques d'Anthropic ; World of Warcraft est une marque de
Blizzard Entertainment. Fonctionne uniquement sous Windows.

## Licence

MIT — voir [LICENSE](LICENSE).
