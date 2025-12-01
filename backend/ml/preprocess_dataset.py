"""
Script de preprocessing du dataset R1 dans asstets/datasets/R1.
Consolide tous les CSV du dossier R1, mappe les données au format utilisé dans l'API
et génère un dataset propre pour le machine learning.

Ce script transforme les données brutes en un format standardisé :
- Customer (R1) -> enseigne (Maison) par défaut
- Loc (Desk1/2/3/4) -> capteur_id (Bureau1, Bureau2, Bureau3, Bureau4) par défaut
- salle -> Bureau (tous les capteurs sont dans la même salle Bureau) par défaut
- ts -> timestamp
- T -> temperature
- H -> humidity
- CO2 -> co2
- PMS2_5 -> pm25
- VoC -> tvoc

YA BESOIN DE L'EXECUTER QUE 1 FOIS POUR GENERER LES DATASETS dans assets/datasets/ml_data
APRES YA PLUS QU'A CHARGER LES DATASETS DEJA PRETRAITES DANS L'API
"""

import pandas as pd
import numpy as np
from pathlib import Path
import logging
import json

# Configuration du logger pour afficher les informations de traitement
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# ============================================================================
# CONFIGURATION : Mapping des données
# ============================================================================

# Convertit les noms de localisation en identifiants de capteur
LOC_TO_CAPTEUR_MAPPING = {
    "Desk1": "Bureau1",
    "Desk2": "Bureau2",
    "Desk3": "Bureau3",
    "Desk4": "Bureau4",
}
DEFAULT_ROOM = "Bureau" 

CUSTOMER_TO_ENSEIGNE_MAPPING = {
    "R1": "Maison",
}
# Liste des capteurs valides (pour filtrer les données invalides)
VALID_CAPTEURS = ['Bureau1', 'Bureau2', 'Bureau3', 'Bureau4']


# ============================================================================
# FONCTIONS UTILITAIRES
# ============================================================================

def trouver_tous_les_fichiers_csv(dossier_r1):
    """
    Trouve tous les fichiers CSV dans le dossier R1 et ses sous-dossiers.
    dossier_r1: Chemin vers le dossier R1 contenant les données
    
    Retourne la liste de tous les chemins des fichiers CSV trouvés
    """
    # Recherche récursive de tous les fichiers .csv
    fichiers_csv = list(dossier_r1.rglob("*.csv"))
    logger.info(f"Trouvé {len(fichiers_csv)} fichiers CSV dans {dossier_r1}")
    
    # Organiser les fichiers par date pour afficher un résumé
    dossiers_par_date = {}
    for fichier_csv in fichiers_csv:
        nom_dossier_date = fichier_csv.parent.name
        if nom_dossier_date not in dossiers_par_date:
            dossiers_par_date[nom_dossier_date] = []
        dossiers_par_date[nom_dossier_date].append(fichier_csv.name)
    
    # Afficher un résumé des fichiers trouvés
    logger.info(f"Dates avec données: {len(dossiers_par_date)}")
    for date, fichiers in sorted(dossiers_par_date.items()):
        logger.info(f"  {date}: {len(fichiers)} fichiers ({', '.join(sorted(fichiers))})")
    
    return fichiers_csv


def remplacer_valeurs_vides_par_nan(dataframe):
    # Remplace toutes les chaînes vides ("") par NaN dans un DataFrame.
    return dataframe.replace(['', ' ', '  '], np.nan)


def convertir_en_numerique_propre(serie, nom_colonne):
    # Convertir en numérique, les erreurs deviennent NaN
    return pd.to_numeric(serie, errors='coerce')


def filtrer_valeurs_aberrantes(dataframe):
    """
    Filtre les valeurs aberrantes en les remplaçant par NaN.
    
    Définit des limites réalistes pour chaque type de mesure :
    - CO2: entre 200 et 5000 ppm
    - PM2.5: entre 0 et 500 µg/m³
    - TVOC: entre 0 et 10000 ppb
    - Température: entre -10 et 50°C
    - Humidité: entre 0 et 100%
    
    Retourne un DataFrame avec les valeurs aberrantes = NaN
    """
    df = dataframe.copy()
    
    # Filtrer CO2 (valeurs réalistes: 200-5000 ppm)
    df.loc[df['co2'] < 200, 'co2'] = np.nan
    df.loc[df['co2'] > 5000, 'co2'] = np.nan
    
    # Filtrer PM2.5 (valeurs réalistes: 0-500 µg/m³)
    df.loc[df['pm25'] < 0, 'pm25'] = np.nan
    df.loc[df['pm25'] > 500, 'pm25'] = np.nan
    
    # Filtrer TVOC (valeurs réalistes: 0-10000 ppb)
    df.loc[df['tvoc'] < 0, 'tvoc'] = np.nan
    df.loc[df['tvoc'] > 10000, 'tvoc'] = np.nan
    
    # Filtrer température (valeurs réalistes: -10 à 50°C)
    df.loc[df['temperature'] < -10, 'temperature'] = np.nan
    df.loc[df['temperature'] > 50, 'temperature'] = np.nan
    
    # Filtrer humidité (valeurs réalistes: 0-100%)
    df.loc[df['humidity'] < 0, 'humidity'] = np.nan
    df.loc[df['humidity'] > 100, 'humidity'] = np.nan
    
    return df


