/**
 * Gestion du mode sombre/clair pour IAQverse
 * Synchronisé avec la configuration (affichage.mode)
 */

// Fonction pour appliquer le thème
function applyTheme(mode) {
    const theme = mode === 'sombre' || mode === 'Sombre' ? 'sombre' : 'clair';
    if (document.documentElement.getAttribute('data-theme') === theme) {
        return;
    }
    document.documentElement.setAttribute('data-theme', theme);
}

// Fonction pour initialiser le thème au chargement de la page
async function initTheme() {
    try {
        const currentConfig = typeof window.getConfig === 'function' ? window.getConfig() : null;
        if (currentConfig?.affichage?.mode) {
            applyTheme(currentConfig.affichage.mode);
        }

        if (window.configReady) {
            const freshConfig = await window.configReady;
            if (freshConfig?.affichage?.mode) {
                applyTheme(freshConfig.affichage.mode);
                return;
            }
        }

        if (typeof window.loadConfig === 'function') {
            const config = await window.loadConfig();
            const mode = config?.affichage?.mode || 'clair';
            applyTheme(mode);
            return;
        }
    } catch(e) {
        console.warn('Theme: loadConfig failed', e);
    }

    applyTheme('clair');
}

// Fonction pour changer le thème
async function toggleTheme() {
    const currentTheme = document.documentElement.getAttribute('data-theme') || 'clair';
    const newTheme = currentTheme === 'clair' ? 'sombre' : 'clair';
    applyTheme(newTheme);
    await updateThemeInConfig(newTheme);
    if (typeof refreshChartsTheme === 'function') {
        refreshChartsTheme();
    }
}

// Mettre à jour le thème dans la configuration serveur
async function updateThemeInConfig(theme) {
    if (typeof window.saveConfig === 'function') {
        try {
            // Use standardized saveConfig — always lowercase
            await window.saveConfig({ affichage: { mode: theme } });
            console.log('Thème sauvegardé via /api/config');
            return;
        } catch(e) {
            console.error('Erreur saveConfig (theme):', e);
        }
    }
}

// Initialiser le thème (une seule fois)
let themeInitialized = false;
const runThemeInitOnce = async () => {
    if (themeInitialized) return;
    themeInitialized = true;
    await initTheme();
};

// Lancer au plus tôt
runThemeInitOnce();

// Re-tenter au DOMContentLoaded si nécessaire
document.addEventListener('DOMContentLoaded', runThemeInitOnce);

// Exporter globalement
window.applyTheme = applyTheme;
window.toggleTheme = toggleTheme;
