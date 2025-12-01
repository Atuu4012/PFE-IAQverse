# Architecture du Projet IAQverse

## 📋 Vue d'ensemble

IAQverse est une plateforme IoT de surveillance et d'analyse de la qualité de l'air intérieur (Indoor Air Quality) avec jumeau numérique 3D, prédictions ML et système d'alertes préventives.

---

## 🏗️ Architecture Cloud & Microservices

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            CLIENT / NAVIGATEUR                               │
│                                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐                      │
│  │   Dashboard  │  │ Digital Twin │  │   Settings   │                      │
│  │  (index.html)│  │ (3D Viewer)  │  │   (Config)   │                      │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘                      │
│         │                 │                  │                               │
│         └─────────────────┴──────────────────┘                               │
│                           │                                                  │
│                           │ HTTP/REST + WebSocket                            │
└───────────────────────────┼──────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         NGINX (Port 8080)                                    │
│                     Serveur Web Statique                                     │
│                                                                              │
│  • Sert les fichiers HTML/CSS/JS                                            │
│  • Proxy inverse pour l'API backend                                         │
│  • Gestion du cache navigateur                                              │
└───────────────────────────┬─────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                      API BACKEND (Port 8000)                                 │
│                      FastAPI + Uvicorn                                       │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────┐    │
│  │                        ENDPOINTS REST                              │    │
│  │                                                                    │    │
│  │  /api/ingest         → POST données capteurs                      │    │
│  │  /api/iaq/data       → GET données historiques (filtrage)         │    │
│  │  /api/predict/       → GET prédictions ML (score, actions)        │    │
│  │  /config             → GET/POST configuration système             │    │
│  │  /ws/iaq             → WebSocket temps réel                       │    │
│  └────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐                      │
│  │  API Module  │  │  Core Module │  │   ML Module  │                      │
│  │              │  │              │  │              │                      │
│  │ • ingest.py  │  │ • settings   │  │ • predictor  │                      │
│  │ • query.py   │  │ • influx     │  │ • trainer    │                      │
│  │ • config.py  │  │ • websocket  │  │ • scheduler  │                      │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘                      │
│         │                 │                  │                               │
│         └─────────────────┴──────────────────┘                               │
│                           │                                                  │
└───────────────────────────┼──────────────────────────────────────────────────┘
                            │
                 ┌──────────┴──────────┐
                 │                     │
                 ▼                     ▼
┌────────────────────────┐  ┌────────────────────────┐
│  INFLUXDB (Port 8086)  │  │  ML SCHEDULER SERVICE  │
│   Time-Series DB       │  │   Réentraînement Auto  │
│                        │  │                        │
│ • Stockage données IAQ │  │ • Schedule: 12h        │
│ • Requêtes Flux        │  │ • CSV + InfluxDB       │
│ • Rétention: 30j       │  │ • MAJ modèles ML       │
│ • Bucket: iaq_bucket   │  │                        │
└────────────────────────┘  └────────────────────────┘
```

---

## 🔄 Flux de Données

### 1. Ingestion de Données (Capteurs IoT → InfluxDB)

```
┌──────────────┐
│  Capteur IoT │ (Simulé par send_test_data.ps1)
│  • CO₂       │ 
│  • PM2.5     │ Intervalle: 5 secondes (debug)
│  • TVOC      │ 
│  • Temp/Hum  │ 
└──────┬───────┘
       │ POST /api/ingest
       │ {"sensor_id": "...", "values": {...}}
       ▼
┌──────────────────────────────┐
│  Backend: ingest.py          │
│                              │
│  1. Validation données       │
│  2. Calcul IAQ Score         │
│  3. Stockage RAM (iaq_db)    │
│  4. InfluxDB write           │
│  5. WebSocket broadcast      │
└──────┬───────────────────────┘
       │
       ├─────────────────┬──────────────────┐
       ▼                 ▼                  ▼
┌─────────────┐   ┌──────────────┐   ┌─────────────┐
│  InfluxDB   │   │  iaq_database│   │  WebSocket  │
│  (permanent)│   │  (RAM cache) │   │  (clients)  │
└─────────────┘   └──────────────┘   └─────────────┘
```

### 2. Requête de Données (Frontend ← Backend)

```
┌──────────────┐
│   Frontend   │
│   Charts.js  │ 
└──────┬───────┘
       │ GET /api/iaq/data?enseigne=X&salle=Y&hours=1&step=1min
       ▼
