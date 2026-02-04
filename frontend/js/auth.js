// Configuration Supabase - Chargée dynamiquement
let supabaseClient = null;
let initPromise = null;

async function fetchAuthConfig() {
     try {
        const response = await fetch('/api/auth/config', {
            headers: { 'ngrok-skip-browser-warning': 'true' }
        });
        if (response.ok) {
            return await response.json();
        }
    } catch (e) {
        console.error("Impossible de charger la config Auth", e);
    }
    return null;
}

async function initSupabase() {
    if (supabaseClient) return supabaseClient;
    if (initPromise) return initPromise;

    initPromise = (async () => {
        const config = await fetchAuthConfig();
        if (config && config.supabaseUrl && config.supabaseKey) {
            if (typeof supabase !== 'undefined') {
                supabaseClient = supabase.createClient(config.supabaseUrl, config.supabaseKey);
            } else {
                console.error("SDK Supabase non chargé");
            }
        } else {
             console.warn("Supabase credentials not found");
        }
        return supabaseClient;
    })();
    
    return initPromise;
}

// Gestion du formulaire de login
document.addEventListener('DOMContentLoaded', async () => {
    await initSupabase();

    if (supabaseClient) {
        // Vérifier si déjà connecté
        const { data: { session } } = await supabaseClient.auth.getSession();
        
        // Check URL params for force_login
        const urlParams = new URLSearchParams(window.location.search);
        const forceLogin = urlParams.get('force_login');

        if (session && !forceLogin) {
            const isLoginPage = window.location.pathname.endsWith('login.html') || (window.location.pathname === '/' && document.getElementById('login-form'));
            
            if (isLoginPage) {
                // MODIFICATION: On ne redirige plus automatiquement vers index.html
                // On laisse l'utilisateur sur la page de login même s'il est connecté.
                // Il devra se reconnecter ou cliquer sur un bouton "Continuer" si on en implémente un.
                console.log("Utilisateur déjà connecté, mais maintien sur la page de login (demande utilisateur).");
                // window.location.href = 'index.html'; 
                // return;
            }
        }
        
        // Si force_login est présent, on veut permettre de se connecter à un autre compte
        // Supabase garde la session active. Si on se connecte avec un autre compte, ça l'écrasera.
        // C'est le comportement voulu. Mais pour l'UX, on pourrait vouloir afficher un message.
    }

    const loginForm = document.getElementById('login-form');
    if (loginForm) {
        loginForm.addEventListener('submit', handleLogin);
    }
    
    // Ajout bouton Sign Up (Legacy) & Nouvelle Page
    const signupBtn = document.getElementById('signup-btn');
    if (signupBtn && !signupBtn.hasAttribute('onclick')) {
        signupBtn.addEventListener('click', handleSignup);
    }

    const googleBtn = document.getElementById('google-btn');
    if (googleBtn) {
        googleBtn.addEventListener('click', handleGoogleLogin);
    }

    const forgotPasswordLink = document.getElementById('forgot-password-link');
    if (forgotPasswordLink) {
        forgotPasswordLink.addEventListener('click', handlePasswordReset);
    }
});

