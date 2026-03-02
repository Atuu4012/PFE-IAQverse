document.addEventListener('DOMContentLoaded', () => {
    const t = (key, fallback) => {
        try {
            return (window.i18n && typeof window.i18n.t === 'function' && window.i18n.t(key)) || fallback;
        } catch (e) {
            return fallback;
        }
    };
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
            doneBtnText: t('tutorial.common.done', 'Terminer'),
            nextBtnText: t('tutorial.common.next', 'Suivant'),
            prevBtnText: t('tutorial.common.prev', 'Précédent'),
            progressText: t('tutorial.common.progress', 'Étape {{current}} sur {{total}}'),
            steps: [
                {
                    element: '.sidebar',
                    popover: {
                        title: t('tutorial.settings.general.title', 'Paramètres Généraux'),
                        description: `
                            <p>${t('tutorial.settings.general.p1', 'Bienvenue dans le panneau de configuration.')}</p>
                            <p>${t('tutorial.settings.general.p2', 'Ici, vous pouvez gérer tous les aspects de votre compte et de vos bâtiments.')}</p>
                            <button onclick="window.cancelSettingsTutorial()" class="tutorial-skip-btn">${t('tutorial.common.skip', 'Passer le tutoriel')}</button>
                        `,
                        side: "right",
                        align: 'start'
                    }
                },
                {
                    element: '.sidebar .menu li[data-section="compte"]',
                    popover: {
                        title: t('tutorial.settings.account.title', 'Vos Informations'),
                        description: t('tutorial.settings.account.desc', 'Mettez à jour votre profil, mot de passe et préférences personnelles ici.'),
                        side: "right"
                    }
                },
                {
                    element: '.sidebar .menu li[data-section="lieux"]',
                    popover: {
                        title: t('tutorial.settings.locations.title', 'Gestion des Lieux (Salles)'),
                        description: t('tutorial.settings.locations.desc', '<strong>C\'est l\'étape la plus importante !</strong><br>Définissez ici la structure de votre bâtiment (étages, salles) pour commencer à recevoir des données.'),
                        side: "right"
                    }
                },
                {
                    element: '.sidebar .menu li[data-section="notifications"]',
                    popover: {
                        title: t('tutorial.settings.notifications.title', 'Alertes & Notifications'),
                        description: t('tutorial.settings.notifications.desc', 'Configurez comment et quand vous souhaitez être averti en cas de problème de qualité d\'air.'),
                        side: "right"
                    }
                },
                {
                     element: '.sidebar .menu li[data-section="abonnement"]',
                     popover: {
                         title: t('tutorial.settings.subscription.title', 'Abonnement'),
                         description: t('tutorial.settings.subscription.desc', 'Gérez votre plan et vos factures ici.'),
                         side: "right"
                     }
                },
                {
                    popover: {
                        title: t('tutorial.settings.end.title', 'Prêt à configurer ?'),
                        description: t('tutorial.settings.end.desc', 'Une fois vos lieux configurés, rendez-vous dans l\'onglet "Jumeau Numérique" (au centre) pour voir le résultat en 3D !'),
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
            localStorage.removeItem('show_digital_twin_tutorial');
        };

        // Petit délai pour laisser le temps à l'interface de se charger complètement
        setTimeout(() => {
            driverObj.drive();
        }, 500);
    }
});