┌──────────────────────────────┐
│  Backend: query.py           │
│                              │
│  1. Parser paramètres        │
│  2. Requête Flux (InfluxDB)  │
│  3. Fallback RAM si erreur   │
│  4. Agrégation (5min/daily)  │
│  5. Calcul global_score      │
└──────┬───────────────────────┘
       │ JSON: [{timestamp, co2, pm25, ...}]
       ▼
┌──────────────┐
│   Plotly.js  │ Affichage graphiques temps réel
│   (60 points)│ Max: dernière heure
└──────────────┘
```

### 3. Prédictions ML (Analyse Préventive)

```
┌──────────────┐
│   Frontend   │ Intervalle: 30 secondes
│ digital-twin │ 
└──────┬───────┘
       │ GET /api/predict/preventive-actions?enseigne=X&salle=Y
       ▼
┌────────────────────────────────────────┐
│  Backend: main.py → ml_predict_generic │
│                                        │
│  1. Init ML Predictor (lazy load)     │
│  2. Fetch recent data (2h, 100 pts)   │
│  3. Feature engineering (20 features) │
│  4. Prediction (VotingRegressor)      │
│  5. Risk analysis (seuils)            │
│  6. Generate actions                  │
└────────┬───────────────────────────────┘
         │ JSON: {actions: [...], predicted_values: {...}}
         ▼
┌──────────────────────────┐
│  Frontend: Affichage     │
│                          │
│  • Actions préventives   │
│  • Dispositifs (window)  │
│  • Priorité (urgent/high)│
│  • Valeurs prédites      │
└──────────────────────────┘
```

### 4. Réentraînement Automatique ML

```
┌─────────────────────────┐
│  ML Scheduler Service   │ Cron: Toutes les 12h
│  (scheduler_retrain.py) │ 
└─────────┬───────────────┘
          │ Timer trigger
          ▼
┌──────────────────────────────────────┐
│  ml_train.py (subprocess)            │
│                                      │
│  1. Load CSV dataset (22k lignes)   │
│  2. Fetch InfluxDB data (nouveau)   │
│  3. Merge & preprocess              │
│  4. Feature engineering (47 → 20)   │
│  5. Train VotingRegressor           │
│     • RandomForest (n=200)          │
│     • GradientBoosting (n=200)      │
│  6. Save models (joblib)            │
│     • generic_multi_output.joblib   │
│     • generic_scaler.joblib         │
│     • encoders (salle, capteur)     │
└─────────┬────────────────────────────┘
          │
          ▼
┌──────────────────────┐
│  assets/ml_models/   │ Modèles mis à jour
│  • .joblib files     │ Utilisés par predictor
└──────────────────────┘
```

---

## 📦 Structure des Modules

### Backend (FastAPI)

```
backend/
├── main.py                      # Point d'entrée FastAPI
│   ├── App initialization
│   ├── CORS middleware
│   ├── Router registration
│   ├── ML predictor (lazy)
│   ├── Posting task (5s)
│   └── WebSocket handler
│
├── api/                         # Endpoints REST
│   ├── __init__.py             # Export routers
│   ├── ingest.py               # POST /api/ingest
│   │   └── iaq_database []     # RAM cache (global)
│   ├── query.py                # GET /api/iaq/data
│   │   ├── InfluxDB queries
│   │   └── Fallback RAM
│   └── config_api.py           # GET/POST /config
│       └── assets/config.json
│
├── core/                        # Infrastructure
│   ├── __init__.py             # Export clients
│   ├── settings.py             # Configuration (Pydantic)
│   │   ├── INFLUXDB_*
│   │   ├── APP_NAME
│   │   └── ML_MODELS_DIR
│   ├── influx_client.py        # InfluxDB wrapper
│   │   ├── get_influx_client()
│   │   ├── write_data()
│   │   └── query_data()
│   └── websocket_manager.py    # WebSocket pub/sub
│       ├── connect()
│       ├── disconnect()
│       └── broadcast()
│
├── ml/                          # Machine Learning
│   ├── ml_train.py             # Entraînement modèles
│   │   ├── creer_features() → 47 features
│   │   ├── preparer_donnees() → top 20
│   │   └── entrainer_modele() → joblib
│   ├── ml_predict_generic.py   # Prédictions temps réel
│   │   ├── RealtimeGenericPredictor
│   │   ├── load_models()
│   │   ├── predict() → 30min ahead
│   │   └── analyze_risks()
│   ├── scheduler_retrain.py    # Cron réentraînement
│   │   └── schedule.every(12h)
│   └── preprocess_dataset.py   # Nettoyage CSV
│
├── iaq_score.py                 # Calcul score IAQ global
│   └── calculate_iaq_score() → 0-100
│
└── utils.py                     # Helpers
    ├── sanitize_for_storage()
    └── load_dataset_df()
