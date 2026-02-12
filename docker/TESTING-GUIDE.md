# Guide de Test Docker - React Development

## 🐳 Configuration Docker Créée

### Fichiers ajoutés :
- **docker/Dockerfile.frontend-react** - Image Docker pour React + Vite
- **docker/docker-compose.dev-react.yml** - Compose pour développement React
- **docker/DOCKER-DEV-REACT.md** - Documentation complète
- **docker/start-dev.ps1** - Script PowerShell de démarrage rapide
- **docker/start-dev.sh** - Script Bash de démarrage rapide
- **frontend-react/.dockerignore** - Exclusions Docker

### Configuration mise à jour :
- **frontend-react/vite.config.js** - Supporté Docker avec hot-reload
- **docker/docker-compose.yml** - Ajout du service frontend-react

---

## 🚀 Lancement Rapide

### Option 1 : Script PowerShell (Recommandé Windows)

```powershell
cd C:\Users\Arthur\Desktop\pfe
.\docker\start-dev.ps1
```

### Option 2 : Commande directe

```powershell
cd C:\Users\Arthur\Desktop\pfe\docker
docker-compose -f docker-compose.dev-react.yml up --build
```

---

## 📊 Services Disponibles

Une fois lancé, vous aurez accès à :

| Service | URL | Description |
|---------|-----|-------------|
| **Frontend React** | http://localhost:3000 | Application React avec hot-reload ✅ |
| **Backend API** | http://localhost:8000 | FastAPI backend |
| **InfluxDB UI** | http://localhost:8086 | Base de données time-series |
| **MLflow UI** | http://localhost:5000 | ML tracking |

---

## 🧪 Tester dans Docker

### 1. Lancer les tests Vitest

```powershell
# Accéder au container
docker exec -it iaqverse-frontend-react-dev sh

# Lancer les tests
npm test

# Tests avec UI
npm run test:ui

# Tests avec couverture
npm run test:coverage

# Sortir
exit
```

### 2. Commande directe (sans entrer dans le container)

```powershell
# Tests simples
docker exec -it iaqverse-frontend-react-dev npm test

# Tests avec couverture
docker exec -it iaqverse-frontend-react-dev npm run test:coverage
```

---

## 🔄 Hot Reload Activé

Les modifications sont **automatiquement détectées** grâce à :

1. **usePolling** activé dans vite.config.js
2. **Volumes montés** dans docker-compose.dev-react.yml
3. **Watch mode** de Vite

### Fichiers surveillés :
- `frontend-react/src/**/*` - Tous les fichiers source
- `frontend-react/index.html` - Page d'entrée
- `frontend-react/vite.config.js` - Configuration Vite

**Modifiez un fichier → Le navigateur se recharge automatiquement ! ✨**

---

## 📝 Workflow de Test

### Scénario complet :

```powershell
# 1. Démarrer l'environnement
cd C:\Users\Arthur\Desktop\pfe\docker
docker-compose -f docker-compose.dev-react.yml up -d

# 2. Voir les logs
docker-compose -f docker-compose.dev-react.yml logs -f frontend-react

# 3. Ouvrir le navigateur
start http://localhost:3000

# 4. Lancer les tests
docker exec -it iaqverse-frontend-react-dev npm test

# 5. Voir les logs du backend
docker-compose -f docker-compose.dev-react.yml logs -f backend

# 6. Arrêter quand vous avez terminé
docker-compose -f docker-compose.dev-react.yml down
```

---

## 🐛 Commandes de Debug

### Vérifier que les containers tournent

```powershell
docker-compose -f docker-compose.dev-react.yml ps
```

### Voir les logs en temps réel

```powershell
# Tous les services
docker-compose -f docker-compose.dev-react.yml logs -f

# Frontend uniquement
docker-compose -f docker-compose.dev-react.yml logs -f frontend-react

# Backend uniquement
docker-compose -f docker-compose.dev-react.yml logs -f backend
```

### Accéder au shell du container

```powershell
docker exec -it iaqverse-frontend-react-dev sh
```

### Vérifier la configuration

```powershell
# Variables d'environnement
docker exec -it iaqverse-frontend-react-dev env | grep VITE

# Structure des fichiers
docker exec -it iaqverse-frontend-react-dev ls -la /app

# Vérifier node_modules
docker exec -it iaqverse-frontend-react-dev ls -la /app/node_modules
```

