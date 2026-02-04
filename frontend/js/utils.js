/**
 * Utilitaires communs pour IAQverse
 */

/**
 * Échappe les caractères HTML pour éviter les injections XSS
 * @param {string} s - La chaîne à échapper
 * @returns {string} La chaîne échappée
 */
function escapeHtml(s) {
    if (s === undefined || s === null) return '';
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/**
 * Affiche une notification à l'utilisateur
 * @param {string} message - Le message à afficher
 * @param {boolean} isError - Si true, affiche une notification d'erreur
 */
function showNotification(message, isError = false) {
    const notification = document.getElementById('notification');
    if (!notification) return;

    // Store a pending notification in sessionStorage so that if the page
    // reloads immediately after a change, the message can be restored and
    // shown again. This avoids the message being cut short by navigations.
    try {
        const duration = 3000;
        const pending = { message, isError: !!isError, expires: Date.now() + duration };
        sessionStorage.setItem('iaq_pending_notification', JSON.stringify(pending));
    } catch (e) {
        // ignore sessionStorage errors
    }

    notification.textContent = message;
    notification.className = 'notification ' + (isError ? 'error' : 'success');
    notification.style.display = 'block';

    // Remove both the DOM visible message and the pending entry after duration
    setTimeout(() => {
        notification.style.display = 'none';
        try { sessionStorage.removeItem('iaq_pending_notification'); } catch (e) {}
    }, 3000);
}

/**
 * Initialisation des actions de compte globales
 * (Déconnexion, Changement de compte, etc.)
 */
document.addEventListener('DOMContentLoaded', () => {
    // 1. Bouton Déconnexion
    const logoutBtns = document.querySelectorAll('.account-action.logout');
    logoutBtns.forEach(btn => {
        btn.style.cursor = 'pointer';
        // On vérifie si l'événement n'est pas déjà attaché via un attribut ou autre,
        // mais pour addEventListener c'est cumulatif.
        // Pour éviter les doublons avec settings.js, on pourrait vérifier une classe,
        // mais ici c'est plus simple de le faire partout.
        btn.onclick = () => { // Utiliser onclick écrase les handlers précédents si on veut éviter les doublons
             if (typeof logout === 'function') logout();
             else if (typeof window.logout === 'function') window.logout();
        };
    });

    // 2. Bouton "Autre Compte" (Changera de compte -> Logout)
    const otherAccountSpans = document.querySelectorAll('.account-item span[data-i18n="account.otherAccount"]');
    otherAccountSpans.forEach(span => {
        const btn = span.closest('.account-item');
        if (btn) {
            btn.style.cursor = 'pointer';
            btn.onclick = () => {
                if (typeof logout === 'function') logout();
                else if (typeof window.logout === 'function') window.logout();
            };
        }
    });

    // 3. Gestion de la fermeture du modal si clic à l'extérieur (Global)
    window.addEventListener('click', (e) => {
        const modal = document.getElementById('accountModal');
        // On vérifie les triggers possibles (avatar header)
        const trigger = document.querySelector('.header-avatar-link');
        const triggerImg = document.getElementById('header-avatar');
        
        if (modal && (modal.style.display === 'block' || modal.classList.contains('show'))) {
             // Si le clic n'est pas dans le modal et n'est pas sur le bouton d'ouverture
             if (!modal.contains(e.target) && e.target !== trigger && e.target !== triggerImg && !trigger?.contains(e.target)) {
                 modal.style.display = 'none';
                 modal.classList.remove('show');
             }
        }
    });
});


/**
 * Gestion des modales
 */
const ModalManager = {
    /**
     * Ouvre une modale
     * @param {string} modalId - L'ID de la modale
     */
    open(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.style.display = 'flex';
        }
    },

    /**
     * Ferme une modale
     * @param {string} modalId - L'ID de la modale
     */
    close(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.style.display = 'none';
        }
    },

    /**
     * Initialise la fermeture des modales au clic sur l'overlay
     */
    initClickOutside() {
        window.addEventListener('click', function(event) {
            if (event.target.classList.contains('modal')) {
                event.target.style.display = 'none';
            }
        });
    }
};

/**
 * Initialisation des gestionnaires de modales au chargement
 */
document.addEventListener('DOMContentLoaded', () => {
    ModalManager.initClickOutside();

    // Ajouter les gestionnaires pour les boutons close
    document.querySelectorAll('.close').forEach(btn => {
        btn.addEventListener('click', function() {
            const modal = this.closest('.modal');
            if (modal) {
                modal.style.display = 'none';
            }
        });
    });

    // If a notification was stored just before a reload, restore and show it
    try {
        const pendingRaw = sessionStorage.getItem('iaq_pending_notification');
        if (pendingRaw) {
            const pending = JSON.parse(pendingRaw);
            if (pending && pending.expires && pending.expires > Date.now()) {
                const notification = document.getElementById('notification');
                if (notification) {
                    notification.textContent = pending.message;
                    notification.className = 'notification ' + (pending.isError ? 'error' : 'success');
                    notification.style.display = 'block';
                    // remove after remaining time
                    const remaining = Math.max(0, pending.expires - Date.now());
                    setTimeout(() => {
                        notification.style.display = 'none';
                        try { sessionStorage.removeItem('iaq_pending_notification'); } catch (e) {}
                    }, remaining || 1500);
                }
            } else {
                try { sessionStorage.removeItem('iaq_pending_notification'); } catch (e) {}
            }
        }
    } catch (e) {
        // ignore
    }
});

// Export des fonctions
window.escapeHtml = escapeHtml;
window.showNotification = showNotification;
window.ModalManager = ModalManager;

/**
 * Met � jour l'avatar dans le header
 */
async function updateHeaderAvatar() {
    const avatarImg = document.getElementById('header-avatar');
    if (!avatarImg) return;

    // Default avatar
    const defaultAvatar = '/assets/icons/profil.png';

    try {
        // Try to get config if available
        if (typeof window.loadConfig === 'function') {
            const config = await window.loadConfig();
            if (config && config.vous && config.vous.avatar) {
                avatarImg.src = config.vous.avatar;
            }
        }
    } catch (e) {
        console.warn('Failed to load avatar config', e);
    }
    
    // Fallback to default if not set or error
    if (!avatarImg.getAttribute('src')) {
        avatarImg.src = defaultAvatar;
    }

    // Mettre à jour l'avatar dans le menu du compte (Utilisateur Actuel)
    const modalAvatar = document.querySelector('.account-item.active .account-avatar-small');
    if (modalAvatar) {
        modalAvatar.src = avatarImg.src;
    }
}

// Initialize avatar on load
document.addEventListener('DOMContentLoaded', () => {
    updateHeaderAvatar();
});


/**
 * Bascule l'affichage du modal de compte
 */
function toggleAccountModal() {
    const modal = document.getElementById('accountModal');
    if (modal) {
        modal.classList.toggle('visible');
    }
}

// Fermer le modal si on clique en dehors
document.addEventListener('click', function(event) {
    const modal = document.getElementById('accountModal');
    const avatarLink = document.querySelector('.header-avatar-link');
    
    if (modal && modal.classList.contains('visible')) {
        // Si le clic n'est ni dans le modal ni sur l'avatar (qui l'ouvre)
        if (!modal.contains(event.target) && (!avatarLink || !avatarLink.contains(event.target))) {
            modal.classList.remove('visible');
        }
    }
});