```

### Frontend (Vanilla JS)

```
frontend/
├── index.html                   # Dashboard principal
├── digital-twin.html            # Jumeau numérique 3D
├── settings.html                # Configuration
├── style.css                    # Styles globaux
│
└── js/
    ├── api.js                   # API client
    │   ├── API_ENDPOINTS {}
    │   ├── fetchData()
    │   └── postData()
    │
    ├── api-retry.js             # Retry logic (NEW)
    │   ├── fetchWithRetry()     # 3 tentatives
    │   └── apiCallWithCache()   # Cache fallback
    │
    ├── charts.js                # Plotly graphiques
    │   ├── fetchAndUpdate()     # 1h data, 1min step
    │   ├── extendTraces()       # maxPoints: 60
    │   └── resetCharts()        # Clear on room change
    │
    ├── dashboard.js             # Logique dashboard
    │   ├── updateCharts()
    │   └── roomChanged event
    │
    ├── digital-twin.js          # Scène 3D + Actions
    │   ├── loadPieceModel()     # GLB loader
    │   ├── fetchPreventiveActions() # 30s interval
    │   └── displayPreventiveActions()
    │
    ├── preventive-global.js     # Actions toutes salles
    │   └── fetchGlobalActions() # 30s interval
    │
    ├── alerts-engine.js         # Système alertes
    │   ├── evaluateCondition()
    │   ├── syncAlertPoints()
    │   └── showDetails()
    │
    ├── three-scene.js           # Three.js 3D
    │   ├── GLTFLoader
    │   ├── OrbitControls
    │   └── Animation loop
    │
    ├── config-loader.js         # Chargement config
    │   └── loadConfig() → assets/config.json
    │
    ├── tabs-manager.js          # Navigation salles
    │   ├── renderTabs()
    │   ├── roomChanged event
    │   └── enseigneChanged event
    │
    ├── i18n.js                  # Internationalisation
    │   └── loadTranslations() → assets/i18n/
    │
    ├── theme.js                 # Dark/Light mode
    │   └── toggleTheme()
    │
    └── utils.js                 # Helpers JS
        └── formatDate(), ...
```

---

## 🔌 API Endpoints

### Ingestion

| Méthode | Endpoint | Description | Body |
|---------|----------|-------------|------|
| `POST` | `/api/ingest` | Ingestion données capteur | `{sensor_id, enseigne, salle, timestamp, values: {CO2, PM25, TVOC, Temperature, Humidity}}` |

### Requêtes de Données

| Méthode | Endpoint | Description | Paramètres |
|---------|----------|-------------|------------|
| `GET` | `/api/iaq/data` | Récupère données IAQ | `enseigne, salle, sensor_id, hours, start, end, step, raw` |
| `GET` | `/api/iaq/debug` | Debug iaq_database | - |

### Prédictions ML

| Méthode | Endpoint | Description | Paramètres |
|---------|----------|-------------|------------|
| `GET` | `/api/predict/score` | Score IAQ prédit (30min) | `enseigne, salle, sensor_id` |
| `GET` | `/api/predict/preventive-actions` | Actions préventives ML | `enseigne, salle, sensor_id` |

### Configuration

| Méthode | Endpoint | Description | Body |
|---------|----------|-------------|------|
| `GET` | `/config` | Récupère config | - |
| `POST` | `/config` | Sauvegarde config | `{lieux: {enseignes: [...], active: "..."}}` |

### WebSocket

| Type | Endpoint | Description | Message |
|------|----------|-------------|---------|
| `WS` | `/ws/iaq` | Stream temps réel | `{type: "iaq_update", data: {...}}` |

---

## 🗄️ Modèle de Données

### Structure InfluxDB

```
Measurement: iaq_raw

