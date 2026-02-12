# Démarrage rapide Docker - React Development

# Lancer l'environnement de développement complet
Set-Location docker
docker-compose -f docker-compose.dev-react.yml up --build

# Les services seront disponibles sur :
# - Frontend React : http://localhost:3000
# - Backend API : http://localhost:8000
# - InfluxDB UI : http://localhost:8086
# - MLflow UI : http://localhost:5000
