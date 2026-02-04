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


// -- Fonctionnalités liées au compte (Déconnexion, Changement, etc.) --

/**
 * Affiche une modale de confirmation pour la déconnexion
 */
function showLogoutConfirmation() {
    // Vérifier si la modale existe déjà
    let modal = document.getElementById('logout-confirmation-modal');
    
    if (!modal) {
        // Créer la modale si elle n'existe pas
        modal = document.createElement('div');
        modal.id = 'logout-confirmation-modal';
        modal.className = 'modal confirm-modal';
        modal.innerHTML = `
            <div class="modal-content" style="max-width: 350px; text-align: center;">
                <h3 style="margin-top: 0; margin-bottom: 15px;">Déconnexion</h3>
                <p style="margin-bottom: 25px; color: var(--text-secondary);">Êtes-vous sûr de vouloir vous déconnecter ?</p>
                <div class="modal-actions" style="display: flex; justify-content: center; gap: 10px;">
                    <button class="btn-cancel" style="padding: 8px 16px; border-radius: 6px; border: 1px solid var(--border-color); background: transparent; color: var(--text-primary); cursor: pointer;">Annuler</button>
                    <button class="btn-confirm-logout" style="padding: 8px 16px; border-radius: 6px; border: none; background: #e74c3c; color: white; cursor: pointer; font-weight: 500;">Déconnexion</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        
        // Events
        const cancelBtn = modal.querySelector('.btn-cancel');
        const confirmBtn = modal.querySelector('.btn-confirm-logout');
        
        cancelBtn.onclick = () => {
            modal.style.display = 'none';
        };
        
        confirmBtn.onclick = () => {
             if (typeof logout === 'function') logout();
             else if (typeof window.logout === 'function') window.logout();
             modal.style.display = 'none';
        };

        // Fermer si clic dehors
        modal.onclick = (e) => {
            if (e.target === modal) modal.style.display = 'none';
        };
    }
    
    // Afficher la modale
    modal.style.display = 'flex';
}

function handleAccountModalOutsideClick(event) {
    const modal = document.getElementById('accountModal');
    const trigger = document.querySelector('.header-avatar-link');
    const triggerImg = document.getElementById('header-avatar');

    if (!modal) return;

    const isVisible =
        modal.classList.contains('visible') ||
        modal.classList.contains('show') ||
        modal.style.display === 'block';

    if (!isVisible) return;

    if (
        !modal.contains(event.target) &&
        event.target !== trigger &&
        event.target !== triggerImg &&
        !trigger?.contains(event.target)
    ) {
        modal.classList.remove('visible');
        modal.classList.remove('show');
        modal.style.display = 'none';
    }
}

/**
 * Initialisation des actions de compte globales
 * (Déconnexion, Changement de compte, etc.)
 */
document.addEventListener('DOMContentLoaded', () => {
    // 1. Bouton Déconnexion (Initiale, avant renderAccountList potentielle)
    const logoutBtns = document.querySelectorAll('.account-action.logout');
    logoutBtns.forEach(btn => {
        btn.style.cursor = 'pointer';
        btn.onclick = () => {
             showLogoutConfirmation();
        };
    });

    // 2. Bouton "Autre Compte" (Ajout d'un compte)
    const otherAccountSpans = document.querySelectorAll('.account-item span[data-i18n="account.otherAccount"]');
    otherAccountSpans.forEach(span => {
        const btn = span.closest('.account-item');
        if (btn) {
            btn.style.cursor = 'pointer';
            btn.onclick = () => {
                if (typeof addNewAccount === 'function') addNewAccount();
                else window.location.href = 'login.html?force_login=true';
            };
        }
    });

    // 3. Fermeture du modal compte si clic à l'extérieur
    window.addEventListener('click', handleAccountModalOutsideClick);

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

    // Restauration de notification après reload
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

    updateHeaderAvatar();
    renderAccountList();
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



/**
 * Bascule l'affichage du modal de compte
 */
function toggleAccountModal() {
    const modal = document.getElementById('accountModal');
    if (modal) {
        modal.classList.toggle('visible');
        if (modal.classList.contains('visible')) {
            renderAccountList();
        }
    }
}

/**
 * Affiche la liste des comptes stockés
 */
async function renderAccountList() {
    // On s'assure d'abord d'avoir acces à supabase pour l'utilisateur courant
    let currentUser = null;
    if (typeof supabaseClient !== 'undefined' && supabaseClient) {
         const { data } = await supabaseClient.auth.getSession();
         currentUser = data.session?.user;
    } else if (typeof initSupabase === 'function') {
         await initSupabase();
         if (supabaseClient) {
            const { data } = await supabaseClient.auth.getSession();
            currentUser = data.session?.user;
         }
    }

    const listContainer = document.querySelector('.account-list');
    if (!listContainer) return;

    // Sauvegarder les éléments statiques (Paramètres, Logout) pour les remettre à la fin
    // On suppose que les li avec classe account-action sont à garder en bas, et le header avatar en haut.
    // Mais le HTML actuel est mixte. Recréons la liste proprement en gardant la structure.
    
    // Structure cible :
    // 1. Current User (active)
    // 2. Other Accounts (loop)
    // 3. Divider
    // 4. Settings
    // 5. Add Account (renamed Autre Compte behavior ?) -> Non, "Autre Compte" est souvent "Ajouter un compte"
    // 6. Logout

    // On récupère les comptes stockés
    let accounts = [];
    try {
        accounts = JSON.parse(localStorage.getItem('iaq_accounts') || '[]');
    } catch (e) { accounts = []; }

    // Filtrer pour ne pas afficher le compte courant dans la liste "autres"
    const otherAccounts = accounts.filter(a => !currentUser || a.user.id !== currentUser.id);

    // On vide la partie "utilisateurs" de la liste mais on garde "Paramètres" et "Déconnexion"
    // Pour faire simple, on recrée le innerHTML
    
    let html = '';
    
    // 1. Current User
    if (currentUser) {
        // Essayer de trouver l'avatar dans la config ou utiliser defaut
        let avatarSrc = '/assets/icons/profil.png';
        const currentStored = accounts.find(a => a.user.id === currentUser.id);
        if (currentStored && currentStored.user.user_metadata?.avatar_url) {
             avatarSrc = currentStored.user.user_metadata.avatar_url;
        }
        // Sinon peut-etre maj via updateHeaderAvatar qui a lu config.json... 
        // On check l'image du header
        const headerAvatar = document.getElementById('header-avatar');
        if (headerAvatar) avatarSrc = headerAvatar.src;

        html += `
        <li class="account-item active" style="cursor: default;">
          <img src="${avatarSrc}" class="account-avatar-small">
          <div style="display:flex; flex-direction:column; justify-content:center;">
             <span data-i18n="account.currentUser" style="font-weight:bold;">${currentUser.email || 'Utilisateur Actuel'}</span>
             <span style="font-size: 0.8em; color: var(--text-secondary);">Actif</span>
          </div>
        </li>`;
    }

    // 2. Other stored accounts
    otherAccounts.forEach(acc => {
        let avatarSrc = acc.user.user_metadata?.avatar_url || '/assets/icons/profil.png';
        html += `
        <li class="account-item" onclick="switchAccount('${acc.user.id}')" style="cursor: pointer;">
          <img src="${avatarSrc}" class="account-avatar-small" style="filter: grayscale(1);">
          <div style="display:flex; flex-direction:column; justify-content:center;">
             <span>${acc.user.email}</span>
             <span style="font-size: 0.8em; color: var(--text-secondary);">Connecté</span>
          </div>
        </li>`;
    });

    // 3. Add Account Button (was "Autre Compte")
    html += `
        <li class="account-item" onclick="addNewAccount()" style="cursor: pointer;">
          <img src="/assets/icons/profil.png" class="account-avatar-small" style="filter: grayscale(1); opacity: 0.7;">
          <span data-i18n="account.otherAccount">Ajouter un compte</span>
        </li>
    `;

    // 4. Divider and Actions
    html += `
        <li class="account-divider"></li>
        <li class="account-action" onclick="location.href='settings.html'">
          <span data-i18n="settings.title">Paramètres</span>
        </li>
        <li class="account-action logout">
          <span data-i18n="account.logout">Déconnexion</span>
        </li>
    `;

    listContainer.innerHTML = html;

    // Réattacher les event listeners pour le logout car on a écrasé le DOM
    const logoutBtn = listContainer.querySelector('.account-action.logout');
    if (logoutBtn) {
        logoutBtn.onclick = () => {
             showLogoutConfirmation();
        };
    }
}

window.switchAccount = async (userId) => {
    let accounts = [];
    try { accounts = JSON.parse(localStorage.getItem('iaq_accounts') || '[]'); } catch(e){}
    
    const target = accounts.find(a => a.user.id === userId);
    if (target && target.access_token) {
        if (!supabaseClient) await initSupabase();
        // Set session
        const { error } = await supabaseClient.auth.setSession({
            access_token: target.access_token,
            refresh_token: target.refresh_token
        });
        
        if (!error) {
            window.location.reload();
        } else {
            console.error("Erreur switch account", error);
            // Si le token est invalide, on le retire ?
            alert("Session expirée, veuillez vous reconnecter.");
            removeAccountFromStorage(userId);
            renderAccountList();
        }
    }
};

window.addNewAccount = async () => {
    // Pour ajouter un compte, on va simplement rediriger vers le login
    // MAIS supabase par défaut écrase la session locale.
    // L'astuce est que handleLogin dans auth.js va SAUVEGARDER la NOUVELLE session.
    // Et notre système `iaq_accounts` a déjà sauvegardé l'ANCIENNE via onAuthStateChange ou initial load.
    
    // Donc on fait juste logout (qui ne clear PAS iaq_accounts grace à ma modif removeAccountFromStorage qui retire SEULEMENT l'actuel)
    // AH ATTENTION: Mon logout() modifié appele removeAccountFromStorage(current).
    // => Si je veux "Ajouter un compte", je ne veux PAS perdre le compte actuel de ma liste.
    
    // Modif: On va rediriger vers login.html sans appeler logout(), mais en s'assurant que login.html ne nous redirige pas auto.
    // login.html a une verif "si deja connecté -> index.html".
    // On doit passer un flag. "?force_login=true"
    
    window.location.href = 'login.html?force_login=true';
};

// Fonctions utilitaires pour le stockage (dupliquées de auth.js pour dispo globale si besoin, mais auth.js gère l'écriture)
// On a besoin de removeAccountFromStorage localement si on veut nettoyer
function removeAccountFromStorage(userId) {
    try {
        let accounts = JSON.parse(localStorage.getItem('iaq_accounts') || '[]');
        accounts = accounts.filter(a => a.user.id !== userId);
        localStorage.setItem('iaq_accounts', JSON.stringify(accounts));
    } catch (e) {}
}





