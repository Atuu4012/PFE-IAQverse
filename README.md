<div align="center">

# IAQverse

**Plateforme IoT de surveillance et de prédiction de la qualité de l'air intérieur**

FastAPI · Vanilla JS · Three.js · TensorFlow · InfluxDB · MLflow · Supabase · Docker

</div>

---

## Sommaire

- [IAQverse](#iaqverse)
  - [Sommaire](#sommaire)
  - [Présentation](#présentation)
    - [Fonctionnalités principales](#fonctionnalités-principales)
  - [Architecture](#architecture)
  - [Stack technique](#stack-technique)
  - [Démarrage rapide](#démarrage-rapide)
    - [Prérequis](#prérequis)
    - [Lancement (développement)](#lancement-développement)
    - [Services disponibles](#services-disponibles)
    - [Consulter les logs](#consulter-les-logs)
  - [Déploiement en production](#déploiement-en-production)
  - [Variables d'environnement](#variables-denvironnement)
  - [Services Docker](#services-docker)
  - [API Backend](#api-backend)
    - [Endpoints](#endpoints)
    - [Exemple d'ingestion](#exemple-dingestion)
    - [Exemple de requête de données](#exemple-de-requête-de-données)
  - [Pipeline ML / DL](#pipeline-ml--dl)
    - [Prétraitement des données](#prétraitement-des-données)
    - [Modèle LSTM (principal)](#modèle-lstm-principal)
    - [Modèle VotingRegressor (fallback)](#modèle-votingregressor-fallback)
    - [Stratégie de prédiction en temps réel](#stratégie-de-prédiction-en-temps-réel)
    - [Réentraînement automatique](#réentraînement-automatique)
    - [Évaluation continue](#évaluation-continue)
  - [Système temps réel (WebSocket)](#système-temps-réel-websocket)
  - [Scoring IAQ](#scoring-iaq)
  - [Simulateur de capteurs](#simulateur-de-capteurs)
  - [Système d'alertes](#système-dalertes)
  - [Frontend](#frontend)
    - [Pages](#pages)
    - [Modules JavaScript](#modules-javascript)
    - [Thème et responsive](#thème-et-responsive)
  - [Internationalisation](#internationalisation)
  - [Tests](#tests)
  - [CI/CD](#cicd)
  - [Arborescence du projet](#arborescence-du-projet)
  - [Licence](#licence)

---

## Présentation

IAQverse est une plateforme complète de monitoring de la qualité de l'air intérieur (Indoor Air Quality). Elle collecte en temps réel les mesures de capteurs IoT (CO₂, PM2.5, TVOC, température, humidité), calcule un score de qualité (0–100), prédit l'évolution à 30 minutes grâce à des modèles ML/DL, et déclenche des actions préventives automatisées (ouverture de fenêtres, activation de la VMC, purificateur, radiateur).

### Fonctionnalités principales

- **Dashboard temps réel** — Graphiques Plotly mis à jour via WebSocket
- **Jumeau numérique 3D** — Visualisation Three.js interactive de la pièce avec alertes spatialisées
- **Double modèle de prédiction** — LSTM (encoder-decoder + attention) et VotingRegressor (fallback)
- **Réentraînement automatique** — Scheduler périodique avec optimisation Optuna et tracking MLflow
- **Domotique intelligente** — Exécution automatique d'actions (fenêtres, VMC, purificateur, radiateur)
- **Alertes email** — Notification du syndic et de l'assurance en cas de dégradation persistante
- **Multi-langue** — Français, anglais, allemand, espagnol, italien
- **Authentification** — Supabase Auth (email/password + Google OAuth)
- **Responsive** — UI mobile-first avec mode clair/sombre

---

## Architecture

```
Capteurs IoT ─── POST /api/ingest ──► InfluxDB (time-series)
                                           │
                                     ┌─────┴──────┐
                                     │  Scoring   │
                                     │ IAQ 0-100  │
                                     └─────┬──────┘
                                           │
                        ┌──────────────────┼──────────────────┐
                        ▼                  ▼                  ▼
                   WebSocket          ML Prédiction      Alertes email
                  (broadcast)        (+30 min ahead)    (syndic/assurance)
                        │                  │
                        ▼                  ▼
              Dashboard + Charts    Actions préventives
              Jumeau numérique 3D   (fenêtres, VMC, etc.)
```

```
┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│   Frontend   │◄──►│   Backend    │◄──►│  InfluxDB    │
│   (Nginx)    │    │  (FastAPI)   │    │  (2.7)       │
│   port 80    │    │  port 8000   │    │  port 8086   │
└──────────────┘    └──────┬───────┘    └──────────────┘
                           │
                    ┌──────┴───────┐
                    │              │
              ┌─────▼─────┐ ┌─────▼──────┐
              │  MLflow   │ │ Supabase   │
              │ (v3.8.1)  │ │ (Auth+DB)  │
              │ port 5000 │ │  (cloud)   │
              └─────▲─────┘ └────────────┘
                    │
             ┌──────┴───────┐
             │ ML Scheduler │
             │ (réentraîne- │
             │  ment auto)  │
             └──────────────┘
```

---

## Stack technique

| Composant        | Technologie                             |
| ---------------- | --------------------------------------- |
| **Backend**      | Python 3.11, FastAPI, Uvicorn           |
| **Frontend**     | Vanilla JS, Plotly.js, Three.js         |
| **Base de données** | InfluxDB 2.7 (time-series)           |
| **ML classique** | Scikit-learn (VotingRegressor)          |
| **Deep Learning**| TensorFlow/Keras (LSTM encoder-decoder) |
| **Optimisation** | Optuna (hyperparamètres)                |
| **MLOps**        | MLflow 3.8.1 (tracking + artifacts)     |
| **Auth**         | Supabase (JWT ES256 + JWKS)             |
| **Config users** | Supabase PostgreSQL (table `user_configs`) |
| **Proxy**        | Nginx (reverse proxy + static files)    |
| **Conteneurs**   | Docker Compose                          |
| **CI/CD**        | GitHub Actions → déploiement VPS SSH    |

---

## Démarrage rapide

### Prérequis

- [Docker](https://docs.docker.com/get-docker/) et Docker Compose
- Un fichier `docker/.env.dev` (voir [Variables d'environnement](#variables-denvironnement))

### Lancement (développement)

```powershell
# Option 1 : script fourni
.\docker\start-dev.ps1

# Option 2 : manuellement
cd docker
docker compose --env-file .env.dev -f docker-compose.dev.yml up -d --build
```

### Services disponibles

| Service     | URL                        |
| ----------- | -------------------------- |
| Frontend    | http://localhost:8080       |
| Backend API | http://localhost:8000       |
| Swagger     | http://localhost:8000/docs  |
| InfluxDB    | http://localhost:8086       |
| MLflow      | http://localhost:5000       |

### Consulter les logs

```powershell
cd docker
docker compose -f docker-compose.dev.yml logs -f backend
docker compose -f docker-compose.dev.yml logs -f ml-scheduler
```

---

## Déploiement en production

```powershell
cd docker
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d --build --force-recreate
```

En production :
- Le frontend est servi sur le **port 80** via Nginx
- InfluxDB et MLflow sont sur un réseau Docker interne (non exposés publiquement)
- Les volumes Docker (`ml_models`, `mlflow_data`, `influxdb_data`) persistent les données entre redéploiements
- Le déploiement automatique se fait via GitHub Actions (push sur `main` → SSH vers VPS)

---

## Variables d'environnement

Les fichiers `.env` se trouvent dans `docker/` : `.env.dev` pour le développement, `.env.prod` pour la production.

| Variable                     | Description                                        |
| ---------------------------- | -------------------------------------------------- |
| `INFLUXDB_USER`              | Nom d'utilisateur admin InfluxDB                   |
| `INFLUXDB_PASSWORD`          | Mot de passe admin InfluxDB                        |
| `INFLUXDB_TOKEN`             | Token d'accès InfluxDB                             |
| `INFLUXDB_ORG`               | Organisation InfluxDB                              |
| `INFLUXDB_BUCKET`            | Bucket InfluxDB                                    |
| `SUPABASE_URL`               | URL du projet Supabase                             |
| `SUPABASE_PUBLISHABLE_KEY`   | Clé publique Supabase                              |
| `SUPABASE_ANON_KEY`          | Clé anonyme Supabase                               |
| `SUPABASE_KEY`               | Clé Supabase                                       |
| `SUPABASE_SERVICE_ROLE_KEY`  | Clé service Supabase (admin)                       |
| `RETRAIN_INTERVAL`           | Intervalle de réentraînement automatique (heures)  |

---

## Services Docker

| Service        | Image / Dockerfile             | Rôle                                                       |
| -------------- | ------------------------------ | ---------------------------------------------------------- |
| `influxdb`     | `influxdb:2.7`                 | Base de données time-series pour les mesures capteurs       |
| `backend`      | `Dockerfile.backend`           | API REST, prédictions ML, WebSocket temps réel, scoring     |
| `mlflow`       | `ghcr.io/mlflow/mlflow:v3.8.1` | Serveur de tracking des expériences et registre de modèles |
| `ml-scheduler` | `Dockerfile.ml-scheduler`      | Réentraînement périodique LSTM + optimisation Optuna        |
| `frontend`     | `Dockerfile.frontend`          | Nginx servant le frontend statique + reverse proxy API/WS   |

---

## API Backend

La documentation Swagger interactive est accessible sur `/docs` une fois le backend démarré.

### Endpoints

| Méthode | Endpoint                          | Description                                        |
| ------- | --------------------------------- | -------------------------------------------------- |
| `POST`  | `/api/ingest`                     | Ingestion d'une mesure capteur                     |
| `GET`   | `/api/iaq/data`                   | Requête de données historiques (enseigne, salle, hours, step) |
| `GET`   | `/api/predict/score`              | Score IAQ prédit à +30 min (0–100)                 |
| `GET`   | `/api/predict/preventive-actions` | Actions préventives recommandées + analyse de risque|
| `GET`   | `/api/config`                     | Configuration utilisateur (auth requise)           |
| `POST`  | `/api/config`                     | Sauvegarde de la configuration utilisateur          |
| `GET`   | `/api/model/performance`          | Métriques de performance du modèle (MAE, RMSE, corrélation) |
| `POST`  | `/api/reload-model`               | Force le rechargement du modèle (après réentraînement) |
| `GET`   | `/health`                         | Vérification de santé du service                   |
| `WS`    | `/ws`                             | WebSocket temps réel (mesures, prédictions, alertes)|

### Exemple d'ingestion

```json
POST /api/ingest
{
  "sensor_id": "bureau1",
  "enseigne": "Maison",
  "salle": "Bureau",
  "timestamp": "2026-03-09T10:05:00Z",
  "values": {
    "CO2": 645,
    "PM25": 12,
    "TVOC": 200,
    "Temperature": 22.3,
    "Humidity": 45
  }
}
```

### Exemple de requête de données

```
GET /api/iaq/data?enseigne=Maison&salle=Bureau&hours=24&step=5min
```

---

## Pipeline ML / DL

IAQverse utilise deux modèles de prédiction complémentaires avec une stratégie de fallback.

### Prétraitement des données

**Script** : `backend/ml/preprocess_dataset.py`

- Nettoyage du dataset brut (4 capteurs IoT)
- Rééchantillonnage à 5 minutes
- Standardisation des noms de colonnes
- Simulation d'occupation (horaires de bureau)
- Export : `assets/datasets/ml_data/dataset_ml_5min.csv`

### Modèle LSTM (principal)

**Script** : `backend/dl/ml_train_lstm.py`

```
Architecture : Encoder LSTM → RepeatVector → Decoder LSTM → Attention → Dense
```

| Paramètre     | Valeur                          |
| -------------- | ------------------------------- |
| Lookback       | 72 pas (6h à 5 min d'intervalle)|
| Horizon        | 6 pas (30 min de prédiction)    |
| Features       | CO₂, PM2.5, TVOC, Temp, Humidité, occupants, heure (sin/cos), jour (sin/cos) |
| Optimisation   | Optuna (base SQLite persistante, essais cumulatifs) |
| Tracking       | MLflow (métriques + artifacts)  |

**Fichiers produits** :
- `assets/ml_models/lstm_model.keras` — Modèle entraîné
- `assets/ml_models/lstm_config.json` — Hyperparamètres
- `assets/ml_models/lstm_scaler.joblib` — Scaler MinMax

### Modèle VotingRegressor (fallback)

**Script** : `backend/ml/ml_train.py`

Ensemble de Random Forest (200 arbres) + Gradient Boosting (200 estimateurs). Utilisé automatiquement si le LSTM ne dispose pas d'assez de données historiques (6h requises).

**Feature engineering** : moyennes mobiles, lags, encodage cyclique (heure/jour), encodage catégoriel (salle/capteur).

**Fichiers produits** :
- `assets/ml_models/generic_multi_output.joblib`
- `assets/ml_models/generic_scaler.joblib`
- `assets/ml_models/capteur_encoder.joblib`
- `assets/ml_models/salle_encoder.joblib`

### Stratégie de prédiction en temps réel

**Script** : `backend/ml/ml_predict_generic.py`

1. **Essai LSTM** — Récupère 6h de données InfluxDB agrégées à 5 min
2. **Fallback VotingRegressor** — Si le LSTM échoue ou les données sont insuffisantes
3. **Analyse de risque** — Compare les prédictions aux seuils → génère des actions préventives

### Réentraînement automatique

**Script** : `backend/dl/scheduler_retrain.py`

- Se déclenche toutes les N heures (configurable via `RETRAIN_INTERVAL`)
- Récupère les dernières 72h de données InfluxDB
- Fusionne avec le dataset historique CSV
- Lance les essais Optuna → réentraîne si de meilleurs paramètres sont trouvés
- Notifie le backend via `POST /api/reload-model`

### Évaluation continue

**Module** : `backend/core/model_tracker.py`

- Chaque prédiction est enregistrée dans une base SQLite
- Une tâche de fond évalue les prédictions passées vs les valeurs réelles InfluxDB
- Calcule MAE, RMSE, corrélation, MAPE
- Résultats exposés via `GET /api/model/performance`

---

## Système temps réel (WebSocket)

**Endpoint** : `WS /ws`

Le backend diffuse en temps réel via WebSocket (pub/sub par topic) :

| Topic           | Contenu                                      |
| --------------- | -------------------------------------------- |
| `measurement`   | Mesure capteur + score IAQ global            |
| `prediction`    | Prédictions à +30 min                        |
| `alert`         | Alertes de qualité d'air                     |
| `modules`       | État des modules domotiques (fenêtre, VMC…)  |

Le frontend se reconnecte automatiquement avec backoff exponentiel. En production, Nginx gère le proxy WebSocket avec des timeouts de 7 jours pour les connexions persistantes.

---

## Scoring IAQ

Le score IAQ (0–100) est calculé comme la moyenne pondérée de 5 sous-scores individuels.

| Paramètre   | Excellent   | Bon              | Modéré              | Mauvais          |
| ------------ | ----------- | -----------------| ------------------- | ---------------- |
| CO₂          | < 600 ppm   | 600–1000 ppm     | 1000–1400 ppm       | > 2000 ppm       |
| PM2.5        | < 12 µg/m³  | 12–25 µg/m³      | 25–50 µg/m³         | > 100 µg/m³      |
| TVOC         | < 200 ppb   | 200–300 ppb      | 300–500 ppb         | > 1000 ppb       |
| Température  | 19–22 °C    | 18–24 °C         | 16–26 °C            | < 16 ou > 26 °C  |
| Humidité     | 40–50 %     | 30–60 %          | 20–70 %             | < 20 ou > 70 %   |

Le seuil CO₂ est ajusté dynamiquement en fonction du nombre d'occupants (+100 ppm/personne).

**Niveaux** : excellent ≥ 90 · bon ≥ 70 · modéré ≥ 50 · mauvais ≥ 30 · très mauvais < 30

---

## Simulateur de capteurs

**Module** : `backend/simulator.py`

En l'absence de capteurs physiques, le backend génère des données réalistes :

- Lit la configuration utilisateur depuis Supabase (pièces, capteurs, modules)
- Simule la physique de l'air intérieur : génération de CO₂ par les occupants, ventilation, pertes thermiques, variations aléatoires PM2.5/TVOC
- Écrit les mesures dans InfluxDB toutes les 5 secondes
- Les modules domotiques (fenêtres, VMC, purificateur) influencent la simulation

---

## Système d'alertes

**Module** : `backend/core/alert_service.py`

- Surveille la dégradation IAQ par capteur
- Seuil de déclenchement : 30 min en qualité "mauvaise" (15 min si système mal configuré)
- Envoie un email HTML au syndic de copropriété et à l'assurance
- Cooldown de 24h entre les notifications
- Emails envoyés via SMTP (`backend/core/email_sender.py`)

---

## Frontend

### Pages

| Page                  | Description                                              |
| --------------------- | -------------------------------------------------------- |
| `login.html`          | Connexion (email/password + Google OAuth)                |
| `signup.html`         | Inscription                                             |
| `reset-password.html` | Réinitialisation du mot de passe                        |
| `index.html`          | Dashboard principal (graphiques, score, occupants)       |
| `digital-twin.html`   | Jumeau numérique 3D (Three.js, modèle GLB)             |
| `settings.html`       | Configuration (profil, lieux, pièces, modules, abonnement, notifications) |

### Modules JavaScript

| Module                     | Rôle                                                    |
| -------------------------- | ------------------------------------------------------- |
| `auth.js`                  | Client Supabase, login/signup/logout, gestion du token  |
| `api.js`                   | Centralisation des appels API via le proxy Nginx        |
| `api-retry.js`             | Retry automatique (3 tentatives) + cache de réponses    |
| `config-loader.js`         | Chargement et cache de la config utilisateur (TTL 60s)  |
| `websocket-manager.js`     | Connexion WebSocket, pub/sub par topic, reconnexion auto|
| `dashboard.js`             | Mise à jour des graphiques et du score prédit            |
| `charts-chartjs.js`        | Graphiques Plotly avec mise à jour temps réel (max 60 points) |
| `digital-twin.js`          | Chargement du modèle 3D GLB, rendu des alertes spatiales|
| `three-scene.js`           | Scène Three.js (caméra, lumières, contrôles orbitaux)   |
| `settings.js`              | Formulaires de configuration utilisateur                |
| `settings-modules.js`      | Gestion des modules domotiques dans les paramètres      |
| `alerts-engine.js`         | Rendu des modales d'alerte                              |
| `global-alerts.js`         | Notifications globales (en-tête)                        |
| `preventive-global.js`     | Cartes d'actions préventives via WebSocket              |
| `occupants-display.js`     | Affichage du nombre d'occupants en temps réel           |
| `i18n.js`                  | Chargement dynamique des traductions                    |
| `theme.js`                 | Bascule mode clair / sombre                             |
| `tutorial.js`              | Onboarding interactif (Driver.js)                       |
| `tabs-manager.js`          | Gestion des onglets de navigation                       |
| `ui-shell.js`              | Layout et composants UI partagés                        |
| `disable-browser-shortcuts.js` | Désactivation des raccourcis navigateur (mode kiosque) |

### Thème et responsive

- `style.css` — Styles principaux avec CSS custom properties (clair/sombre)
- `media.css` — Breakpoints responsive (mobile-first)
- Upload de modèles GLB pour le jumeau numérique (max 2 Go via Nginx)

---

## Internationalisation

5 langues supportées via les fichiers `assets/i18n/` :

| Fichier   | Langue    |
| --------- | --------- |
| `fr.json` | Français  |
| `en.json` | Anglais   |
| `de.json` | Allemand  |
| `es.json` | Espagnol  |
| `it.json` | Italien   |

Le module `i18n.js` charge dynamiquement la langue sélectionnée et applique les traductions au DOM via des attributs `data-i18n`.

---

## Tests

```powershell
# Backend (pytest)
pytest tests/backend

# Frontend (Playwright)
pytest tests/frontend
```

Les tests backend couvrent les endpoints API (ingestion, requêtes, configuration). Les tests frontend utilisent Playwright avec un serveur HTTP local.

---

## CI/CD

Le workflow GitHub Actions (`.github/workflows/deploy.yml`) s'exécute sur chaque push sur `main` :

1. **Tests** — Backend (pytest) + Frontend (Playwright) sur Ubuntu
2. **Déploiement** — Connexion SSH au VPS → `git pull` → `docker compose up --build --force-recreate`

Les images Docker sont reconstruites à chaque déploiement, garantissant que tout le code (backend, DL, ML, frontend) est à jour.

---

## Arborescence du projet

```
.
├── .github/workflows/
│   └── deploy.yml                    # CI/CD GitHub Actions
├── assets/
│   ├── config.json                   # Configuration par défaut
│   ├── datasets/                     # Données d'entraînement (CSV)
│   │   └── ml_data/                  # Dataset prétraité (5 min)
│   ├── i18n/                         # Fichiers de traduction (5 langues)
│   ├── icons/                        # Icônes de l'application
│   ├── landscapes/                   # Images de fond
│   ├── ml_models/                    # Modèles ML/DL sauvegardés
│   │   ├── lstm_model.keras          #   LSTM entraîné
│   │   ├── lstm_config.json          #   Config hyperparamètres LSTM
│   │   ├── lstm_scaler.joblib        #   Scaler LSTM
│   │   ├── generic_multi_output.joblib #  VotingRegressor
│   │   ├── generic_scaler.joblib     #   Scaler ML classique
│   │   └── optuna_plots/             #   Visualisations Optuna
│   └── rooms/                        # Modèles 3D GLB des pièces
├── backend/
│   ├── main.py                       # Point d'entrée FastAPI
│   ├── iaq_score.py                  # Calcul du score IAQ (0-100)
│   ├── simulator.py                  # Simulateur de capteurs IoT
│   ├── utils.py                      # Utilitaires (chargement config, dataset)
│   ├── requirements.txt              # Dépendances (développement local)
│   ├── requirements-docker.txt       # Dépendances (image Docker backend)
│   ├── api/
│   │   ├── ingest.py                 # POST /api/ingest
│   │   ├── query.py                  # GET /api/iaq/data, prédictions
│   │   └── config_api.py             # GET/POST /api/config (auth JWT)
│   ├── core/
│   │   ├── settings.py               # Configuration globale
│   │   ├── influx_client.py          # Client InfluxDB (singleton)
│   │   ├── websocket_manager.py      # Gestionnaire WebSocket (pub/sub)
│   │   ├── alert_service.py          # Surveillance et alertes IAQ
│   │   ├── email_sender.py           # Envoi d'emails SMTP
│   │   ├── supabase.py               # Client Supabase (auth JWT)
│   │   └── model_tracker.py          # Évaluation continue des prédictions
│   ├── ml/
│   │   ├── preprocess_dataset.py     # Prétraitement du dataset brut
│   │   ├── ml_train.py               # Entraînement VotingRegressor
│   │   └── ml_predict_generic.py     # Prédiction temps réel (LSTM + fallback)
│   └── dl/
│       ├── ml_train_lstm.py          # Entraînement LSTM + Optuna
│       ├── scheduler_retrain.py      # Scheduler de réentraînement auto
│       ├── plot_optuna_trials.py     # Visualisation des essais Optuna
│       └── requirements.txt          # Dépendances ML Scheduler
├── frontend/
│   ├── index.html                    # Dashboard principal
│   ├── digital-twin.html             # Jumeau numérique 3D
│   ├── settings.html                 # Page de configuration
│   ├── login.html                    # Connexion
│   ├── signup.html                   # Inscription
│   ├── reset-password.html           # Réinitialisation mot de passe
│   ├── style.css                     # Styles principaux
│   ├── media.css                     # Responsive
│   └── js/                           # Modules JavaScript (voir section Frontend)
├── docker/
│   ├── docker-compose.dev.yml        # Compose développement
│   ├── docker-compose.prod.yml       # Compose production
│   ├── Dockerfile.backend            # Image backend (FastAPI + ML)
│   ├── Dockerfile.frontend           # Image frontend (Nginx)
│   ├── Dockerfile.ml-scheduler       # Image scheduler (TensorFlow + Optuna)
│   ├── nginx.conf                    # Config Nginx (proxy, WS, cache, gzip)
│   └── start-dev.ps1                 # Script de démarrage rapide (PowerShell)
├── database/
│   └── influx_data/                  # Volume InfluxDB local (dev)
├── info/
│   ├── ARCHITECTURE.md               # Documentation architecture détaillée
│   ├── ML_DL_PIPELINE.md             # Documentation pipeline ML/DL
│   └── WEBSOCKET.md                  # Documentation WebSocket
└── tests/
    ├── conftest.py                   # Fixtures pytest
    ├── backend/                      # Tests API backend
    └── frontend/                     # Tests Playwright
```

---

## Licence

Projet de fin d'études — IAQverse
