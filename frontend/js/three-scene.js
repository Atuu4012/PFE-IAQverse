import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Reflector } from 'three/addons/objects/Reflector.js';

// Initialisation du conteneur
const container = document.getElementById('blender-viewer');
// Hide loader on init to prevent infinite loading if script crashes later
const initLoader = document.getElementById('model-loader');
if (initLoader) {
    // Only hide if we are not about to load (but we are not loading yet)
    // Actually, let's leave it visible if we want to show loading immediately, 
    // but if the script runs, we know we are alive.
    console.log('[three-scene] Script initialized');
}

if (container) {
  if (!container.style.position) container.style.position = 'relative';
  // Supprimé pour laisser le CSS gérer la taille responsive
  // if (!container.style.width) container.style.width = '700px';
  // if (!container.style.height) container.style.height = '400px';
}

const width = (container && container.clientWidth) || 700;
const height = (container && container.clientHeight) || 400;

// Détection mobile basique pour ajuster la qualité
const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

// Renderer with fallback configuration
const renderer = new THREE.WebGLRenderer({ 
  alpha: true, 
  antialias: !isMobile, // Désactiver l'antialiasing sur mobile pour éviter les crashs (OOM)
  precision: isMobile ? 'mediump' : 'highp', 
  powerPreference: isMobile ? 'default' : 'high-performance',
  failIfMajorPerformanceCaveat: false
});

// OPTIMISATION MOBILE CRITIQUE : Pixel Ratio à 1.0 (et non 1.5)
// 1.5x pixel ratio = 2.25x plus de pixels à rendre et stocker en mémoire.
// Sur des appareils à haute résolution, cela fait exploser la mémoire vidéo.
renderer.setPixelRatio(isMobile ? 1 : Math.min(window.devicePixelRatio || 1, 2));

// Désactiver les ombres sur mobile (très coûteux en mémoire et GPU)
renderer.shadowMap.enabled = !isMobile;
if (!isMobile) {
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
}

renderer.setSize(width, height);
if (container) container.appendChild(renderer.domElement);

// Scene & Camera
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 2000);

// Lumières
const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
scene.add(ambientLight);

const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
dirLight.position.set(5, 10, 7.5);
// Désactiver shadows sur mobile
dirLight.castShadow = !isMobile; 
if (dirLight.castShadow) {
    dirLight.shadow.mapSize.width = 1024; // Défaut 512, plus net
    dirLight.shadow.mapSize.height = 1024;
}
scene.add(dirLight);

// Lumière intérieure (Plafonnier) - Chaude, initialement éteinte ou faible
const roomLight = new THREE.PointLight(0xffaa55, 0, 15); // Couleur chaude, intensité 0, distance 15m
roomLight.position.set(0, 3, 0); // Au plafond, au centre
roomLight.decay = 2;
scene.add(roomLight);

// Pulse state API (no-op, sphere removed)
window.setPulseState = function() {};

// Ajout de la sphère d'environnement (Skybox 360°)
const textureLoader = new THREE.TextureLoader();
let environmentSphere = null;
let currentEnvironmentPath = '';

// Fonction de mise à jour de l'environnement
const updateEnvironment = async (configOverride = null) => {
    let cfg = configOverride;
    
    // Essayer de récupérer la config si non fournie
    if (!cfg && window.getConfig) {
        cfg = window.getConfig();
    }
    // Si toujours pas de config, essayer de la charger (asynchrone)
    if (!cfg && window.loadConfig) {
        try {
            cfg = await window.loadConfig();
        } catch(e) { console.warn("Config load failed for env", e); }
    }
    
    // Valeurs par défaut
    // On essaie de déterminer le paysage par défaut sur base de ce qu'on trouve, ou un fallback sûr
    let landscape = 'urban_day.jpg';
    let auto = false;
    
    if (cfg && cfg.digital_twin) {
        if (cfg.digital_twin.landscape) landscape = cfg.digital_twin.landscape;
        if (typeof cfg.digital_twin.auto_day_night === 'boolean') auto = cfg.digital_twin.auto_day_night;
    }
    
    // Logique automatique Jour/Nuit
    if (auto) {
        const hour = new Date().getHours();
        // Jour arbitraire entre 7h et 20h
        const isNight = hour < 7 || hour >= 20;
        
        // Déduction du thème (urban ou garden) depuis le nom de fichier
        let theme = 'urban';
        if (landscape.includes('garden')) theme = 'garden';
        // Ajouter d'autres thèmes ici si nécessaire
        
        landscape = `${theme}_${isNight ? 'night' : 'day'}.jpg`;
    }
    
    const path = `assets/landscapes/${landscape}`;
    
    // Mise à jour de l'éclairage en fonction du mode (Jour/Nuit)
    // On déduit le mode du nom de fichier (contient "night" ou non)
    const isNightMode = landscape.includes('night');
    
    if (isNightMode) {
        // Mode Nuit : Ambiance sombre et bleutée, Lune, Lumière intérieure allumée fort
        
        // Ambient: Bleu nuit très sombre
        ambientLight.color.setHSL(0.66, 0.6, 0.2); 
        ambientLight.intensity = 0.3;
        
        // Directional (Lune): Bleu/Gris, rasant
        dirLight.color.setHSL(0.6, 0.4, 0.6);
        dirLight.intensity = 0.4;
        
        // Intérieur: Chaud et intense (On allume la lumière)
        roomLight.intensity = 1.2;
        
    } else {
        // Mode Jour : Lumière naturelle forte, Soleil
        
        // Ambient: Blanc/Bleu ciel lumineux
        ambientLight.color.setHSL(0.6, 0.2, 0.8);
        ambientLight.intensity = 0.8;
        
        // Directional (Soleil): Blanc chaud
        dirLight.color.setHSL(0.1, 0.3, 0.95);
        dirLight.intensity = 1.0;
        
        // Intérieur: Éteint ou très faible (lumière du jour suffit)
        roomLight.intensity = 0; 
    }

    // Éviter de recharger si c'est la même image
    if (path === currentEnvironmentPath && environmentSphere) return;
    currentEnvironmentPath = path;

    // OPTIMISATION MOBILE : Pas de texture 360° (OOM Saver)
    if (isMobile) {
        if (environmentSphere) {
            scene.remove(environmentSphere);
            disposeObject(environmentSphere);
            environmentSphere = null;
        }
        // Fond uni simple pour remplacer la skybox
        scene.background = new THREE.Color(isNightMode ? 0x050510 : 0x87CEEB);
        scene.environment = null; // Pas de reflets complexes
        console.log('[Mobile] Skybox disabled for performance');
        return;
    }

    textureLoader.load(
      path, 
      (texture) => {
        // Configuration de l'espace colorimétrique pour un rendu correct
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.mapping = THREE.EquirectangularReflectionMapping;

        // Si la sphère existe déjà, on met à jour la texture
        if (environmentSphere) {
            const oldTexture = environmentSphere.material.map;
            if (oldTexture) {
                oldTexture.dispose(); // Libérer la mémoire GPU
            }
            environmentSphere.material.map = texture;
            environmentSphere.material.needsUpdate = true;
            scene.environment = texture;
            console.log(`Environment theme updated to: ${path}`);
            return;
        }

        const sphereGeometry = new THREE.SphereGeometry(500, 60, 40);
        // Inverser la géométrie sur l'axe X pour voir la texture de l'intérieur
        sphereGeometry.scale(-0.1, 0.1, 0.1);

        const sphereMaterial = new THREE.MeshBasicMaterial({
          map: texture
        });

        environmentSphere = new THREE.Mesh(sphereGeometry, sphereMaterial);
        
        // Position par défaut
        // Note : Monter la sphère aligne le sol mais déplace l'horizon. 
        environmentSphere.position.y = 0;
        environmentSphere.name = 'EnvironmentSphere'; // Nom pour identification

        scene.add(environmentSphere);
        
        // Ajoute l'environnement pour les réflexions sur les matériaux (vitres, métal)
        scene.environment = texture;
        
        console.log(`Environment sphere added: ${path}`);
      },
      undefined,
      (err) => {
        console.error('Erreur lors du chargement de la texture 360°', err);
      }
    );
};

// Initialiser l'environnement
updateEnvironment();

// Exposer la fonction (utile pour les mises à jour via WebSocket ou autre)
window.updateThreeEnvironment = updateEnvironment;

// Vérifier périodiquement pour le mode automatique (toutes les minutes)
setInterval(() => updateEnvironment(), 60000);

// Contrôles
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.screenSpacePanning = false;
controls.minDistance = 0.5;
controls.maxDistance = 500;
controls.maxPolarAngle = Math.PI / 2.1;

const loader = new GLTFLoader();
let modelRoot = null;
let isLoading = false; // prevent concurrent loads
let animationStarted = false; // ensure only one animate loop

// Cache pour stocker les modèles 3D déjà chargés (évite de recharger)
const modelCache = new Map(); // clé: glbPath, valeur: {scene: clonedScene, original: gltf.scene}

let objectStates = {};
let currentEnseigneId = null;
let currentPieceId = null;

const objectAnimations = {
  door: {
    axis: 'z',  // axe Z pour tourner comme une porte
    openAngle: Math.PI / 2,  // -90° pour ouvrir dans l'autre sens
    closeAngle: 0,
    duration: 1000,
    particleColor: 0xEEFFFF, // Vent frais (blanc bleuté)
    particleCount: 25,       // MOINS DE PARTICULES (50 -> 25)
    particleType: 'draft'    
  },
  window: {
    axis: 'y',
    openAngle: Math.PI / 4,
    closeAngle: 0,
    duration: 800,
    particleColor: 0xEEFFFF, // Vent frais
    particleCount: 20,       // MOINS DE PARTICULES (40 -> 20)
    particleType: 'draft'
  },
  ventilation: {
    colorOn: 0x00ff00,  // vert quand allumé (Led)
    colorOff: 0xff0000, // rouge par défaut (Led)
    duration: 500,
    particleColor: 0x0080ff, // bleu (Air froid)
    particleCount: 30,
    particleType: 'steam'
  },
  air_purifier: {
    colorOn: 0x00ff00,  // vert quand allumé
    colorOff: 0xff0000, // rouge par défaut
    duration: 500,
    particleColor: 0x00ffff, // Cyan (Air purifié)
    particleCount: 25,
    particleType: 'steam'
  },
  radiator: {
    colorOn: 0x00ff00,  // vert quand allumé (Led)
    colorOff: 0xff0000, // rouge par défaut (Led)
    duration: 500,
    particleColor: 0xff4000, // rouge-orange (Chaleur)
    particleCount: 30,
    particleType: 'steam'
  }
};

let activeParticles = {}; // obj.uuid -> {points, positions, colors, velocities, lifetimes, maxCount, emitting}
let invisibleWalls = []; // Stockage des murs invisibles
let mirrors = []; // Stockage des miroirs (CubeCamera pour reflets locaux)

// Fonction pour créer un mur invisible (collision)
function createInvisibleWall(obj) {
    // Prevent duplicates
    if (obj.userData.hasInvisibleWall) return;

    // On attend que la matrice monde soit à jour
    obj.updateWorldMatrix(true, false);
    
    // Créer une boîte englobante pour récupérer la taille et position
    const box = new THREE.Box3().setFromObject(obj);
    const size = new THREE.Vector3();
    box.getSize(size);
    const center = new THREE.Vector3();
    box.getCenter(center);

    // Si l'objet est trop petit, ignorer
    if (size.length() < 0.1) return;

    // Créer un mesh invisible
    // On s'assure d'une épaisseur minimale pour bloquer le passage
    const thickness = 0.5; // 50cm d'épaisseur
    
    // On détermine l'orientation principale pour l'épaisseur
    // C'est une approximation AABB, donc le mur sera toujours aligné aux axes XYZ
    // On crée un mur un peu plus grand que l'échelle pour bien boucher
    const geometry = new THREE.BoxGeometry(size.x, size.y, Math.max(size.z, thickness));
    
    // Matériel invisible MAIS détectable (visible: true + opacity: 0)
    // Cela permet au Raycaster de le détecter sans modifier le code de filtrage
    const material = new THREE.MeshBasicMaterial({
        color: 0xff0000,
        visible: true, // Doit être visible pour le Raycaster standard
        transparent: true,
        opacity: 0.0, // Totalement transparent
        depthWrite: false, // Ne pas écrire dans le Z-buffer
        side: THREE.DoubleSide
    });
    
    const wall = new THREE.Mesh(geometry, material);
    
    // Positionner au centre de l'objet
    wall.position.copy(center);
    
    // Nommage pour identification
    wall.name = "invisible_wall_" + obj.name;
    
    // Ajouter à la scène directement (ne bougera pas si la porte s'ouvre)
    scene.add(wall);
    invisibleWalls.push(wall);
    
    // Mark as created
    obj.userData.hasInvisibleWall = true;
    
    console.log(`[Collision] Mur invisible ajouté pour: ${obj.name}`);
}

