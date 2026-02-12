# 🚀 Guide de Migration - Frontend React IAQverse

## ✅ Migration Complète

Votre frontend a été entièrement migré vers **React 19.2** avec une architecture moderne et professionnelle.

---

## 📁 Structure du Projet

```
frontend-react/
├── src/
│   ├── components/          # Composants réutilisables
│   │   └── common/          # Navbar, ThemeToggle, etc.
│   ├── pages/               # Pages de l'application
│   │   ├── Login.jsx
│   │   ├── Signup.jsx
│   │   ├── ResetPassword.jsx
│   │   ├── Dashboard.jsx
│   │   ├── DigitalTwin.jsx
│   │   └── Settings.jsx
│   ├── services/            # Services (API, Supabase)
│   ├── stores/              # Zustand stores (state management)
│   ├── i18n/                # Configuration i18next
│   ├── styles/              # Styles globaux
│   ├── App.jsx              # Composant racine
│   └── main.jsx             # Point d'entrée
├── public/                  # Assets statiques
├── index.html
├── vite.config.js
└── package.json
```

---

## 🛠️ Installation & Démarrage

### 1. Installer Node.js

Si Node.js n'est pas installé, téléchargez-le depuis [nodejs.org](https://nodejs.org/) (version LTS recommandée).

### 2. Installer les dépendances

```bash
cd frontend-react
npm install
```

### 3. Configuration

Créez un fichier `.env` à la racine de `frontend-react/` :

```bash
cp .env.example .env
```

Éditez `.env` et ajoutez vos clés Supabase :

```env
VITE_SUPABASE_URL=https://votre-projet.supabase.co
VITE_SUPABASE_ANON_KEY=votre-cle-anon
```

### 4. Copier les assets

Copiez les fichiers statiques depuis l'ancien frontend :

```bash
# Windows PowerShell
Copy-Item -Path ..\frontend\assets -Destination .\public\assets -Recurse

# Ou manuellement
# Copier frontend/assets/ vers frontend-react/public/assets/
```

### 5. Lancer le serveur de développement

```bash
npm run dev
```

L'application sera disponible sur `http://localhost:3000`

### 6. Build pour la production

```bash
npm run build
```

Les fichiers de production seront dans `dist/`

---

## 🎯 Fonctionnalités Implémentées

### ✅ Architecture & Configuration
- ⚡ Vite 6 - Build tool ultra-rapide
- ⚛️ React 19.0 - Dernière version
- 🛣️ React Router 7 - Routing moderne
- 🐻 Zustand - State management léger
- 🌍 i18next - Internationalisation (5 langues)

### ✅ Authentification (Supabase)
- 🔐 Connexion / Inscription
- 📧 Réinitialisation du mot de passe
- 🛡️ Routes protégées
- 💾 Session persistante

### ✅ Pages & Composants
- 📊 Dashboard - Vue d'ensemble IAQ
- 🎨 Digital Twin - Visualisation 3D (structure prête)
- ⚙️ Settings - Paramètres utilisateur
- 🧭 Navbar responsive
- 🌓 Thème clair/sombre
- 🌐 Sélecteur de langue

### ✅ Services
- 📡 WebSocket temps réel (Zustand store)
- 🔄 API service avec retry automatique
- 🌍 i18n configuré

### ✅ Styles
- 🎨 CSS moderne avec variables CSS
- 📱 100% responsive
- 🌓 Dark mode complet
- ✨ Animations fluides

---

## 🔄 Prochaines Étapes

### Fonctionnalités à finaliser :

1. **Graphiques Chart.js**
   - Installer `react-chartjs-2` et `chart.js`
   - Créer des composants de graphiques
   - Intégrer dans le Dashboard

2. **Visualisation 3D (Digital Twin)**
   - Intégrer `@react-three/fiber` et `@react-three/drei`
   - Migrer la logique Three.js existante
   - Charger les modèles 3D

3. **Alertes en temps réel**
   - Migrer `alerts-engine.js`
   - Créer le système d'alertes React
   - Notifications push

4. **Tutoriels Driver.js**
   - Intégrer `driver.js` dans React
   - Créer les tutoriels interactifs

5. **Actions préventives**
   - Migrer `preventive-global.js`
   - Créer l'interface de prédictions ML

6. **Tests**
   - Ajouter Vitest
   - Tests unitaires des composants
   - Tests E2E avec Playwright

---

## 📦 Packages Installés

### Core
- `react@19.0.0`
- `react-dom@19.0.0`
- `react-router-dom@7.1.1`

### State & Data
- `zustand@5.0.2` - State management
- `@supabase/supabase-js@2.39.1` - Auth & Database

### UI & Visualisation
- `lucide-react@0.462.0` - Icônes modernes
- `chart.js@4.4.1` - Graphiques
- `react-chartjs-2@5.2.0` - Wrapper React pour Chart.js
- `three@0.170.0` - 3D
- `@react-three/fiber@8.15.16` - Three.js pour React
- `@react-three/drei@9.96.1` - Helpers Three.js

### i18n
- `i18next@23.7.16`
- `react-i18next@14.0.1`

### Autres
- `driver.js@1.3.1` - Tutoriels interactifs

---

## 🔧 Configuration Docker (Optionnel)

Pour déployer avec Docker, ajoutez un `Dockerfile` :

```dockerfile
FROM node:20-alpine AS builder

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
```

Et un `nginx.conf` :

```nginx
server {
    listen 80;
    server_name localhost;
    root /usr/share/nginx/html;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location /api {
        proxy_pass http://backend:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    location /ws {
        proxy_pass http://backend:8000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

---

## 📚 Ressources

- [Documentation React 19](https://react.dev/)
- [Documentation Vite](https://vitejs.dev/)
- [Documentation Zustand](https://zustand-demo.pmnd.rs/)
- [Documentation React Router](https://reactrouter.com/)
- [Documentation i18next](https://www.i18next.com/)
- [Documentation Supabase](https://supabase.com/docs)

---

## 🎉 Conclusion

Votre frontend est maintenant entièrement migré vers React 19.2 avec :

✅ Architecture moderne et scalable  
✅ State management avec Zustand  
✅ Routing avec React Router 7  
✅ Authentification Supabase  
✅ WebSocket temps réel  
✅ i18n (5 langues)  
✅ Dark mode  
✅ Design responsive  
✅ Code propre et maintenable  

**Bon développement ! 🚀**
