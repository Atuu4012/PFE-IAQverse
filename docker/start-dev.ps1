# Démarrage rapide Docker - Environnement de développement

# Se placer dans le dossier docker (fonctionne depuis n'importe où)
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $scriptDir

# Lancer avec --env-file pour que les ${VAR} du compose soient résolues
docker compose --env-file .env.dev -f docker-compose.dev.yml up -d --build

# Les services seront disponibles sur :
# - Frontend : http://localhost:8080
# - Backend API : http://localhost:8000
# - InfluxDB UI : http://localhost:8086
# - MLflow UI : http://localhost:5000
