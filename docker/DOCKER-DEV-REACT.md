# Scripts Docker pour le développement React

## 🚀 Démarrage rapide

### 1. Environnement complet (Backend + Frontend React)

```bash
# Depuis la racine du projet
cd docker

# Lancer tous les services
docker-compose -f docker-compose.dev-react.yml up --build

# Ou en mode détaché
docker-compose -f docker-compose.dev-react.yml up -d --build
```

### 2. Services accessibles

- **Frontend React** : http://localhost:3000 (avec hot-reload)
- **Backend API** : http://localhost:8000
- **InfluxDB UI** : http://localhost:8086
- **MLflow UI** : http://localhost:5000

---

## 🔧 Commandes utiles

### Démarrer les services

```bash
# Démarrer avec build
docker-compose -f docker-compose.dev-react.yml up --build

# Démarrer sans rebuild
docker-compose -f docker-compose.dev-react.yml up

# Mode détaché (background)
docker-compose -f docker-compose.dev-react.yml up -d
```

### Arrêter les services

```bash
# Arrêter les services
docker-compose -f docker-compose.dev-react.yml down

# Arrêter et supprimer les volumes
docker-compose -f docker-compose.dev-react.yml down -v
```

### Logs

```bash
# Voir tous les logs
docker-compose -f docker-compose.dev-react.yml logs -f

# Logs d'un service spécifique
docker-compose -f docker-compose.dev-react.yml logs -f frontend-react
docker-compose -f docker-compose.dev-react.yml logs -f backend

# Dernières 100 lignes
docker-compose -f docker-compose.dev-react.yml logs --tail=100 -f frontend-react
```

### Rebuild

```bash
# Rebuild un service spécifique
docker-compose -f docker-compose.dev-react.yml build frontend-react

# Rebuild tous les services
docker-compose -f docker-compose.dev-react.yml build

# Rebuild sans cache
docker-compose -f docker-compose.dev-react.yml build --no-cache
```

### Redémarrer un service

```bash
docker-compose -f docker-compose.dev-react.yml restart frontend-react
docker-compose -f docker-compose.dev-react.yml restart backend
```

---

## 🐛 Tests dans Docker

### Lancer les tests React

```bash
# Accéder au container
docker exec -it iaqverse-frontend-react-dev sh

# Lancer les tests
npm test

# Tests avec interface graphique
npm run test:ui

# Tests avec couverture
npm run test:coverage

# Sortir du container
exit
```

### Alternative : Commande directe

```bash
# Lancer les tests directement
docker exec -it iaqverse-frontend-react-dev npm test

# Tests avec UI
docker exec -it iaqverse-frontend-react-dev npm run test:ui

# Couverture
docker exec -it iaqverse-frontend-react-dev npm run test:coverage
```

### Lancer les tests Python (backend)

```bash
# Accéder au container backend
docker exec -it iaqverse-backend-dev sh

# Lancer pytest
pytest tests/

exit
```

---

## 🔄 Hot Reload

Le hot-reload est **automatiquement activé** grâce aux volumes montés :

- **Frontend React** : Les modifications dans `frontend-react/src/` sont immédiatement prises en compte
- **Backend Python** : Les modifications dans `backend/` déclenchent un reload automatique avec uvicorn

### Fichiers surveillés pour le hot-reload :

```yaml
# Frontend React
- frontend-react/src/**/*.jsx
- frontend-react/src/**/*.js
- frontend-react/src/**/*.css
- frontend-react/index.html
- frontend-react/vite.config.js

# Backend Python
- backend/**/*.py
```

---

## 📦 Installation de nouvelles dépendances

### Frontend React

```bash
# Méthode 1 : Via le container
docker exec -it iaqverse-frontend-react-dev npm install package-name

# Méthode 2 : Rebuild après modification de package.json
# 1. Modifier frontend-react/package.json localement
# 2. Rebuild le service
docker-compose -f docker-compose.dev-react.yml build frontend-react
docker-compose -f docker-compose.dev-react.yml up -d frontend-react
```

### Backend Python

```bash
# Méthode 1 : Via le container
docker exec -it iaqverse-backend-dev pip install package-name

# Méthode 2 : Rebuild après modification de requirements.txt
docker-compose -f docker-compose.dev-react.yml build backend
docker-compose -f docker-compose.dev-react.yml up -d backend
```

---

## 🐳 Gestion des containers

### Voir les containers actifs

```bash
docker-compose -f docker-compose.dev-react.yml ps
```