---

## 🔧 Problèmes Courants

### Le hot-reload ne fonctionne pas

**Solution 1** : Vérifier que usePolling est activé
```powershell
docker exec -it iaqverse-frontend-react-dev cat vite.config.js
```

**Solution 2** : Redémarrer le service
```powershell
docker-compose -f docker-compose.dev-react.yml restart frontend-react
```

**Solution 3** : Rebuild complet
```powershell
docker-compose -f docker-compose.dev-react.yml down
docker-compose -f docker-compose.dev-react.yml up --build
```

### Les assets ne se chargent pas

**Vérifier que les assets sont bien montés :**
```powershell
docker exec -it iaqverse-frontend-react-dev ls -la /app/public/assets
```

**Si manquants, copier les assets :**
```powershell
Copy-Item -Path frontend\assets -Destination frontend-react\public\assets -Recurse -Force
```

### Les tests ne fonctionnent pas

**Vérifier que les dépendances sont installées :**
```powershell
docker exec -it iaqverse-frontend-react-dev npm list vitest
```

**Réinstaller si nécessaire :**
```powershell
docker exec -it iaqverse-frontend-react-dev npm install
```

---

## 📦 Installation de Nouvelles Dépendances

### Méthode recommandée

```powershell
# 1. Modifier package.json localement

# 2. Rebuild le service
docker-compose -f docker-compose.dev-react.yml build frontend-react

# 3. Redémarrer
docker-compose -f docker-compose.dev-react.yml up -d frontend-react
```

### Méthode rapide (pour test)

```powershell
docker exec -it iaqverse-frontend-react-dev npm install package-name
```

---

## 🎯 Tester les Fonctionnalités

### 1. Dashboard avec Graphiques

```
1. Ouvrir http://localhost:3000
2. Se connecter
3. Vérifier les 3 graphiques Chart.js
4. Vérifier les alertes en temps réel
```

### 2. Digital Twin 3D

```
1. Aller sur http://localhost:3000/digital-twin
2. Vérifier la scène 3D (Three.js)
3. Interagir avec les capteurs
4. Tester le mode plein écran
```

### 3. Tutoriels Driver.js

```
1. Cliquer sur le bouton d'aide (?)
2. Suivre le tutoriel guidé
3. Vérifier le support dark mode
```

### 4. Tests Vitest

```powershell
docker exec -it iaqverse-frontend-react-dev npm test
```

---

## 🛑 Arrêter l'Environnement

### Arrêt simple

```powershell
docker-compose -f docker-compose.dev-react.yml down
```

### Arrêt avec suppression des volumes (⚠️ perte de données)

```powershell
docker-compose -f docker-compose.dev-react.yml down -v
```

---

## 📊 Monitoring

### Voir l'utilisation des ressources

```powershell
docker stats
```

### Suivre les logs en direct

```powershell
# Terminal 1 : Frontend
docker-compose -f docker-compose.dev-react.yml logs -f frontend-react

# Terminal 2 : Backend
docker-compose -f docker-compose.dev-react.yml logs -f backend
```

---

## ✅ Checklist de Vérification

Avant de commencer à développer, vérifiez que :

- [ ] Docker Desktop est lancé
- [ ] Fichier `.env` existe à la racine avec les clés Supabase
- [ ] Les services démarrent sans erreur
- [ ] Frontend accessible sur http://localhost:3000
- [ ] Backend accessible sur http://localhost:8000
- [ ] Hot-reload fonctionne (modifier un fichier → navigateur se recharge)
- [ ] Tests passent : `docker exec -it iaqverse-frontend-react-dev npm test`

---

## 🎉 Prêt à Tester !

Votre environnement Docker de développement React est configuré avec :

✅ **Hot-reload** automatique  
✅ **Tests Vitest** dans le container  
✅ **Backend + InfluxDB + MLflow** intégrés  
✅ **Volumes persistants** pour les données  
✅ **Réseau Docker** pour communication inter-services  

**Bon développement ! 🚀**

---

*Pour plus de détails, voir [DOCKER-DEV-REACT.md](DOCKER-DEV-REACT.md)*
