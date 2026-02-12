# IAQverse Frontend - React 19.2 ✅

Application React moderne pour la gestion et la visualisation de la qualité de l'air intérieur.

**🎉 Version complète avec toutes les fonctionnalités implémentées !**

## 🚀 Technologies

### Core
- **React 19.0** - Framework UI dernière version
- **Vite 6** - Build tool & dev server ultra-rapide
- **React Router 7** - Routing moderne
- **Zustand** - State management léger
- **i18next** - Internationalisation (5 langues)
- **Supabase** - Authentification & backend

### Fonctionnalités Avancées ✅
- **Chart.js + react-chartjs-2** - Graphiques interactifs temps réel
- **Three.js + React Three Fiber** - Visualisation 3D immersive
- **Driver.js** - Tutoriels interactifs guidés
- **Vitest + Testing Library** - Suite de tests complète

## 📦 Installation

```bash
npm install
```

## 🛠️ Développement

```bash
# Lancer le serveur de développement
npm run dev

# Lancer les tests
npm test

# Tests avec interface graphique
npm run test:ui

# Tests avec rapport de couverture
npm run test:coverage

# Linter le code
npm run lint
```

L'application sera disponible sur `http://localhost:3000`

## 🏗️ Build Production

```bash
npm run build
npm run preview
```

## 📁 Structure du Projet

```
src/
├── assets/          # Images, icons, etc.
├── components/      # Composants réutilisables
│   ├── common/      # Navbar, Loading, Theme, etc.
│   ├── charts/      # Chart.js components ✅
│   ├── three/       # Three.js 3D components ✅
│   └── alerts/      # Alert system ✅
├── pages/           # Pages de l'application
├── services/        # Services (API, WebSocket, etc.)
├── hooks/           # Custom hooks (useTutorial, etc.) ✅
├── stores/          # Zustand stores (5 stores)
├── utils/           # Utilitaires
├── i18n/            # Traductions (FR, EN, ES, DE, IT)
├── styles/          # Styles globaux + driver.css ✅
├── tests/           # Tests Vitest ✅
├── App.jsx          # Composant racine avec routing
└── main.jsx         # Point d'entrée
```

## 🌐 Pages Supabase
- `/signup` - Inscription
- `/reset-password` - Réinitialisation mot de passe
- `/` - **Dashboard** avec graphiques Chart.js & alertes ✅
- `/digital-twin` - **Jumeau numérique 3D** avec Three.js ✅
- `/settings` - Paramètres utilisateur avec tutoriel ✅

## 🎨 Fonctionnalités Implémentées

### ✅ Dashboard Complet
- Score IAQ temps réel

### Variables d'environnement

Créer un fichier `.env` basé sur `.env.example` :

```env
VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_ANON_KEY=your_supabase_key
```

## 📖 Documentation Complète

- [MIGRATION.md](./MIGRATION.md) - Guide de migration HTML vers React
- [SCRIPTS.md](./SCRIPTS.md) - Documentation des scripts
- [SUMMARY.md](./SUMMARY.md) - Résumé technique
- [FEATURES-COMPLETE.md](./FEATURES-COMPLETE.md) - **Fonctionnalités complètes** ✅

## 🎯 Statut du Projet

**✅ 100% COMPLET**

- ✅ Migration React 19.2
- ✅ Graphiques Chart.js (3 types)
- ✅ Visualisation 3D React Three Fiber
- ✅ Système d'alertes complet
- ✅ Tutoriels Driver.js (3 flows)
- ✅ Tests Vitest (18+ tests)

**Prêt pour la production ! 🚀**

---

*Migration effectuée le 11 février 2026*  
*IAQverse - React 19.2 - Édition Complète*
- Métriques live (température, humidité, CO₂)
- **3 graphiques Chart.js interactifs**
- **Système d'alertes avec gestion complète**
- **Tutoriel guidé Driver.js**

### ✅ Visualisation 3D
- **Scène 3D complète avec React Three Fiber**
- **Bâtiment multi-étages interactif**
- **Capteurs 3D cliquables avec données**
- **Mode plein écran**
- Contrôles OrbitControls (rotation, zoom, pan)

### ✅ Système d'Alertes
- 4 types d'alertes (info, success, warning, error)
- Auto-dismiss configurable
- Marquer comme lu / Supprimer
- Compteur de non-lus
- Store Zustand dédié

### ✅ Tutoriels Interactifs
- 3 tutoriels guidés (Dashboard, Digital Twin, Settings)
- Auto-démarrage à la première visite
- Support thème clair/sombre
- Bouton d'aide flottant

### ✅ Tests Vitest
- 18+ tests unitaires
- Tests des stores (auth, alerts)
- Tests des composants
- Tests des services
- Interface de test graphique
- Rapport de couverture

### ✅ Thème & I18n
- Mode clair/sombre persistant
- 5 langues supportées (FR, EN, ES, DE, IT)
- Sauvegarde des préférences

### ✅ WebSocket Temps Réel
- Connexion automatique
- Mise à jour instantanée
- Gestion de la reconnexion
- `/digital-twin` - Jumeau numérique 3D
- `/settings` - Paramètres utilisateur

## 🔧 Configuration

Les configurations sont chargées depuis `/assets/config.json` au démarrage de l'application.