### Accéder à un container

```bash
# Frontend React
docker exec -it iaqverse-frontend-react-dev sh

# Backend
docker exec -it iaqverse-backend-dev sh

# InfluxDB
docker exec -it iaqverse-influxdb-dev sh
```

### Supprimer et recréer

```bash
# Arrêter et supprimer
docker-compose -f docker-compose.dev-react.yml down

# Supprimer avec volumes (ATTENTION: perte de données)
docker-compose -f docker-compose.dev-react.yml down -v

# Recréer
docker-compose -f docker-compose.dev-react.yml up --build
```

---

## 🌐 Configuration réseau

Tous les services sont dans le même réseau Docker `iaqverse-network` :

- Les services peuvent communiquer entre eux via leur nom
- Exemple : `http://backend:8000` depuis le frontend
- Exemple : `http://influxdb:8086` depuis le backend

### URLs internes (entre containers)

```
Backend API     : http://backend:8000
InfluxDB        : http://influxdb:8086
MLflow          : http://mlflow:5000
```

### URLs externes (depuis votre machine)

```
Frontend React  : http://localhost:3000
Backend API     : http://localhost:8000
InfluxDB UI     : http://localhost:8086
MLflow UI       : http://localhost:5000
```

---

## 🔍 Debugging

### Vérifier la configuration Vite

```bash
docker exec -it iaqverse-frontend-react-dev cat vite.config.js
```

### Vérifier les variables d'environnement

```bash
# Frontend
docker exec -it iaqverse-frontend-react-dev env | grep VITE

# Backend
docker exec -it iaqverse-backend-dev env
```

### Vérifier les fichiers montés

```bash
# Lister le contenu de /app
docker exec -it iaqverse-frontend-react-dev ls -la /app

# Vérifier les assets
docker exec -it iaqverse-frontend-react-dev ls -la /app/public/assets
```

### Tail les logs en temps réel

```bash
# Tous les services
docker-compose -f docker-compose.dev-react.yml logs -f

# Frontend uniquement
docker-compose -f docker-compose.dev-react.yml logs -f frontend-react

# Backend uniquement
docker-compose -f docker-compose.dev-react.yml logs -f backend
```

---

## 🧹 Nettoyage

### Nettoyer les images inutilisées

```bash
docker system prune -a
```

### Supprimer uniquement les volumes

```bash
docker volume prune
```

### Nettoyer complètement

```bash
# ATTENTION: Supprime TOUT
docker-compose -f docker-compose.dev-react.yml down -v
docker system prune -a --volumes
```

---

## ⚡ Optimisation du workflow

### Script de démarrage rapide

Créer un fichier `dev.sh` à la racine :

```bash
#!/bin/bash
cd docker
docker-compose -f docker-compose.dev-react.yml up --build
```

Utilisation :
```bash
chmod +x dev.sh
./dev.sh
```

### Script PowerShell (Windows)

Créer `dev.ps1` :

```powershell
Set-Location docker
docker-compose -f docker-compose.dev-react.yml up --build
```

Utilisation :
```powershell
.\dev.ps1
```

---

## 📊 Monitoring

### Voir l'utilisation des ressources

```bash
docker stats
```

### Voir les processus dans un container

```bash
docker top iaqverse-frontend-react-dev
```

---

## 🚀 Workflow recommandé

1. **Démarrer l'environnement**
   ```bash
   cd docker
   docker-compose -f docker-compose.dev-react.yml up -d
   ```

2. **Voir les logs**
   ```bash
   docker-compose -f docker-compose.dev-react.yml logs -f frontend-react
   ```

3. **Développer**
   - Modifier les fichiers dans `frontend-react/src/`
   - Le navigateur se recharge automatiquement

4. **Tester**
   ```bash
   docker exec -it iaqverse-frontend-react-dev npm test
   ```

5. **Arrêter**
   ```bash
   docker-compose -f docker-compose.dev-react.yml down
   ```

---

## 📝 Notes importantes

- **Hot Reload** : Fonctionne automatiquement grâce aux volumes montés
- **node_modules** : Reste dans le container (pas de conflit avec l'hôte)
- **Assets** : Les assets sont partagés entre l'ancien frontend et React
- **Base de données** : InfluxDB persiste les données dans `database/influx_data/`
- **Tests** : Lancez les tests depuis le container pour avoir l'environnement complet

---

*IAQverse - Docker Development Setup*  
*React 19.2 + Vite + Hot Reload*
