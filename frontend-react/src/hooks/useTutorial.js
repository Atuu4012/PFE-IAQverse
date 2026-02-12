import { driver } from 'driver.js'
import 'driver.js/dist/driver.css'

export const dashboardTutorial = () => {
  const driverObj = driver({
    showProgress: true,
    showButtons: ['next', 'previous', 'close'],
    steps: [
      {
        element: '.iaq-score-card',
        popover: {
          title: 'Score IAQ Principal',
          description: 'Visualisez le score global de qualité de l\'air intérieur. Plus le score est élevé, meilleure est la qualité.',
          side: 'bottom',
          align: 'center'
        }
      },
      {
        element: '.metric-card:first-of-type',
        popover: {
          title: 'Métriques en Temps Réel',
          description: 'Consultez les valeurs actuelles de température, humidité et CO₂ mises à jour en direct.',
          side: 'top',
          align: 'center'
        }
      },
      {
        element: '.chart-card:first-of-type',
        popover: {
          title: 'Graphiques d\'Évolution',
          description: 'Analysez les tendances sur 24h pour mieux comprendre les variations de qualité d\'air.',
          side: 'left',
          align: 'start'
        }
      },
      {
        element: '.alerts-card',
        popover: {
          title: 'Alertes et Notifications',
          description: 'Recevez des alertes en temps réel lorsque des seuils critiques sont dépassés.',
          side: 'top',
          align: 'center'
        }
      },
      {
        popover: {
          title: 'Exploration Terminée !',
          description: 'Vous pouvez maintenant explorer le dashboard. Utilisez la navigation pour accéder au jumeau numérique 3D et aux paramètres.'
        }
      }
    ],
    nextBtnText: 'Suivant →',
    prevBtnText: '← Précédent',
    doneBtnText: 'Terminé ✓'
  })

  driverObj.drive()
}

export const digitalTwinTutorial = () => {
  const driverObj = driver({
    showProgress: true,
    showButtons: ['next', 'previous', 'close'],
    steps: [
      {
        element: '.canvas-wrapper',
        popover: {
          title: 'Visualisation 3D',
          description: 'Explorez le modèle 3D de votre bâtiment. Utilisez la souris pour tourner, zoomer et naviguer.',
          side: 'right',
          align: 'center'
        }
      },
      {
        element: '.controls-panel',
        popover: {
          title: 'Panneau de Contrôle',
          description: 'Changez la vue, activez/désactivez l\'affichage des capteurs et personnalisez la visualisation.',
          side: 'left',
          align: 'start'
        }
      },
      {
        element: '.fullscreen-btn',
        popover: {
          title: 'Mode Plein Écran',
          description: 'Passez en mode plein écran pour une meilleure immersion dans la visualisation 3D.',
          side: 'bottom',
          align: 'end'
        }
      },
      {
        popover: {
          title: 'Interaction avec les Capteurs',
          description: 'Cliquez sur les sphères colorées dans la scène 3D pour voir les détails de chaque capteur en temps réel.'
        }
      }
    ],
    nextBtnText: 'Suivant →',
    prevBtnText: '← Précédent',
    doneBtnText: 'Terminé ✓'
  })

  driverObj.drive()
}

export const settingsTutorial = () => {
  const driverObj = driver({
    showProgress: true,
    showButtons: ['next', 'previous', 'close'],
    steps: [
      {
        element: '.settings-sidebar',
        popover: {
          title: 'Navigation des Paramètres',
          description: 'Accédez rapidement aux différentes sections : profil, notifications, préférences et sécurité.',
          side: 'right',
          align: 'start'
        }
      },
      {
        element: '.settings-tab:nth-child(2)',
        popover: {
          title: 'Notifications',
          description: 'Configurez vos préférences de notifications pour recevoir les alertes importantes.',
          side: 'right',
          align: 'center'
        }
      },
      {
        element: '.settings-tab:nth-child(3)',
        popover: {
          title: 'Préférences',
          description: 'Personnalisez votre expérience : langue, fuseau horaire, et autres options.',
          side: 'right',
          align: 'center'
        }
      },
      {
        element: '.save-btn',
        popover: {
          title: 'Sauvegarder',
          description: 'N\'oubliez pas de sauvegarder vos modifications avant de quitter !',
          side: 'bottom',
          align: 'end'
        }
      }
    ],
    nextBtnText: 'Suivant →',
    prevBtnText: '← Précédent',
    doneBtnText: 'Terminé ✓'
  })

  driverObj.drive()
}

// Hook personnalisé pour gérer les tutoriels
export const useTutorial = (tutorialName) => {
  const startTutorial = () => {
    // Vérifier si l'utilisateur a déjà vu ce tutoriel
    const hasSeenTutorial = localStorage.getItem(`tutorial_${tutorialName}_completed`)
    
    if (!hasSeenTutorial) {
      setTimeout(() => {
        switch (tutorialName) {
          case 'dashboard':
            dashboardTutorial()
            break
          case 'digitalTwin':
            digitalTwinTutorial()
            break
          case 'settings':
            settingsTutorial()
            break
          default:
            break
        }
        localStorage.setItem(`tutorial_${tutorialName}_completed`, 'true')
      }, 1000) // Délai pour laisser la page se charger
    }
  }

  const resetTutorial = () => {
    localStorage.removeItem(`tutorial_${tutorialName}_completed`)
  }

  return { startTutorial, resetTutorial }
}
