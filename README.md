# IAQverse - Plateforme de Qualité de l'Air Intérieur

Plateforme complète de surveillance et prédiction de la qualité de l'air intérieur (IAQ) avec jumeau numérique 3D, Machine Learning et IoT.

## Démarrage rapide

```powershell
# Démarrer l'application
docker-compose up -d

# Accéder aux interfaces
- Frontend: http://localhost:3000
- API: http://localhost:8000/docs
- InfluxDB: http://localhost:8086
```

## Architecture

```
├── backend/          # API FastAPI + ML
│   ├── api/         # Endpoints REST
│   ├── core/        # Configuration & services
│   ├── ml/          # Prédiction ML
│   └── main.py      # Point d'entrée
├── frontend/        # Interface web
│   ├── js/          # Scripts JavaScript
│   ├── index.html   # Dashboard principal
│   └── digital-twin.html  # Jumeau numérique 3D
├── assets/          # Ressources
│   ├── datasets/    # Données d'entraînement
│   └── ml_models/   # Modèles ML pré-entraînés
└── database/        # Données InfluxDB
```

## Fonctionnalités

### Dashboard Principal (`index.html`)

- Visualisation en temps réel (CO₂, PM2.5, TVOC, Température, Humidité)
- Score IAQ actuel et prédit (30 min)
- Graphiques interactifs Plotly
- Multi-pièces et multi-enseignes

### Jumeau Numérique 3D (`digital-twin.html`)

- Modèle 3D interactif de la pièce
- Points d'alerte visuels (ventilation, fenêtres, radiateur...)
- Actions préventives basées sur ML
- Changement de couleur selon sévérité

### Machine Learning

- Prédiction des paramètres IAQ à 30 minutes
- Ensemble Voting (RandomForest + GradientBoosting)
- Actions préventives intelligentes
- Score IAQ prédit en temps réel

## Configuration

### Variables d'environnement (`.env`)

```env
# InfluxDB
INFLUXDB_URL=http://influxdb:8086
INFLUXDB_TOKEN=your-token
INFLUXDB_ORG=iaqverse
INFLUXDB_BUCKET=iaq_data

# Application
APP_NAME=IAQverse
APP_VERSION=2.0.0
ML_MODELS_DIR=/app/assets/ml_models
```

### Entraîner le modèle ML

```powershell
docker exec iaqverse-backend python backend/ml/ml_train.py
```

## API Endpoints

### Ingestion de données

```http
POST /api/ingest/iaq
Content-Type: application/json

{
  "enseigne": "Maison",
  "salle": "Bureau",
  "co2": 650,
  "pm25": 12,
  "tvoc": 250,
  "temperature": 21.5,
  "humidity": 45
}
```

### Requête de données

```http
GET /api/iaq/data?enseigne=Maison&salle=Bureau&hours=1
```

### Prédiction ML

```http
GET /api/predict/score?enseigne=Maison&salle=Bureau
GET /api/predict/preventive-actions?enseigne=Maison&salle=Bureau
```

## Tests

### Envoyer des données de test

```powershell
.\send_test_data.ps1
```

### Vérifier la santé

```http
GET /health
```

## Seuils IAQ

| Paramètre   | Bon         | Moyen             | Mauvais         |
| ------------ | ----------- | ----------------- | --------------- |
| CO₂         | < 800 ppm   | 800-1200 ppm      | > 1200 ppm      |
| PM2.5        | < 5 µg/m³ | 5-35 µg/m³      | > 35 µg/m³    |
| TVOC         | < 300 ppb   | 300-1000 ppb      | > 1000 ppb      |
| Température | 18-22°C    | 16-18 ou 22-24°C | < 16 ou > 24°C |
| Humidité    | 40-60%      | 30-40 ou 60-70%   | < 30 ou > 70%   |

## Développement

### Structure du code

- **Backend modulaire**: Séparation claire API/Core/ML
- **Frontend léger**: Vanilla JS, pas de framework lourd
- **ML intégré**: Prédictions en temps réel sans service séparé
- **Base de données**: InfluxDB (time-series) + Mémoire (cache)

### Ajouter un nouveau capteur

1. Modifier `backend/api/ingest.py`
2. Ajouter les seuils dans `backend/action_selector.py`
3. Mettre à jour le frontend `frontend/js/charts.js`

### Personnaliser le jumeau numérique

Éditer `frontend/js/three-scene.js` pour modifier le modèle 3D ou les points d'alerte.

## Licence

Projet de fin d'études - IAQverse Platform

## Support

Pour toute question, consulter `/docs` de l'API ou examiner les logs :

```powershell
docker-compose logs -f backend
docker-compose logs -f frontend
```