// Helper to update backend config
async function updateModuleConfig(enseigneId, pieceId, moduleId, newState, moduleType = 'unknown') {
    if (!enseigneId || !pieceId) return;
    try {
        const payload = {
            enseigne_id: enseigneId,
            piece_id: pieceId,
            module_id: moduleId,
            module_type: moduleType,
            state: newState
        };
        const headers = { 'Content-Type': 'application/json' };
        // Add auth token
        try {
            if (typeof getAuthToken === 'function') {
                const token = await getAuthToken();
                if (token) headers['Authorization'] = `Bearer ${token}`;
            }
        } catch (e) {
            console.warn('[three-scene] Auth token error:', e);
        }

        await fetch('/api/config/module_state', {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(payload)
        });
        console.log(`[three-scene] Updated module ${moduleId} state to ${newState}`);
    } catch(e) {
        console.error("[three-scene] Failed to update module config", e);
    }
}

// Websocket Synchronization
function setupWebsocket() {
    // Wait for WS Manager to be available
    if (window.wsManager) {
        if (!window.wsManager.isConnectionActive()) {
             window.wsManager.connect();
        }
        window.wsManager.subscribe(['modules']);
        window.wsManager.on('modules', handleExternalModuleUpdate);
        console.log('[three-scene] Listening for WS module updates');
    } else {
        // Retry a bit later if not loaded yet
        setTimeout(setupWebsocket, 1000);
    }
}

function handleExternalModuleUpdate(data) {
    // data: { type: 'module_update', enseigne_id, piece_id, module_id, state, module_type }
    if (data.enseigne_id !== currentEnseigneId || data.piece_id !== currentPieceId) return;
    
    const { module_id, state } = data;
    const objState = objectStates[module_id];
    
    if (objState && objState.state !== state) {
        console.log(`[three-scene] External update for ${module_id}: ${state}`);
        
        // Trigger Animation
        animateObject(objState.object, objState.config, state);
        
        // Manage Particles
        if (state === 'on') {
            createParticles(objState.object, objState.config);
        } else if (state === 'off') {
            stopParticles(objState.object);
        }
        
        // Update Internal State
        objState.state = state;
        
        // Update UI (Alert Point)
        const ap = document.querySelector(`.alert-point[data-target-names="${module_id}"]`);
        if (ap) {
            ap.setAttribute('data-state', state);
            // Re-eval background color
            let bgColor = 'rgba(220, 20, 60, 0.9)'; // default red
            const isPositive = state === 'open' || state === 'on';
            if (isPositive) bgColor = 'rgba(34, 139, 34, 0.9)'; // green
            ap.style.backgroundColor = bgColor;
        }
    }
}

// Start listening
setupWebsocket();

// Function to synchronize with backend configuration (replaces loadObjectStates)
function getModuleStateFromConfig(enseigneId, pieceId, moduleId, defaultState = null) {
  const cfg = (typeof window.getConfig === 'function') ? window.getConfig() : window.config;
  
  if (!cfg || !cfg.lieux) return defaultState;
  
  const ens = cfg.lieux.enseignes.find(e => e.id === enseigneId);
  if (!ens) return defaultState;
  const piece = ens.pieces.find(p => p.id === pieceId);
  if (!piece || !piece.modules) return defaultState;
  
  const mod = piece.modules.find(m => m.id === moduleId);
  return mod ? mod.state : defaultState;
}

function interpolateColor(startColor, endColor, factor) {
  const r = startColor.r + (endColor.r - startColor.r) * factor;
  const g = startColor.g + (endColor.g - startColor.g) * factor;
  const b = startColor.b + (endColor.b - startColor.b) * factor;
  return new THREE.Color(r, g, b);
}

function setObjectColor(obj, colorHex) {
  // Approche "LED Réaliste" : Rectangle LED sur le côté pour Clim/Radiateur
  // AVEC FIX POSITIONNEMENT: On s'attache au Mesh principal, pas au Groupe parent
  
  const nameLower = obj.name ? obj.name.toLowerCase() : '';
  const isRadiator = nameLower.includes('radiator') || nameLower.includes('radiateur') || nameLower.includes('heater') || nameLower.includes('chauffage');
  const isAC = nameLower.includes('clim') || nameLower.includes('ac_') || nameLower.includes('aircon');
  const isPurifier = nameLower.includes('purifier') || nameLower.includes('epurateur');
  
  const isTarget = isRadiator || isAC || isPurifier;

  // Ne rien faire sur les portes/fenêtres si on appelle cette fonction
  if (!isTarget && (nameLower.includes('door') || nameLower.includes('window'))) return;

  // 1. Trouver le Mesh Principal (le plus gros volume)
  let targetMesh = null;
  let maxVolume = -1;

  // Function helper pour traverser
  const validMeshes = [];
  if (obj.isMesh) validMeshes.push(obj);
  
  obj.traverse(c => {
     if (c.isMesh && c.geometry) validMeshes.push(c);
  });

  validMeshes.forEach(c => {
     if (!c.geometry.boundingBox) c.geometry.computeBoundingBox();
     const bb = c.geometry.boundingBox;
     const sz = new THREE.Vector3();
     bb.getSize(sz);
     const vol = (sz.x + 0.01) * (sz.y + 0.01) * (sz.z + 0.01);
     if (vol > maxVolume) {
         maxVolume = vol;
         targetMesh = c;
     }
  });
  
  // Si aucun mesh trouvé
  if (!targetMesh) return;
  
   // FIX: Pour le radiateur, on force la suppression de l'ancienne LED pour recalculer la position
  if (isRadiator) {
      const oldLeds = [];
      targetMesh.traverse(c => { if(c.name === 'StatusLED') oldLeds.push(c); });
      oldLeds.forEach(l => {
          console.log('[setObjectColor] Removing old StatusLED on radiator to force refresh');
          l.removeFromParent();
      });
  }

  if (isRadiator) {
     console.log(`[setObjectColor] Radiator detected: ${obj.name}. TargetMesh: ${targetMesh.name}`);
  }

  // Vérifier si la LED existe déjà SUR LE TARGET MESH
  let led = targetMesh.getObjectByName('StatusLED');

  if (!led) {
      // CRÉATION DE L'INDICATEUR RÉALISTE
      // On crée un groupe qui contient : Boitier (noir) + Lumière (colorée)
      led = new THREE.Group();
      led.name = 'StatusLED';

      // 1. Le Boitier (Fausse surface d'affichage) - Noir brillant
      const housingGeo = new THREE.PlaneGeometry(1.2, 0.6);
      const housingMat = new THREE.MeshStandardMaterial({ 
          color: 0x111111, 
          metalness: 0.8, 
          roughness: 0.2,
          side: THREE.DoubleSide 
      });
      const housing = new THREE.Mesh(housingGeo, housingMat);
      housing.position.z = -0.01; // Légèrement derrière la lumière
      led.add(housing);

      // 2. La Lumière (Le "point" ou "chiffres")
      // Petit rectangle lumineux
      const lightGeo = new THREE.PlaneGeometry(0.5, 0.25);
      const lightMat = new THREE.MeshBasicMaterial({ 
          color: colorHex,
          toneMapped: false, // Glow effect
          transparent: true,
          opacity: 0.9,
          side: THREE.DoubleSide
      });
      const light = new THREE.Mesh(lightGeo, lightMat);
      light.name = 'LightMesh';
      light.position.z = 0.01; // Devant
      led.add(light);
      
      // -- POSITIONNEMENT SUR LE MESH --
      if (!targetMesh.geometry.boundingBox) targetMesh.geometry.computeBoundingBox();
      const bb = targetMesh.geometry.boundingBox;
      
      const name = obj.name.toLowerCase();
      const isRadiator = name.includes('radiator') || name.includes('radiateur') || name.includes('heater') || name.includes('chauffage');

      const sz = new THREE.Vector3();
      bb.getSize(sz);
      let thinAxis = 'z';
      if (sz.x < sz.z && sz.x < sz.y) thinAxis = 'x';

      // ROTATION: 
      if (isRadiator) {
          if (thinAxis === 'x') led.rotation.y = Math.PI / 2;
          else led.rotation.y = 0;
      } else {
          led.rotation.y = Math.PI / 2;
      }
      
      // TAILLE
      const worldSize = 0.08; 
      const parentScale = new THREE.Vector3();
      targetMesh.getWorldScale(parentScale);
      if (parentScale.x < 0.001) parentScale.x = 1;
      if (parentScale.y < 0.001) parentScale.y = 1;
      if (parentScale.z < 0.001) parentScale.z = 1;

      led.scale.set(
          worldSize / parentScale.x,
          worldSize / parentScale.y,
          worldSize / parentScale.z
      );

      // PRE-CALCULS GEOMETRIE
      const cx = (bb.max.x + bb.min.x) / 2;
      const cy = (bb.max.y + bb.min.y) / 2;
      const cz = (bb.max.z + bb.min.z) / 2;
      
      const hx = (bb.max.x - bb.min.x) / 2;
      const hy = (bb.max.y - bb.min.y) / 2;
      const hz = (bb.max.z - bb.min.z) / 2;

      if (isRadiator) {
          // RADIATEUR : LOGIQUE AVEC RÉGLAGE MANUEL
          // 1. Détection Millimètres (si taille > 100)
          const size = new THREE.Vector3();
          bb.getSize(size);
          const isMillimeters = Math.max(size.y, size.z) > 100;

          // 2. Paramètres manuels
          // => MODIFIEZ 'offsetZ' POUR AVANCER/RECULER LA LED
          const offsetZ = isMillimeters ? 150 : 0.15; // 15cm vers l'avant (augmenté pour sortir du radiateur)
          const ledSize = isMillimeters ? 100 : 0.10; // 10cm de large
          
          // 3. Mise à l'échelle
          // Correction de l'étirement : si le radiateur est très large ou écrasé, 
          // led.scale compensait trop. On force une échelle uniforme basée sur la moyenne.
          const uniformScale = ledSize / Math.max(parentScale.x, parentScale.y, parentScale.z);
          
          led.scale.set(
              uniformScale * (parentScale.x < 0.01 ? 1 : 1), // Protection contre les échelles infinies
              uniformScale,
              uniformScale
          );
          
          // Si l'objet parent avait une échelle non uniforme très marquée (ex: x=10, y=1, z=1)
          // diviser par parentScale.x écrasait la LED. 
          // Ici on essaie de garder des proportions carrées pour la LED.
          led.scale.set(
              ledSize / (parentScale.x * 1000 || 1),
              ledSize / (parentScale.y || 1),
              ledSize / (parentScale.z || 1)
          );

          // Force le ratio d'aspect de la LED pour qu'elle ne soit pas étirée
          // Si le parent est étiré en X, on compense pour ramener la LED à sa forme normale
          if (parentScale.x > parentScale.y * 2) led.scale.x /= (parentScale.x / parentScale.y);
          if (parentScale.z > parentScale.y * 2) led.scale.z /= (parentScale.z / parentScale.y);
          
          // 4. Positionnement (Reset Rotation + Position Face Z)
          led.rotation.set(0, 0, Math.PI / 2);
          
          // On le place légèrement à droite et en haut, et on l'avance franchement
          led.position.set(
             cx * 0.3 + (size.x * 0.01), 
             cy + (size.y * 0.01), 
             bb.max.z - 145 + (offsetZ / (parentScale.z || 1))
          );

          // 5. Matériaux (Sans X-Ray pour le rendu final, mais remis normal)
          const lightMesh = led.getObjectByName('LightMesh');
          if (lightMesh) {
             lightMesh.material.color.setHex(colorHex);
             lightMesh.material.depthTest = true;
             lightMesh.material.depthWrite = true;
             lightMesh.renderOrder = 0;
          }
          
      } else if (isPurifier) {
          // --- CONFIGURATION PURIFICATEUR (LED) ---
          // Modifiez ces valeurs pour ajuster l'affichage
          const ALIGN_Y_PERCENT = 0.97;  // Hauteur (0=bas, 1=haut)
          const FORWARD_OFFSET = 1;     // Avancée en cm (profondeur)
          const HORIZONTAL_OFFSET = -4.5;  // Décalage horizontal en cm (Négatif = Gauche, Positif = Droite)
          const LED_SCALE = 0.8;        // Taille
          
          // ROTATION (en degrés) : Changez ces valeurs pour tourner la LED
          const ROT_X = 90;     // Essayez 90 ou -90 si elle est couchée
          const ROT_Y = 210;    // Essayez 90 ou -90 pour tourner sur le côté
          const ROT_Z = 90;
          // ----------------------------------------

          led.rotation.set(
              ROT_X * (Math.PI/180), 
              ROT_Y * (Math.PI/180), 
              ROT_Z * (Math.PI/180)
          );

          // 1. Gestion Echelle (Support des modèles en mm et en mètres)
          const size = new THREE.Vector3();
          bb.getSize(size);
          const isLargeScale = Math.max(size.y, size.z) > 50; // Seuil détection mm

          // Taille de base : 12cm ou 120mm
          const baseSize = isLargeScale ? 120 : 0.12; 
          const finalScale = (baseSize * LED_SCALE) / Math.max(parentScale.x, parentScale.y, parentScale.z);
          led.scale.set(finalScale, finalScale, finalScale);
          
          // 2. Positionnement
          // Conversion de l'offset (cm -> unité locale)
          const cmToUnits = isLargeScale ? 10 : 0.01;
          const zOffsetUnits = FORWARD_OFFSET * cmToUnits;
          const xOffsetUnits = HORIZONTAL_OFFSET * cmToUnits;

          led.position.set(
              cx + (xOffsetUnits / (parentScale.x || 1)), // Décalage horizontal
              bb.min.y + (size.y * ALIGN_Y_PERCENT), // Hauteur relative
              bb.max.z + (zOffsetUnits / (parentScale.z || 1)) - 0.18 // Avancé devant
          );
      } else {
          // CLIM : SUR LE CÔTÉ DROIT (X+), HAUT, CENTRÉ EN PROFONDEUR
          led.position.set(
              bb.max.x + (0.01 / parentScale.x), // Collé sur la droite
              cy + hy * 0.9,  // Tout en haut
              bb.max.z - hz   // Au centre de la profondeur (Z middle)
          );
      }

      targetMesh.add(led);
      
  } else {
      // MISE À JOUR COULEUR & EFFACER L'ANCIEN SI TYPE DIFFÉRENT
      // Si on avait une sphère avant (vieux code), on la supprime
      if (led.isMesh) { 
          targetMesh.remove(led);
          // On rappelle récursivement pour recréer le bon
          setObjectColor(obj, colorHex);
          return;
      }
      
      // Sinon c'est notre groupe, on update la lumière
      const light = led.getObjectByName('LightMesh');
      if (light) {
          light.material.color.setHex(colorHex);
      }
  }
}


