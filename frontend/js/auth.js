// Configuration Supabase - À REMPLACER PAR VOS VRAIES CLÉS LORS DU DÉPLOIEMENT
// Ces clés pourront être chargées dynamiquement ou injectées au build
const SUPABASE_URL = os.getenv('SUPABASE_URL'); 
const SUPABASE_KEY = os.getenv('SUPABASE_KEY');

// Initialisation du client
let supabaseClient = null;

function initSupabase() {
    if (typeof supabase !== 'undefined') {
        supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
    } else {
        console.error("SDK Supabase non chargé");
    }
}

// Gestion du formulaire de login
document.addEventListener('DOMContentLoaded', async () => {
    initSupabase();

    // Vérifier si déjà connecté
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (session && window.location.pathname.endsWith('login.html')) {
        // Redirection si déjà connecté
        window.location.href = 'index.html';
        return;
    }

    const loginForm = document.getElementById('login-form');
    if (loginForm) {
        loginForm.addEventListener('submit', handleLogin);
    }
});

async function handleLogin(e) {
    e.preventDefault();
    
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
    if (!supabaseClient) initSupabase();
    const { data } = await supabaseClient.auth.getSession();
    return data.session?.access_token || null;
}

// Fonction de déconnexion
async function logout() {
    if (!supabaseClient) initSupabase();
    await supabaseClient.auth.signOut();
    window.location.href = 'login.html';
}