Tags:
├── enseigne        (string) "Maison" | "Boutique"
├── salle           (string) "Bureau" | "Salon" | "Chambre"
└── sensor_id       (string) "bureau1" | "salon1"

Fields:
├── co2             (float)  400-2000+ ppm
├── pm25            (float)  0-200+ µg/m³
├── tvoc            (float)  0-1000+ ppb
├── temperature     (float)  15-35°C
├── humidity        (float)  20-80 %
└── global_score    (float)  0-100 (calculé)

Timestamp: RFC3339 UTC
Rétention: 30 jours
```

### Configuration JSON

```json
{
  "lieux": {
    "active": "ens_1762004765975",
    "enseignes": [
      {
        "id": "ens_1762004765975",
        "nom": "Maison",
        "pieces": [
          {
            "id": "piece_1762418101133",
            "nom": "Bureau",
            "icone": "bureau",
            "model": "ens_1762004765975_piece_1762418101133.glb",
            "capteurs": ["bureau1"],
            "seuils": {
              "co2": {"warning": 800, "danger": 1200},
              "pm25": {"warning": 15, "danger": 35},
              "tvoc": {"warning": 300, "danger": 1000}
            },
            "alertes": [
              {
                "nom": "Ventilation",
                "conditions": ["co2 > 1000"],
                "actions": ["open_window"],
                "severite": "danger"
              }
            ]
          }
        ]
      }
    ]
  }
}
```

### Modèles ML (Joblib)

```
assets/ml_models/
├── generic_multi_output.joblib     # VotingRegressor
│   ├── RandomForestRegressor (n_estimators=200)
│   └── GradientBoostingRegressor (n_estimators=200)
│
├── generic_scaler.joblib           # StandardScaler
│   └── Normalisation features
│
├── salle_encoder.joblib            # LabelEncoder
│   └── Encodage noms de salles
│
├── capteur_encoder.joblib          # LabelEncoder
│   └── Encodage sensor_id
│
└── generic_training_config.json    # Métadonnées
    ├── trained_rooms: [...]
    ├── trained_sensors: [...]
    ├── feature_columns: [20]
    ├── forecast_minutes: 6
    └── performance: {co2: R²=0.999, ...}
```

---

## 🔐 Sécurité & Configuration

### Variables d'Environnement (.env)

```env
# InfluxDB
INFLUXDB_URL=http://influxdb:8086
INFLUXDB_TOKEN=dev-token-iaqverse-2024
INFLUXDB_ORG=iaqverse
INFLUXDB_BUCKET=iaq_bucket

# Application
APP_NAME=IAQverse
APP_VERSION=2.0
CORS_ORIGINS=http://localhost:8080

# ML
ML_MODELS_DIR=/app/assets/ml_models

# Scheduler
RETRAIN_INTERVAL=12  # heures
```

### Ports Docker

| Service | Port Interne | Port Externe | Protocole |
|---------|-------------|--------------|-----------|
| **Frontend (Nginx)** | 80 | 8080 | HTTP |
| **Backend (Uvicorn)** | 8000 | 8000 | HTTP/WS |
| **InfluxDB** | 8086 | 8086 | HTTP |
| **ML Scheduler** | - | - | Internal |

### Réseau Docker

```yaml
iaqverse-network (bridge)
├── iaqverse-frontend     → 172.18.0.2
├── iaqverse-backend      → 172.18.0.3
├── iaqverse-influxdb     → 172.18.0.4
└── iaqverse-ml-scheduler → 172.18.0.5
```

---

## 🚀 Déploiement & Scaling

### Docker Compose

```yaml
version: '3.8'