// Exposed logic for custom signup page
async function handleSignupLogic(email, password) {
    if (!supabaseClient) await initSupabase();
    try {
        const { data, error } = await supabaseClient.auth.signUp({
            email,
            password
        });

        // Auto-save email to config if session is created immediately (no email verification or auto-login)
        if (data && data.session) {
            try {
                fetch('/api/config', {
                    method: 'PUT',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${data.session.access_token}`
                    },
                    body: JSON.stringify({
                        vous: { email: email }
                    })
                }).catch(err => console.warn("Background config update failed", err));
            } catch (e) {
                // Ignore sync errors during signup
            }
        }

        if (error) throw error;
        return { success: true, data };
    } catch (error) {
        console.error(error);
        return { success: false, error: error.message || "Erreur inconnue" };
    }
}
window.handleSignupLogic = handleSignupLogic; // Export global

async function updateUserPassword(newPassword) {
    if (!supabaseClient) await initSupabase();
    try {
        const { data, error } = await supabaseClient.auth.updateUser({
            password: newPassword
        });

        if (error) throw error;
        return { success: true, data };
    } catch (error) {
        console.error("Erreur changement mot de passe:", error);
        return { success: false, error: error.message };
    }
}
window.updateUserPassword = updateUserPassword;

async function verifyPassword(password) {
    if (!supabaseClient) await initSupabase();
    // Get current user email
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user || !user.email) return { success: false, error: "Utilisateur non connecté" };

    // Try to sign in to verify password
    const { data, error } = await supabaseClient.auth.signInWithPassword({
        email: user.email,
        password: password
    });

    if (error) return { success: false, error: "Ancien mot de passe incorrect." };
    return { success: true };
}
window.verifyPassword = verifyPassword;

async function handleGoogleLogin() {
    if (!supabaseClient) await initSupabase();
    try {
        const { data, error } = await supabaseClient.auth.signInWithOAuth({
            provider: 'google',
            options: {
                redirectTo: window.location.origin + '/index.html'
            }
        })
        if (error) throw error;
    } catch (error) {
        console.error(error);
        alert("Erreur Google Login: " + error.message);
    }
}

async function handlePasswordReset(e) {
    e.preventDefault();
    const email = document.getElementById('email').value;
    if (!email) {
        alert("Veuillez d'abord entrer votre adresse email dans le champ Email.");
        return;
    }

    if (!supabaseClient) await initSupabase();

    try {
        const { data, error } = await supabaseClient.auth.resetPasswordForEmail(email, {
            redirectTo: window.location.origin + '/reset-password.html',
        });
        if (error) throw error;
        alert("Email de réinitialisation envoyé ! Vérifiez votre boîte de réception.");
    } catch (error) {
        console.error(error);
        alert("Erreur: " + error.message);
    }
}

async function handleSignup(e) {
    e.preventDefault();
    if (!supabaseClient) await initSupabase();

    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    const errorMsg = document.getElementById('error-msg');
    
    errorMsg.style.display = 'none';
    
    try {
        const { data, error } = await supabaseClient.auth.signUp({
            email,
            password
        });
        
        if (error) throw error;
        
        alert("Inscription réussie ! Vérifiez vos emails pour confirmer l'inscription.");
    } catch (error) {
        console.error(error);
        errorMsg.textContent = "Échec de l'inscription : " + (error.message || "Erreur inconnue");
        errorMsg.style.display = 'block';
    }
}

async function handleLogin(e) {
    e.preventDefault();
    
    if (!supabaseClient) await initSupabase();

    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    const errorMsg = document.getElementById('error-msg');
    const btn = e.target.querySelector('button');

    // Reset UI
    errorMsg.style.display = 'none';
    btn.disabled = true;
    btn.textContent = 'Connexion...';

    try {
        const { data, error } = await supabaseClient.auth.signInWithPassword({
            email,
            password
        });

        if (error) throw error;

        // Connexion réussie
        window.location.href = 'index.html';

    } catch (error) {
        console.error(error);
        errorMsg.textContent = "Échec de connexion : " + (error.message || "Erreur inconnue");
        errorMsg.style.display = 'block';
        btn.disabled = false;
        btn.textContent = 'Se connecter';
    }
}

// Fonction utilitaire pour récupérer le token dans les autres fichiers
async function getAuthToken() {
    if (!supabaseClient) await initSupabase();
    if (!supabaseClient) return null;
    const { data } = await supabaseClient.auth.getSession();
    return data.session?.access_token || null;
}

// Fonction de déconnexion
async function logout() {
    if (!supabaseClient) await initSupabase();
    
    // Si on a une session active, on la retire de notre liste de comptes locaux
    if (supabaseClient) {
        const { data: { session } } = await supabaseClient.auth.getSession();
        if (session && session.user) {
            removeAccountFromStorage(session.user.id);
        }
        await supabaseClient.auth.signOut();
    }
    
    // Définir le message de confirmation pour la page de login
    try {
        // Fallback simple si utils.js n'est pas chargé ici, on utilise sessionStorage directement
        // (format compatible avec showNotification dans utils.js)
        const pending = { message: "Vous avez été déconnecté avec succès.", isError: false, expires: Date.now() + 3000 };
        sessionStorage.setItem('iaq_pending_notification', JSON.stringify(pending));
    } catch(e) {}

    window.location.href = 'login.html';
}

// Gestion multi-comptes : Stockage local des sessions
function saveAccountToStorage(session) {
    if (!session || !session.user) return;
    
    try {
        const accounts = JSON.parse(localStorage.getItem('iaq_accounts') || '[]');
        const existingIndex = accounts.findIndex(a => a.user.id === session.user.id);
        
        const accountData = {
            user: session.user,
            access_token: session.access_token,
            refresh_token: session.refresh_token,
            last_login: Date.now()
        };

        if (existingIndex >= 0) {
            accounts[existingIndex] = accountData;
        } else {
            accounts.push(accountData);
        }
        
        localStorage.setItem('iaq_accounts', JSON.stringify(accounts));
    } catch (e) {
        console.error("Erreur sauvegarde compte", e);
    }
}

function removeAccountFromStorage(userId) {
    try {
        let accounts = JSON.parse(localStorage.getItem('iaq_accounts') || '[]');
        accounts = accounts.filter(a => a.user.id !== userId);
        localStorage.setItem('iaq_accounts', JSON.stringify(accounts));
    } catch (e) {
        console.error("Erreur suppression compte", e);
    }
}

// Sync session on auth state change
document.addEventListener('DOMContentLoaded', async () => {
    await initSupabase();
    if (supabaseClient) {
        supabaseClient.auth.onAuthStateChange((event, session) => {
            if (event === 'SIGNED_IN' && session) {
                saveAccountToStorage(session);
            }
        });
    }
});
