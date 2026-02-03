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
        if (session && window.location.pathname.endsWith('login.html')) {
            // Redirection si déjà connecté
            window.location.href = 'index.html';
            return;
        }
    }

    const loginForm = document.getElementById('login-form');
    if (loginForm) {
        loginForm.addEventListener('submit', handleLogin);
    }
    
    // Ajout bouton Sign Up
    const signupBtn = document.getElementById('signup-btn');
    if (signupBtn) {
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
    if (supabaseClient) {
        await supabaseClient.auth.signOut();
    }
    window.location.href = 'login.html';
}