// Texture de fumée générée dynamiquement
let _smokeTexture = null;
function getSmokeTexture() {
  if (_smokeTexture) return _smokeTexture;
  
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  
  const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255, 255, 255, 1)'); 
  grad.addColorStop(0.3, 'rgba(255, 255, 255, 0.4)');
  grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
  
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 64, 64);
  
  _smokeTexture = new THREE.CanvasTexture(canvas);
  return _smokeTexture;
}

function createParticles(obj, config) {
  // CRITICAL MOBILE OPTIMIZATION
  // Désactiver les particules sur mobile pour économiser CPU/GPU et mémoire
  if (isMobile) return;

  if (activeParticles[obj.uuid]) {
    // Si le système existe déjà, juste remettre emitting à true
    activeParticles[obj.uuid].emitting = true;
    return;
  }

  const maxCount = config.particleCount || 30;
  
  // Groupe conteneur (plus propre que des points individuels)
  const particleGroup = new THREE.Group();
  particleGroup.name = `particles_${obj.name}`;
  scene.add(particleGroup);
  
  const texture = getSmokeTexture();
  const particles = [];
  
  // Créer un pool de Sprites
  // On utilise des Sprites au lieu de Points pour avoir :
  // 1. Rotation de texture (plus naturel)
  // 2. Transparence individuelle propre
  // 3. Mise à l'échelle individuelle
  for (let i = 0; i < maxCount; i++) {
      const material = new THREE.SpriteMaterial({ 
          map: texture, 
          color: config.particleColor, 
          transparent: true, 
          opacity: 0,
          depthWrite: false, // Important pour la "fumée"
          blending: THREE.AdditiveBlending // Effet lumineux/gazeux
      });
      
      const sprite = new THREE.Sprite(material);
      sprite.visible = false; // Caché par défaut
      particleGroup.add(sprite);
      
      particles.push({
          mesh: sprite,
          velocity: new THREE.Vector3(),
          age: 0,
          life: 0,
          active: false
      });
  }

  activeParticles[obj.uuid] = {
    group: particleGroup,
    particles: particles,
    maxCount,
    emitting: true,
    obj,
    config,
    spawnTimer: 0
  };
}

function stopParticles(obj) {
  if (activeParticles[obj.uuid]) {
    activeParticles[obj.uuid].emitting = false;
  }
}

function spawnParticle(system, p, emissionMatrix, emissionQuaternion, objPos) {
    p.active = true;
    p.age = 0;
    p.mesh.visible = true;
    
    // GESTION DIFFÉRENTE SELON LE TYPE (Courant d'air vs Vapeur/Fumée)
    if (system.config.particleType === 'draft') {
        // == COURANT D'AIR (Portes / Fenêtres) == 
        let targetMesh = null;
        let maxVolume = -1;

        if (system.obj.isMesh) {
            targetMesh = system.obj;
        } else {
             system.obj.traverse(c => {
               if (c.isMesh && c.geometry) {
                   if (!c.geometry.boundingBox) c.geometry.computeBoundingBox();
                   const bb = c.geometry.boundingBox;
                   const sz = new THREE.Vector3();
                   bb.getSize(sz);
                   const metric = (sz.x + 0.1) * (sz.y + 0.1) * (sz.z + 0.1); 
                   if (metric > maxVolume) {
                       maxVolume = metric;
                       targetMesh = c;
                   }
               }
            });
        }
        
        if (!targetMesh && system.obj.children.length > 0) targetMesh = system.obj.children[0];

        if (targetMesh && targetMesh.geometry) {
             if (!targetMesh.geometry.boundingBox) targetMesh.geometry.computeBoundingBox();
             const bb = targetMesh.geometry.boundingBox;
             
             let shiftX = 0;
             const name = system.obj.name ? system.obj.name.toLowerCase() : '';
             
             if (name.includes('door')) shiftX = -0.4;
             else if (name.includes('window')) shiftX = 0.4;

             const localPoint = new THREE.Vector3(
                bb.min.x + Math.random() * (bb.max.x - bb.min.x) + shiftX,
                bb.min.y + Math.random() * (bb.max.y - bb.min.y),
                bb.min.z + Math.random() * (bb.max.z - bb.min.z)
             );
             
             const relativeMatrix = new THREE.Matrix4().copy(system.obj.matrixWorld).invert().multiply(targetMesh.matrixWorld);
             localPoint.applyMatrix4(relativeMatrix);
             const worldPoint = localPoint.applyMatrix4(emissionMatrix);
             
             p.mesh.position.copy(worldPoint);
        } else {
             p.mesh.position.set(objPos.x, objPos.y + 1.0, objPos.z);
        }

        let axis = new THREE.Vector3(0, 0, 1);
        if (system.obj.name && system.obj.name.toLowerCase().includes('door')) {
             axis.set(0, 1, 0); 
        }
        
        const windDir = axis.applyQuaternion(emissionQuaternion).normalize();
        const speed = 0.02 + Math.random() * 0.04; 
        
        p.velocity.set(
            windDir.x * speed,
            windDir.y * speed + (Math.random() * 0.005 - 0.0025),
            windDir.z * speed
        );
        
        // Durée particule (plus courte pour aspect rapide)
        p.life = Math.random() * 40 + 30;

    } else {
        // == FUMÉE / VAPEUR STANDARD (Radiateur / Clim) ==
        p.mesh.position.set(
            objPos.x + (Math.random() - 0.5) * 0.5,
            objPos.y + Math.random() * 0.3,
            objPos.z + (Math.random() - 0.5) * 0.5
        );

        p.velocity.set(
            (Math.random() - 0.5) * 0.015,
            Math.random() * 0.025 + 0.01,
            (Math.random() - 0.5) * 0.015
        );

        p.life = Math.random() * 120 + 60; // Vie longue
    }
    
    // Rotation initiale aléatoire de la texture
    p.mesh.material.rotation = Math.random() * Math.PI * 2;
}

function updateParticles() {
  for (const uuid in activeParticles) {
    const system = activeParticles[uuid];
    
    // --- CALCUL DE LA MATRICE "FERMÉE" (Optimisé) ---
    let emissionMatrix = system.obj.matrixWorld;
    let emissionQuaternion = system.obj.quaternion;
    const isDraft = (system.config.particleType === 'draft');
    
    if (isDraft && system.config.axis) {
        const storedRot = system.obj.rotation[system.config.axis];
        const closedAngle = system.config.closeAngle || 0;
        
        if (Math.abs(storedRot - closedAngle) > 0.01) {
            system.obj.rotation[system.config.axis] = closedAngle;
            system.obj.updateMatrixWorld();
            emissionMatrix = system.obj.matrixWorld.clone();
            emissionQuaternion = system.obj.quaternion.clone();
            system.obj.rotation[system.config.axis] = storedRot;
            system.obj.updateMatrixWorld();
        }
    }

    const objPos = new THREE.Vector3();
    objPos.setFromMatrixPosition(emissionMatrix); 

    // Émettre de nouvelles particules
    if (system.emitting) {
        // Taux d'émission : 1 particule toutes les frames ou toutes les 2 frames selon densité voulue
        const rate = isDraft ? 2 : 1; 
        
        for(let k=0; k<rate; k++) {
            // Trouver premier inactif
            const p = system.particles.find(p => !p.active);
            if (p) {
                spawnParticle(system, p, emissionMatrix, emissionQuaternion, objPos);
            }
        }
    }

    // Mettre à jour les particules existantes
    let activeCount = 0;
    system.particles.forEach(p => {
        if (p.active) {
            activeCount++;
            
            // Physique
            p.mesh.position.add(p.velocity);
            
            // Age
            p.age++;
            const lifeRatio = p.age / p.life;
            
            if (lifeRatio >= 1) {
                p.active = false;
                p.mesh.visible = false;
            } else {
                // Rendu Réaliste : Scale + Opacity
                
                // Opacité : Fade In rapide -> Fade Out lent
                // Max opacité selon config par défaut c'était vertexColors, ici on hardcode ou on pourrait paramétrer
                const maxOpacity = 0.5; // Assez transparent pour la fumée
                
                if (lifeRatio < 0.2) {
                    p.mesh.material.opacity = (lifeRatio / 0.2) * maxOpacity;
                } else {
                    p.mesh.material.opacity = (1 - ((lifeRatio - 0.2) / 0.8)) * maxOpacity;
                }
                
                // Taille : Grossit progressivement (diffusion)
                const startSize = 0.15;
                const endSize = 0.6;
                const scale = startSize + (endSize - startSize) * lifeRatio;
                p.mesh.scale.set(scale, scale, scale);
                
                // Rotation : Tourne doucement en montant
                p.mesh.material.rotation += 0.02;
            }
        }
    });

    // Nettoyage si fini
    if (!system.emitting && activeCount === 0) {
      scene.remove(system.group);
      system.particles.forEach(p => p.mesh.material.dispose());
      delete activeParticles[uuid];
    }
  }
}

function animateObject(obj, config, targetState) {
  const targetObj = obj;
  
  if (config.axis) {
    // rotation animation
    const axis = config.axis;
    const startRotation = targetObj.rotation[axis];
    const targetRotation = targetState === 'open' ? config.openAngle : config.closeAngle;
    const startTime = Date.now();
    const animate = () => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / config.duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3); // ease out
      targetObj.rotation[axis] = startRotation + (targetRotation - startRotation) * eased;
      if (progress < 1) {
        requestAnimationFrame(animate);
      } else {
         // FIN DE L'ANIMATION ROTATION (Porte / Fenêtre)
         // Vérifier si on doit lancer des particules
         // targetState est 'open' ou 'closed'
         if ((targetState === 'open' || targetState === 'on') && config.particleColor) {
             createParticles(targetObj, config);
         } else if (targetState === 'closed' || targetState === 'off') {
             stopParticles(targetObj);
         }
      }
    };
    animate();
  } else if (config.colorOn) {
    // LED Animation (Clim / Radiateur)
    const endColor = targetState === 'on' ? new THREE.Color(config.colorOn) : new THREE.Color(config.colorOff);
    
    // Mettre à jour l'objet pour qu'il ait la LED (création si besoin)
    setObjectColor(obj, endColor.getHex());
    
    // Pour animer, on doit retrouver le maillage de la lumière dans la structure complexe NOUS-MÊME
    // car 'led' récupéré par getObjectByName peut être le groupe
    
    let ledGroup = null;
    let lightMesh = null;
    
    // Chercher dans les descendants du groupe principal obj
    // Note: setObjectColor l'a mis sur le target mesh, qui est un descendant de obj
    obj.traverse(c => {
        if (c.name === 'StatusLED') ledGroup = c;
        if (c.name === 'LightMesh') lightMesh = c;
    });

    if (lightMesh) {
        // Animation du LightMesh (PlaneGeometry coloré)
        const startColor = lightMesh.material.color.clone();
        const startTime = Date.now();
        const animate = () => {
          const elapsed = Date.now() - startTime;
          const progress = Math.min(elapsed / config.duration, 1);
          const eased = progress; 
          
          lightMesh.material.color = interpolateColor(startColor, endColor, eased);
          
          if (progress < 1) {
            requestAnimationFrame(animate);
          } else {
            if (targetState === 'on' && config.particleColor) {
              createParticles(obj, config);
            } else if (targetState === 'off') {
              stopParticles(obj);
            }
          }
        };
        animate();
    } else {
        // Fallback (ex: vieux système ou bug)
        // On essaye de trouver un mesh qui s'appelle StatusLED (cas des portes/fenetres)
        // ou on ignore l'animation couleur
        if (targetState === 'on' && config.particleColor) {
            createParticles(obj, config);
        } else if (targetState === 'off') {
            stopParticles(obj);
        }
    }
  }
}

