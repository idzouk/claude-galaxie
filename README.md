# Galaxie ✦

Un mod pour Claude Code qui montre en direct ce que fait Claude.

- **Un panneau animé** à côté de la conversation : une planète en pixel art, et une comète en orbite pour chaque action en cours (lire un fichier, lancer une commande, chercher sur le web…), avec son nom écrit à côté. La couleur suit ce que fait Claude.
- **Ta demande et ses étapes** en bas du panneau, avec une barre de progression. Claude déclare lui-même ses étapes au début de chaque tâche et les coche en avançant.
- **Un bouquet de fin** (ondes et confettis) quand la réponse est prête.
- **Une mini-planète flottante** pour Mac, en option : elle reste au premier plan même quand tu quittes le terminal. Orange avec des comètes = Claude travaille, verte = réponse prête, grise = en veille.

## Installer le panneau

Dans Claude Code, tape :

```
/plugin install galaxie --marketplace idzouk/claude-galaxie
```

Réponds `y` pour ajouter la marketplace, puis choisis la portée (Entrée pour la première). Le panneau s'ouvre tout seul si ton terminal est assez large, sinon tape `/galaxie`.

Depuis un terminal classique, c'est la même chose :

```
claude plugin install galaxie --marketplace idzouk/claude-galaxie
```

Il faut une version récente de Claude Code : les mods sont une fonction en accès anticipé, qui peut évoluer.

## Installer la mini-planète (Mac seulement, optionnel)

Elle a besoin du mod Galaxie installé, qui lui envoie l'état de Claude. Tu la compiles toi-même, ça prend quelques secondes :

```
git clone https://github.com/idzouk/claude-galaxie.git
cd claude-galaxie/mini-planete
swiftc -O GalaxieWidget.swift -o galaxie-mini
./galaxie-mini &
```

S'il manque `swiftc`, installe les outils développeur d'Apple avec `xcode-select --install`.

Fais-la glisser où tu veux, elle retient sa place. **Clic droit → Quitter** pour la fermer. Elle ne se relance pas toute seule au démarrage du Mac : relance `./galaxie-mini &`.

## Désinstaller

- Le panneau : `/plugin`, choisis galaxie, puis « Uninstall » (ou `claude plugin uninstall galaxie`).
- La mini-planète : clic droit → Quitter, puis supprime le dossier `claude-galaxie`. Le mod laisse aussi un petit fichier d'état dans `~/.claude/galaxie-etat.json`, que tu peux supprimer.

Rien d'autre n'est installé ni envoyé où que ce soit : tout reste sur ton ordinateur.