def traiter_un_fichier_csv(chemin_csv):
    """
    Traite un seul fichier CSV et le convertit au format standard.
    
    Cette fonction :
    1. Lit le fichier CSV
    2. Vérifie que toutes les colonnes requises sont présentes
    3. Remplace les valeurs vides par NaN
    4. Convertit les colonnes au bon format
    5. Mappe les identifiants (capteurs, salles, enseignes)
    6. Filtre les valeurs aberrantes
    7. Supprime les lignes sans aucune mesure valide
    """
    try:
        # Lire le fichier CSV
        df = pd.read_csv(chemin_csv, low_memory=False)
        
        # Remplacer les chaînes vides par NaN dès le début
        df = remplacer_valeurs_vides_par_nan(df)
        
        # Vérifier que toutes les colonnes nécessaires sont présentes
        colonnes_requises = ['ts', 'T', 'H', 'CO2', 'PMS2_5', 'VoC', 'Customer', 'Loc']
        colonnes_manquantes = [col for col in colonnes_requises if col not in df.columns]
        
        if colonnes_manquantes:
            logger.warning(f"Colonnes manquantes dans {chemin_csv.name}: {colonnes_manquantes} - Fichier ignoré")
            return pd.DataFrame()
        
        # Vérifier si le fichier est vide
        if len(df) == 0:
            logger.warning(f"Fichier vide: {chemin_csv.name} - Ignoré")
            return pd.DataFrame()
        
        # Créer un nouveau DataFrame 
        df_sortie = pd.DataFrame()
        df_sortie['timestamp'] = pd.to_datetime(df['ts'], errors='coerce')
        df_sortie['co2'] = convertir_en_numerique_propre(df['CO2'], 'CO2')
        df_sortie['pm25'] = convertir_en_numerique_propre(df['PMS2_5'], 'PM2.5')
        df_sortie['tvoc'] = convertir_en_numerique_propre(df['VoC'], 'TVOC')
        df_sortie['temperature'] = convertir_en_numerique_propre(df['T'], 'Température')
        df_sortie['humidity'] = convertir_en_numerique_propre(df['H'], 'Humidité')
        
        # Mapper 
        df_sortie['enseigne'] = df['Customer'].map(CUSTOMER_TO_ENSEIGNE_MAPPING).fillna('Maison')
        df_sortie['salle'] = DEFAULT_ROOM
        df_sortie['capteur_id'] = df['Loc'].map(LOC_TO_CAPTEUR_MAPPING).fillna(df['Loc'])
        
        # Supprimer les lignes avec timestamp invalide (NaN)
        df_sortie = df_sortie.dropna(subset=['timestamp'])
        
        # Ne garder que les capteurs valides (Bureau1, Bureau2, Bureau3, Bureau4)
        df_sortie = df_sortie[df_sortie['capteur_id'].isin(VALID_CAPTEURS)]
        
        # Filtrer les valeurs aberrantes
        df_sortie = filtrer_valeurs_aberrantes(df_sortie)
        
        # IMPORTANT: Supprimer les lignes où TOUTES les mesures sont NaN
        # Une ligne doit avoir au moins une mesure valide pour être conservée
        colonnes_mesures = ['co2', 'pm25', 'tvoc', 'temperature', 'humidity']
        df_sortie = df_sortie.dropna(subset=colonnes_mesures, how='all')
        
        # Log le résultat
        if len(df_sortie) > 0:
            logger.info(f"{chemin_csv.name}: {len(df_sortie)} lignes valides conservées")
        else:
            logger.warning(f"{chemin_csv.name}: Aucune ligne valide après filtrage")
        
        return df_sortie
        
    except Exception as e:
        logger.error(f"Erreur lors du traitement de {chemin_csv}: {e}")
        return pd.DataFrame()