function frameModel(object3d, offsetFactor = 1.5) {
  // Chercher un objet nommé "Camera" dans le modèle
  let cameraObject = null;
  const foundObjects = [];

  object3d.traverse(obj => {
    if (obj.name) {
      foundObjects.push(obj.name);
      // Chercher exactement "Camera" ou contenant "camera"
      if (obj.name === 'Camera' || obj.name.toLowerCase().includes('camera')) {
        cameraObject = obj;
      }
    }
  });

  if (cameraObject) {
    // Centrer sur l'objet "Camera" trouvé
    const cameraWorldPos = new THREE.Vector3();
    cameraObject.getWorldPosition(cameraWorldPos);

    // Positionner la caméra pour regarder vers l'objet Camera
    const distance = 1; // Distance encore plus réduite pour zoomer davantage
    camera.position.set(
      cameraWorldPos.x + distance,
      cameraWorldPos.y + distance * 0.6,
      cameraWorldPos.z + distance
    );

    // Orienter les contrôles vers l'objet Camera
    controls.target.copy(cameraWorldPos);
  } else {
    // Comportement par défaut pour positionner l'A.M.I
    const box = new THREE.Box3().setFromObject(object3d);
    
    // Au lieu de centrer le modèle (qui déplace les murs par rapport à l'origine)
    // On laisse le modèle à sa place d'origine (0,0,0) si possible, 
    // OU on déplace la caméra à l'intérieur.
    
    // Cependant, si le modèle est très loin de l'origine dans Blender, on le ramène.
    // On aligne le BAS du modèle sur le sol (Y=0)
    object3d.position.y = -box.min.y;
    
    // On centre X et Z
    const center = new THREE.Vector3();
    box.getCenter(center);
    object3d.position.x = -center.x;
    object3d.position.z = -center.z;
    
    // POINT D'APPARITION : 
    // Au lieu de (0, 1.7, 2.0), on cherche un point "sûr" sous le plafond le plus haut mais au dessus du sol.
    // On suppose que (0,0,0) après recentrage est le centre de la pièce.
    
    // Désactiver la gravité temporairement pour placer la caméra
    isGrounded = false;
    verticalVelocity = 0;
    
    // CORRECTION PLAFOND ET CAMERA
    // 1. On place la caméra au centre mais PLUS BAS (accroupi par défaut pour entrer)
    // pour être sûr de passer sous le linteau de porte ou le plafond bas.
    camera.position.set(0, 1.0, 1.5); 
    controls.target.set(0, 1.0, 0);

    // 2. On désactive temporairement les collisions avec le plafond pour éviter d'être repoussé sur le toit
    // Le système enforceWallCollision s'en chargera quand on bougera.

    camera.near = 0.1;
    camera.far = 1000;
    camera.updateProjectionMatrix();

    // Reset des touches coincées (bug "avance tout seul")
    Object.keys(keysPressed).forEach(k => keysPressed[k] = false);
    
    // HACK ULTIME POUR LA CAMÉRA :
    // On force la caméra à être SOUS 2 mètres de hauteur quoi qu'il arrive au début
    if (camera.position.y > 2.0) camera.position.y = 1.5;
  }

  controls.update();
}

// Sécurité globale pour les touches coincées (quand on change de fenêtre alt-tab)
// CORRECTION SHIFT : On reset aussi quand Shift est relâché pour éviter les combos bloqués
window.addEventListener('blur', () => {
   Object.keys(keysPressed).forEach(k => keysPressed[k] = false);
});

// Écouteur global pour "nettoyer" l'état des touches si jamais ça coince
window.addEventListener('keyup', (e) => {
    // Si on relâche Shift, on considère que toutes les modificateurs sont partis
    if (e.key === 'Shift') {
        // Optionnel : on ne fait rien de spécial, ou on reset tout par sécurité
        // console.log("Shift released");
    }
});

function disposeObject(root) {
  if (!root) return;
  root.traverse(obj => {
    // 1. Dispose Geometry
    if (obj.geometry) obj.geometry.dispose();
    
    // 2. Dispose Material & Textures
    if (obj.material) {
      const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
      
      materials.forEach(mat => {
        // Dispose all textures located in material properties
        for (const key in mat) {
          if (mat[key] && mat[key].isTexture) {
            mat[key].dispose();
          }
        }
        // Dispose the material itself
        mat.dispose();
      });
    }
  });
}

// Fonction pour configurer les miroirs avec CubeCamera (reflets locaux)
function setupMirrors(root) {
  // Nettoyer les anciens miroirs
  mirrors.forEach(mirrorData => {
    if (mirrorData.cubeCamera && mirrorData.cubeCamera.parent) {
      mirrorData.cubeCamera.parent.remove(mirrorData.cubeCamera);
    }
    if (mirrorData.renderTarget) {
      mirrorData.renderTarget.dispose();
    }
  });
  mirrors = [];

  // CRITICAL: Disable mirrors on mobile (CubeMaps are very memory intensive)
  if (isMobile) return;

  root.traverse((child) => {
    if (child.isMesh) {
      const name = child.name;
      // Détecter Mirror_001, Mirror_002, etc.
      if (name && name.match(/^Mirror_\d{3}$/i)) {
        console.log('[Mirror] Détecté:', name);
        
        try {
          // Créer un CubeRenderTarget pour capturer l'environnement local
          const cubeRenderTarget = new THREE.WebGLCubeRenderTarget(256, {
            format: THREE.RGBFormat,
            generateMipmaps: true,
            minFilter: THREE.LinearMipmapLinearFilter
          });
          
          // Créer la CubeCamera pour capturer la scène depuis le miroir
          const cubeCamera = new THREE.CubeCamera(0.1, 100, cubeRenderTarget);
          
          // Positionner la caméra au centre du miroir
          child.add(cubeCamera);
          cubeCamera.position.set(0, 0, 0);
          
          // Créer un matériau réfléchissant utilisant la capture locale
          const mirrorMaterial = new THREE.MeshStandardMaterial({
            color: 0xffffff,
            metalness: 1.0,
            roughness: 0.02,
            envMap: cubeRenderTarget.texture,
            envMapIntensity: 1.0,
            side: THREE.DoubleSide
          });
          
          // Remplacer le matériau
          if (Array.isArray(child.material)) {
            child.material.forEach(m => m.dispose());
          } else if (child.material) {
            child.material.dispose();
          }
          
          child.material = mirrorMaterial;
          child.visible = true;
          
          // Stocker les données du miroir
          mirrors.push({
            mesh: child,
            cubeCamera: cubeCamera,
            renderTarget: cubeRenderTarget
          });
          
          console.log('[Mirror] CubeCamera configurée pour:', name);
          
        } catch (error) {
          console.error('[Mirror] Erreur lors de la création du miroir pour', name, error);
        }
      }
    }
  });
  
  console.log(`[Mirror] ${mirrors.length} miroir(s) configuré(s)`);
}

// Fonction pour mettre à jour les reflets des miroirs
function updateMirrorReflections() {
  if (mirrors.length === 0) return;
  
  mirrors.forEach(mirrorData => {
    const { mesh, cubeCamera } = mirrorData;
    
    // Cacher le miroir lui-même pour éviter qu'il se voie
    mesh.visible = false;
    
    // Cacher temporairement la skybox pour ne capturer que l'intérieur
    const envSphereVisible = environmentSphere ? environmentSphere.visible : false;
    if (environmentSphere) environmentSphere.visible = false;
    
    // Mettre à jour la CubeCamera (capture la scène)
    cubeCamera.update(renderer, scene);
    
    // Restaurer la visibilité
    mesh.visible = true;
    if (environmentSphere) environmentSphere.visible = envSphereVisible;
  });
  
  console.log('[Mirror] Reflets mis à jour pour', mirrors.length, 'miroir(s)');
}

/**
 * Corrige les cibles des lumières après un clonage de scène.
 * Gère deux cas :
 * 1. La cible existe dans la hiérarchie clonée (on reconnecte).
 * 2. La cible est une copie détachée (créée par Light.clone). On l'ajoute à la scène
 *    pour qu'elle ait des coordonnées valides (sinon elle reste à 0,0,0 sans matrixWorld).
 */
function fixLightTargets(clonedRoot) {
  clonedRoot.traverse((child) => {
    if ((child.isSpotLight || child.isDirectionalLight) && child.target) {
      
      let targetFound = false;

      // Cas 1: Reconnexion par nom si possible (le plus propre)
      if (child.target.name) {
        const newTarget = clonedRoot.getObjectByName(child.target.name);
        if (newTarget) {
          child.target = newTarget;
          targetFound = true;
          // console.log(`[FixLights] Cible recombinée pour ${child.name} -> ${newTarget.name}`);
        }
      }

      // Cas 2: Si la cible n'a pas été retrouvée ou n'a pas de nom,
      // et qu'elle n'a pas de parent (elle est détachée à cause du clone),
      // on l'attache à la racine ou au parent de la lumière pour qu'elle "existe" dans le graphe.
      if (!targetFound && !child.target.parent) {
          // On l'ajoute au parent de la lumière pour qu'elle suive les transformations locales,
          // ou à la racine clonée si préférable. Le parent de la lumière est souvent le meilleur choix
          // pour conserver la position relative si la lumière est dans un groupe.
          
          if (child.parent) {
              child.parent.add(child.target);
          } else {
              clonedRoot.add(child.target);
          }
          
          // Force la mise à jour de la matrice pour éviter le bug de "lumière vers 0,0,0" au premier frame
          child.target.updateMatrixWorld(true); 
          // console.log(`[FixLights] Cible orpheline attachée pour ${child.name}`);
      }
    }
  });
}

