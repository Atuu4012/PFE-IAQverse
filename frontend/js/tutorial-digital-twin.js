document.addEventListener('DOMContentLoaded', () => {
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
            doneBtnText: 'Terminer',
            nextBtnText: 'Suivant',
            prevBtnText: 'Précédent',
            progressText: 'Étape {{current}} sur {{total}}',
            steps: [
                {
                    element: '#blender-viewer',
                    popover: {
                        title: 'Visualisation 3D',
                        description: `
                            <p>Voici le cœur de IAQverse : votre bâtiment en temps réel.</p>
                            <p>Utilisez la souris ou le tactile pour naviguer, tourner et zoomer dans la pièce.</p>
                            <button onclick="window.cancelTwinTutorial()" class="tutorial-skip-btn">Passer le tutoriel</button>
                        `,
                        side: "left",
                        align: 'center'
                    }
                },
                {
                    element: '.room-tabs', // Peut être vide au chargement, attention
                    popover: {
                        title: 'Navigation par Pièce',
                        description: 'Changez de vue rapidement en sélectionnant une autre salle ici.',
                        side: "bottom"
                    }
                },
                {
                    element: '#iaq-overlay',
                    popover: {
                        title: 'Données en Temps Réel',
                        description: 'Surveillez les indicateurs clés (CO2, Température, etc.) directement superposés à la vue 3D.',
                        side: "left"
                    }
                },
                {
                    element: '.preventive-panel-global',
                    popover: {
                        title: 'Prédictions IA',
                        description: 'Notre IA analyse les tendances pour vous avertir des problèmes avant qu\'ils n\'arrivent.',
                        side: "bottom"
                    }
                },
                {
                    element: '.actions-panel',
                    popover: {
                        title: 'Plan d\'Action',
                        description: 'En cas d\'alerte, consultez ce tableau pour savoir exactement quoi faire.',
                        side: "top"
                    }
                },
                {
                    element: 'header .header-nav a[href="index.html"]',
                    popover: {
                        title: 'Retour au Tableau de Bord',
                        description: 'Vous avez fait le tour ! Retournez à l\'accueil pour une vue d\'ensemble.',
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