def consolider_tous_les_fichiers(dossier_r1, frequence_echantillonnage=None):
    """
    Consolide tous les fichiers CSV en un seul DataFrame.
    
    Cette fonction :
    1. Trouve tous les fichiers CSV
    2. Traite chaque fichier individuellement
    3. Combine tous les résultats
    4. Supprime les doublons
    5. Optionnellement rééchantillonne les données
    """
    # Trouver tous les fichiers CSV
    fichiers_csv = trouver_tous_les_fichiers_csv(dossier_r1)
    
    if not fichiers_csv:
        logger.error("Aucun fichier CSV trouvé!")
        return pd.DataFrame()
    
    # Traiter chaque fichier et stocker les résultats
    liste_dataframes = []
    for fichier_csv in fichiers_csv:
        df = traiter_un_fichier_csv(fichier_csv)
        if not df.empty:
            liste_dataframes.append(df)
    
    # Vérifier qu'on a des données valides
    if not liste_dataframes:
        logger.error("Aucune donnée valide trouvée dans les fichiers!")
        return pd.DataFrame()
    
    # Combiner tous les DataFrames en un seul
    df_combine = pd.concat(liste_dataframes, ignore_index=True)
    
    # Trier par timestamp (ordre chronologique)
    df_combine = df_combine.sort_values('timestamp').reset_index(drop=True)
    
    # Supprimer les doublons (même timestamp, même salle, même capteur)
    df_combine = df_combine.drop_duplicates(
        subset=['timestamp', 'salle', 'capteur_id'], 
        keep='first'
    )
    
    # Afficher les statistiques
    logger.info(f"\nStatistiques de consolidation:")
    logger.info(f"  - Total lignes: {len(df_combine):,}")
    logger.info(f"  - Période: {df_combine['timestamp'].min()} → {df_combine['timestamp'].max()}")
    logger.info(f"  - Capteurs: {sorted(df_combine['capteur_id'].unique().tolist())}")
    logger.info(f"  - Salles: {df_combine['salle'].unique().tolist()}")
    
    # Statistiques détaillées par capteur
    logger.info(f"\nRépartition par capteur:")
    for capteur in sorted(df_combine['capteur_id'].unique()):
        nombre_lignes = len(df_combine[df_combine['capteur_id'] == capteur])
        logger.info(f"  - {capteur}: {nombre_lignes:,} lignes")

    # Rééchantillonnage si demandé
    if frequence_echantillonnage:
        df_combine = reechantillonner_donnees(df_combine, frequence_echantillonnage)
    
    return df_combine


def reechantillonner_donnees(dataframe, frequence):
    """
    Rééchantillonne les données à une fréquence donnée (calcule la moyenne).
    
    Le rééchantillonnage permet de réduire le volume de données en regroupant
    plusieurs mesures sur un intervalle de temps (ex: moyenne sur 5 minutes).
    
    Args:
        dataframe: DataFrame à rééchantillonner
        frequence: Fréquence d'échantillonnage (ex: '1min', '5min', '1H')
    
    Returns:
        DataFrame rééchantillonné
    """
    logger.info(f"Rééchantillonnage des données à {frequence}...")
    
    # Traiter chaque capteur séparément
    liste_dataframes_reechantillonnes = []
    
    # Obtenir toutes les combinaisons uniques de salle et capteur
    combinaisons_salle_capteur = dataframe[['salle', 'capteur_id']].drop_duplicates()
    
    for _, ligne in combinaisons_salle_capteur.iterrows():
        salle = ligne['salle']
        capteur_id = ligne['capteur_id']
        
        # Filtrer les données pour ce capteur
        masque = (dataframe['salle'] == salle) & (dataframe['capteur_id'] == capteur_id)
        df_capteur = dataframe[masque].copy()
        
        # Définir le timestamp comme index pour le rééchantillonnage
        df_capteur = df_capteur.set_index('timestamp')
        
        # Rééchantillonner les colonnes numériques (calcul de la moyenne)
        colonnes_numeriques = ['co2', 'pm25', 'tvoc', 'temperature', 'humidity']
        df_reechantillonne = df_capteur[colonnes_numeriques].resample(frequence).mean()
        
        # Restaurer les colonnes non-numériques
        df_reechantillonne['enseigne'] = df_capteur['enseigne'].iloc[0] if len(df_capteur) > 0 else 'Maison'
        df_reechantillonne['salle'] = salle
        df_reechantillonne['capteur_id'] = capteur_id
        
        # Remettre le timestamp en colonne normale
        df_reechantillonne = df_reechantillonne.reset_index()
        
        # Supprimer les lignes où toutes les mesures sont NaN après rééchantillonnage
        colonnes_mesures = ['co2', 'pm25', 'tvoc', 'temperature', 'humidity']
        df_reechantillonne = df_reechantillonne.dropna(subset=colonnes_mesures, how='all')
        
        liste_dataframes_reechantillonnes.append(df_reechantillonne)
    
    # Combiner tous les résultats
    df_resultat = pd.concat(liste_dataframes_reechantillonnes, ignore_index=True)
    df_resultat = df_resultat.sort_values('timestamp').reset_index(drop=True)
    
    logger.info(f"Dataset rééchantillonné: {len(df_resultat):,} lignes")
    return df_resultat