function loadPieceModel(roomId) {
  // Prevent concurrent loads
  if (isLoading) {
    return;
  }

  // Utiliser la config globale remplie par config-loader.js / tabs-manager.js
  try {
    const cfg = typeof getConfig === 'function' ? getConfig() : window.config;
    const activeEnseigne = typeof getActiveEnseigne === 'function' ? getActiveEnseigne() : window.activeEnseigne;
    if (!cfg || !cfg.lieux || !cfg.lieux.enseignes || !activeEnseigne) return;

    const enseigne = cfg.lieux.enseignes.find(e => e.id === activeEnseigne);
    if (!enseigne) return;

    const piece = enseigne.pieces?.find(p => p.id === roomId);
    if (!piece || !piece.glbModel) {
      // Clear existing model
      if (modelRoot) {
        scene.remove(modelRoot);
        disposeObject(modelRoot);
        modelRoot = null;
      }
      renderer.render(scene, camera);
      return;
    }

    const glbPath = piece.glbModel;
    
    // Stocker les IDs actuels pour la persistance
    currentEnseigneId = activeEnseigne;
    currentPieceId = roomId;
    
    console.log('[loadPieceModel] Setting IDs - enseigne:', currentEnseigneId, 'piece:', currentPieceId);

    // Clear existing model before loading new one
    if (modelRoot) {
      scene.remove(modelRoot);
      disposeObject(modelRoot);
      modelRoot = null;
    }
    
    // Réinitialiser l'état du modèle
    modelLoaded = false;
    modelLoadTime = 0;
    
    // Nettoyer les particules actives
    Object.values(activeParticles).forEach(system => {
      if (system.group) {
        scene.remove(system.group);
      }
      if (system.particles) {
          system.particles.forEach(p => {
              if (p.mesh.material) p.mesh.material.dispose();
          });
      }
      // Cas legacy (compatibilité ancien système si besoin)
      if (system.points) {
        scene.remove(system.points);
        if (system.points.geometry) system.points.geometry.dispose();
        if (system.points.material) system.points.material.dispose();
      }
    });
    activeParticles = {};
    
    // Nettoyer les murs invisibles
    invisibleWalls.forEach(w => {
        scene.remove(w);
        if (w.geometry) w.geometry.dispose();
        if (w.material) w.material.dispose();
    });
    invisibleWalls = [];

    isLoading = true;
    
    // Afficher le loader
    const loaderElement = document.getElementById('model-loader');
    if (loaderElement) {
      loaderElement.classList.remove('hidden');
      loaderElement.style.display = 'flex';
    }

    // Vérifier si le modèle est déjà en cache (Désactivé sur mobile pour économiser RAM)
    if (!isMobile && modelCache.has(glbPath)) {
      console.log('[loadPieceModel] Chargement depuis le cache:', glbPath);
      
      isLoading = false;
      
      // Masquer le loader immédiatement
      if (loaderElement) {
        loaderElement.classList.add('hidden');
        setTimeout(() => {
          if (loaderElement.classList.contains('hidden')) {
            loaderElement.style.display = 'none';
          }
        }, 100);
      }
      
      // Récupérer le modèle du cache et le cloner
      const cachedModel = modelCache.get(glbPath);
      modelRoot = cachedModel.clone();
      
      // Fixer les cibles des lumières après le clonage
      fixLightTargets(modelRoot);
      
      scene.add(modelRoot);
      
      // Reconfigurer les miroirs pour le modèle cloné
      setupMirrors(modelRoot);
      
      frameModel(modelRoot, 1.1);
      
      // Marquer que le modèle est chargé
      modelLoaded = true;
      modelLoadTime = Date.now();
      
      // Générer automatiquement les alert-points pour les objets numérotés
      autoGenerateAlertPoints(modelRoot);
      
      // Mettre à jour les reflets des miroirs après un court délai
      setTimeout(() => {
        updateMirrorReflections();
      }, 200);
      
      // Start animation loop only once
      if (!animationStarted) {
        animationStarted = true;
        animate();
      }
      
      return;
    }

    // Si pas en cache, charger depuis le fichier
    console.log('[loadPieceModel] Chargement depuis le fichier:', glbPath);
    
    loader.load(
      glbPath,
      function (gltf) {
        isLoading = false;
        
        // Masquer le loader
        if (loaderElement) {
          loaderElement.classList.add('hidden');
          setTimeout(() => {
              if (loaderElement.classList.contains('hidden')) {
                loaderElement.style.display = 'none';
              }
          }, 300); // Attendre la fin de la transition CSS
        }

        modelRoot = gltf.scene;
        
        // Aggressively fix ALL shader issues by replacing materials and validating geometry
        modelRoot.traverse((child) => {
          if (child.isMesh) {
            
            // --- NEW: Gestion des collisions invisibles ---
            // Créer un mur invisible derrière les portes et fenêtres pour empêcher le passage (conceptuel)
            const nLower = child.name.toLowerCase();
            if (nLower.includes('door') || nLower.includes('porte') || nLower.includes('window') || nLower.includes('fenetre') || nLower.includes('vitre')) {
                createInvisibleWall(child);
            }
            // ---------------------------------------------

            // Step 1: Fix geometry issues - keep ALL UV maps for complex textures
            if (child.geometry) {
              try {
                // Remove only problematic attributes that cause shader issues
                const attributes = child.geometry.attributes;
                const keysToRemove = [];

                // Keep ALL UV maps (uv, uv2, uv3, uv4, etc.) for complex materials
                // Only remove truly problematic attributes
                for (const key in attributes) {
                  // Keep essential attributes including all UV maps
                  if (!['position', 'normal', 'uv', 'uv2', 'uv3', 'uv4', 'uv5', 'uv6', 'uv7', 'uv8', 'color', 'tangent', 'bitangent'].includes(key)) {
                    // Check if it's a custom attribute that might cause issues
                    if (key.startsWith('uv') && key.length > 3) {
                      // Keep high-number UV maps too (uv9, uv10, etc.)
                      continue;
                    }
                    keysToRemove.push(key);
                  }
                }

                keysToRemove.forEach(key => {
                  delete child.geometry.attributes[key];
                });

                // Ensure we have at least basic UV map to prevent shader errors
                if (!child.geometry.attributes.uv) {
                  // If no uv, check if we have uv2, uv3, etc. and use the first available
                  let foundUV = false;
                  for (let i = 2; i <= 10; i++) {
                    const uvKey = `uv${i}`;
                    if (child.geometry.attributes[uvKey]) {
                      child.geometry.setAttribute('uv', child.geometry.attributes[uvKey]);
                      foundUV = true;
                      break;
                    }
                  }

                  // If no UV maps at all, create dummy UVs
                  if (!foundUV) {
                    const positionCount = child.geometry.attributes.position.count;
                    const uvArray = new Float32Array(positionCount * 2);
                    child.geometry.setAttribute('uv', new THREE.BufferAttribute(uvArray, 2));
                  }
                }

                // Recompute normals if missing
                if (!child.geometry.attributes.normal) {
                  child.geometry.computeVertexNormals();
                }

              } catch (e) {
                console.warn('[three-scene] Geometry fix failed for', child.name, e);
              }
            }
            
            // Step 2: Fix materials but preserve textures when possible
            try {
              const originalMaterials = Array.isArray(child.material) ? child.material : [child.material];
              const newMaterials = [];

              originalMaterials.forEach(mat => {
                try {
                  // Try to preserve the original material if it's not causing issues
                  if (mat && mat.isMaterial) {
                    // Check if material has complex features that might cause shader issues
                    const hasProblematicFeatures = (
                      mat.isShaderMaterial ||
                      mat.isRawShaderMaterial ||
                      (mat.map && mat.map.isCompressedTexture) ||
                      (mat.normalMap && mat.normalMap.isCompressedTexture) ||
                      (mat.roughnessMap && mat.roughnessMap.isCompressedTexture) ||
                      (mat.metalnessMap && mat.metalnessMap.isCompressedTexture)
                    );

                    if (!hasProblematicFeatures) {
                      // Material seems safe, try to use it with some fixes
                      let finalMat = mat.clone();

                      // Ensure basic properties are set
                      if (!finalMat.color) {
                        finalMat.color = new THREE.Color(0xcccccc);
                      }
                      
                      // --- FIX TRANSPARENCE VITRES (Mode Safe) ---
                      const nameLower = child.name.toLowerCase();
                      const matNameLower = mat && mat.name ? mat.name.toLowerCase() : '';
                      const isGlass = nameLower.includes('window') || nameLower.includes('fenetre') || nameLower.includes('vitre') || nameLower.includes('glass') || 
                                      matNameLower.includes('glass') || matNameLower.includes('vitre') || matNameLower.includes('window');

                      if (isGlass) {
                          finalMat.transparent = true;
                          finalMat.opacity = 0.45; // Semi-transparent
                          finalMat.roughness = 0.05; // Très lisse
                          finalMat.metalness = 0.9; // Réfléchissant
                          finalMat.side = THREE.DoubleSide;
                          // finalMat.depthWrite = false; // Parfois nécessaire, parfois bugué. On tente sans d'abord si safeMat
                      }
                      // ------------------------------------------

                      if (finalMat.transparent === undefined) {
                        finalMat.transparent = false;
                      }
                      if (finalMat.side === undefined) {
                         finalMat.side = THREE.FrontSide;
                      }

                      newMaterials.push(finalMat);
                      return;
                    }
                  }

                  // Fallback: create a basic material that preserves textures
                  let color = 0xcccccc;
                  let map = null;
                  let normalMap = null;
                  let roughnessMap = null;
                  let metalnessMap = null;
                  let aoMap = null;
                  let emissiveMap = null;

                  if (mat) {
                    // Extract color safely
                    try {
                      if (mat.color && typeof mat.color.getHex === 'function') {
                        color = mat.color.getHex();
                      } else if (mat.color && typeof mat.color === 'number') {
                        color = mat.color;
                      }
                    } catch (e) {
                      // Use default color
                    }

                    // Preserve texture maps if they exist and are not compressed
                    if (mat.map && !mat.map.isCompressedTexture) {
                      map = mat.map;
                    }
                    if (mat.normalMap && !mat.normalMap.isCompressedTexture) {
                      normalMap = mat.normalMap;
                    }
                    if (mat.roughnessMap && !mat.roughnessMap.isCompressedTexture) {
                      roughnessMap = mat.roughnessMap;
                    }
                    if (mat.metalnessMap && !mat.metalnessMap.isCompressedTexture) {
                      metalnessMap = mat.metalnessMap;
                    }
                    if (mat.aoMap && !mat.aoMap.isCompressedTexture) {
                      aoMap = mat.aoMap;
                    }
                    if (mat.emissiveMap && !mat.emissiveMap.isCompressedTexture) {
                      emissiveMap = mat.emissiveMap;
                    }

                    // Dispose old material
                    if (typeof mat.dispose === 'function') {
                      try {
                        mat.dispose();
                      } catch (e) {
                        // Ignore
                      }
                    }
                  }

                  // --- FIX TRANSPARENCE VITRES (Mode Fallback) ---
                  const nameLower = child.name.toLowerCase();
                  const matNameLower = mat && mat.name ? mat.name.toLowerCase() : '';
                  const isGlass = nameLower.includes('window') || nameLower.includes('fenetre') || nameLower.includes('vitre') || nameLower.includes('glass') || 
                                  matNameLower.includes('glass') || matNameLower.includes('vitre') || matNameLower.includes('window');
                  
                  let isTransparent = false;
                  let opacity = 1.0;
                  
                  if (isGlass) {
                      isTransparent = true;
                      opacity = 0.45;
                  } else if (mat && (mat.transparent || mat.opacity < 1.0)) {
                      isTransparent = true;
                      opacity = mat.opacity;
                  }
                  // ---------------------------------------------

                  // Create material with preserved textures
                  const newMat = new THREE.MeshStandardMaterial({
                    color: color,
                    map: map,
                    normalMap: normalMap,
                    roughnessMap: roughnessMap,
                    metalnessMap: metalnessMap,
                    aoMap: aoMap,
                    emissiveMap: emissiveMap,
                    roughness: map ? 0.8 : (isGlass ? 0.05 : 0.7), // Slightly rougher if no texture, smooth if glass
                    metalness: isGlass ? 0.9 : 0.0,
                    side: THREE.DoubleSide,
                    transparent: isTransparent,
                    opacity: opacity,
                    depthWrite: !isGlass // Disable depth write for glass to avoid occlusion issues
                  });

                  newMaterials.push(newMat);

                } catch (e) {
                  console.warn('[three-scene] Material processing failed for', child.name, e);
                  // Ultimate fallback
                  newMaterials.push(new THREE.MeshStandardMaterial({
                    color: 0xcccccc,
                    side: THREE.DoubleSide
                  }));
                }
              });

              // Apply materials
              child.material = newMaterials.length === 1 ? newMaterials[0] : newMaterials;

            } catch (e) {
              console.error('[three-scene] Complete material replacement failed for', child.name, e);
              // Ultimate fallback
              child.material = new THREE.MeshStandardMaterial({
                color: 0xcccccc,
                side: THREE.DoubleSide
              });
            }
          }
        });
        
        // Stocker le modèle dans le cache avant de l'ajouter à la scène
        // Désactivé sur mobile pour éviter que la mémoire ne sature (OOM Crash)
        if (!isMobile) {
            console.log('[loadPieceModel] Ajout au cache:', glbPath);
            modelCache.set(glbPath, modelRoot.clone());
        }
        
        scene.add(modelRoot);
        
        // Configurer les miroirs (CubeCamera)
        setupMirrors(modelRoot);
        
        frameModel(modelRoot, 1.1);
        
        // Marquer que le modèle est chargé
        modelLoaded = true;
        modelLoadTime = Date.now();
        
        // Générer automatiquement les alert-points pour les objets numérotés
        autoGenerateAlertPoints(modelRoot);
        
        // Mettre à jour les reflets des miroirs après un court délai
        setTimeout(() => {
          updateMirrorReflections();
        }, 200);
        
        // Start animation loop only once
        if (!animationStarted) {
          animationStarted = true;
          animate();
        }
      },
      function (xhr) {
        // Progress callback
      },
      function (error) {
        isLoading = false;
        const loaderElement = document.getElementById('model-loader');
        if (loaderElement) {
          loaderElement.classList.add('hidden');
          loaderElement.style.display = 'none';
        }
        console.error('Erreur de chargement du modèle:', error);
      }
    );
  } catch (e) {
    isLoading = false;
    const loaderElement = document.getElementById('model-loader');
    if (loaderElement) {
      loaderElement.classList.add('hidden');
      loaderElement.style.display = 'none';
    }
    console.error('loadPieceModel error:', e);
  }
}

// Points d'alertes : recherche d'objet par noms
function findTargetObjectByNames(root, names) {
  const lowerNames = names.map(n => n.trim().toLowerCase()).filter(Boolean);
  let found = null;
  let bestMatch = null;
  let bestScore = 0;
  
  root.traverse((child) => {
    if (!child.name) return;
    const lname = child.name.toLowerCase();
    
    for (const n of lowerNames) {
      // Score de correspondance : 3 = exact match, 2 = contient, 1 = contenu dans
      let score = 0;
      if (lname === n) {
        score = 3;
      } else if (lname.indexOf(n) !== -1) {
        score = 2;
      } else if (n.indexOf(lname) !== -1) {
        score = 1;
      }
      
      if (score > bestScore) {
        bestScore = score;
        bestMatch = child;
      }
      
      // Si match exact, prendre immédiatement
      if (score === 3) {
        found = child;
        return;
      }
    }
  });
  
  // Retourner le meilleur match trouvé, ou null
  return found || bestMatch;
}

