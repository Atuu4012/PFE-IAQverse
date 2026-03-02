document.addEventListener('DOMContentLoaded', () => {
    const t = (key, fallback) => {
        try {
            return (window.i18n && typeof window.i18n.t === 'function' && window.i18n.t(key)) || fallback;
        } catch (e) {
            return fallback;
        }
    };
    // Vérifier si le tutoriel du jumeau numérique doit être affiché
    const urlParams = new URLSearchParams(window.location.search);
    const showTwinTutorial = localStorage.getItem('show_digital_twin_tutorial') === 'true' || urlParams.get('tutorial') === 'twin';

    if (showTwinTutorial) {
        const driver = window.driver.js.driver;
        
        // Fonction globale pour le bouton passer
        window.cancelTwinTutorial = function() {
            driverObj.destroy();
            localStorage.removeItem('show_digital_twin_tutorial');
        };

        const driverObj = driver({
            showProgress: true,
            animate: true,
            allowClose: true,
            doneBtnText: t('tutorial.common.done', 'Terminer'),
            nextBtnText: t('tutorial.common.next', 'Suivant'),
            prevBtnText: t('tutorial.common.prev', 'Précédent'),
            progressText: t('tutorial.common.progress', 'Étape {{current}} sur {{total}}'),
            steps: [
                {
                    element: '#blender-viewer',
                    popover: {
                        title: t('tutorial.twin.viewer.title', 'Visualisation 3D'),
                        description: `
                            <p>${t('tutorial.twin.viewer.p1', 'Voici le cœur de IAQverse : votre bâtiment en temps réel.')}</p>
                            <p>${t('tutorial.twin.viewer.p2', 'Utilisez la souris ou le tactile pour naviguer, tourner et zoomer dans la pièce.')}</p>
                            <button onclick="window.cancelTwinTutorial()" class="tutorial-skip-btn">${t('tutorial.common.skip', 'Passer le tutoriel')}</button>
                        `,
                        side: "left",
                        align: 'center'
                    }
                },
                {
                    element: '.room-tabs', // Peut être vide au chargement, attention
                    popover: {
                        title: t('tutorial.twin.rooms.title', 'Navigation par Pièce'),
                        description: t('tutorial.twin.rooms.desc', 'Changez de vue rapidement en sélectionnant une autre salle ici.'),
                        side: "bottom"
                    }
                },
                {
                    element: '#iaq-overlay',
                    popover: {
                        title: t('tutorial.twin.realtime.title', 'Données en Temps Réel'),
                        description: t('tutorial.twin.realtime.desc', 'Surveillez les indicateurs clés (CO2, Température, etc.) directement superposés à la vue 3D.'),
                        side: "left"
                    }
                },
                {
                    element: '.preventive-panel-global',
                    popover: {
                        title: t('tutorial.twin.prediction.title', 'Prédictions IA'),
                        description: t('tutorial.twin.prediction.desc', 'Notre IA analyse les tendances pour vous avertir des problèmes avant qu\'ils n\'arrivent.'),
                        side: "bottom"
                    }
                },
                {
                    element: '.actions-panel',
                    popover: {
                        title: t('tutorial.twin.actions.title', 'Plan d\'Action'),
                        description: t('tutorial.twin.actions.desc', 'En cas d\'alerte, consultez ce tableau pour savoir exactement quoi faire.'),
                        side: "top"
                    }
                },
                {
                    element: 'header .header-nav a[href="index.html"]',
                    popover: {
                        title: t('tutorial.twin.end.title', 'Retour au Tableau de Bord'),
                        description: t('tutorial.twin.end.desc', 'Vous avez fait le tour ! Retournez à l\'accueil pour une vue d\'ensemble.'),
                        side: "bottom"
                    }
                }
            ],
            onDestroyed: () => {
                localStorage.removeItem('show_digital_twin_tutorial');
            }
        });

        // Délai pour laisser Three.js s'initialiser un peu (bien que le loader soit là)
        setTimeout(() => {
            driverObj.drive();
        }, 1500); 
    }
});
