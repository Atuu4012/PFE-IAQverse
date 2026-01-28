import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

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
  if (!container.style.width) container.style.width = '700px';
  if (!container.style.height) container.style.height = '400px';
}

const width = (container && container.clientWidth) || 700;
const height = (container && container.clientHeight) || 400;

// Renderer with fallback configuration
const renderer = new THREE.WebGLRenderer({ 
  alpha: true, 
  antialias: true,
  precision: 'mediump', // Use medium precision to avoid shader compilation issues
  powerPreference: 'high-performance',
  failIfMajorPerformanceCaveat: false
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2)); // Limit pixel ratio
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
scene.add(dirLight);

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
    
    // Éviter de recharger si c'est la même image
    if (path === currentEnvironmentPath && environmentSphere) return;
    currentEnvironmentPath = path;

    textureLoader.load(
      path, 
      (texture) => {
        // Configuration de l'espace colorimétrique pour un rendu correct
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.mapping = THREE.EquirectangularReflectionMapping;

        // Si la sphère existe déjà, on met à jour la texture
        if (environmentSphere) {
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

// Fonctions pour gérer la persistance de l'état des objets
function saveObjectStates(enseigneId, pieceId) {
  if (!enseigneId || !pieceId) return;
  
  const statesData = {};
  Object.entries(objectStates).forEach(([name, stateObj]) => {
    statesData[name] = {
      type: stateObj.type,
      state: stateObj.state
    };
  });
  
  const storageKey = `objectStates_${enseigneId}_${pieceId}`;
  sessionStorage.setItem(storageKey, JSON.stringify(statesData));
}

function loadObjectStates(enseigneId, pieceId) {
  if (!enseigneId || !pieceId) return {};
  
  const storageKey = `objectStates_${enseigneId}_${pieceId}`;
  console.log('[loadObjectStates] Loading from key:', storageKey);
  const saved = sessionStorage.getItem(storageKey);
  return saved ? JSON.parse(saved) : {};
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
  
  const isTarget = isRadiator || isAC;

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


function createParticles(obj, config) {
  if (activeParticles[obj.uuid]) {
    // Si le système existe déjà, juste remettre emitting à true
    activeParticles[obj.uuid].emitting = true;
    return;
  }

  const maxCount = config.particleCount;
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(maxCount * 3);
  const colors = new Float32Array(maxCount * 3);

  // initialiser à des positions hors vue
  for (let i = 0; i < maxCount; i++) {
    positions[i * 3] = 0;
    positions[i * 3 + 1] = -100; // hors vue
    positions[i * 3 + 2] = 0;
    const color = new THREE.Color(config.particleColor);
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }

  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  const material = new THREE.PointsMaterial({ size: 0.05, vertexColors: true, transparent: true });
  const points = new THREE.Points(geometry, material);
  scene.add(points);

  activeParticles[obj.uuid] = {
    points,
    positions,
    colors,
    velocities: new Float32Array(maxCount * 3),
    lifetimes: new Float32Array(maxCount),
    maxCount,
    emitting: true,
    obj,
    config,
    nextIndex: 0
  };
}

function stopParticles(obj) {
  if (activeParticles[obj.uuid]) {
    activeParticles[obj.uuid].emitting = false;
    // attendre que toutes les particules meurent
  }
}

function updateParticles() {
  for (const uuid in activeParticles) {
    const system = activeParticles[uuid];
    
    // --- CALCUL DE LA MATRICE "FERMÉE" POUR LES PORTES/FENÊTRES ---
    // Si la porte est ouverte, elle a tourné. Mais le courant d'air vient du "trou", qui est fixe.
    // On calcule temporairement la matrice qu'aurait l'objet s'il était fermé.
    let emissionMatrix = system.obj.matrixWorld;
    let emissionQuaternion = system.obj.quaternion;
    let isDraft = (system.config.particleType === 'draft');
    
    // Optim : ne faire ce calcul coûteux que pour le type 'draft'
    if (isDraft && system.config.axis) {
        const storedRot = system.obj.rotation[system.config.axis];
        const closedAngle = system.config.closeAngle || 0;
        
        // Si la rotation actuelle est significativement différente de l'angle fermé
        if (Math.abs(storedRot - closedAngle) > 0.01) {
            // On force temporairement la rotation "fermée"
            system.obj.rotation[system.config.axis] = closedAngle;
            system.obj.updateMatrixWorld();
            
            // On capture la matrice et le quaternion du "trou"
            emissionMatrix = system.obj.matrixWorld.clone();
            emissionQuaternion = system.obj.quaternion.clone();
            
            // On restaure l'état visuel réel
            system.obj.rotation[system.config.axis] = storedRot;
            system.obj.updateMatrixWorld();
        }
    }

    const objPos = new THREE.Vector3();
    objPos.setFromMatrixPosition(emissionMatrix); 

    // Émettre de nouvelles particules si emitting
    if (system.emitting) {
      for (let i = 0; i < 2; i++) { // émettre 2 par frame
        const idx = system.nextIndex;
        
        // GESTION DIFFÉRENTE SELON LE TYPE (Courant d'air vs Vapeur/Fumée)
        if (system.config.particleType === 'draft') {
            // == COURANT D'AIR (Portes / Fenêtres) == 
            // 1. Trouver le mesh le plus grand (le panneau de la porte) pour éviter de spawner sur la poignée/seuil
            let targetMesh = null;
            let maxVolume = -1;

            if (system.obj.isMesh) {
                targetMesh = system.obj;
            } else {
                 // On parcourt tout pour trouver le panneau principal (celui avec le plus grand volume/aire)
                 // pour éviter les petites pièces comme les poignées ou les barres de seuil
                 system.obj.traverse(c => {
                   if (c.isMesh && c.geometry) {
                       if (!c.geometry.boundingBox) c.geometry.computeBoundingBox();
                       const bb = c.geometry.boundingBox;
                       const sz = new THREE.Vector3();
                       bb.getSize(sz);
                       // Volume approximatif (avec biais pour objets plats)
                       const metric = (sz.x + 0.1) * (sz.y + 0.1) * (sz.z + 0.1); 
                       if (metric > maxVolume) {
                           maxVolume = metric;
                           targetMesh = c;
                       }
                   }
                });
            }
            
            // Fallback
            if (!targetMesh && system.obj.children.length > 0) targetMesh = system.obj.children[0];

            if (targetMesh && targetMesh.geometry) {
                 if (!targetMesh.geometry.boundingBox) targetMesh.geometry.computeBoundingBox();
                 const bb = targetMesh.geometry.boundingBox;
                 
                 // 2. Choisir un point aléatoire DANS le volume du Bounding Box
                 // DÉCALAGE pour centrer parfaitement visuellement
                 let shiftX = 0;
                 const name = system.obj.name ? system.obj.name.toLowerCase() : '';
                 
                 if (name.includes('door')) {
                     shiftX = -0.4; // Gauche pour les portes
                 } else if (name.includes('window')) {
                     shiftX = 0.4;  // Droite pour les fenêtres
                 }

                 const localPoint = new THREE.Vector3(
                    bb.min.x + Math.random() * (bb.max.x - bb.min.x) + shiftX,
                    bb.min.y + Math.random() * (bb.max.y - bb.min.y),
                    bb.min.z + Math.random() * (bb.max.z - bb.min.z)
                 );
                 
                 // 3. Convertir ce point en coordonnées Monde EN UTILISANT LA MATRICE FERMÉE
                 // PRÉALABLE: Convertir du Mesh Space -> Pivot Space (System Obj Space)
                 // car le Mesh peut être décalé dans le pivot (ex: charnière)
                 
                 // Matrice: [TargetMesh Local] -> [SystemObj Local aka Pivot]
                 // R = inv(SystemObjWorld) * TargetMeshWorld
                 const relativeMatrix = new THREE.Matrix4().copy(system.obj.matrixWorld).invert().multiply(targetMesh.matrixWorld);
                 
                 // Appliquer transformation locale
                 localPoint.applyMatrix4(relativeMatrix);
                 
                 // Appliquer transformation monde (fermée)
                 const worldPoint = localPoint.applyMatrix4(emissionMatrix);
                 
                 system.positions[idx * 3] = worldPoint.x;
                 system.positions[idx * 3 + 1] = worldPoint.y;
                 system.positions[idx * 3 + 2] = worldPoint.z;
            } else {
                 system.positions[idx * 3] = objPos.x;
                 system.positions[idx * 3 + 1] = objPos.y + 1.0;
                 system.positions[idx * 3 + 2] = objPos.z;
            }

            // Vitesse : Toujours perpendiculaire à la porte/fenêtre (EN MODE FERMÉ)
            // MODIFICATION: Les portes ont souvent un axe différent (ex: Y au lieu de Z)
            let axis = new THREE.Vector3(0, 0, 1);
            if (system.obj.name && system.obj.name.toLowerCase().includes('door')) {
                 axis.set(0, 1, 0); // Axe Y pour les portes (souvent orientées différemment)
            }
            
            // On utilise le quaternion FERMÉ pour la direction
            const windDir = axis.applyQuaternion(emissionQuaternion).normalize();
            
            // Vitesse DOUCE
            const speed = 0.01 + Math.random() * 0.03; 
            
            system.velocities[idx * 3] = windDir.x * speed;
            system.velocities[idx * 3 + 1] = windDir.y * speed + (Math.random() * 0.005);
            system.velocities[idx * 3 + 2] = windDir.z * speed;
            
            system.lifetimes[idx] = Math.random() * 60 + 40;

        } else {
            // == FUMÉE / VAPEUR STANDARD (Radiateur / Clim) ==
            // Émission depuis le centre de l'objet (plus classique)
            
            system.positions[idx * 3] = objPos.x + (Math.random() - 0.5) * 0.5;
            system.positions[idx * 3 + 1] = objPos.y + Math.random() * 0.5;
            system.positions[idx * 3 + 2] = objPos.z + (Math.random() - 0.5) * 0.5;

            system.velocities[idx * 3] = (Math.random() - 0.5) * 0.01;
            system.velocities[idx * 3 + 1] = Math.random() * 0.02 + 0.01; // Monte doucement
            system.velocities[idx * 3 + 2] = (Math.random() - 0.5) * 0.01;

            system.lifetimes[idx] = Math.random() * 200 + 100; // Vie longue (lent)
        }

        system.nextIndex = (system.nextIndex + 1) % system.maxCount;
      }
    }

    // Mettre à jour les particules existantes
    let activeCount = 0;
    for (let i = 0; i < system.maxCount; i++) {
      if (system.lifetimes[i] > 0) {
        activeCount++;
        system.positions[i * 3] += system.velocities[i * 3];
        system.positions[i * 3 + 1] += system.velocities[i * 3 + 1];
        system.positions[i * 3 + 2] += system.velocities[i * 3 + 2];
        system.lifetimes[i]--;

        // Garder la couleur originale, ne pas fade to gray
        // Les particules disparaissent naturellement en montant
      } else {
        // cacher
        system.positions[i * 3 + 1] = -100;
      }
    }

    system.points.geometry.attributes.position.needsUpdate = true;
    system.points.geometry.attributes.color.needsUpdate = true;

    // Si plus emitting et plus de particules actives, supprimer
    if (!system.emitting && activeCount === 0) {
      scene.remove(system.points);
      system.points.geometry.dispose();
      system.points.material.dispose();
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
    if (obj.geometry) obj.geometry.dispose();
    if (obj.material) {
      if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose());
      else obj.material.dispose();
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
      if (system.points) {
        scene.remove(system.points);
        system.points.geometry.dispose();
        system.points.material.dispose();
      }
    });
    activeParticles = {};

    isLoading = true;
    
    // Afficher le loader
    const loaderElement = document.getElementById('model-loader');
    if (loaderElement) {
      loaderElement.classList.remove('hidden');
      loaderElement.style.display = 'flex';
    }

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
                      const safeMat = mat.clone();

                      // Ensure basic properties are set
                      if (!safeMat.color) {
                        safeMat.color = new THREE.Color(0xcccccc);
                      }
                      if (safeMat.transparent === undefined) {
                        safeMat.transparent = false;
                      }
                      if (safeMat.side === undefined) {
                        safeMat.side = THREE.FrontSide;
                      }

                      newMaterials.push(safeMat);
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

                  // Create material with preserved textures
                  const newMat = new THREE.MeshStandardMaterial({
                    color: color,
                    map: map,
                    normalMap: normalMap,
                    roughnessMap: roughnessMap,
                    metalnessMap: metalnessMap,
                    aoMap: aoMap,
                    emissiveMap: emissiveMap,
                    roughness: map ? 0.8 : 0.7, // Slightly rougher if no texture
                    metalness: 0.0,
                    side: THREE.DoubleSide
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
        
        scene.add(modelRoot);
        frameModel(modelRoot, 1.1);
        
        // Marquer que le modèle est chargé
        modelLoaded = true;
        modelLoadTime = Date.now();
        
        // Générer automatiquement les alert-points pour les objets numérotés
        autoGenerateAlertPoints(modelRoot);
        
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
  
  // Charger les états sauvegardés pour cette pièce
  const savedStates = loadObjectStates(currentEnseigneId, currentPieceId);
  console.log('[autoGenerate] Loaded saved states:', savedStates);
  
  // Patterns à rechercher dans les noms d'objets (ajustés selon les vrais noms du GLB)
  const patterns = {
    // Regex plus souples qui excluent explicitement les sous-parties (poignées, cadres)
    // Cela permet des noms comme "Door_Cuisine_Inv", "Door.001", etc.
    'window': /^Window(?!.*(?:Handle|Frame|Vitre|Glass|Poignee|Cadre)).*$/i,
    'door': /^Door(?!.*(?:Handle|Frame|Cadre|Poignee)).*$/i,
    'ventilation': /Clim/i, // Cherche "Clim" n'importe où dans le nom
    'radiator': /^Radiator(?!.*(?:Valve|Tuyau)).*$/i
  };
  
  // Collecter tous les noms d'objets pour debug
  const allObjectNames = [];
  modelRoot.traverse(obj => {
    if (obj.name) {
      allObjectNames.push(obj.name);
    }
  });
  console.log('[autoGenerate] === TOUS LES OBJETS DU MODÈLE ===');
  console.log('[autoGenerate] Nombre total d\'objets:', allObjectNames.length);
  console.log('[autoGenerate] Noms:', allObjectNames.join(', '));
  
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
            console.log(`[autoGenerate] ✓ Objet trouvé - Type: ${type}, Nom: "${obj.name}", isChild: ${isChild}`);
            foundObjects[type].push(obj); // Stocker l'objet Three.js complet
            
            // Définir la couleur par défaut à rouge pour ventilation et radiator
            if (type === 'ventilation' || type === 'radiator') {
              setObjectColor(obj, 0xff0000); // rouge
            }
          } else {
            console.log(`[autoGenerate] ✗ Objet ignoré (enfant) - Type: ${type}, Nom: "${obj.name}"`);
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
          
          // Créer une configuration spécifique pour cet objet
          // Cela permet d'adapter l'animation (direction, axe) par objet
          const config = { ...objectAnimations[type] };
          
          // Adaptabilité : inverser la direction de rotation si le nom contient "Inv", "Rev", "Invert" ou "Opposite"
          // Utile pour les portes qui s'ouvrent dans l'autre sens
          const isInverted = targetName.match(/Inv|Rev|Invert|Opposite/i);
          
          if (isInverted) {
             console.log(`[autoGenerate] Inverting rotation for ${targetName}`);
             if (config.openAngle) config.openAngle *= -1;
          } else {
             console.log(`[autoGenerate] Standard rotation for ${targetName}`);
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
              
              console.log(`[autoGenerate] Adjusted animation for ${targetName}: start=${initialRotation.toFixed(2)}, end=${config.openAngle.toFixed(2)}`);
            }
          }
          
          objectStates[targetName] = { 
            object: animationObj, 
            type: type, 
            state: type === 'door' || type === 'window' ? 'closed' : 'off', 
            particles: null,
            config: config
          };
          
          // Charger l'état sauvegardé depuis sessionStorage
          if (savedStates[targetName]) {
            objectStates[targetName].state = savedStates[targetName].state;
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
        } else if (type === 'ventilation' || type === 'radiator') {
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
                const map = { 'window': 'Fenêtre', 'door': 'Porte', 'ventilation': 'Ventilation', 'radiator': 'Radiateur' };
                translatedName = map[type] || type;
            }
        }
        
        // Définir les composants affectés
        const affectedComponents = {
          'window': ['CO₂', 'PM2.5', 'Temp', 'Hum'],
          'door': ['CO₂'],
          'ventilation': ['CO₂', 'PM2.5', 'TVOC', 'Hum'],
          'radiator': ['Temp', 'Hum']
        };
        
        const components = affectedComponents[type] || [];
        const componentsText = components.join(', ');
        
        tooltip.innerHTML = `
          <span class="alert-tooltip-title">${translatedName}</span>
          <span class="alert-tooltip-info">${componentsText}</span>
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
            } else if (alertType === 'ventilation' || alertType === 'radiator') {
              newBgColor = newState === 'off' ? 'rgba(220, 20, 60, 0.9)' : 'rgba(34, 139, 34, 0.9)';
            }
            alertPoint.style.background = newBgColor;
            alertPoint.setAttribute('data-bg-color', newBgColor);
            alertPoint.setAttribute('data-state', newState);
            
            // Sauvegarder l'état dans sessionStorage
            saveObjectStates(currentEnseigneId, currentPieceId);
            
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
        
        // Appliquer visuellement l'état restauré
        if (savedStates[targetName]) {
          const config = objectStates[targetName].config || objectAnimations[type];
          if (config) {
            // Appliquer immédiatement l'état sans animation
            if (config.axis) {
              // Pour portes et fenêtres : rotation
              const targetRotation = currentState === 'open' ? config.openAngle : config.closeAngle;
              animationObj.rotation[config.axis] = targetRotation;
            } else if (config.colorOn) {
              // Pour ventilation et radiateur : couleur et particules
              const targetColor = currentState === 'on' ? config.colorOn : config.colorOff;
              setObjectColor(objectStates[targetName].object, targetColor);
            }

            // Gestion des particules (pour tout le monde : clim, radiateur, porte, fenetre)
            if ((currentState === 'on' || currentState === 'open') && config.particleColor) {
               createParticles(objectStates[targetName].object, config);
            }
          }
        }
      });
    }
  });
  
  const totalPoints = document.querySelectorAll('.alert-point[data-auto-generated="true"]').length;
  console.log('[autoGenerate] Total alert points created:', totalPoints);
  console.log('[autoGenerate] Created alert points, now syncing table');
  
  // Synchroniser le tableau avec les nouveaux alert-points (avec délai pour laisser le DOM se mettre à jour)
  setTimeout(() => {
    if (typeof window.syncAlertPointsToTable === 'function') {
      console.log('[autoGenerate] Calling syncAlertPointsToTable');
      window.syncAlertPointsToTable();
    } else {
      console.error('[autoGenerate] syncAlertPointsToTable not found');
    }
    
    // Mettre à jour le compteur d'alertes après création
    if (typeof window.updateAlertCountLabel === 'function') {
      window.updateAlertCountLabel();
    } else {
      console.error('[three-scene] updateAlertCountLabel function not found on window');
    }
    
    // Notifier alerts-engine.js que les points sont prêts
    console.log('[autoGenerate] Emitting alertPointsReady event');
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
    // console.log(`[updateAlertPoints] Waiting for model to stabilize (${timeSinceLoad}ms elapsed)`);
    return;
  }

  // console.log('[updateAlertPoints] Mise à jour de', points.length, 'points');

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
      // console.log('[updateAlertPoints] Objet non trouvé pour', el.getAttribute('data-target-names'));
      el.style.display = 'none';
      return;
    }

    const worldPos = new THREE.Vector3();
    target.getWorldPosition(worldPos);

    // Ajuster la position pour certains types d'objets
    const i18nKey = el.getAttribute('data-i18n-key');
    if (i18nKey === 'door') {
      // Remonter le point de la porte d'environ 1.0 unités dans l'espace 3D
      worldPos.y += 1.0;
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
    
    /*
    console.log(`[updateAlertPoints] ${el.getAttribute('data-i18n-key')} (${target.name}):`, {
      worldPos: { x: worldPos.x.toFixed(2), y: worldPos.y.toFixed(2), z: worldPos.z.toFixed(2) },
      ndc: { x: ndc.x.toFixed(2), y: ndc.y.toFixed(2), z: ndc.z.toFixed(2) },
      inFrustum,
      cameraPos: { x: camera.position.x.toFixed(2), y: camera.position.y.toFixed(2), z: camera.position.z.toFixed(2) }
    });
    */
    
    if (!inFrustum) {
      // console.log(`[updateAlertPoints] ${target.name} hors frustum, masqué`);
      el.style.display = 'none';
      el.setAttribute('data-in-view', 'false');
      return;
    }
    
    // Double vérification : si les coordonnées NDC sont hors limites, masquer
    if (ndc.x < -1 || ndc.x > 1 || ndc.y < -1 || ndc.y > 1 || ndc.z < 0 || ndc.z > 1) {
      // console.log(`[updateAlertPoints] ${target.name} NDC hors limites, masqué`);
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

    // console.log(`[updateAlertPoints] ${target.name} visible à (${x.toFixed(0)}, ${y.toFixed(0)})`);

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
const WALK_SPEED = 0.04; // Vitesse de marche normale
const RUN_SPEED = 0.07; // Vitesse courir
const CROUCH_SPEED = 0.02; // Vitesse accroupi

const BOBBING_SPEED = 0.15;
const BOBBING_AMOUNT = 0.015;

// Variables physiques
let verticalVelocity = 0;
let isGrounded = true;
const GRAVITY = 0.008;
const JUMP_FORCE = 0.15;
const PLAYER_HEIGHT_STANDING = 1.7; // Hauteur des yeux debout
const PLAYER_HEIGHT_CROUCHING = 1.0; // Hauteur des yeux accroupi
let currentPlayerHeight = PLAYER_HEIGHT_STANDING; // Hauteur actuelle (lissée)

function updateMovement() {
  // Vérification de toutes les touches
  const moveForward = keysPressed.ArrowUp || keysPressed.z || keysPressed.Z;
  const moveBackward = keysPressed.ArrowDown || keysPressed.s || keysPressed.S;
  const moveLeft = keysPressed.ArrowLeft || keysPressed.q || keysPressed.Q;
  const moveRight = keysPressed.ArrowRight || keysPressed.d || keysPressed.D;
  const doJump = keysPressed[' '];
  const doCrouch = keysPressed.c || keysPressed.C || keysPressed.Control;

  // Gestion de la hauteur (Accroupi / Debout)
  const targetHeight = doCrouch ? PLAYER_HEIGHT_CROUCHING : PLAYER_HEIGHT_STANDING;
  // Lissage de la transition accroupi (Lerp)
  currentPlayerHeight += (targetHeight - currentPlayerHeight) * 0.15;

  // Gestion du saut
  if (doJump && isGrounded && !doCrouch) {
    verticalVelocity = JUMP_FORCE;
    isGrounded = false;
  }

  // Application de la gravité
  if (!isGrounded) {
    verticalVelocity -= GRAVITY;
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
  let newCameraY = camera.position.y + verticalVelocity;
  
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

  
  if (!moveForward && !moveBackward && !moveLeft && !moveRight) {
    return;
  }

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
      moveVector.normalize().multiplyScalar(currentSpeed);
      
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
          
          // Effet de marche (Head Bobbing) - Désactivé si en l'air
          if (isGrounded) {
             const oldBob = Math.sin(bobbingPhase) * BOBBING_AMOUNT;
             bobbingPhase += BOBBING_SPEED;
             const newBob = Math.sin(bobbingPhase) * BOBBING_AMOUNT;
             const bobDelta = newBob - oldBob;
             
             camera.position.y += bobDelta;
             controls.target.y += bobDelta;
          }
      }
  }
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
    
    for (const offset of heightOffsets) {
        // Point de départ du rayon
        const p = camera.position.clone();
        p.y -= offset; 

        // Sécurité : on ne teste pas sous le sol (Y < 0.1)
        if (p.y < 0.1) continue;

        for (const dir of allRays) {
            collisionRay.set(p, dir);
            collisionRay.far = minDistance;
            
            const intersects = collisionRay.intersectObject(modelRoot, true);
            
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

  const intersects = raycaster.intersectObject(modelRoot, true);
  
  // Trouver le premier obstacle visible (mur, meuble...)
  const hit = intersects.find(h => h.object.isMesh && h.object.visible);

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
function animate() {
  requestAnimationFrame(animate);
  updateMovement(); // Appliquer les mouvements fluides
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
  const w = (container && container.clientWidth) || 800;
  const h = (container && container.clientHeight) || 600;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
});

// Observer pour détecter les changements de taille du conteneur
if (container) {
  const resizeObserver = new ResizeObserver(entries => {
    for (let entry of entries) {
      const w = entry.contentRect.width;
      const h = entry.contentRect.height;
      if (w > 0 && h > 0) {
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
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
