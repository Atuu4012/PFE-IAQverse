document.addEventListener('DOMContentLoaded', () => {
    // Vérifier si le tutoriel des paramètres doit être affiché
    // On permet aussi le lancement via URL pour le test (?tutorial=settings)
    const urlParams = new URLSearchParams(window.location.search);
    const showSettingsTutorial = localStorage.getItem('show_settings_tutorial') === 'true' || urlParams.get('tutorial') === 'settings';

    if (showSettingsTutorial) {
        const driver = window.driver.js.driver;
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
                    element: '.sidebar',
                    popover: {
                        title: 'Paramètres Généraux',
                        description: `
                            <p>Bienvenue dans le panneau de configuration.</p>
                            <p>Ici, vous pouvez gérer tous les aspects de votre compte et de vos bâtiments.</p>
                            <button onclick="window.cancelSettingsTutorial()" class="tutorial-skip-btn">Passer le tutoriel</button>
                        `,
                        side: "right",
                        align: 'start'
                    }
                },
                {
                    element: '.sidebar .menu li[data-section="compte"]',
                    popover: {
                        title: 'Vos Informations',
                        description: 'Mettez à jour votre profil, mot de passe et préférences personnelles ici.',
                        side: "right"
                    }
                },
                {
                    element: '.sidebar .menu li[data-section="lieux"]',
                    popover: {
                        title: 'Gestion des Lieux (Salles)',
                        description: '<strong>C\'est l\'étape la plus importante !</strong><br>Définissez ici la structure de votre bâtiment (étages, salles) pour commencer à recevoir des données.',
                        side: "right"
                    }
                },
                {
                    element: '.sidebar .menu li[data-section="notifications"]',
                    popover: {
                        title: 'Alertes & Notifications',
                        description: 'Configurez comment et quand vous souhaitez être averti en cas de problème de qualité d\'air.',
                        side: "right"
                    }
                },
                {
                     element: '.sidebar .menu li[data-section="abonnement"]',
                     popover: {
                         title: 'Abonnement',
                         description: 'Gérez votre plan et vos factures ici.',
                         side: "right"
                     }
                },
                {
                    popover: {
                        title: 'Prêt à configurer ?',
                        description: 'Commencez par vérifier vos lieux dans l\'onglet "Lieux".',
                        side: "center"
                    }
                }
            ],
            onDestroyed: () => {
                localStorage.removeItem('show_settings_tutorial');
            }
        });

        // Fonction globale pour le bouton passer
        window.cancelSettingsTutorial = function() {
            driverObj.destroy();
            localStorage.removeItem('show_settings_tutorial');
        };

        // Petit délai pour laisser le temps à l'interface de se charger complètement
        setTimeout(() => {
            driverObj.drive();
        }, 500);
    }
});