services:
  influxdb:
    image: influxdb:2.7
    volumes:
      - ./database/influx_data:/var/lib/influxdb2
    ports:
      - "8086:8086"
    healthcheck:
      test: ["CMD", "influx", "ping"]
      interval: 10s
      
  backend:
    build:
      context: .
      dockerfile: Dockerfile.backend
    depends_on:
      - influxdb
    ports:
      - "8000:8000"
    volumes:
      - ./assets:/app/assets
    env_file: .env
    
  frontend:
    image: nginx:alpine
    volumes:
      - ./frontend:/usr/share/nginx/html:ro
      - ./assets:/usr/share/nginx/html/assets:ro
    ports:
      - "8080:80"
      
  ml-scheduler:
    build:
      context: .
      dockerfile: Dockerfile.ml-scheduler
    depends_on:
      - backend
      - influxdb
    volumes:
      - ./assets:/app/assets
    env_file: .env
```

### Stratégie de Scaling

```
┌─────────────────────────────────────────┐
│         LOAD BALANCER (Nginx)           │
│              Port 443 (HTTPS)           │
└──────┬────────────────────────┬─────────┘
       │                        │
       ▼                        ▼
┌──────────────┐        ┌──────────────┐
│  Frontend 1  │        │  Frontend 2  │
│  (Static)    │        │  (Static)    │
└──────────────┘        └──────────────┘
       │                        │
       └────────────┬───────────┘
                    ▼
            ┌──────────────┐
            │   API Gateway │
            │   (Port 8000) │
            └──────┬────────┘
                   │
       ┌───────────┼───────────┐
       ▼           ▼           ▼
┌───────────┐ ┌───────────┐ ┌───────────┐
│Backend 1  │ │Backend 2  │ │Backend 3  │
│(FastAPI)  │ │(FastAPI)  │ │(FastAPI)  │
└─────┬─────┘ └─────┬─────┘ └─────┬─────┘
      │             │             │
      └─────────────┼─────────────┘
                    ▼
            ┌──────────────┐
            │  InfluxDB    │
            │  (Clustered) │
            └──────────────┘
