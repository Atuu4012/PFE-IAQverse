# Pipeline ML & DL — IAQverse

> Documentation complète du preprocessing, de l'ingénierie des features, des pipelines d'entraînement et des artefacts produits.

---

## Table des matières

1. [Vue d'ensemble](#1-vue-densemble)
2. [Preprocessing du dataset](#2-preprocessing-du-dataset)
3. [Pipeline ML classique — VotingRegressor](#3-pipeline-ml-classique--votingregressor)
4. [Pipeline DL — LSTM Encoder-Decoder avec Attention](#4-pipeline-dl--lstm-encoder-decoder-avec-attention)
5. [Service de prédiction en temps réel](#5-service-de-prédiction-en-temps-réel)
6. [Scheduler de réentraînement automatique](#6-scheduler-de-réentraînement-automatique)
7. [Résumé des artefacts produits](#7-résumé-des-artefacts-produits)
8. [Synthèse des choix techniques](#8-synthèse-des-choix-techniques)

---

## 1. Vue d'ensemble

Le projet utilise **deux modèles complémentaires** pour prédire la qualité de l'air intérieur :

| Modèle | Rôle | Fichier d'entraînement |
|--------|------|------------------------|
| **VotingRegressor** (RF + GB) | Modèle de secours, simple et rapide | `backend/ml/ml_train.py` |
| **LSTM Encoder-Decoder + Attention** | Modèle de production, plus précis | `backend/dl/ml_train_lstm.py` |

Le système essaie toujours de charger le LSTM en premier. S'il n'est pas disponible (pas encore entraîné, fichier corrompu…), il bascule automatiquement sur le VotingRegressor. Cette approche s'appelle un **dual-model avec dégradation gracieuse** : le service ne tombe jamais en panne, il utilise simplement un modèle moins performant en attendant.

**Flux global des données :**

```
Capteurs IoT (brut)
        │
        ▼
  preprocess_dataset.py ──► dataset_ml_5min.csv (nettoyé, rééchantillonné)
        │
        ├──► ml_train.py ──► VotingRegressor (fallback)
        │
        └──► ml_train_lstm.py ──► LSTM (production)
                │
                ▼
        ml_predict_generic.py ──► Prédictions temps réel + Alertes
```

---

## 2. Preprocessing du dataset

> **Fichier** : `backend/ml/preprocess_dataset.py`
>
> **Exécution** : une seule fois, pour générer les CSV propres à partir des données brutes.

### 2.1 Source des données

Les données brutes proviennent du dossier `assets/datasets/R1/`. Ce sont des fichiers CSV organisés par date, issus de **4 capteurs IoT** (Desk1 à Desk4) installés dans un espace de bureaux.

Chaque fichier contient des colonnes comme `ts`, `T`, `H`, `CO2`, `PMS2_5`, `VoC`, `Customer`, `Loc`.

### 2.2 Mapping des colonnes

La première étape est de **renommer les colonnes** dans un format standard et lisible. Cela permet au reste du code de toujours utiliser les mêmes noms, peu importe le format d'origine des capteurs.

| Colonne brute | Colonne standardisée | Unité | Signification |
|---------------|---------------------|-------|---------------|
| `ts` | `timestamp` | — | Date et heure de la mesure |
| `T` | `temperature` | °C | Température ambiante |
| `H` | `humidity` | % | Taux d'humidité relative |
| `CO2` | `co2` | ppm | Concentration de dioxyde de carbone |
| `PMS2_5` | `pm25` | µg/m³ | Particules fines (diamètre ≤ 2.5 µm) |
| `VoC` | `tvoc` | ppb | Composés organiques volatils totaux |
| `Loc` (Desk1…4) | `capteur_id` (Bureau1…4) | — | Identifiant du capteur |
| `Customer` (R1) | `enseigne` (Maison) | — | Identifiant du site |

Les capteurs sont affectés à une salle unique appelée `Bureau`. C'est une simplification car tous les capteurs du dataset R1 sont dans le même espace ouvert.

### 2.3 Nettoyage des données

Le nettoyage se fait en **4 passes** successives :

#### Passe 1 — Remplacement des valeurs vides

Toutes les chaînes vides (`""`, `" "`, `"  "`) sont remplacées par `NaN`. Cela uniformise la représentation des données manquantes pour que pandas puisse les gérer correctement.

#### Passe 2 — Conversion numérique forcée

Chaque colonne de mesure est convertie avec `pd.to_numeric(errors='coerce')`. Si une valeur n'est pas un nombre valide (ex: `"N/A"`, `"---"`), elle devient `NaN` au lieu de faire planter le script.

#### Passe 3 — Filtrage des valeurs aberrantes

Des **bornes physiques réalistes** sont définies pour chaque mesure. Toute valeur en dehors de ces bornes est remplacée par `NaN`.

| Mesure | Minimum | Maximum | Justification |
|--------|---------|---------|---------------|
| CO2 | 200 ppm | 5000 ppm | Le CO2 atmosphérique est ~420 ppm. En dessous de 200, c'est un capteur défaillant. Au-dessus de 5000, c'est un environnement dangereux irréaliste en bureau. |
| PM2.5 | 0 µg/m³ | 500 µg/m³ | Les PM2.5 ne peuvent pas être négatives. Au-dessus de 500, c'est un incendie, pas un bureau. |
| TVOC | 0 ppb | 10000 ppb | Même logique : négatif = erreur capteur, 10000+ = situation extrême. |
| Température | -10°C | 50°C | Un bureau ne descend jamais sous -10°C et ne dépasse pas 50°C. |
| Humidité | 0% | 100% | L'humidité relative est physiquement bornée entre 0 et 100%. |

**Pourquoi ne pas simplement supprimer ces lignes ?** Parce qu'une ligne peut avoir un CO2 aberrant mais une température parfaitement valide. En mettant `NaN` uniquement sur la valeur aberrante, on conserve le maximum d'information.

#### Passe 4 — Suppression des lignes totalement vides

Une ligne où **toutes** les mesures (co2, pm25, tvoc, temperature, humidity) sont `NaN` n'apporte aucune information. Elle est supprimée. En revanche, une ligne avec même une seule mesure valide est conservée.

### 2.4 Déduplication

Si deux lignes ont le même `timestamp` + `salle` + `capteur_id`, c'est un doublon. Seule la première occurrence est gardée. Cela peut arriver quand un capteur renvoie deux fois la même mesure (retransmission réseau par exemple).

### 2.5 Simulation des occupants

Le dataset R1 ne contient **aucune information** sur le nombre de personnes présentes. Or, l'occupation est un facteur majeur de la qualité de l'air : plus il y a de monde, plus le CO2 et les TVOC augmentent.

Pour que le modèle puisse apprendre cette relation, une colonne `occupants` est **simulée** :

- **Heures de bureau** (8h–19h, lundi à vendredi) : entre 1 et 5 personnes, tiré aléatoirement
- **Nuit et week-end** : 0 personne

**Deux choix importants :**

1. **Stabilité par heure** : l'occupation ne change pas chaque minute. On génère un nombre par heure entière, et toutes les lignes de cette heure ont la même valeur. C'est plus réaliste : les gens n'arrivent pas et ne partent pas toutes les minutes.

2. **Reproductibilité** : `np.random.seed(42)` garantit que les mêmes valeurs sont générées à chaque exécution du script. Deux personnes qui exécutent ce script obtiendront exactement le même dataset.

### 2.6 Rééchantillonnage

Les capteurs envoient des données à intervalle irrégulier (parfois toutes les secondes, parfois toutes les minutes). Le rééchantillonnage uniformise la fréquence en calculant la **moyenne** sur chaque intervalle.

Deux datasets sont générés :

| Fichier | Fréquence | Usage | Nombre de lignes (ordre de grandeur) |
|---------|-----------|-------|--------------------------------------|
| `dataset_full_1min.csv` | 1 minute | Analyse exploratoire, visualisation | ~élevé |
| `dataset_ml_5min.csv` | 5 minutes | **Entraînement ML et DL** | ~modéré |

**Pourquoi 5 minutes pour l'entraînement ?**

- La qualité de l'air intérieur évolue **lentement** : le CO2 ne double pas en 30 secondes. Un pas de 5 minutes capture très bien les dynamiques réelles.
- Un pas plus court (1 min) augmenterait le volume de données ×5 sans apporter d'information utile, ce qui ralentirait l'entraînement.
- Un pas plus long (15 min) perdrait des transitoires importants (ex : fenêtre ouverte pendant 10 minutes).
- 5 minutes est aussi un standard courant dans les systèmes de monitoring de bâtiments.

Le rééchantillonnage est fait **par capteur** séparément, pour éviter de mélanger les moyennes de capteurs différents.

### 2.7 Sauvegarde et statistiques

Le dataset final est sauvegardé en CSV. Un fichier JSON de statistiques est aussi généré avec : nombre total de lignes, période couverte, liste des capteurs, valeurs manquantes par colonne, et statistiques descriptives (min, max, moyenne, écart-type…).

---

## 3. Pipeline ML classique — VotingRegressor

> **Fichier** : `backend/ml/ml_train.py`
>
> Ce modèle sert de **fallback**. Il est plus simple et plus rapide à entraîner que le LSTM.

### 3.1 Chargement des données

Le script peut fonctionner en deux modes :

1. **CSV seul** : charge `dataset_ml_5min.csv` (mode initial)
2. **CSV + InfluxDB** : fusionne le CSV historique avec les données récentes de la base InfluxDB (mode réentraînement). Cela permet au modèle d'apprendre sur des données plus récentes sans perdre l'historique.

### 3.2 Ingénierie des features

La fonction `creer_features()` transforme les 5 mesures brutes en **~40 features** réparties en 7 catégories.

#### 3.2.1 Features temporelles basiques

```
hour, day_of_week, is_weekend
```

- `hour` (0–23) : capture les patterns journaliers (CO2 monte le matin quand les gens arrivent, baisse le soir).
- `day_of_week` (0–6) : capture les différences semaine/week-end.
- `is_weekend` (0 ou 1) : simplification binaire de `day_of_week`.

#### 3.2.2 Features temporelles cycliques (sin/cos)

```
hour_sin, hour_cos, day_sin, day_cos
```

**Pourquoi ?** Si on donne `hour = 23` et `hour = 0` à un modèle, il pense qu'ils sont éloignés (différence = 23). Or, 23h et 0h ne sont séparés que d'une heure. L'encodage sinusoïdal résout ce problème :

- `hour_sin = sin(2π × hour / 24)` et `hour_cos = cos(2π × hour / 24)`

Avec cet encodage, 23h et 0h sont proches dans l'espace des features. Le modèle comprend naturellement la périodicité.

La même logique est appliquée au jour de la semaine (période de 7).

#### 3.2.3 Encodage des variables catégorielles

```
salle_encoded, sensor_encoded
```

`LabelEncoder` transforme les noms de salles et capteurs en nombres entiers. Cela permet au modèle de différencier les capteurs (chaque bureau peut avoir des caractéristiques différentes : exposition soleil, proximité fenêtre…).

#### 3.2.4 Différences (dérivée discrète)

```
co2_diff, pm25_diff, tvoc_diff, temperature_diff, humidity_diff
```

`diff()` calcule la différence entre la valeur courante et la précédente. C'est la **vitesse de changement** : si `co2_diff` est fortement positif, le CO2 est en train de monter rapidement. Le modèle peut ainsi anticiper une accélération.

#### 3.2.5 Moyennes mobiles

```
{mesure}_ma3  (moyenne sur les 3 dernières mesures = 15 min)
{mesure}_ma6  (moyenne sur les 6 dernières mesures = 30 min)
```

Les moyennes mobiles **lissent le bruit** des capteurs et capturent les tendances :

- `_ma3` (court terme, 15 min) : réagit vite aux changements récents
- `_ma6` (moyen terme, 30 min) : donne une tendance plus stable

**Pourquoi deux fenêtres ?** Si la valeur actuelle est au-dessus de `_ma6` mais en dessous de `_ma3`, cela signifie que la tendance court terme s'inverse (le pic est passé). Le modèle peut exploiter ce croisement.

#### 3.2.6 Écart-type mobile

```
{mesure}_std3  (écart-type sur 3 mesures)
```

Mesure la **volatilité locale**. Un écart-type élevé signifie que la valeur oscille fortement (ex : ouverture/fermeture de fenêtre répétée). Un écart-type faible signifie un environnement stable. Le modèle peut adapter ses prédictions en conséquence.

#### 3.2.7 Lag features (valeurs passées)

```
{mesure}_lag1  (valeur à t-1, soit 5 min avant)
{mesure}_lag2  (valeur à t-2, soit 10 min avant)
```

Ce sont les valeurs passées, telles quelles. Le modèle peut ainsi faire de l'**auto-régression** : prédire la valeur future à partir des valeurs passées. C'est l'approche la plus simple et souvent très efficace pour les séries temporelles.

#### 3.2.8 Features d'interaction

```
co2_tvoc_ratio       = co2 / (tvoc + 1)
pm25_humidity_ratio  = pm25 / (humidity + 1)
temp_humidity_interaction = temperature × humidity
```

Ces features capturent des **relations physiques** connues :

- **CO2/TVOC** : ces deux polluants sont souvent corrélés car ils proviennent de la même source (la respiration humaine). Un ratio stable suggère une source humaine, un ratio anormal suggère une autre source (peinture, nettoyant…).
- **PM2.5/humidity** : l'humidité favorise l'agglomération des particules fines. Un ratio élevé avec une humidité faible est plus alarmant.
- **Température × Humidité** : rappelle l'indice de confort thermique. Chaleur + humidité = inconfort perçu.

Le `+ 1` au dénominateur évite la division par zéro.

### 3.3 Sélection des features (Top 20)

Sur les ~40 features créées, seules **20** sont retenues pour l'entraînement. Elles ont été sélectionnées en mesurant l'importance des features avec le modèle (feature importance du Random Forest + Gradient Boosting).

```
Valeurs actuelles :  humidity, co2, tvoc, pm25, temperature
Moyennes mobiles  :  humidity_ma3, pm25_ma3, co2_ma3, tvoc_ma6, pm25_ma6, humidity_ma6
Lag features      :  co2_lag1, humidity_lag1, pm25_lag1, tvoc_lag2, tvoc_lag1
Encodages         :  sensor_encoded, salle_encoded
Temporelles       :  hour, day_of_week
```

**Pourquoi réduire à 20 features ?**

- **Éviter l'overfitting** : plus il y a de features, plus le modèle risque d'apprendre du bruit plutôt que du signal.
- **Rapidité** : moins de features = entraînement et prédiction plus rapides.
- **Interprétabilité** : on sait exactement ce que le modèle utilise.

On remarque que les **features d'interaction** (ratios) et l'**écart-type mobile** ne font pas partie du Top 20. Cela signifie qu'elles n'apportent pas suffisamment d'information supplémentaire par rapport aux features plus simples.

### 3.4 Normalisation

Un `StandardScaler` est appliqué sur les features (centrage à 0, écart-type à 1). Cela met toutes les features sur la même échelle, ce qui est surtout utile pour le Gradient Boosting (le Random Forest y est moins sensible, mais ça ne nuit pas).

### 3.5 Split temporel

```
85% train | 15% test
```

Le split est **chronologique** : les 85% premiers par ordre de temps servent à l'entraînement, les 15% restants au test. Il n'y a **pas de shuffle** (mélange aléatoire).

**Pourquoi un split temporel et non aléatoire ?** Avec un shuffle, le modèle pourrait voir des données de février dans le train et de janvier dans le test. Il "tricherait" en utilisant des informations futures pour prédire le passé (data leakage temporel). Le split chronologique simule la réalité : on entraîne sur le passé, on évalue sur le futur.

**Pourquoi 85/15 et non 80/20 ?** Plus de données d'entraînement = meilleure généralisation, surtout avec un dataset de taille modeste. 15% de test reste suffisant pour évaluer les performances.

### 3.6 Architecture du modèle

```
VotingRegressor
├── RandomForestRegressor (poids = 1.0)
│   ├── 200 arbres
│   ├── Profondeur max = 15
│   └── OOB Score activé
│
└── GradientBoostingRegressor (poids = 1.2)
    ├── 200 arbres
    ├── Profondeur max = 6
    └── Learning rate = 0.05

→ Le tout enveloppé dans MultiOutputRegressor
```

#### Pourquoi un VotingRegressor ?

Un VotingRegressor combine les prédictions de plusieurs modèles en faisant une **moyenne pondérée**. L'idée est que les erreurs de chaque modèle se compensent mutuellement.

#### Pourquoi Random Forest + Gradient Boosting ?

- **Random Forest** (bagging) : construit 200 arbres indépendants sur des sous-échantillons aléatoires. Chaque arbre fait des erreurs différentes, et la moyenne les annule. Il est **robuste au bruit** et **résistant à l'overfitting**.
- **Gradient Boosting** (boosting) : construit 200 arbres séquentiellement, chaque nouvel arbre corrigeant les erreurs des précédents. Il est **plus précis** mais plus sensible à l'overfitting.

En les combinant, on obtient le meilleur des deux : la stabilité du RF et la précision du GB.

#### Pourquoi le GB a un poids de 1.2 ?

Le GB est généralement plus précis que le RF sur des données tabulaires structurées. Le surpondérer légèrement (×1.2 au lieu de ×1.0) favorise cette précision tout en gardant le filet de sécurité du RF.

#### Pourquoi MultiOutputRegressor ?

Le modèle prédit **4 variables en même temps** : CO2, PM2.5, TVOC et humidité. `MultiOutputRegressor` entraîne un modèle séparé pour chaque target, mais en utilisant les mêmes features. C'est plus simple qu'un modèle multi-target natif, et ça fonctionne bien en pratique.

**Note** : la température n'est pas dans les targets. C'est un choix délibéré : en intérieur, la température est souvent contrôlée par la climatisation/chauffage et donc très stable et prévisible.

#### Hyperparamètres du Random Forest

| Paramètre | Valeur | Justification |
|-----------|--------|---------------|
| `n_estimators=200` | Plus d'arbres = prédictions plus stables. Au-delà de 200, le gain est marginal. |
| `max_depth=15` | Assez profond pour capturer des patterns complexes, pas trop pour éviter l'overfitting. |
| `min_samples_split=10` | Empêche un noeud de se diviser s'il contient moins de 10 échantillons. Régularisation douce. |
| `min_samples_leaf=4` | Chaque feuille doit contenir au moins 4 échantillons. Lisse les prédictions. |
| `max_features='sqrt'` | Chaque arbre ne voit qu'un sous-ensemble de features (√20 ≈ 4-5). Force la diversité entre arbres. |
| `oob_score=True` | Score Out-of-Bag : évaluation gratuite sans ensemble de test séparé (spécifique au bagging). |

#### Hyperparamètres du Gradient Boosting

| Paramètre | Valeur | Justification |
|-----------|--------|---------------|
| `n_estimators=200` | 200 étapes de boosting. |
| `max_depth=6` | Plus faible que le RF, car le boosting compense la faible profondeur par le nombre d'itérations. |
| `learning_rate=0.05` | Faible learning rate = chaque arbre contribue peu → moins d'overfitting, meilleure généralisation. |
| `subsample=0.8` | Chaque arbre ne voit que 80% des données (stochastic GB). Ajoute de la régularisation. |

### 3.7 Métriques d'évaluation

Pour chaque target, 5 métriques sont calculées :

| Métrique | Signification | Utilité |
|----------|---------------|---------|
| **RMSE** | Erreur quadratique moyenne | Pénalise fortement les grosses erreurs |
| **MAE** | Erreur absolue moyenne | Plus intuitive, en unités de la mesure |
| **R²** | Coefficient de détermination | 1.0 = parfait, 0.0 = aussi bon que la moyenne |
| **MAPE** | Erreur relative moyenne (%) | Interprétable en pourcentage |
| **Médiane AE** | Médiane des erreurs absolues | Robuste aux outliers |

### 3.8 Artefacts produits

| Fichier | Contenu | Utilisé par |
|---------|---------|-------------|
| `generic_multi_output.joblib` | Le modèle VotingRegressor entraîné | `ml_predict_generic.py` |
| `generic_scaler.joblib` | Le StandardScaler fitté sur le train | `ml_predict_generic.py` |
| `salle_encoder.joblib` | LabelEncoder des noms de salles | `ml_predict_generic.py` |
| `capteur_encoder.joblib` | LabelEncoder des IDs de capteurs | `ml_predict_generic.py` |
| `generic_training_config.json` | Métadonnées (type modèle, liste features, liste targets, salles/capteurs connus) | `ml_predict_generic.py` |

Tous ces fichiers sont sauvegardés dans `assets/ml_models/`.

---

## 4. Pipeline DL — LSTM Encoder-Decoder avec Attention

> **Fichier** : `backend/dl/ml_train_lstm.py`
>
> C'est le **modèle principal** déployé en production. Il est plus complexe, plus précis, et nécessite plus de données.

### 4.1 Configuration globale

| Paramètre | Valeur | Signification |
|-----------|--------|---------------|
| `LOOKBACK_STEPS` | **72** | Le modèle reçoit 72 pas d'historique, soit **6 heures** (72 × 5 min) |
| `HORIZON_STEPS` | **6** | Le modèle prédit 6 pas futurs : +5, +10, +15, +20, +25, +30 min |
| `TARGET_HORIZON_IDX` | **5** | L'horizon principal optimisé est le dernier : **t+30 min** |

**Pourquoi 6 heures de lookback ?**

Les patterns de qualité d'air en bureau suivent des cycles de quelques heures : arrivée le matin (CO2 monte sur ~2h), pause déjeuner (CO2 baisse sur ~1h), retour l'après-midi. 6 heures capturent un demi-cycle journalier complet. Augmenter au-delà (12h, 24h) apporterait peu d'information supplémentaire tout en augmentant considérablement la mémoire et le temps de calcul.

**Pourquoi 6 horizons de prédiction ?**

Prédire uniquement à +30 min serait suffisant pour les alertes, mais les horizons intermédiaires (+5, +10…) permettent de :
- Offrir un aperçu **granulaire** de l'évolution attendue
- Observer la **dégradation des performances** au fil du temps (les prédictions à +5 min sont toujours meilleures qu'à +30 min)
- Alimenter des visualisations (courbe de tendance dans le dashboard)

### 4.2 Features d'entrée (10 dimensions)

| # | Feature | Nature | Justification |
|---|---------|--------|---------------|
| 1 | `co2` | Mesure brute | Polluant principal en intérieur |
| 2 | `pm25` | Mesure brute | Particules fines, dangereux pour la santé |
| 3 | `tvoc` | Mesure brute | Composés organiques volatils |
| 4 | `temperature` | Mesure brute | Influe sur le confort et les autres polluants |
| 5 | `humidity` | Mesure brute | Influe sur les PM2.5 et le confort |
| 6 | `occupants` | Contextuel | Nombre de personnes, facteur principal du CO2 |
| 7 | `hour_sin` | Temporel cyclique | Position dans la journée (composante sinus) |
| 8 | `hour_cos` | Temporel cyclique | Position dans la journée (composante cosinus) |
| 9 | `day_sin` | Temporel cyclique | Position dans la semaine (composante sinus) |
| 10 | `day_cos` | Temporel cyclique | Position dans la semaine (composante cosinus) |

**Pourquoi pas de lag features ou moyennes mobiles comme le ML ?**

Le LSTM intègre nativement la notion de mémoire temporelle grâce à ses portes (forget gate, input gate). Il discerne lui-même les patterns de tendance (ce que font les moyennes mobiles) et les dépendances au passé (ce que font les lag features). Ajouter ces features manuellement serait **redondant** et pourrait même nuire en ajoutant du bruit.

En revanche, les **features temporelles cycliques** (sin/cos) sont conservées car le LSTM ne peut pas facilement inférer l'heure ou le jour à partir des seules mesures physiques.

### 4.3 Targets (5 sorties)

```
co2, pm25, tvoc, temperature, humidity
```

Contrairement au ML classique qui ne prédit que 4 targets, le LSTM prédit aussi la **température**. Le LSTM, avec sa fenêtre de 6h, peut capter les lentes variations de température que le modèle tabulaire peinait à modéliser.

### 4.4 Préparation des données

#### 4.4.1 Chargement et fusion incrémentale

À chaque exécution, le script peut **fusionner** le CSV historique avec les données récentes récupérées via l'API (provenant d'InfluxDB). Cette fusion est additive : seules les lignes plus récentes que le dernier timestamp du CSV sont ajoutées.

**Pourquoi ?** Le dataset grossit progressivement avec les nouvelles données de production. Le modèle apprend sur un historique de plus en plus riche sans avoir à tout recalculer depuis zéro.

#### 4.4.2 Lissage par capteur (smoothing)

Un lissage par **moyenne mobile** est appliqué aux mesures brutes, par capteur séparément.

```python
df[col] = df.groupby("sensor_id")[col].transform(
    lambda s: s.rolling(window=smoothing_window, min_periods=1).mean()
)
```

La fenêtre de lissage (`smoothing_window`) est un **hyperparamètre optimisé par Optuna**. Les valeurs testées sont : **1** (pas de lissage), **3** (15 min), et **6** (30 min).

**Pourquoi lisser ?** Les capteurs IoT sont bruités. Sans lissage, le LSTM risque d'apprendre les imperfections du capteur plutôt que les vraies dynamiques de la QAI. Mais trop de lissage efface les signaux rapides (ouverture de fenêtre). Le bon compromis est trouvé automatiquement par Optuna.

**Pourquoi par capteur ?** Chaque capteur a son propre niveau de bruit. Lisser globalement mélangerait les signaux de capteurs différents.

#### 4.4.3 Normalisation MinMaxScaler (0–1)

```python
scaler = MinMaxScaler(feature_range=(0, 1))
scaler.fit(train_df[FEATURES].values)  # Fitté UNIQUEMENT sur le train
```

**Pourquoi MinMaxScaler et non StandardScaler (comme pour le ML) ?**

Le LSTM utilise des activations `tanh` (sortie entre -1 et +1). Des données normalisées en [0, 1] sont dans la zone de sensibilité maximale de tanh, ce qui permet des gradients plus forts et un apprentissage plus rapide. Avec un StandardScaler, certaines valeurs pourraient être à ±3 ou plus, saturant les activations.

**Pourquoi fitté uniquement sur le train ?** Pour éviter le **data leakage** : si on fittait sur tout le dataset, les valeurs min/max du test influenceraient la normalisation, et les métriques seraient artificiellement meilleures.

#### 4.4.4 Création des séquences par fenêtres glissantes

Pour chaque capteur, la série temporelle est découpée en **fenêtres glissantes** :

```
Entrée : [t, t+1, ..., t+71]      →  72 pas (6h)
Sortie  : [t+72, t+73, ..., t+77] →  6 pas (30 min)
```

Chaque fenêtre avance d'un pas (pas de chevauchement exclu). Un capteur avec 1000 mesures génère ~920 séquences.

**Le split train/test est fait par capteur** : pour chaque capteur, les 80% premières séquences vont dans le train, les 20% restantes dans le test. Ensuite, tous les trains de tous les capteurs sont concaténés, et de même pour les tests.

**Pourquoi par capteur ?** Si on mélangeait d'abord et qu'on splitait ensuite, des séquences proches temporellement d'un même capteur pourraient se retrouver des deux côtés du split. Le modèle "tricherait" avec des données presque identiques à celles du test.

### 4.5 Architecture du modèle

```
        Input (72, 10)
             │
    ┌────────┴────────┐
    │   N × LSTM      │  ← Encoder : n_layers couches LSTM empilées
    │   + Dropout     │    Chaque couche retourne des séquences
    └────────┬────────┘
             │
     encoder_outputs (72, units)
             │
    encoder_last = dernier pas (1, units)
             │
      RepeatVector(6) → (6, units)
             │
    ┌────────┴────────┐
    │   LSTM          │  ← Decoder : 1 couche LSTM
    │   + Dropout     │
    └────────┬────────┘
             │
      decoder_lstm (6, units)
             │
    ┌────────┴────────────────────┐
    │ Attention(decoder, encoder) │  ← Le decoder regarde l'encoder
    └────────┬────────────────────┘
             │
      Concatenate[decoder, attention] (6, 2×units)
             │
    TimeDistributed(Dense(5)) → Output (6, 5)
```

#### Pourquoi un Encoder-Decoder ?

C'est l'architecture classique pour le **sequence-to-sequence** (seq2seq). L'encoder compresse 72 pas d'entrée en un vecteur de contexte, et le decoder génère 6 pas de sortie à partir de ce contexte. C'est plus adapté qu'un simple LSTM qui ne produirait qu'une seule sortie.

#### Pourquoi le mécanisme d'Attention ?

Sans attention, le decoder ne reçoit que le **dernier état** de l'encoder (un seul vecteur). Toute l'information de 6 heures doit être compressée dans cet unique vecteur — c'est un goulot d'étranglement, surtout quand le lookback est long (72 pas).

Avec l'attention, le decoder peut **regarder directement** chaque pas de l'encoder et décider lesquels sont les plus pertinents pour chaque prédiction. Par exemple, pour prédire le CO2 à 15h, le mécanisme d'attention peut donner plus de poids aux données de 9h (même heure la veille dans un cycle similaire) qu'aux données de 11h.

L'utilisation ou non de l'attention est aussi un hyperparamètre testé par Optuna (`use_attention`), au cas où la version sans attention serait suffisante pour ces données.

#### Pourquoi la Huber Loss ?

```python
loss="huber"
```

La perte de Huber est un **compromis entre MSE et MAE** :
- Pour les **petites erreurs** : elle se comporte comme MSE (quadratique), encourageant la précision.
- Pour les **grosses erreurs** : elle se comporte comme MAE (linéaire), sans les pénaliser excessivement.

Les données IoT contiennent parfois des valeurs aberrantes que le nettoyage n'a pas rattrapées. Avec MSE, une seule mesure aberrante pourrait déformer tout l'entraînement. Huber est **robuste à ces outliers**.

#### Pourquoi clipnorm=1.0 dans Adam ?

```python
optimizer=Adam(learning_rate=..., clipnorm=1.0)
```

Les LSTM sont sujets au problème d'**explosion de gradient** (gradient qui devient très grand, déstabilise l'entraînement). Le clipping de gradient limite la norme à 1.0, ce qui stabilise l'apprentissage sans l'empêcher.

### 4.6 Optimisation des hyperparamètres — Optuna

Optuna est un framework d'optimisation bayésienne des hyperparamètres (HPO). Il propose intelligemment de nouvelles combinaisons en apprenant des résultats précédents.

#### Espace de recherche

| Hyperparamètre | Min | Max | Type | Justification de la plage |
|----------------|-----|-----|------|--------------------------|
| `lstm_units` | 64 | 280 | entier (step=32) | 64 = modèle léger, 280 = modèle riche. Step=32 pour aligner sur les architectures GPU. |
| `n_layers` | 1 | 5 | entier | 1 couche = simple, 5 = profond. Plus de couches = plus de capacité mais risque d'overfitting. |
| `dropout_rate` | 0.0 | 0.15 | flottant | Faible plage car un dropout trop élevé nuit aux LSTM (les états cachés perdent de l'information). |
| `learning_rate` | 1e-4 | 5e-3 | log-uniforme | Échelle logarithmique car les LR efficaces varient souvent de manière exponentielle. |
| `use_attention` | True, False | catégoriel | Teste si l'attention apporte un gain sur ce dataset spécifique. |
| `smoothing_window` | 1, 3, 6 | catégoriel | Fenêtres de lissage des données (pas de lissage, 15 min, 30 min). |

#### Mécanisme incrémental persistant

L'étude Optuna est stockée dans un fichier **SQLite** (`optuna_lstm_study.db`). Chaque exécution du script ajoute N nouveaux essais (trials) à l'étude existante. Rien n'est perdu entre les exécutions.

**Pourquoi cette approche ?**

Le scheduler de réentraînement tourne quotidiennement. Chaque jour, il ajoute 2 trials. Après un mois, l'étude cumule ~60 trials — sans jamais avoir monopolisé le CPU pendant des heures. C'est une approche **incrémentale et économe en ressources**, idéale pour un serveur qui doit aussi répondre aux requêtes en temps réel.

#### Décision de réentraînement

Après les trials Optuna, le script décide s'il faut réentraîner le modèle complet :

1. **Oui** si `--force-retrain` est passé
2. **Oui** si le seuil minimum de 6 trials cumulés est atteint pour la première fois (premier entraînement fiable)
3. **Oui** si les nouveaux trials ont trouvé de meilleurs hyperparamètres
4. **Non** sinon → le modèle existant est conservé, prochaine tentative demain

Cette logique évite de **réentraîner inutilement** un modèle qui fonctionne déjà bien.

### 4.7 Métrique d'objectif composite

L'objectif optimisé par Optuna est un **score combiné** évalué à l'horizon t+30 min :

$$\text{score} = 0.7 \times \bar{r} - 0.3 \times \overline{\text{NMAE}}$$

Où :
- $\bar{r}$ = corrélation de Pearson moyenne sur les 5 targets
- $\overline{\text{NMAE}}$ = MAE normalisée moyenne (MAE ÷ écart-type de la cible)

**Pourquoi cette formule ?**

- La **corrélation** mesure si le modèle suit bien la *forme* du signal (montées et descentes au bon moment). Un modèle avec une corrélation de 0.9 mais un biais constant sera corrigé facilement.
- La **NMAE** mesure l'erreur absolue, normalisée pour pouvoir comparer des grandeurs différentes (CO2 en ppm vs température en °C).
- La NMAE est normalisée par l'écart-type pour mettre toutes les targets sur un pied d'égalité.

**Pourquoi surpondérer la corrélation (0.7 vs 0.3) ?**

Pour un système d'**alertes préventives**, il est plus important de détecter correctement qu'une valeur va **monter** que de prédire sa valeur exacte. Si le modèle annonce "le CO2 va augmenter fortement" et qu'il augmente effectivement (même si la valeur prédite est décalée de 50 ppm), l'alerte est pertinente. Une corrélation élevée garantit cette capacité de détection de tendance.

### 4.8 Entraînement final

Quand le réentraînement est déclenché, le meilleur jeu d'hyperparamètres trouvé par Optuna est utilisé pour un entraînement **complet** :

| Phase | Paramètre | Valeur |
|-------|-----------|--------|
| Optuna (exploration) | Epochs | 10 (rapide, juste pour évaluer) |
| Optuna (exploration) | Batch size | 128 (gros batch, moins d'itérations) |
| Optuna (exploration) | Données | 50% du train (sous-échantillon pour aller plus vite) |
| Entraînement final | Epochs | 30–50 (configurable) |
| Entraînement final | Batch size | 64 |
| Entraînement final | Données | 100% du train |
| Entraînement final | EarlyStopping | patience=10 |
| Entraînement final | ReduceLROnPlateau | factor=0.5, patience=7 |

**EarlyStopping** : arrête l'entraînement si la validation loss ne s'améliore plus pendant 10 epochs. Restaure les poids de la meilleure epoch. Évite l'overfitting et le gaspillage de temps.

**ReduceLROnPlateau** : diminue le learning rate par 2 si la validation loss stagne pendant 7 epochs. Permet un affinement plus fin en fin d'entraînement.

### 4.9 Métriques et graphiques enregistrés

Pour chaque target × chaque horizon, les métriques suivantes sont calculées et enregistrées dans MLflow :

| Métrique | Description |
|----------|-------------|
| MAE | Erreur absolue moyenne |
| RMSE | Racine de l'erreur quadratique moyenne |
| R² | Coefficient de détermination |
| Corrélation de Pearson | Suivi de la forme du signal |
| MAPE | Erreur relative en % |
| Directional Accuracy | % du temps où la direction prédite (monte/descend) est correcte |

**Graphiques générés :**

1. **Courbe de loss** : train vs validation loss par epoch (détection d'overfitting)
2. **Dégradation par horizon** : comment la corrélation, la MAE et le score combiné évoluent de t+5 à t+30 min
3. **Scatter plots** : réel vs prédit pour chaque target (à t+30 min)
4. **Distribution des erreurs** : histogramme des erreurs par target
5. **Exemples de prédiction temporelle** : superposition réel/prédit sur 300 échantillons, avec les horizons t+5 et t+30 min

### 4.10 Artefacts produits

#### Artefacts de production (`assets/ml_models/`)

| Fichier | Contenu |
|---------|---------|
| `lstm_model.keras` | Le modèle LSTM Keras entraîné |
| `lstm_scaler.joblib` | Le MinMaxScaler fitté sur le train |
| `lstm_config.json` | Configuration complète (features, targets, lookback, horizon, smoothing, poids objectif) |
| `optuna_lstm_study.db` | Base SQLite avec tout l'historique des trials Optuna |

#### Artefacts MLflow

| Artefact | Description |
|----------|-------------|
| Modèle TensorFlow | Sauvegardé avec signature d'inférence et enregistré dans le Model Registry (`IAQ_LSTM_Model`) |
| `lstm_scaler.joblib` | Copie dans les artefacts MLflow pour traçabilité |
| `horizon_metrics.csv` + `.json` | Tableau de métriques par horizon |
| `loss_curve.png` | Courbe d'apprentissage |
| `horizon_degradation.png` | Corrélation, MAE, score par horizon |
| `scatter_plots.png` | Réel vs prédit par target |
| `error_distribution.png` | Distribution des erreurs par target |
| `prediction_sample.png` | Exemples temporels réel vs prédit |

---

## 5. Service de prédiction en temps réel

> **Fichier** : `backend/ml/ml_predict_generic.py`

### 5.1 Chargement dual-model

Au démarrage, le service tente de charger les modèles dans cet ordre :

1. **LSTM** : cherche `lstm_config.json` + `lstm_model.keras` → si trouvés, le LSTM est utilisé
2. **VotingRegressor** (fallback) : cherche `generic_training_config.json` + `generic_multi_output.joblib`

Si le LSTM est disponible, le service entre dans la **branche LSTM** pour toute prédiction. Sinon, il utilise la **branche classique**.

### 5.2 Branche LSTM — Prédiction

1. **Récupération des données agrégées** : requête InfluxDB avec agrégation au **pas de 5 minutes** (même résolution que l'entraînement). On ne donne **jamais** des données brutes à 5 secondes au LSTM — cela fausserait le lookback, les features temporelles et le lissage.

2. **Feature engineering** identique à l'entraînement : calcul de `hour_sin`, `hour_cos`, `day_sin`, `day_cos`, occupants, et lissage identique.

3. **Scaling** avec le même `MinMaxScaler` que l'entraînement.

4. **Prédiction** sur les 72 derniers pas → sortie de forme `(1, 6, 5)` (1 batch, 6 horizons, 5 targets).

5. **Inverse transform** pour revenir aux unités d'origine.

6. **Analyse de risque** : comparaison des valeurs prédites aux seuils critiques.

### 5.3 Branche classique — Prédiction

1. **Récupération directe depuis la mémoire** (`iaq_database`, la liste in-memory du backend). Fallback HTTP si non accessible.

2. **Création des features** identiques à `ml_train.py` (moyennes mobiles, lags, encodages…).

3. **Moyenne** des dernières lignes du lookback → vecteur d'entrée unique.

4. **Scaling** + **prédiction** → 4 valeurs (co2, pm25, tvoc, humidity).

### 5.4 Analyse de risque

Après chaque prédiction, les valeurs courantes et prédites sont comparées à des **seuils à 3 niveaux** :

| Polluant | Warning | Critical | Danger |
|----------|---------|----------|--------|
| CO2 | 600 ppm | 900 ppm | 1200 ppm |
| PM2.5 | 10 µg/m³ | 25 µg/m³ | 50 µg/m³ |
| TVOC | 200 ppb | 600 ppb | 1000 ppb |
| Humidité | 60% | 80% | 90% |
| Température | 25°C | 30°C | 35°C |

La logique d'alerte tient compte de la **combinaison** entre le niveau actuel et la tendance prédite :
- Actuellement critique ET en augmentation → priorité **urgente**
- Actuellement critique mais en diminution → priorité **haute** (situation s'améliore, pas de panique)
- Actuellement normal mais va devenir critique → priorité **médium** (alerte préventive)

Chaque alerte est accompagnée d'une **action recommandée** concrète (ex: "Ouvrir les fenêtres immédiatement", "Activer le purificateur d'air").

### 5.5 Rechargement à chaud

Après un réentraînement, le backend est notifié et appelle `predictor.reload()`. Cela libère l'ancien modèle de la mémoire (vide la session Keras, garbage collection), recharge les nouveaux fichiers du disque, et reprend les prédictions avec le nouveau modèle — sans redémarrage du serveur.

---

## 6. Scheduler de réentraînement automatique

> **Fichier** : `backend/dl/scheduler_retrain.py`

### 6.1 Fonctionnement

Le scheduler est un processus indépendant (container Docker `iaqverse-ml-scheduler`) qui :

1. Tourne en boucle avec `schedule.every(N).hours.do(...)`
2. À chaque intervalle (par défaut **24 heures**) :
   - Lance `ml_train_lstm.py --trials 2 --epochs 50` en sous-processus
   - Le script LSTM fusionne les nouvelles données InfluxDB dans le CSV
   - Ajoute 2 trials Optuna à l'étude existante
   - Si meilleur modèle trouvé → réentraîne et notifie le backend
3. Streame les logs du sous-processus en temps réel

### 6.2 Dataset cumulatif

À chaque exécution, `refresh_training_dataset()` :
1. Charge le CSV existant
2. Récupère les données récentes via l'API (dernières 72h par défaut)
3. Ne garde que les lignes **plus récentes** que le dernier timestamp du CSV
4. Fusionne et déduplique
5. Sauvegarde le CSV mis à jour

Le dataset **grandit progressivement** jour après jour. Le modèle est toujours entraîné sur **tout l'historique disponible**.

### 6.3 Options de configuration

| Option | Défaut | Description |
|--------|--------|-------------|
| `--interval` | 24h | Fréquence de réentraînement |
| `--interval-minutes` | — | Pour les tests (ex: 30 minutes) |
| `--run-now` | Désactivé | Exécuter immédiatement au démarrage |
| `--no-influxdb` | Désactivé | Mode CSV seul (pas de données récentes) |

---

## 7. Résumé des artefacts produits

### Artefacts du modèle ML classique

```
assets/ml_models/
├── generic_multi_output.joblib   ← Modèle VotingRegressor
├── generic_scaler.joblib         ← StandardScaler
├── salle_encoder.joblib          ← LabelEncoder salles
├── capteur_encoder.joblib        ← LabelEncoder capteurs
└── generic_training_config.json  ← Config (features, targets, salles/capteurs)
```

### Artefacts du modèle LSTM

```
assets/ml_models/
├── lstm_model.keras              ← Modèle LSTM Keras
├── lstm_scaler.joblib            ← MinMaxScaler
├── lstm_config.json              ← Config (features, targets, lookback, horizon, smoothing…)
└── optuna_lstm_study.db          ← Historique complet des trials Optuna (SQLite)
```

### Artefacts MLflow (par run)

```
mlflow_data/artifacts/<experiment>/<run_id>/
├── model/                        ← Modèle TensorFlow avec signature
├── lstm_scaler.joblib            ← Copie du scaler
├── horizon_metrics.csv           ← Métriques détaillées par horizon
├── horizon_metrics.json
├── loss_curve.png                ← Courbe d'apprentissage
├── horizon_degradation.png       ← Métriques par horizon
├── scatter_plots.png             ← Réel vs Prédit
├── error_distribution.png        ← Distribution des erreurs
└── prediction_sample.png         ← Exemples temporels
```

### Datasets générés par le preprocessing

```
assets/datasets/ml_data/
├── dataset_full_1min.csv         ← Dataset complet 1 min (exploration)
├── dataset_ml_5min.csv           ← Dataset ML 5 min (entraînement)
└── dataset_statistics.json       ← Statistiques descriptives
```

---

## 8. Synthèse des choix techniques

| Décision | Choix retenu | Alternative envisageable | Pourquoi ce choix |
|----------|-------------|--------------------------|-------------------|
| Pas temporel | 5 minutes | 1 min, 15 min | 5 min capture bien les dynamiques QAI sans surcharger les données. 1 min est trop bruitée, 15 min perd des événements courts. |
| Occupants | Simulés (1–5 en heures bureau) | Omettre la feature | Le CO2 est directement lié à l'occupation. Même simulée, cette feature aide le modèle à comprendre les patterns jour/nuit et semaine/week-end. |
| Architecture DL | LSTM Encoder-Decoder + Attention | Transformer, GRU, CNN-LSTM | Le LSTM est le standard éprouvé pour les séries temporelles de taille modeste. Les Transformers brillent sur de très gros datasets, ce qui n'est pas le cas ici. |
| Loss LSTM | Huber | MSE, MAE | Huber est robuste aux outliers (fréquents sur les capteurs IoT) tout en restant précis sur les petites erreurs. |
| Normalisation LSTM | MinMaxScaler (0–1) | StandardScaler | Mieux adapté aux activations tanh du LSTM. Garantit que toutes les valeurs sont dans [0, 1]. |
| Normalisation ML | StandardScaler | MinMaxScaler | Plus courant pour les modèles tabulaires (RF/GB). Centre les données à 0 avec écart-type 1. |
| HPO | Optuna incrémental (SQLite) | Grid search, Bayesian (Hyperopt) | Incrémental = ajoute des trials chaque jour sans perdre l'historique. Bayésien = plus intelligent que le grid search. SQLite = simple et persistant. |
| Métrique d'objectif | 0.7×corrélation - 0.3×NMAE | RMSE seul, R² seul | La corrélation mesure la détection de tendance (crucial pour les alertes). La NMAE pénalise les erreurs. La combinaison maximise les deux. |
| Split | Temporel par capteur (80/20) | Aléatoire, K-fold | Le split temporel reflète la réalité (prédire le futur, pas le passé). Par capteur évite le data leakage. |
| Dual-model | LSTM prioritaire, RF+GB en fallback | Un seul modèle | Assure la continuité du service même si le LSTM n'est pas entraîné ou échoue au chargement. |
| Réentraînement | Conditionnel (seulement si amélioration) | Systématique | Évite de gaspiller du CPU et de risquer une régression en déployant un modèle moins bon. |
| Lookback LSTM | 72 pas = 6 heures | 24 pas (2h), 144 pas (12h) | 6h capture un demi-cycle journalier complet. Plus court = pas assez de contexte. Plus long = mémoire et temps de calcul excessifs. |
| Horizon | 6 pas = 30 minutes | 1 pas (5 min), 12 pas (1h) | 30 min est un horizon utile pour les alertes préventives (le temps d'agir). 1h serait moins précis. 5 min trop court pour réagir. |
| Smoothing | Testé par Optuna (1, 3, 6) | Fixe | Le meilleur lissage dépend du niveau de bruit des capteurs, qui varie. Optuna choisit automatiquement. |
| Attention | Testée par Optuna (oui/non) | Toujours activée | Sur certains datasets simples, l'attention n'aide pas et ajoute des paramètres inutiles. On laisse Optuna décider. |