def sauvegarder_dataset(dataframe, dossier_sortie, nom_fichier="preprocessed_dataset.csv"):
    """Sauvegarde le dataset au format CSV propre (sans guillemets excessifs)"""
    # Créer le dossier de sortie s'il n'existe pas
    dossier_sortie.mkdir(parents=True, exist_ok=True)
    
    # Chemin complet du fichier
    chemin_sortie = dossier_sortie / nom_fichier
    
    # Sauvegarder avec QUOTE_MINIMAL (guillemets uniquement si nécessaire)
    # quoting=1 = QUOTE_MINIMAL (évite les guillemets sur les nombres)
    # Utiliser quotechar='"' et escapechar=None par défaut
    dataframe.to_csv(
        chemin_sortie, 
        index=False, 
        sep=',',
        quoting=1,  # QUOTE_MINIMAL - guillemets uniquement pour strings avec virgules
        float_format='%.6f'  # Limiter la précision des flottants
    )
    
    logger.info(f"✓ Dataset sauvegardé: {chemin_sortie}")
    return chemin_sortie


def generer_statistiques(dataframe):
    stats = {
        "total_lignes": len(dataframe),
        "periode": {
            "debut": str(dataframe['timestamp'].min()),
            "fin": str(dataframe['timestamp'].max()),
            "duree_jours": (dataframe['timestamp'].max() - dataframe['timestamp'].min()).days
        },
        "salles": dataframe['salle'].unique().tolist(),
        "capteurs": sorted(dataframe['capteur_id'].unique().tolist()),
        "valeurs_manquantes": dataframe.isnull().sum().to_dict(),
        "statistiques_mesures": dataframe[['co2', 'pm25', 'tvoc', 'temperature', 'humidity']].describe().to_dict()
    }
    return stats


# ============================================================================
# FONCTION PRINCIPALE
# ============================================================================

def main():
    """
    Cette fonction :
    1. Définit les chemins des dossiers
    2. Génère un dataset complet rééchantillonné à 1 minute
    3. Génère un dataset agrégé à 5 minutes pour le ML
    4. Sauvegarde les statistiques
    """
    # Définir les chemins des dossiers (CORRECTION: aller au dossier parent parent)
    dossier_base = Path(__file__).parent.parent.parent  # backend/ml -> backend -> racine
    dossier_r1 = dossier_base / "assets" / "datasets" / "R1"
    dossier_sortie = dossier_base / "assets" / "datasets" / "ml_data"
    
    # ========================================================================
    # OPTION 1: Dataset complet avec rééchantillonnage à 1 minute
    # ========================================================================
    logger.info("=" * 70)
    logger.info("GÉNÉRATION DU DATASET COMPLET (rééchantillonné à 1 minute)")
    logger.info("=" * 70)
    
    df_complet = consolider_tous_les_fichiers(dossier_r1, frequence_echantillonnage='1min')
    
    if not df_complet.empty:
        # Sauvegarder le dataset complet
        sauvegarder_dataset(df_complet, dossier_sortie, "dataset_full_1min.csv")
        
        # Générer et sauvegarder les statistiques
        stats = generer_statistiques(df_complet)
        logger.info(f"\nStatistiques du dataset:")
        logger.info(f"  - Total lignes: {stats['total_lignes']:,}")
        logger.info(f"  - Période: {stats['periode']['debut']} → {stats['periode']['fin']}")
        logger.info(f"  - Durée: {stats['periode']['duree_jours']} jours")

        # Sauvegarder les statistiques dans un fichier JSON
        chemin_stats = dossier_sortie / "dataset_statistics.json"
        with open(chemin_stats, 'w', encoding='utf-8') as f:
            json.dump(stats, f, indent=2, ensure_ascii=False)
        logger.info(f"Statistiques sauvegardées: {chemin_stats}")
    
    # ========================================================================
    # OPTION 2: Dataset agrégé à 5 minutes pour le Machine Learning
    # ========================================================================
    logger.info("\n" + "=" * 70)
    logger.info("GÉNÉRATION DU DATASET ML (agrégé à 5 minutes)")
    logger.info("=" * 70)
    
    df_ml = consolider_tous_les_fichiers(dossier_r1, frequence_echantillonnage='5min')
    
    if not df_ml.empty:
        sauvegarder_dataset(df_ml, dossier_sortie, "dataset_ml_5min.csv")
    
    # ========================================================================
    # Terminé!
    # ========================================================================
    logger.info("\n" + "=" * 70)
    logger.info("PREPROCESSING TERMINÉ AVEC SUCCÈS!")
    logger.info("=" * 70)


if __name__ == "__main__":
    main()