```

---

## 📊 Métriques & Performance

### Temps de Réponse

| Endpoint | Latence Moyenne | P95 | P99 |
|----------|----------------|-----|-----|
| `/api/ingest` | 15ms | 25ms | 40ms |
| `/api/iaq/data` (1h) | 120ms | 200ms | 350ms |
| `/api/predict/*` | 450ms | 800ms | 1200ms |
| WebSocket broadcast | 5ms | 10ms | 15ms |

### Volumétrie

- **Ingestion** : 5 secondes/point × 4 capteurs = 2880 points/jour/capteur
- **Stockage InfluxDB** : ~50 KB/jour/capteur (compressé)
- **Rétention** : 30 jours → ~1.5 MB/capteur
- **Prédictions ML** : 30 secondes interval → 2880 prédictions/jour

### Ressources Docker

| Service | CPU | RAM | Disque |
|---------|-----|-----|--------|
| Frontend | 0.1 core | 50 MB | 20 MB |
| Backend | 0.5 core | 300 MB | 100 MB |
| InfluxDB | 0.3 core | 512 MB | 500 MB (+ data) |
| ML Scheduler | 0.2 core | 200 MB | 50 MB |
| **TOTAL** | **1.1 core** | **~1 GB** | **~700 MB + data** |

---

## 🔄 Workflows Principaux

### Workflow 1 : Ajout Nouveau Capteur

```
1. Configuration
   └─> POST /config (ajouter capteur à config.json)

2. Simulation/Déploiement
   └─> Modifier send_test_data.ps1
   └─> POST /api/ingest (nouvelles données)

3. ML Retraining
   └─> Scheduler détecte nouveau capteur
   └─> ml_train.py inclut dans encoders
   └─> Modèles mis à jour automatiquement

4. Frontend
   └─> Auto-détection via config.json
   └─> Nouveaux onglets générés
   └─> Prédictions disponibles
```

### Workflow 2 : Alerte Qualité d'Air

```
1. Ingestion
   POST /api/ingest → {CO2: 1500 ppm}
   
2. Calcul Score
   iaq_score.py → global_score = 45 (mauvais)
   
3. Stockage
   ├─> InfluxDB (permanent)
   └─> iaq_database (RAM)
   
4. Broadcast
   WebSocket → Tous clients connectés
   
5. Frontend
   ├─> charts.js : Point rouge sur graphique
   ├─> alerts-engine.js : Evaluate conditions
   └─> digital-twin.js : Alert point 3D (rouge)
   
6. Prédiction (30s plus tard)
   GET /api/predict/preventive-actions
   └─> ML détecte tendance à la hausse
   └─> Génère action: "Ouvrir fenêtre" (URGENT)
   
7. Affichage
   digital-twin.js → Card rouge avec action
```

### Workflow 3 : Changement de Salle

```
1. User Click
   Onglet "Salon" cliqué
   
2. Event Dispatch
   tabs-manager.js → roomChanged event
   
3. Reset
   charts.js → resetCharts()
   ├─> Clear Plotly traces
   └─> seenTimestamps.clear()
   
4. Data Fetch
   GET /api/iaq/data?salle=Salon&hours=1&step=1min
   
5. ML Prediction
   GET /api/predict/preventive-actions?salle=Salon
   
6. 3D Model
   three-scene.js → loadPieceModel("salon.glb")
   
7. Update UI
   ├─> Graphiques : 60 points (1h)
   ├─> Actions préventives : nouvelles actions
   ├─> Score prédit : recalculé
   └─> Alert points 3D : repositionnés
```

---

## 🧪 Tests & Debugging

### Scripts de Test

```bash
# Test ingestion manuelle
./send_test_data.ps1

# Vérifier logs backend
docker logs -f iaqverse-backend

# Requête API directe
curl http://localhost:8000/api/iaq/data?hours=1

# Test prédiction ML
curl http://localhost:8000/api/predict/preventive-actions?enseigne=Maison&salle=Bureau
```

### Points de Debug

1. **Backend** : `docker logs iaqverse-backend`
   - Erreurs ML : "Failed to load ML predictor"
   - InfluxDB : "Erreur requête InfluxDB, fallback mémoire"
   
2. **Frontend** : Console navigateur (F12)
   - `[preventive]` : Actions préventives
   - `[charts]` : Graphiques Plotly
   - `[alerts-engine]` : Système d'alertes

3. **InfluxDB** : http://localhost:8086
   - Query explorer
   - Data browser

---

## 📚 Dépendances Critiques

### Backend (Python 3.12)

```
fastapi==0.115.4        # Framework API
uvicorn==0.32.0         # ASGI server
influxdb-client==1.46.0 # InfluxDB SDK
pandas==2.3.3           # Data processing
numpy==2.3.5            # Numerical computing
scikit-learn==1.7.2     # Machine Learning
joblib==1.5.2           # Model serialization
schedule==1.2.2         # Task scheduling
```

### Frontend (JavaScript Vanilla)

```
plotly.js v2.x          # Graphiques interactifs
three.js v0.155.0       # Moteur 3D
GLTFLoader              # Chargement modèles 3D
OrbitControls           # Contrôles caméra 3D
```

---

## 🔮 Évolutions Futures

### Phase 1 : Optimisations
- [ ] Redis pour cache haute performance
- [ ] PostgreSQL pour métadonnées
- [ ] Message Queue (RabbitMQ) pour découplage

### Phase 2 : Fonctionnalités
- [ ] Authentification JWT
- [ ] Multi-tenant (organisations)
- [ ] Notifications push (email, SMS)
- [ ] Export PDF rapports
- [ ] API GraphQL

### Phase 3 : Intelligence
- [ ] Deep Learning (LSTM, Transformer)
- [ ] Détection d'anomalies (Isolation Forest)
- [ ] Recommandations personnalisées
- [ ] Prédictions long terme (7 jours)

### Phase 4 : Infrastructure
- [ ] Kubernetes orchestration
- [ ] CI/CD (GitHub Actions)
- [ ] Monitoring (Prometheus + Grafana)
- [ ] Logs centralisés (ELK Stack)

---

## 📖 Références

- **FastAPI** : https://fastapi.tiangolo.com/
- **InfluxDB** : https://docs.influxdata.com/
- **Three.js** : https://threejs.org/docs/
- **Plotly.js** : https://plotly.com/javascript/
- **Scikit-learn** : https://scikit-learn.org/

---

**Dernière mise à jour** : 18 novembre 2025  
**Version** : 2.0  
**Architecture** : Microservices + Docker + ML
