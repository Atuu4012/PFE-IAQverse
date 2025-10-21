# IAQverse – Jumeau numérique pour la qualité de l'air intérieur (PFE)

> IAQverse est une plateforme immersive et intelligente dédiée à la surveillance, la visualisation et l'amélioration de la qualité de l'air intérieur (IAQ) dans les bâtiments. Grâce à l'intégration de capteurs, d'une API en temps réel, d'un dashboard interactif et d'une scène VR, le projet transforme l'invisible en action.

---

## *Structure du projet*

**IAQverse/**
│
├── **backend/**              API FastAPI, traitement des données
│   ├── main.py
│   ├── models.py
│   ├── database.py
│   ├── ml_model.py
│   └── requirements.txt
│
├── **frontend/**              Dashboard web, VR, visualisation
│   ├── index.html
│   ├── style.css
│   ├── app.js
│   └── charts.js
│
├── simulator.py          Générateur de données capteurs
│
├── **assets/**                Images, textures, vidéos 360°
│   └── ...
│
├── **config/**                Fichiers .env, paramètres
│   └── .env
│
└── README.md              Documentation du projet

## Fonctionnalités

- **Collecte IAQ** : CO₂, PM2.5, TVOC, température, humidité
- **API FastAPI** : réception et stockage des données en temps réel
- **Dashboard Web** : visualisation des indicateurs IAQ
- **Capteurs** : génération de données par des capteurs
- **Prévision IA** : modèle LSTM pour anticiper les risques
- **Scène VR** : immersion 360° avec alertes visuelles
- **Automatisation** : envoi d’alertes au syndic, propriétaire ou assurance
- **Agenda connecté** : synchronisation avec Outlook ou Google Calendar

## Installation

1. **Cloner le projet** :

   ```bash
   git clone https://github.com/ton-utilisateur/iaqverse.git
   cd iaqverse
   ```
2. **Installer les dépendances Python** :

   ```
   pip install -r backend/requirements.txt
   ```
3. **Lancer l’API FastAPI** :

   ```
   uvicorn backend.main:app --reload
   ```
4. **Ouvrir le dashboard** :

* Ouvrir `frontend/index.html` dans ton navigateur

## Technologies utilisées

* **Python** : FastAPI, Pydantic, SQLAlchemy, TensorFlow
* **JavaScript** : Plotly.js, A-Frame, WebSocket
* **HTML/CSS** : Interface responsive
* **SQLite / Firebase** : Stockage des données
* **VR** : Insta360, WebXR
* **Agenda** : Microsoft Graph API, Google Calendar API

## Objectifs pédagogiques

* Comprendre les enjeux de la qualité de l’air intérieur
* Concevoir un jumeau numérique immersif et interactif
* Appliquer des modèles IA pour la prédiction environnementale
* Automatiser des actions techniques et administratives

## Équipe projet

* Arthur Parizot de Laporterie
* Quentin Tajchner
