# IAQverse

Plateforme de surveillance et de prediction de la qualite de l'air interieur (IAQ).
Backend FastAPI, frontend vanilla JS, base de donnees InfluxDB, modeles ML avec suivi MLflow, authentification Supabase.

## Prerequis

- Docker et Docker Compose

## Demarrage rapide (developpement)

Depuis la racine du projet :

```powershell
cd docker
docker-compose -f docker-compose.dev.yml up --build
```

Ou utiliser le script fourni :

```powershell
.\docker\start-dev.ps1
```

Services disponibles :

| Service     | URL                        |
| ----------- | -------------------------- |
| Frontend    | http://localhost:8080      |
| Backend API | http://localhost:8000      |
| API Docs    | http://localhost:8000/docs |
| InfluxDB    | http://localhost:8086      |
| MLflow      | http://localhost:5000      |

## Production

```powershell
cd docker
docker-compose -f docker-compose.prod.yml up --build -d
```

En production le frontend est servi sur le port 80. Les ports internes (InfluxDB, backend) ne sont pas exposes.

## Configuration

Les variables d'environnement sont dans `docker/.env.dev` (developpement) et `docker/.env.prod` (production). Un exemple pour la production est fourni dans `docker/.env.prod.example`.

Variables principales :

| Variable                  | Description                              |
| ------------------------- | ---------------------------------------- |
| INFLUXDB_TOKEN            | Token d'acces InfluxDB                   |
| INFLUXDB_ORG              | Organisation InfluxDB                    |
| INFLUXDB_BUCKET           | Bucket InfluxDB                          |
| SUPABASE_URL              | URL du projet Supabase                   |
| SUPABASE_KEY              | Cle publique Supabase                    |
| SUPABASE_SERVICE_ROLE_KEY | Cle service Supabase                     |
| RETRAIN_INTERVAL          | Intervalle de reentrainement ML (heures) |

## Architecture

```
.
├── backend/
│   ├── api/            # Endpoints REST (ingest, query, config)
│   ├── core/           # Configuration et services
│   ├── ml/             # Entrainement et prediction ML classique
│   ├── dl/             # Entrainement LSTM et scheduler de reentrainement
│   ├── main.py         # Point d'entree FastAPI
│   ├── iaq_score.py    # Calcul du score IAQ
│   ├── simulator.py    # Simulateur de donnees capteurs
│   └── utils.py        # Utilitaires
├── frontend/
│   ├── js/             # Scripts (charts, websocket, auth, settings, 3D...)
│   ├── index.html      # Dashboard principal
│   ├── digital-twin.html  # Jumeau numerique 3D
│   ├── settings.html   # Page de configuration
│   ├── login.html      # Connexion
│   ├── signup.html     # Inscription
│   └── style.css       # Styles
├── docker/
│   ├── docker-compose.dev.yml   # Compose developpement
│   ├── docker-compose.prod.yml  # Compose production
│   ├── Dockerfile.backend
│   ├── Dockerfile.frontend
│   ├── Dockerfile.ml-scheduler
│   ├── nginx.conf
│   ├── .env.dev
│   ├── .env.prod
│   └── start-dev.ps1
├── assets/
│   ├── datasets/       # Donnees d'entrainement
│   └── ml_models/      # Modeles sauvegardes
└── database/           # Donnees InfluxDB (volume local dev)
```

## Services Docker

| Service      | Role                                              |
| ------------ | ------------------------------------------------- |
| backend      | API FastAPI, predictions ML, WebSocket temps reel |
| frontend     | Nginx servant les fichiers statiques              |
| influxdb     | Base de donnees time-series                       |
| mlflow       | Suivi des experiences et registre de modeles      |
| ml-scheduler | Reentrainement periodique des modeles             |

## API

La documentation interactive est disponible sur `/docs` (Swagger) une fois le backend demarre.

Endpoints principaux :

```
POST /api/ingest/iaq          # Ingestion de donnees capteurs
GET  /api/iaq/data            # Requete de donnees (params: enseigne, salle, hours)
GET  /api/predict/score       # Score IAQ predit
GET  /api/predict/preventive-actions  # Actions preventives
GET  /health                  # Verification de sante
```

## Seuils IAQ

| Parametre   | Bon       | Moyen            | Mauvais        |
| ----------- | --------- | ---------------- | -------------- |
| CO2         | < 800 ppm | 800 - 1200 ppm   | > 1200 ppm     |
| PM2.5       | < 5 ug/m3 | 5 - 35 ug/m3     | > 35 ug/m3     |
| TVOC        | < 300 ppb | 300 - 1000 ppb   | > 1000 ppb     |
| Temperature | 18 - 22 C | 16-18 ou 22-24 C | < 16 ou > 24 C |
| Humidite    | 40 - 60 % | 30-40 ou 60-70 % | < 30 ou > 70 % |

## Logs

```powershell
cd docker
docker-compose -f docker-compose.dev.yml logs -f backend
docker-compose -f docker-compose.dev.yml logs -f ml-scheduler
```

## Licence

Projet de fin d'etudes - IAQverse