function autoGenerateAlertPoints(modelRoot) {
  if (!modelRoot) return;
  
  console.log('[autoGenerate] Starting with enseigne:', currentEnseigneId, 'piece:', currentPieceId);
  
  // Réinitialiser objectStates pour la nouvelle pièce
  objectStates = {};
  
  // Supprimer les anciens alert-points générés automatiquement
  const existingAutoPoints = document.querySelectorAll('.alert-point[data-auto-generated="true"]');
  existingAutoPoints.forEach(point => point.remove());
  
  const alertPointsContainer = document.getElementById('alert-points-container');
  if (!alertPointsContainer) return;
  
  // Note: savedStates removal - we use config now
  
  // Patterns à rechercher dans les noms d'objets (ajustés selon les vrais noms du GLB)
  const patterns = {
    // Regex plus souples qui excluent explicitement les sous-parties (poignées, cadres)
    // Cela permet des noms comme "Door_Cuisine_Inv", "Door.001", etc.
    'window': /^Window(?!.*(?:Handle|Frame|Vitre|Glass|Poignee|Cadre)).*$/i,
    'door': /^Door(?!.*(?:Handle|Frame|Cadre|Poignee)).*$/i,
    'ventilation': /Clim/i, // Cherche "Clim" n'importe où dans le nom
    'air_purifier': /^Purifier.*$/i,
    'radiator': /^Radiator(?!.*(?:Valve|Tuyau)).*$/i
  };
  
  // Collecter tous les objets correspondants (stocker les objets Three.js, pas juste les noms)
  const foundObjects = {};
  Object.keys(patterns).forEach(key => foundObjects[key] = []);
  
  modelRoot.traverse(obj => {
    if (obj.name) {
      Object.entries(patterns).forEach(([type, pattern]) => {
        if (pattern.test(obj.name)) {
          // Vérifier que ce n'est pas un enfant d'un objet déjà trouvé
          let isChild = false;
          obj.traverseAncestors(ancestor => {
            if (ancestor !== modelRoot && ancestor.name && pattern.test(ancestor.name)) {
              isChild = true;
            }
          });
          
          // Ne stocker que les objets parents (pas les enfants)
          if (!isChild) {
            foundObjects[type].push(obj); // Stocker l'objet Three.js complet
            
            // Définir la couleur par défaut à rouge pour ventilation et radiator
            if (type === 'ventilation' || type === 'radiator' || type === 'air_purifier') {
              setObjectColor(obj, 0xff0000); // rouge
            }
          }
        }
      });
    }
  });
  
  console.log('[autoGenerate] === RÉSUMÉ DES OBJETS TROUVÉS ===');
  Object.entries(foundObjects).forEach(([type, objects]) => {
    console.log(`[autoGenerate] ${type}: ${objects.length} objet(s) trouvé(s)`, objects.map(o => o.name));
  });
  
  // Créer les alert-points pour chaque type trouvé
  const typePositions = {
    'window': { top: '20%', left: '30%' },
    'door': { top: '30%', left: '10%' }, // Remonté pour être au milieu de la porte
    'ventilation': { top: '10%', left: '50%' },
    'air_purifier': { top: '50%', left: '50%' },
    'radiator': { top: '80%', left: '20%' }
  };
  
  Object.entries(foundObjects).forEach(([type, objects]) => {
    if (objects.length > 0) {
      // Créer un alert-point pour CHAQUE objet trouvé
      objects.forEach((obj, index) => {
        // Déterminer le nom cible pour l'animation
        let targetName = obj.name;
        
        if (!objectStates[targetName]) {
          let animationObj = obj;
          
          // Initial State Resolution from Config
          // Si non présent dans la config, getModuleStateFromConfig renverra null
          const configState = getModuleStateFromConfig(currentEnseigneId, currentPieceId, targetName);
          const initialMode = configState || (type === 'window' || type === 'door' ? 'closed' : 'off');
          
          // Créer une configuration spécifique pour cet objet
          // Cela permet d'adapter l'animation (direction, axe) par objet
          const config = { ...objectAnimations[type] };
          
          // Adaptabilité : inverser la direction de rotation si le nom contient "Inv", "Rev", "Invert" ou "Opposite"
          // Utile pour les portes qui s'ouvrent dans l'autre sens
          const isInverted = targetName.match(/Inv|Rev|Invert|Opposite/i);
          
          if (isInverted) {
            //  console.log(`[autoGenerate] Inverting rotation for ${targetName}`);
             if (config.openAngle) config.openAngle *= -1;
          }
          
          if (type === 'door' || type === 'window') {
            let objectGroup = obj;
            const pivotGroup = new THREE.Group();
            pivotGroup.name = objectGroup.name + '_pivot';
            
            // Copier les transformations initiales
            pivotGroup.position.copy(objectGroup.position);
            pivotGroup.rotation.copy(objectGroup.rotation);
            pivotGroup.scale.copy(objectGroup.scale);
            
            let originalParent = objectGroup.parent;
            
            if (originalParent) {
              // Calculer les bornes locales pour trouver la charnière
              let minX = Infinity;
              let maxX = -Infinity;
              
              objectGroup.traverse(child => {
                if (child.isMesh && child.geometry) {
                  if (!child.geometry.boundingBox) child.geometry.computeBoundingBox();
                  const bb = child.geometry.boundingBox;
                  if (bb) {
                    // Si l'enfant a une position locale simple (direct child), on l'ajoute
                    // C'est une approximation qui couvre la plupart des cas simples
                    const offset = (child !== objectGroup && child.parent === objectGroup) ? child.position.x : 0;
                    minX = Math.min(minX, bb.min.x + offset);
                    maxX = Math.max(maxX, bb.max.x + offset);
                  }
                }
              });
              
              if (minX === Infinity) minX = -0.5; // Valeur par défaut
              if (maxX === -Infinity) maxX = 0.5;
              
              // Choisir le point de pivot : minX (gauche) par défaut, maxX (droite) si inversé
              // Note: Pour une porte inversée, on veut souvent que la charnière soit de l'autre côté
              const pivotX = isInverted ? maxX : minX;
              
              // Ajouter le pivot au parent
              originalParent.add(pivotGroup);
              
              // Déplacer le pivot à la position de la charnière
              // translateX bouge le pivot le long de son axe X local (qui est aligné avec celui de l'objet)
              pivotGroup.translateX(pivotX * objectGroup.scale.x);
              
              // Déplacer l'objet dans le pivot
              originalParent.remove(objectGroup);
              pivotGroup.add(objectGroup);
              
              // Compenser le déplacement du pivot pour que l'objet reste visuellement en place
              objectGroup.position.set(-pivotX, 0, 0);
              objectGroup.rotation.set(0, 0, 0);
              objectGroup.scale.set(1, 1, 1);
            }
            animationObj = pivotGroup;

            // Ajuster les angles d'animation par rapport à la rotation initiale
            // C'est CRUCIAL pour que la porte ne "saute" pas à une rotation absolue 0 lors du clic
            if (config.axis) {
              const initialRotation = pivotGroup.rotation[config.axis];
              const delta = config.openAngle; // La valeur actuelle est le delta (PI/2 ou -PI/2)
              
              config.closeAngle = initialRotation;
              config.openAngle = initialRotation + delta;
            }
          }
          
          objectStates[targetName] = { 
            object: animationObj, 
            type: type, 
            state: initialMode, 
            particles: null,
            config: config
          };
          
          // Appliquer l'état visuel initial (Rotation ou Couleur)
          if (config.axis) {
             // C'est un objet rotatif (porte/fenêtre)
             const targetAngle = initialMode === 'open' ? config.openAngle : config.closeAngle;
             animationObj.rotation[config.axis] = targetAngle;
          } else if (config.colorOn) {
             // C'est un objet à changement de couleur (radiateur/ventil)
             const targetColor = initialMode === 'on' ? config.colorOn : config.colorOff;
             setObjectColor(animationObj, targetColor);
             
             // Gérer les particules si allumé
             if (initialMode === 'on') {
                 createParticles(animationObj, config);
             }
          }
        }
        
        let animationObj = objectStates[targetName].object;
        const currentState = objectStates[targetName].state;
        
        const severity = type === 'radiator' ? 'warning' : 'info';
        const position = typePositions[type] || { top: '50%', left: '50%' };
        
        // Ajouter un petit offset pour éviter que les points se superposent
        const offsetX = (index % 3 - 1) * 5; // -5%, 0%, 5%
        const offsetY = Math.floor(index / 3) * 5; // 0%, 5%, 10%, etc.
        const finalTop = `calc(${position.top} + ${offsetY}%)`;
        const finalLeft = `calc(${position.left} + ${offsetX}%)`;
        
        const alertPoint = document.createElement('div');
        alertPoint.className = 'alert-point aesthetic-alert';
        alertPoint.setAttribute('data-i18n-key', type);
        alertPoint.setAttribute('data-target-names', targetName);
        alertPoint.setAttribute('data-severity', severity);
        alertPoint.setAttribute('data-state', objectStates[targetName].state);
        alertPoint.setAttribute('data-active', 'true');
        alertPoint.setAttribute('data-auto-generated', 'true');
        
        // Ajouter les attributs d'enseigne et pièce pour la synchronisation avec le tableau
        alertPoint.setAttribute('data-enseigne', currentEnseigneId);
        alertPoint.setAttribute('data-piece', currentPieceId);
        
        // Déterminer la couleur de fond basé sur l'état actuel
        let bgColor = '';
        if (type === 'door' || type === 'window') {
          bgColor = currentState === 'closed' ? 'rgba(220, 20, 60, 0.9)' : 'rgba(34, 139, 34, 0.9)';
        } else if (type === 'ventilation' || type === 'radiator' || type === 'air_purifier') {
          bgColor = currentState === 'off' ? 'rgba(220, 20, 60, 0.9)' : 'rgba(34, 139, 34, 0.9)';
        } else {
          bgColor = 'rgba(220, 20, 60, 0.9)';
        }
        
        alertPoint.textContent = '';
        
        // Créer le tooltip
        const tooltip = document.createElement('div');
        tooltip.className = 'alert-tooltip';
        
        // Pour la ventilation (souvent au plafond), afficher le tooltip en dessous
        if (type === 'ventilation') {
            tooltip.classList.add('tooltip-bottom');
        }
        
        // Récupérer le nom traduit
        const t = (window.i18n && typeof window.i18n.t === 'function') ? window.i18n.t : (k => k);
        const nameKey = `digitalTwin.sample.${type}.subject`;
        // Fallback manuel si i18n n'est pas prêt ou clé manquante
        let translatedName = type;
        if (window.i18n && window.i18n.t) {
            const val = window.i18n.t(nameKey);
            if (val && val !== nameKey) translatedName = val;
            else {
                // Fallback simple
                const map = { 'window': 'Fenêtre', 'door': 'Porte', 'ventilation': 'Ventilation', 'radiator': 'Radiateur', 'air_purifier': 'Purificateur' };
                translatedName = map[type] || type;
            }
        }
        
        // Définir les composants affectés
        const affectedComponents = {
          'window': ['CO₂', 'PM2.5', 'Temp', 'Hum'],
          'door': ['CO₂'],
          'ventilation': ['CO₂', 'PM2.5', 'TVOC', 'Hum'],
          'air_purifier': ['PM2.5', 'TVOC'],
          'radiator': ['Temp', 'Hum']
        };
        
        const components = affectedComponents[type] || [];
        const tagsHTML = components.map(c => `<span class="alert-tooltip-tag">${c}</span>`).join('');
        
        // Determine state label
        const isOpenType = (type === 'door' || type === 'window');
        const stateLabel = isOpenType
          ? (currentState === 'open' ? 'Ouvert' : 'Fermé')
          : (currentState === 'on' ? 'Actif' : 'Inactif');
        const stateClass = `state-${currentState}`;
        
        tooltip.innerHTML = `
          <div class="alert-tooltip-header">
            <span class="alert-tooltip-title">${translatedName}</span>
            <span class="alert-tooltip-state ${stateClass}">
              <span class="alert-tooltip-state-dot"></span>
              ${stateLabel}
            </span>
          </div>
          <div class="alert-tooltip-divider"></div>
          <div class="alert-tooltip-info">${tagsHTML}</div>
        `;
        
        alertPoint.appendChild(tooltip);
        
        alertPoint.style.cssText = `
          position: absolute;
          top: ${finalTop};
          left: ${finalLeft};
          transform: translate(-50%, -50%);
          width: 20px;
          height: 20px;
          border-radius: 50%;
          background: ${bgColor};
          border: 1px solid rgba(255, 255, 255, 0.5);
          box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
          cursor: pointer;
          z-index: 1000;
          display: block;
          transition: transform 0.2s ease;
        `;
        
        alertPoint.setAttribute('data-bg-color', bgColor);
        
        alertPoint.addEventListener('mouseenter', () => {
          alertPoint.style.transform = 'translate(-50%, -50%) scale(1.2)';
        });
        
        alertPoint.addEventListener('mouseleave', () => {
          alertPoint.style.transform = 'translate(-50%, -50%) scale(1)';
        });
        
        // Stocker une référence directe à l'objet Three.js pour le positionnement visuel
        // Pour les portes/fenêtres avec pivot, utiliser l'objet original (obj) pour le positionnement
        alertPoint._threeObject = obj;
        
        // Initialiser data-in-view pour éviter que updateAlertPoints masque le point
        alertPoint.setAttribute('data-in-view', 'true');
        
        // Ajouter l'événement de clic pour animer l'objet
        alertPoint.addEventListener('click', (event) => {
          event.stopPropagation(); // Empêcher la propagation à OrbitControls
          const alertType = alertPoint.getAttribute('data-i18n-key');
          const targetName = alertPoint.getAttribute('data-target-names');
          const stateObj = objectStates[targetName];
          if (stateObj) {
            const config = stateObj.config || objectAnimations[alertType];
            if (!config) return;
            
            const currentState = stateObj.state;
            const newState = currentState === (config.axis ? 'closed' : 'off') ? (config.axis ? 'open' : 'on') : (config.axis ? 'closed' : 'off');
            stateObj.state = newState;
            animateObject(stateObj.object, config, newState);
            
            // Mettre à jour le fond du bouton
            let newBgColor = '';
            if (alertType === 'door' || alertType === 'window') {
              newBgColor = newState === 'closed' ? 'rgba(220, 20, 60, 0.9)' : 'rgba(34, 139, 34, 0.9)';
            } else if (alertType === 'ventilation' || alertType === 'radiator' || alertType === 'air_purifier') {
              newBgColor = newState === 'off' ? 'rgba(220, 20, 60, 0.9)' : 'rgba(34, 139, 34, 0.9)';
            }
            alertPoint.style.background = newBgColor;
            alertPoint.setAttribute('data-bg-color', newBgColor);
            alertPoint.setAttribute('data-state', newState);
            
            // Update tooltip state badge
            const stateBadge = alertPoint.querySelector('.alert-tooltip-state');
            if (stateBadge) {
              stateBadge.className = `alert-tooltip-state state-${newState}`;
              const isOpenType = (alertType === 'door' || alertType === 'window');
              stateBadge.innerHTML = `<span class="alert-tooltip-state-dot"></span>${isOpenType ? (newState === 'open' ? 'Ouvert' : 'Fermé') : (newState === 'on' ? 'Actif' : 'Inactif')}`;
            }
            
            // Sync with Backend Config (this is the single source of truth now)
            updateModuleConfig(currentEnseigneId, currentPieceId, targetName, newState, alertType);
            
            // Rafraîchir le tableau pour mettre à jour les emojis
            if (typeof window.syncAlertPointsToTable === 'function') {
              window.syncAlertPointsToTable();
            }
            
            // NE PAS masquer le point - laisser alerts-engine.js gérer la visibilité
            // Simplement mettre à jour l'état pour que le tableau affiche le bon emoji
          }
        });
        
        alertPointsContainer.appendChild(alertPoint);
        console.log('[autoGenerate] Added alert point:', targetName, 'with data-active:', alertPoint.getAttribute('data-active'), 'severity:', alertPoint.getAttribute('data-severity'), 'enseigne:', alertPoint.getAttribute('data-enseigne'), 'piece:', alertPoint.getAttribute('data-piece'), 'display:', alertPoint.style.display, 'z-index:', alertPoint.style.zIndex);
        
        // Note: Saved state logic removed, replaced by initialMode at creation
      });
    }
  });
  
  const totalPoints = document.querySelectorAll('.alert-point[data-auto-generated="true"]').length;
  
  // Synchroniser le tableau avec les nouveaux alert-points (avec délai pour laisser le DOM se mettre à jour)
  setTimeout(() => {
    if (typeof window.syncAlertPointsToTable === 'function') {
      window.syncAlertPointsToTable();
    }
    
    // Mettre à jour le compteur d'alertes après création
    if (typeof window.updateAlertCountLabel === 'function') {
      window.updateAlertCountLabel();
    }
    
    // Notifier alerts-engine.js que les points sont prêts
    document.dispatchEvent(new CustomEvent('alertPointsReady', {
      detail: { enseigneId: currentEnseigneId, pieceId: currentPieceId }
    }));
  }, 100);
}

