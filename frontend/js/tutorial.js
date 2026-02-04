document.addEventListener('DOMContentLoaded', () => {
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
            doneBtnText: 'Terminer',
            nextBtnText: 'Suivant',
            prevBtnText: 'Précédent',
            progressText: 'Étape {{current}} sur {{total}}',
            steps: [
                {
                    element: 'header',
                    popover: {
                        title: 'Bienvenue sur IAQverse !',
                        description: `
                            <p>Faisons un tour rapide pour bien paramétrer votre compte.</p>
                            <p>Suivez les flèches pour découvrir les fonctionnalités essentielles.</p>
                            <button onclick="window.cancelTutorial(event)" class="tutorial-skip-btn">Passer le tutoriel</button>
                        `,
                        side: "bottom",
                        align: 'center'
                    }
                },
                {
                    element: '.header-nav a[href="settings.html"]',
                    popover: {
                        title: 'Configuration (Important)',
                        description: 'Commencez ici ! Nous avons prévu un tutoriel dédié dans cet onglet pour vous aider à configurer vos bâtiments.',
                        side: "bottom"
                    }
                },
                {
                    element: '.header-nav a[href="digital-twin.html"]',
                    popover: {
                        title: 'Jumeau Numérique',
                        description: 'Une fois configuré, visualisez vos données en 3D dans cet onglet.',
                        side: "bottom"
                    }
                },
                {
                    element: '.header-avatar-link',
                    popover: {
                        title: 'Votre Compte',
                        description: 'Gérez votre profil, changez de mot de passe ou déconnectez-vous ici.',
                        side: "left"
                    }
                },
                {
                    element: '.info-btn',
                    popover: {
                        title: 'Aide & Info',
                        description: 'Besoin d\'aide sur ce que vous voyez ? Cliquez ici pour plus d\'informations contextuelles.',
                        side: "bottom"
                    }
                },
                {
                    element: 'body',
                    popover: {
                        title: 'À vous de jouer !',
                        description: 'Rendez-vous maintenant dans les Paramètres pour finaliser votre installation.',
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
