/**
 * WebSocket Manager pour IAQverse
 * Gère la connexion WebSocket temps réel et remplace le polling HTTP
 */

class WebSocketManager {
    constructor() {
        this.ws = null;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 10;
        this.reconnectDelay = 1000; // 1 seconde
        this.subscriptions = new Set(['measurements']); // Topics par défaut
        this.listeners = new Map(); // Callbacks par topic
        this.isConnected = false;
        this.shouldReconnect = true;
        this.pingInterval = null;
    }

    /**
     * Connecte au WebSocket
     */
    connect() {
        if (this.ws && (this.ws.readyState === WebSocket.CONNECTING || this.ws.readyState === WebSocket.OPEN)) {
            // Silently return if already connecting/connected to avoid console spam
            return;
        }

        const wsUrl = API_ENDPOINTS.websocket;
        console.log(`--- Connexion WebSocket: ${wsUrl} ---`);

        try {
            this.ws = new WebSocket(wsUrl);

            this.ws.onopen = () => {
                console.log('==== WebSocket connecté ====');
                this.isConnected = true;
                this.reconnectAttempts = 0;
                
                // S'abonner aux topics
                this.subscribe([...this.subscriptions]);
                
                // Démarrer le ping pour maintenir la connexion
                this.startPing();
                
                // Notifier les listeners
                this.notifyListeners('connected', { status: 'connected' });
            };

            this.ws.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    console.debug('- WebSocket message:', data);
                    
                    // Dispatcher le message selon le type/topic
                    if (data.type === 'pong') {
                        console.debug('Pong reçu');
                    } else if (data.topic) {
                        this.notifyListeners(data.topic, data.data || data);
                    } else if (data.type === 'measurement') {
                        this.notifyListeners('measurements', data);
                    } else if (data.type === 'module_update') {
                        this.notifyListeners('modules', data);
                    } else if (data.type === 'config_updated') {
                        this.notifyListeners('config', data);
                    }
                } catch (error) {
                    console.error('Erreur parsing WebSocket message:', error);
                }
            };

            this.ws.onerror = (error) => {
                console.error('WebSocket erreur:', error);
                this.isConnected = false;
            };

            this.ws.onclose = (event) => {
                console.log(`--- WebSocket déconnecté (code: ${event.code}) ---`);
                this.isConnected = false;
                this.stopPing();
                
                // Reconnexion automatique
                if (this.shouldReconnect && this.reconnectAttempts < this.maxReconnectAttempts) {
                    this.reconnectAttempts++;
                    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1); // Exponential backoff
                    console.log(`--- Reconnexion dans ${delay}ms (tentative ${this.reconnectAttempts}/${this.maxReconnectAttempts}) ---`);
                    setTimeout(() => this.connect(), delay);
                } else if (this.reconnectAttempts >= this.maxReconnectAttempts) {
                    console.error('Nombre maximum de tentatives de reconnexion atteint');
                    this.notifyListeners('error', { message: 'Impossible de se reconnecter au serveur' });
                }
            };

        } catch (error) {
            console.error(' Erreur création WebSocket:', error);
        }
    }

    /**
     * Déconnecte le WebSocket
     */
    disconnect() {
        this.shouldReconnect = false;
        this.stopPing();
        
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
        
        this.isConnected = false;
        console.log('--- WebSocket déconnecté manuellement ---');
    }

    /**
     * S'abonne à des topics
     * @param {string[]} topics - Liste des topics
     */
    subscribe(topics) {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            console.warn('WebSocket non connecté, abonnement en attente');
            topics.forEach(t => this.subscriptions.add(t));
            return;
        }

        const message = {
            type: 'subscribe',
            topics: topics
        };

        this.ws.send(JSON.stringify(message));
        topics.forEach(t => this.subscriptions.add(t));
        console.log('--- Abonné aux topics:', topics, '---');
    }

    /**
     * Se désabonne de topics
     * @param {string[]} topics - Liste des topics
     */
    unsubscribe(topics) {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            return;
        }

        const message = {
            type: 'unsubscribe',
            topics: topics
        };

        this.ws.send(JSON.stringify(message));
        topics.forEach(t => this.subscriptions.delete(t));
        console.log('--- Désabonné des topics:', topics, '---');
    }

    /**
     * Enregistre un listener pour un topic
     * @param {string} topic - Le topic à écouter
     * @param {Function} callback - Fonction appelée quand un message arrive
     */
    on(topic, callback) {
        if (!this.listeners.has(topic)) {
            this.listeners.set(topic, []);
        }
        this.listeners.get(topic).push(callback);
    }

    /**
     * Retire un listener
     * @param {string} topic - Le topic
     * @param {Function} callback - La fonction à retirer
     */
    off(topic, callback) {
        if (!this.listeners.has(topic)) return;
        
        const callbacks = this.listeners.get(topic);
        const index = callbacks.indexOf(callback);
        if (index > -1) {
            callbacks.splice(index, 1);
        }
    }

    /**
     * Notifie tous les listeners d'un topic
     * @param {string} topic - Le topic
     * @param {any} data - Les données à envoyer
     */
    notifyListeners(topic, data) {
        if (!this.listeners.has(topic)) return;
        
        this.listeners.get(topic).forEach(callback => {
            try {
                callback(data);
            } catch (error) {
                console.error(` Erreur dans listener ${topic}:`, error);
            }
        });
    }

    /**
     * Démarre le ping périodique pour maintenir la connexion
     */
    startPing() {
        this.stopPing(); // Éviter les doublons
        
        this.pingInterval = setInterval(() => {
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                this.ws.send(JSON.stringify({ type: 'ping' }));
                console.debug('Ping envoyé');
            }
        }, 30000); // Ping toutes les 30 secondes
    }

    /**
     * Arrête le ping
     */
    stopPing() {
        if (this.pingInterval) {
            clearInterval(this.pingInterval);
            this.pingInterval = null;
        }
    }

    /**
     * Vérifie si le WebSocket est connecté
     * @returns {boolean}
     */
    isConnectionActive() {
        return this.isConnected && this.ws && this.ws.readyState === WebSocket.OPEN;
    }
}

// Instance globale
window.wsManager = new WebSocketManager();

// Export
window.WebSocketManager = WebSocketManager;


console.log('WebSocket Manager chargé');
window.wsManager.connect();