function updateAlertPoints() {
  const points = document.querySelectorAll('.alert-point');
  if (!modelRoot || points.length === 0 || !container) return;

  // Attendre au moins 2 secondes après le chargement du modèle avant de masquer les points
  const timeSinceLoad = Date.now() - modelLoadTime;
  if (!modelLoaded || timeSinceLoad < 2000) {
    return;
  }

  points.forEach(el => {
    el.style.position = 'absolute';

    // Utiliser la référence directe à l'objet Three.js si disponible
    let target = el._threeObject;
    
    // Fallback vers la recherche par nom si pas de référence directe
    if (!target) {
      const targetNames = (el.getAttribute('data-target-names') || '').split('|').map(s => s.trim()).filter(Boolean);
      if (targetNames.length === 0) return;
      target = findTargetObjectByNames(modelRoot, targetNames);
    }
    
    if (!target) {
      el.style.display = 'none';
      return;
    }

    const worldPos = new THREE.Vector3();
    target.getWorldPosition(worldPos);

    // Ajuster la position pour certains types d'objets
    const i18nKey = el.getAttribute('data-i18n-key');
    if (i18nKey === 'door' || i18nKey === 'window') {
      // Pour les portes et fenêtres, calculer le centre de la bounding box
      // Cela permet de positionner le point au milieu, quelle que soit la taille
      const bbox = new THREE.Box3().setFromObject(target);
      bbox.getCenter(worldPos);
      
      // Ajustement léger pour placer le point un peu plus haut (au niveau de la poignée)
      // On utilise la hauteur de la porte pour calculer un offset proportionnel
      const size = new THREE.Vector3();
      bbox.getSize(size);
      // Placer le point à environ 45% de la hauteur (position typique d'une poignée)
      worldPos.y = bbox.min.y + (size.y * 0.45);
    } else if (i18nKey === 'ventilation' || i18nKey === 'radiator') {
      // Pour ventilation et radiateur, utiliser le centre de la bounding box
      const bbox = new THREE.Box3().setFromObject(target);
      bbox.getCenter(worldPos);
    }

    // Vérifier si l'objet est dans le frustum de la caméra
    const frustum = new THREE.Frustum();
    const cameraViewProjectionMatrix = new THREE.Matrix4();
    cameraViewProjectionMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(cameraViewProjectionMatrix);
    
    const inFrustum = frustum.containsPoint(worldPos);
    const ndc = worldPos.clone().project(camera);
    
    if (!inFrustum) {
      el.style.display = 'none';
      el.setAttribute('data-in-view', 'false');
      return;
    }
    
    // Double vérification : si les coordonnées NDC sont hors limites, masquer
    if (ndc.x < -1 || ndc.x > 1 || ndc.y < -1 || ndc.y > 1 || ndc.z < 0 || ndc.z > 1) {
      el.style.display = 'none';
      el.setAttribute('data-in-view', 'false');
      return;
    }
    
    // L'objet est visible
    el.setAttribute('data-in-view', 'true');

    const rectW = container.clientWidth || 700;
    const rectH = container.clientHeight || 400;
    
    const x = (ndc.x * 0.5 + 0.5) * rectW;
    const y = (-ndc.y * 0.5 + 0.5) * rectH;

    el.style.left = x + 'px';
    el.style.top = y + 'px';
    el.style.display = 'block';
    el.classList.remove('alert-point-clamped');
  });
  
  // Mettre à jour le compteur d'alertes après repositionnement
  if (typeof window.updateAlertCountLabel === 'function') {
    // Petit délai pour laisser le DOM se mettre à jour
    setTimeout(() => window.updateAlertCountLabel(), 50);
  }
}

// Gestion des déplacements fluides
const keysPressed = {
  ArrowUp: false,
  ArrowDown: false,
  ArrowLeft: false,
  ArrowRight: false,
  z: false,
  q: false,
  s: false,
  d: false,
  Z: false,
  Q: false,
  S: false,
  D: false,
  ' ': false, // Espace
  c: false,
  C: false,
  Control: false
};

let bobbingPhase = 0;
const WALK_SPEED = 2.5; // Vitesse de marche (m/s)
const RUN_SPEED = 4.5; // Vitesse de course
const CROUCH_SPEED = 1.5; // Vitesse accroupi

const BOBBING_SPEED = 10.0;
const BOBBING_AMOUNT = 0.03 ;

// Variables physiques
let verticalVelocity = 0;
let isGrounded = true;
const GRAVITY = 25.0; // m/s^2
const JUMP_FORCE = 6.0; // m/s (Impulse)
const PLAYER_HEIGHT_STANDING = 1.7; // Hauteur des yeux debout
const PLAYER_HEIGHT_CROUCHING = 1.2; // Hauteur des yeux accroupi
let currentPlayerHeight = PLAYER_HEIGHT_STANDING; // Hauteur actuelle (lissée)
let currentBobOffset = 0; // Offset visuel pour le head bobbing

function updateMovement(delta) {
  // Limiter delta pour éviter les mouvements brusques
  delta = Math.min(delta, 0.1);

  // 1. DÉTACHER l'offset visuel (bobbing) pour faire la physique sur la position réelle
  camera.position.y -= currentBobOffset;
  controls.target.y -= currentBobOffset;

  // Vérification de toutes les touches
  const moveForward = keysPressed.ArrowUp || keysPressed.z || keysPressed.Z;
  const moveBackward = keysPressed.ArrowDown || keysPressed.s || keysPressed.S;
  const moveLeft = keysPressed.ArrowLeft || keysPressed.q || keysPressed.Q;
  const moveRight = keysPressed.ArrowRight || keysPressed.d || keysPressed.D;
  const doJump = keysPressed[' '];
  const doCrouch = keysPressed.c || keysPressed.C || keysPressed.Control;

  // Gestion de la hauteur (Accroupi / Debout)
  const targetHeight = doCrouch ? PLAYER_HEIGHT_CROUCHING : PLAYER_HEIGHT_STANDING;
  // Lissage de la transition accroupi (Lerp time-based)
  const heightFactor = Math.min(10.0 * delta, 1.0);
  currentPlayerHeight += (targetHeight - currentPlayerHeight) * heightFactor;

  // Gestion du saut
  if (doJump && isGrounded && !doCrouch) {
    verticalVelocity = JUMP_FORCE;
    isGrounded = false;
  }

  // Application de la gravité
  if (!isGrounded) {
    verticalVelocity -= GRAVITY * delta;
  }
  
  // Test sol simple (On suppose le sol à Y=0 pour l'instant, ou on fait un raycast vers le bas)
  // Pour plus de réalisme, on utilise un Raycast pour trouver le sol exact sous les pieds
  let floorY = 0;
  if (modelRoot) {
    const floorRay = new THREE.Raycaster();
    const rayOrigin = camera.position.clone();
    rayOrigin.y += 2.0; // On part de haut
    floorRay.set(rayOrigin, new THREE.Vector3(0, -1, 0));
    floorRay.far = 10;
    const intersects = floorRay.intersectObject(modelRoot, true);
    // On cherche le mesh le plus haut sous nos pieds qui n'est pas le plafond ni la sphere
    const hit = intersects.find(h => {
        if (!h.object.isMesh || !h.object.visible) return false;
        if (h.object.name === 'EnvironmentSphere') return false;
        
        // CORRECTION IMPORTANTE : Ignorer le toit/plafond pour le calcul du sol
        const name = h.object.name.toLowerCase();
        if (name.includes('roof') || name.includes('toit') || name.includes('ceiling') || name.includes('plafond') || name.includes('combles')) {
            return false;
        }
        
        // Si le point trouvé est TROP HAUT (au dessus de la tête), ce n'est pas un sol valide sur lequel on peut marcher
        // (C'est surement un plafond vu de l'intérieur)
        if (h.point.y > camera.position.y - 0.5) return false;
        
        return true;
    });
    
    if (hit) {
      floorY = hit.point.y;
    }
  }

  // Vérification atterrissage
  // La position Y de la caméra = Sol + Hauteur Joueur + Saut
  // On calcule où on devrait être
  const displacementY = verticalVelocity * delta;
  let newCameraY = camera.position.y + displacementY;
  
  // Si on est en train de toucher le sol (ou passer dessous)
  const targetY = floorY + currentPlayerHeight;

  if (newCameraY <= targetY && verticalVelocity <= 0) {
    // Atterrissage ou marche au sol
    newCameraY = targetY; // On se colle au sol (ou à la hauteur courante accroupi/debout)
    verticalVelocity = 0;
    isGrounded = true;
  } else {
    // En l'air
    isGrounded = false;
  }

  // Appliquer le déplacement vertical (Gravité/Saut + Accroupissement) à la caméra et à la cible
  const deltaY = newCameraY - camera.position.y;
  camera.position.y += deltaY;
  controls.target.y += deltaY;

  // RE-CALCUL DU BOBBING (Sera appliqué à la fin)
  let isMoving = false; // Flag pour savoir si on applique le bobbing

  if (!moveForward && !moveBackward && !moveLeft && !moveRight) {
     // Pas de mouvement clavier
  } else {
    // Obtenir la direction de la caméra
    const forward = new THREE.Vector3();
    camera.getWorldDirection(forward);
    forward.y = 0; // On reste sur le plan horizontal
    forward.normalize();
    
    const right = new THREE.Vector3();
    right.crossVectors(forward, camera.up).normalize();
    
    const moveVector = new THREE.Vector3(0, 0, 0);
    
    if (moveForward) moveVector.add(forward);
    if (moveBackward) moveVector.sub(forward);
    if (moveRight) moveVector.add(right);
    if (moveLeft) moveVector.sub(right);
    
    // Normaliser pour éviter d'aller plus vite en diagonale
    if (moveVector.lengthSq() > 0) {
        // Direction pour le raycast
        const direction = moveVector.clone().normalize();
        
        // Vitesse adaptée (accroupi vs debout)
        const currentSpeed = doCrouch ? CROUCH_SPEED : WALK_SPEED;
        moveVector.normalize().multiplyScalar(currentSpeed * delta);
        
        // Détection de collision AMÉLIORÉE (3 rayons : Centre, Gauche, Droite)
        let blocked = false;
        if (modelRoot) {
            const raycaster = new THREE.Raycaster();
            const p = camera.position.clone();
            // On abaisse un peu le point de départ du rayon (taille/hanche) pour mieux détecter les meubles
            p.y -= 0.5; 
            
            raycaster.far = 0.5; // Distance de collision proche (50cm)

            // 1. Rayon Central
            raycaster.set(p, direction);
            let intersects = raycaster.intersectObject(modelRoot, true);
            if (intersects.some(hit => hit.object.isMesh && hit.object.visible && hit.distance < 0.5)) {
                blocked = true;
            }

            // 2. Rayon Gauche (épaule gauche)
            if (!blocked) {
              const leftDir = direction.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 4);
              raycaster.set(p, leftDir);
              intersects = raycaster.intersectObject(modelRoot, true);
              if (intersects.some(hit => hit.object.isMesh && hit.object.visible && hit.distance < 0.5)) {
                  blocked = true;
              }
            }

            // 3. Rayon Droite (épaule droite)
            if (!blocked) {
              const rightDir = direction.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), -Math.PI / 4);
              raycaster.set(p, rightDir);
              intersects = raycaster.intersectObject(modelRoot, true);
              if (intersects.some(hit => hit.object.isMesh && hit.object.visible && hit.distance < 0.5)) {
                  blocked = true;
              }
            }
        }
        
        if (!blocked) {
            camera.position.add(moveVector);
            controls.target.add(moveVector);
            isMoving = true;
        }
    }
  }

  // 2. Update du Bobbing Phase et calcul du nouvel offset
  if (isGrounded && isMoving) {
      bobbingPhase += BOBBING_SPEED * delta;
      currentBobOffset = Math.sin(bobbingPhase) * BOBBING_AMOUNT;
  } else {
      // Retour doux à 0 si on s'arrête
      if (Math.abs(currentBobOffset) > 0.001) {
          currentBobOffset *= 0.8; // Decay rapide
      } else {
          currentBobOffset = 0;
          if (!isMoving) bobbingPhase = 0; // Reset phase quand totalement arrêté
      }
  }

  // 3. RÉ-APPLIQUER le Bobbing sur la position "physique" finale
  camera.position.y += currentBobOffset;
  controls.target.y += currentBobOffset;
}

