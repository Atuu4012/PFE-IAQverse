document.addEventListener('DOMContentLoaded', () => {
    const t = (key, fallback) => {
        try {
            return (window.i18n && typeof window.i18n.t === 'function' && window.i18n.t(key)) || fallback;
        } catch (e) {
            return fallback;
        }
    };
    // Initialisation globale des tutoriels lors de la première visite
    if (!localStorage.getItem('tutorials_initialized')) {
        localStorage.setItem('show_tutorial', 'true');
        localStorage.setItem('show_settings_tutorial', 'true');
        localStorage.setItem('show_digital_twin_tutorial', 'true');
        localStorage.setItem('tutorials_initialized', 'v1');
    }

    // Vérifier si le tutoriel doit être affiché (via localStorage ou paramètre URL pour test)
    const urlParams = new URLSearchParams(window.location.search);
    const showTutorial = localStorage.getItem('show_tutorial') === 'true' || urlParams.get('tutorial') === 'true';
    
    if (showTutorial) {
        const driver = window.driver.js.driver;
        
        // Fonction globale pour le bouton passer
        window.cancelTutorial = function(e) {
            e.preventDefault();
            driverObj.destroy();
            localStorage.removeItem('show_tutorial');
            localStorage.removeItem('show_settings_tutorial');
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
                    element: 'header',
                    popover: {
                        title: t('tutorial.dashboard.welcome.title', 'Bienvenue sur IAQverse !'),
                        description: `
                            <p>${t('tutorial.dashboard.welcome.p1', 'Faisons un tour rapide pour bien paramétrer votre compte.')}</p>
                            <p>${t('tutorial.dashboard.welcome.p2', 'Suivez les flèches pour découvrir les fonctionnalités essentielles.')}</p>
                            <button onclick="window.cancelTutorial(event)" class="tutorial-skip-btn">${t('tutorial.common.skip', 'Passer le tutoriel')}</button>
                        `,
                        side: "bottom",
                        align: 'center'
                    }
                },
                {
                    element: '.header-nav a[href="settings.html"]',
                    popover: {
                        title: t('tutorial.dashboard.settings.title', 'Configuration (Important)'),
                        description: t('tutorial.dashboard.settings.desc', 'Commencez ici ! Nous avons prévu un tutoriel dédié dans cet onglet pour vous aider à configurer vos bâtiments.'),
                        side: "bottom"
                    }
                },
                {
                    element: '.header-nav a[href="digital-twin.html"]',
                    popover: {
                        title: t('tutorial.dashboard.twin.title', 'Jumeau Numérique'),
                        description: t('tutorial.dashboard.twin.desc', 'Une fois configuré, visualisez vos données en 3D dans cet onglet.'),
                        side: "bottom"
                    }
                },
                {
                    element: '.header-avatar-link',
                    popover: {
                        title: t('tutorial.dashboard.account.title', 'Votre Compte'),
                        description: t('tutorial.dashboard.account.desc', 'Gérez votre profil, changez de mot de passe ou déconnectez-vous ici.'),
                        side: "left"
                    }
                },
                {
                    element: '.info-btn',
                    popover: {
                        title: t('tutorial.dashboard.help.title', 'Aide & Info'),
                        description: t('tutorial.dashboard.help.desc', 'Besoin d\'aide sur ce que vous voyez ? Cliquez ici pour plus d\'informations contextuelles.'),
                        side: "bottom"
                    }
                },
                {
                    element: 'body',
                    popover: {
                        title: t('tutorial.dashboard.end.title', 'À vous de jouer !'),
                        description: t('tutorial.dashboard.end.desc', 'Rendez-vous maintenant dans les Paramètres pour finaliser votre installation.'),
                        side: "top",
                        align: 'center'
                    }
                }
            ],
            onDestroyed: () => {
                // S'assurer que le flag est retiré à la fin
                localStorage.removeItem('show_tutorial');
            }
        });

        driverObj.drive();
    }
});
