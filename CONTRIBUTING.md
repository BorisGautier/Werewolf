# 🐺 Guide de Contribution — EpicWolf Game

Merci de votre intérêt pour contribuer au projet **EpicWolf Game** ! 🚀  
Ce document contient les consignes et les bonnes pratiques pour participer au développement du bot.

---

## 🛠️ Stack Technique

- **Langage principal :** TypeScript (Node.js 20+ / ES2022)
- **Framework Telegram :** `grammy` (GrammyJS)
- **Base de données & ORM :** PostgreSQL & Prisma ORM
- **Framework de Test :** Vitest (570+ tests)
- **Intelligence Artificielle :** Google Gemini 2.5 API (Mode Bots)
- **Conteneurisation :** Docker & Docker Compose
- **Système d'i18n :** Fichiers de langues JSON ([`locales/fr.json`](locales/fr.json), [`locales/en.json`](locales/en.json))

---

## 🚀 Installation & Démarrage en Local

### 1. Prérequis
- [Node.js](https://nodejs.org/) v20.x ou plus récent
- [Docker](https://www.docker.com/) & Docker Compose (pour PostgreSQL)
- Un jeton de Bot Telegram fourni par [@BotFather](https://t.me/BotFather)

### 2. Cloner le projet
```bash
git clone https://github.com/BorisGautier/Werewolf.git
cd Werewolf
```

### 3. Installer les dépendances
```bash
npm install
```

### 4. Configuration de l'environnement
Copiez le fichier `.env.example` vers `.env` et remplissez vos identifiants :
```bash
cp .env.example .env
```

Dans `.env` :
- `BOT_TOKEN` : Votre jeton de bot Telegram de test
- `DATABASE_URL` : `postgresql://postgres:postgres@localhost:5432/werewolf_dev`
- `ADMIN_PASSWORD` : Mot de passe d'accès au dashboard admin Web

### 5. Démarrer la base de données PostgreSQL
```bash
docker compose up -d postgres
```

### 6. Synchroniser Prisma et lancer le Bot
```bash
npx prisma db push
npm run dev
```

---

## 🧪 Tests & Qualité de Code

Avant de soumettre une Pull Request, assurez-vous que l'ensemble de la suite de tests passe avec succès :

```bash
# Exécuter les 577 tests unitaires et de simulation
npm test
```

### Règles de développement :
- **Architecture Domaine (DDD) :** Les règles métiers pures (calcul de victoires, résolution des actions de nuit, clairvoyance) résident dans `src/domain/`.
- **Infrastructure :** La communication Telegram, l'ORM Prisma et le serveur Web sont isolés dans `src/infrastructure/`.
- **Zéro Régression :** Tout nouveau rôle ou fonctionnalité doit être accompagné de tests unitaires dans `test/domain/` ou `test/infrastructure/`.

---

## 🌿 Stratégie de Branches & Pull Requests

1. **Créer une branche de fonctionnalité :**
   ```bash
   git checkout -b feat/nom-de-votre-feature
   # ou pour un bug :
   git checkout -b fix/nom-du-bug
   ```
2. **Utiliser les Modèles d'Issues (Issue Templates) :**
   Si vous ouvrez une issue sur GitHub, veuillez utiliser le modèle approprié :
   - 🐛 **Rapport de Bug**
   - ✨ **Nouvelle Fonctionnalité**
   - 🎭 **Proposition de Nouveau Rôle**
   - 🌀 **Proposition de Mode de Jeu**
   - ⚖️ **Ajustement d'Équilibrage**
   - 🌐 **Traduction & Textes (i18n)**
   - 🚨 **Performance & Crash**

3. **Soumettre la Pull Request :**
   - Assurez-vous que le titre respecte la convention [Conventional Commits](https://www.conventionalcommits.org/) (ex: `feat: add witch potion animation`, `fix: correct augur sees text`).
   - Ciblez la branche **`main`** du dépôt `BorisGautier/Werewolf`.

---

## 📜 Licence
Ce projet est sous licence libre.
