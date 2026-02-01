/**
 * Gestion du mode sombre/clair pour IAQverse
 * Synchronisé avec la configuration (affichage.mode)
 */

// Fonction pour appliquer le thème
function applyTheme(mode) {
    const theme = mode === 'sombre' || mode === 'Sombre' ? 'sombre' : 'clair';
    document.documentElement.setAttribute('data-theme', theme);
    // localStorage support removed
    console.log(`Thème appliqué: ${theme}`);
}

// Fonction pour initialiser le thème au chargement de la page
async function initTheme() {
    // Prefer window.loadConfig()
    if (typeof window.loadConfig === 'function') {
        try {
            const config = await window.loadConfig();
            const mode = config?.affichage?.mode || 'clair';
            applyTheme(mode);
            return;
        } catch(e) {
            console.warn('Theme: loadConfig failed', e);
        }
    }
    
    // Fallback if loadConfig is not ready or failed
    try {
        const response = await fetch('/config', { headers: { 'ngrok-skip-browser-warning': 'true' } });
        if (response.ok) {
            const config = await response.json();
            const mode = config?.affichage?.mode || 'clair';
            applyTheme(mode);
            return;
        }
    } catch(e) { 
        console.warn('Theme: direct fetch failed', e);
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
            // Use standardized saveConfig
            await window.saveConfig({ affichage: { mode: theme === 'sombre' ? 'Sombre' : 'Clair' } });
            console.log('Thème sauvegardé via saveConfig');
            return;
        } catch(e) {
            console.error('Erreur saveConfig (theme):', e);
        }
    }
    // Fallback (should be covered by config-loader but kept for safety if loader missing)
    try {
        const response = await fetch('/api/saveConfig', {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'ngrok-skip-browser-warning': 'true' 
            },
            body: JSON.stringify({ affichage: { mode: theme === 'sombre' ? 'Sombre' : 'Clair' } })
        });
        if (response.ok) console.log('Thème sauvegardé (fallback fetch)');
    } catch (error) {
        console.error('Erreur lors de la sauvegarde du thème (fallback):', error);
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