// Fonction de collision universelle (empêche de traverser en tournant ou reculant)
function enforceWallCollision() {
    if (!modelRoot) return;

    // Stratégie améliorée : on crée une "colonne" de collision sous la caméra
    // On vérifie plusieurs hauteurs relatives à la caméra pour être sûr de toucher
    // à la fois les meubles bas (lits) et les murs/fenêtres, quel que soit l'angle de vue.
    
    // Offsets négatifs = sous la caméra.
    // Si la caméra est à ~1.7m (hauteur yeux), on teste :
    // - 0.5m dessous (niv 1.2m -> Torse / Fenêtre)
    // - 1.0m dessous (niv 0.7m -> Table / Hanches)
    // - 1.5m dessous (niv 0.2m -> Lit bas / Tibias)
    const heightOffsets = [0.5, 1.0, 1.5]; 
    
    const minDistance = 0.5; // Rayon du corps (50cm)

    // 16 Rayons autour (tous les 22.5°) pour ne pas avoir d'angle mort
    const rayCount = 16;
    const allRays = [];
    for (let i = 0; i < rayCount; i++) {
        const angle = (i / rayCount) * Math.PI * 2;
        allRays.push(new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle)));
    }

    const collisionRay = new THREE.Raycaster();
    
    // Construire la liste des objets à vérifier (Modèle + Murs invisibles)
    const objectsToCheck = [modelRoot, ...invisibleWalls];

    for (const offset of heightOffsets) {
        // Point de départ du rayon
        const p = camera.position.clone();
        p.y -= offset; 

        // Sécurité : on ne teste pas sous le sol (Y < 0.1)
        if (p.y < 0.1) continue;

        for (const dir of allRays) {
            collisionRay.set(p, dir);
            collisionRay.far = minDistance;
            
            // Vérifier les collisions sur TOUS les objets
            const intersects = collisionRay.intersectObjects(objectsToCheck, true);
            
            // On ne percute que les objets visibles (Mesh)
            // On ignore la sphère d'environnement
            const hit = intersects.find(h => {
                 return h.object.isMesh && h.object.visible && h.object.name !== 'EnvironmentSphere';
            });
            
            if (hit) {
                // Répulsion immédiate
                const pushDist = minDistance - hit.distance;
                
                // On repousse horizontalement uniquement (sur X et Z)
                // pour ne pas faire sauter la caméra
                const pushVec = dir.clone().negate().multiplyScalar(pushDist);
                pushVec.y = 0; 
                
                camera.position.add(pushVec);
                controls.target.add(pushVec);
            }
        }
    }
}

function preventCameraClipping() {
  if (!modelRoot) return;

  // Raycast depuis la cible (target) vers la caméra
  const dir = new THREE.Vector3().subVectors(camera.position, controls.target);
  const dist = dir.length();
  
  if (dist < 0.1) return; // Trop proche pour vérifier
  
  dir.normalize();

  const raycaster = new THREE.Raycaster();
  raycaster.set(controls.target, dir);
  raycaster.far = dist; // Vérifier seulement jusqu'à la caméra

  // Vérifier contre TOUS les objets : Modèle + Murs invisibles
  const objectsToCheck = [modelRoot, ...invisibleWalls];
  const intersects = raycaster.intersectObjects(objectsToCheck, true);
  
  // Trouver le premier obstacle visible (mur, meuble...) OU un mur invisible
  const hit = intersects.find(h => {
      // Les murs invisibles ont opacity: 0 mais visible: true, donc ils passent le test visible
      // On s'assure juste que c'est bien un Mesh
      return h.object.isMesh && h.object.visible;
  });

  if (hit) {
      // Si on rencontre un obstacle, on place la caméra juste devant
      const buffer = 0.2; // 20cm de marge
      
      // On ne rapproche pas la caméra si l'obstacle est très très proche de la cible
      if (hit.distance > buffer) {
          camera.position.copy(controls.target).addScaledVector(dir, hit.distance - buffer);
      }
  }
}

// Animation loop
const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);
  const delta = clock.getDelta();
  updateMovement(delta); // Appliquer les mouvements fluides avec delta time
  controls.update();
  enforceWallCollision(); // NOUVEAU: Empêche de rester coincé dans un mur après rotation
  preventCameraClipping(); // Empêcher la caméra de traverser les murs en reculant/zoomant
  updateAlertPoints();
  updateParticles();

  renderer.render(scene, camera);
}

// Variable pour éviter de masquer les points trop tôt
let modelLoaded = false;
let modelLoadTime = 0;

// Resize
window.addEventListener('resize', () => {
  // Use container dimensions, but fallback to reasonable defaults if 0
  const w = (container && container.clientWidth) || 100;
  const h = (container && container.clientHeight) || 100;
  
  // Don't update if size is zero (hidden/minimized)
  if (w === 0 || h === 0) return;

  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
});

// Observer pour détecter les changements de taille du conteneur (plus fiable pour les layout flex)
if (container) {
  const resizeObserver = new ResizeObserver(entries => {
    for (let entry of entries) {
      if (!entry.contentRect) continue;
      const w = entry.contentRect.width;
      const h = entry.contentRect.height;
      if (w > 0 && h > 0) {
        // Debounce small changes if needed, but direct update is usually fine
        requestAnimationFrame(() => {
            camera.aspect = w / h;
            camera.updateProjectionMatrix();
            renderer.setSize(w, h);
        });
      }
    }
  });
  resizeObserver.observe(container);
}

// Raccourci clavier pour centrer le modèle (F) et gestion des touches
window.addEventListener('keydown', (e) => {
  if (e.key === 'f' && modelRoot) {
    frameModel(modelRoot, 1.1);
  }

  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'z', 'q', 's', 'd', 'Z', 'Q', 'S', 'D', ' ', 'c', 'C', 'Control'].includes(e.key)) {
      // Pour les flèches et espace, on empêche le scroll
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key)) {
        e.preventDefault(); 
      }
      keysPressed[e.key] = true;
  }
});

// CORRECTION BUG SHIFT/TOUCHE BLOQUEE : 
// Si on appuie sur Z puis Shift puis relâche Z, parfois l'événement keyup de Z n'est pas détecté correctement
// ou la touche reste "active". 
// On modifie le keyup pour être plus robuste et gérer les majuscules/minuscules indifféremment.

window.addEventListener('keyup', (e) => {
  const k = e.key;
  // On désactive à la fois la version minuscule et majuscule pour être sûr
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(k)) {
      keysPressed[k] = false;
  }
  
  if (k.toLowerCase() === 'z') { keysPressed['z'] = false; keysPressed['Z'] = false; }
  if (k.toLowerCase() === 'q') { keysPressed['q'] = false; keysPressed['Q'] = false; }
  if (k.toLowerCase() === 's') { keysPressed['s'] = false; keysPressed['S'] = false; }
  if (k.toLowerCase() === 'd') { keysPressed['d'] = false; keysPressed['D'] = false; }
  if (k.toLowerCase() === 'c') { keysPressed['c'] = false; keysPressed['C'] = false; }
  if (k === 'Control') keysPressed['Control'] = false;
});

// Bouton pour centrer le modèle
const frameBtn = document.getElementById('frame-btn');
if (frameBtn) {
  frameBtn.addEventListener('click', () => {
    if (modelRoot) frameModel(modelRoot, 1.1);
  });
}

// Exporter vers le scope global pour usage par d'autres scripts
window.loadPieceModel = loadPieceModel;
window.frameModel = frameModel;

// Initialisation des contrôles tactiles pour mobile
function initMobileControls() {
    const controls = {
        'ctrl-fwd': ['z', 'Z', 'ArrowUp'],
        'ctrl-back': ['s', 'S', 'ArrowDown'],
        'ctrl-left': ['q', 'Q', 'ArrowLeft'],
        'ctrl-right': ['d', 'D', 'ArrowRight'],
        'ctrl-jump': [' '], // Espace
        'ctrl-crouch': ['c', 'C', 'Control']
    };
    
    // Gestion du toggle des contrôles
    const toggleBtn = document.getElementById('toggle-controls-btn');
    const controlsZone = document.getElementById('mobile-joystick-zone');
    
    if (toggleBtn && controlsZone) {
        toggleBtn.addEventListener('click', () => {
             controlsZone.classList.toggle('collapsed');
             // Optionnel: changer l'icône ou l'opacité
             if (controlsZone.classList.contains('collapsed')) {
                 toggleBtn.style.opacity = '1'; // Ensure visible
                 toggleBtn.classList.add('collapsed-indicator');
             } else {
                 toggleBtn.classList.remove('collapsed-indicator');
             }
        });

         // Initial state: Hidden (collapsed)
         controlsZone.classList.add('collapsed');
         toggleBtn.classList.add('collapsed-indicator');
    }

    Object.entries(controls).forEach(([id, keys]) => {
        const btn = document.getElementById(id);
        if (btn) {
            const start = (e) => {
                // IMPORTANT: preventDefault on touchstart avoids mouse emulation events
                // but we also need it to prevent scrolling if the user misses the button slightly
                // or drags. 
                // e.preventDefault(); // Moved to event listener options or specific handler
                
                btn.classList.add('active');
                keys.forEach(k => { if(keysPressed.hasOwnProperty(k) || true) keysPressed[k] = true; });
            };
            
            const end = (e) => {
                // e.preventDefault();
                btn.classList.remove('active');
                keys.forEach(k => { if(keysPressed.hasOwnProperty(k) || true) keysPressed[k] = false; });
            };
            
            // Mouse events for testing on desktop
            btn.addEventListener('mousedown', start);
            btn.addEventListener('mouseup', end);
            btn.addEventListener('mouseleave', end);
            
            // Touch events
            btn.addEventListener('touchstart', (e) => { 
                e.preventDefault(); // Prevent scroll/zoom
                start(e); 
            }, {passive: false});
            
            btn.addEventListener('touchend', (e) => { 
                e.preventDefault(); 
                end(e); 
            });
            
            btn.addEventListener('touchcancel', (e) => { 
                e.preventDefault(); 
                end(e); 
            });
        }
    });
}

// Initialiser les contrôles une fois le script chargé ou DOM prêt
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initMobileControls);
} else {
    initMobileControls();
}
