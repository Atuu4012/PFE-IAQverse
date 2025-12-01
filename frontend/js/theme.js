/**
 * Gestion du mode sombre/clair pour IAQverse
 * Synchronisé avec la configuration (affichage.mode)
 */

// Fonction pour appliquer le thème
function applyTheme(mode) {
    const theme = mode === 'sombre' || mode === 'Sombre' ? 'sombre' : 'clair';
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
    console.log(`Thème appliqué: ${theme}`);
}

// Fonction pour initialiser le thème au chargement de la page
function initTheme() {
    let savedTheme = localStorage.getItem('theme');
    if (savedTheme) {
        document.documentElement.setAttribute('data-theme', savedTheme);
        return;
    }
    fetch('http://localhost:8000/config')
        .then(response => response.json())
        .then(config => {
            const mode = config?.affichage?.mode || 'clair';
            applyTheme(mode);
        })
        .catch(() => {
            console.log('Impossible de charger le thème depuis la config, utilisation du mode clair par défaut');
            applyTheme('clair');
        });
}

// Fonction pour changer le thème
function toggleTheme() {
    const currentTheme = document.documentElement.getAttribute('data-theme') || 'clair';
    const newTheme = currentTheme === 'clair' ? 'sombre' : 'clair';
    applyTheme(newTheme);
    updateThemeInConfig(newTheme);
    if (typeof refreshChartsTheme === 'function') {
        refreshChartsTheme();
    }
}

// Mettre à jour le thème dans la configuration serveur
async function updateThemeInConfig(theme) {
    try {
        const response = await fetch('http://localhost:8000/api/saveConfig', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ affichage: { mode: theme === 'sombre' ? 'Sombre' : 'Clair' } })
        });
        if (response.ok) console.log('Thème sauvegardé dans la configuration');
    } catch (error) {
        console.error('Erreur lors de la sauvegarde du thème:', error);
    }
}

function observeConfigChanges() {
    if (typeof config !== 'undefined' && config?.affichage?.mode) {
        applyTheme(config.affichage.mode);
    }
}

// Initialiser le thème
initTheme();
document.addEventListener('DOMContentLoaded', initTheme);

// Exporter globalement
window.applyTheme = applyTheme;
window.toggleTheme = toggleTheme;
window.observeConfigChanges = observeConfigChanges;
