"""
Scheduler pour réentraînement périodique du modèle ML IAQ.

Ce script :
1. S'exécute en arrière-plan
2. Déclenche le réentraînement du modèle périodiquement
3. Combine dataset CSV + nouvelles données InfluxDB
4. Sauvegarde le nouveau modèle

Usage:
    python scheduler_retrain.py --interval 24  # Réentraîner toutes les 24h
"""

import schedule
import time
import logging
import argparse
import subprocess
import sys
from pathlib import Path
from datetime import datetime

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler('scheduler_retrain.log'),
        logging.StreamHandler(sys.stdout)
    ]
)
logger = logging.getLogger(__name__)


def run_training(with_influxdb=True):
    """Lance le script d'entraînement ml_train.py"""
    try:
        logger.info("="*70)
        logger.info(f"🚀 DÉMARRAGE RÉENTRAÎNEMENT - {datetime.now()}")
        logger.info("="*70)
        
        # Chemin du script d'entraînement
        script_path = Path(__file__).parent / "ml_train.py"
        
        if not script_path.exists():
            logger.error(f"❌ Script ml_train.py non trouvé: {script_path}")
            return False
        
        # Commande d'exécution
        cmd = [sys.executable, str(script_path)]
        if with_influxdb:
            cmd.append("--with-influxdb")
        
        logger.info(f"📋 Commande: {' '.join(cmd)}")
        
        # Exécuter le script
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=600  # Timeout 10 minutes
        )
        
        # Logger la sortie
        if result.stdout:
            logger.info("📤 STDOUT:")
            for line in result.stdout.split('\n')[-30:]:  # Dernières 30 lignes
                if line.strip():
                    logger.info(f"  {line}")
        
        if result.stderr:
            logger.warning("⚠️  STDERR:")
            for line in result.stderr.split('\n'):
                if line.strip():
                    logger.warning(f"  {line}")
        
        # Vérifier le code de retour
        if result.returncode == 0:
            logger.info("✅ RÉENTRAÎNEMENT RÉUSSI!")
            return True
        else:
            logger.error(f"❌ RÉENTRAÎNEMENT ÉCHOUÉ (code {result.returncode})")
            return False
            
    except subprocess.TimeoutExpired:
        logger.error("❌ TIMEOUT: Réentraînement dépassé 10 minutes")
        return False
    except Exception as e:
        logger.error(f"❌ ERREUR: {e}", exc_info=True)
        return False


def job_wrapper(with_influxdb=True):
    """Wrapper pour le job schedulé"""
    logger.info("\n" + "="*70)
    logger.info("⏰ DÉCLENCHEMENT RÉENTRAÎNEMENT PROGRAMMÉ")
    logger.info("="*70)
    
    success = run_training(with_influxdb=with_influxdb)
    
    if success:
        logger.info("🎉 Job terminé avec succès")
    else:
        logger.error("💥 Job terminé avec erreur")
    
    logger.info("="*70 + "\n")


def main():
    parser = argparse.ArgumentParser(
        description="Scheduler de réentraînement périodique du modèle ML IAQ"
    )
    parser.add_argument(
        '--interval',
        type=int,
        default=24,
        help='Intervalle de réentraînement en heures (défaut: 24h)'
    )
    parser.add_argument(
        '--interval-minutes',
        type=int,
        help='Intervalle en minutes (pour tests)'
    )
    parser.add_argument(
        '--run-now',
        action='store_true',
        help='Exécuter immédiatement puis scheduler'
    )
    parser.add_argument(
        '--no-influxdb',
        action='store_true',
        help='Ne pas utiliser les données InfluxDB (CSV seulement)'
    )
    
    args = parser.parse_args()
    
    use_influxdb = not args.no_influxdb
    
    logger.info("="*70)
    logger.info("🤖 SCHEDULER DE RÉENTRAÎNEMENT ML IAQ")
    logger.info("="*70)
    logger.info(f"📅 Intervalle: {args.interval_minutes or args.interval} {'minutes' if args.interval_minutes else 'heures'}")
    logger.info(f"💾 InfluxDB: {'✅ Activé' if use_influxdb else '❌ Désactivé (CSV seulement)'}")
    logger.info(f"▶️  Exécution immédiate: {'Oui' if args.run_now else 'Non'}")
    logger.info("="*70 + "\n")
    
    # Exécuter immédiatement si demandé
    if args.run_now:
        logger.info("▶️  Exécution immédiate demandée...")
        run_training(with_influxdb=use_influxdb)
        logger.info("")
    
    # Programmer les réentraînements
    if args.interval_minutes:
        schedule.every(args.interval_minutes).minutes.do(
            job_wrapper, 
            with_influxdb=use_influxdb
        )
        logger.info(f"⏰ Prochain réentraînement dans {args.interval_minutes} minutes")
    else:
        schedule.every(args.interval).hours.do(
            job_wrapper,
            with_influxdb=use_influxdb
        )
        logger.info(f"⏰ Prochain réentraînement dans {args.interval} heures")
    
    # Boucle principale
    logger.info("🔄 Scheduler démarré. Appuyez sur Ctrl+C pour arrêter.\n")
    
    try:
        while True:
            schedule.run_pending()
            time.sleep(60)  # Vérifier toutes les 60 secondes
            
    except KeyboardInterrupt:
        logger.info("\n⏹️  Arrêt du scheduler demandé")
        logger.info("👋 Scheduler arrêté proprement")


if __name__ == "__main__":
    main()
