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
    duration: 1000
  },
  window: {
    axis: 'y',
    openAngle: Math.PI / 4,
    closeAngle: 0,
    duration: 800
  },
  ventilation: {
    colorOn: 0x00ff00,  // vert quand allumé
    colorOff: 0xff0000, // rouge par défaut
    duration: 500,
    particleColor: 0x0080ff, // bleu
    particleCount: 20
  },
  radiator: {
    colorOn: 0x00ff00,  // vert quand allumé
    colorOff: 0xff0000, // rouge par défaut
    duration: 500,
    particleColor: 0xff4000, // rouge-orange
    particleCount: 20
  }
};

let activeParticles = {}; // obj.uuid -> {points, positions, colors, velocities, lifetimes, maxCount, emitting}

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
        await fetch('/api/config/module_state', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
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
  obj.traverse(child => {
    if (child.isMesh && child.material) {
      child.material.color.setHex(colorHex);
    }
  });
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
    const objPos = new THREE.Vector3();
    system.obj.getWorldPosition(objPos);

    // Émettre de nouvelles particules si emitting
    if (system.emitting) {
      for (let i = 0; i < 2; i++) { // émettre 2 par frame
        const idx = system.nextIndex;
        system.positions[idx * 3] = objPos.x + (Math.random() - 0.5) * 0.5;
        system.positions[idx * 3 + 1] = objPos.y + Math.random() * 0.5;
        system.positions[idx * 3 + 2] = objPos.z + (Math.random() - 0.5) * 0.5;

        system.velocities[idx * 3] = (Math.random() - 0.5) * 0.01;
        system.velocities[idx * 3 + 1] = Math.random() * 0.02 + 0.01;
        system.velocities[idx * 3 + 2] = (Math.random() - 0.5) * 0.01;

        system.lifetimes[idx] = Math.random() * 200 + 100;

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
      }
    };
    animate();
  } else if (config.colorOn) {
    // color animation - pour les groupes, appliquer à tous les meshes enfants
    const endColor = targetState === 'on' ? new THREE.Color(config.colorOn) : new THREE.Color(config.colorOff);
    
    // Collecter tous les meshes qui ont un material
    const meshes = [];
    obj.traverse(child => {
      if (child.isMesh && child.material && child.material.color) {
        meshes.push({
          mesh: child,
          startColor: child.material.color.clone()
        });
      }
    });
    
    if (meshes.length === 0) {
      return;
    }
    
    const startTime = Date.now();
    const animate = () => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / config.duration, 1);
      const eased = progress; // linear for simplicity
      
      meshes.forEach(({ mesh, startColor }) => {
        mesh.material.color = interpolateColor(startColor, endColor, eased);
      });
      
      if (progress < 1) {
        requestAnimationFrame(animate);
      } else {
        // Après l'animation de couleur, gérer les particules
        if (targetState === 'on' && config.particleColor) {
          createParticles(obj, config);
        } else if (targetState === 'off') {
          stopParticles(obj);
        }
      }
    };
    animate();
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
    // Comportement par défaut : centrer sur le modèle entier
    const box = new THREE.Box3().setFromObject(object3d);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);

    // Centrer les objets
    object3d.position.x = object3d.position.x - center.x;
    object3d.position.y = object3d.position.y - center.y;
    object3d.position.z = object3d.position.z - center.z;

    // Position de la caméra
    const cameraZ = maxDim * offsetFactor;
    camera.position.set(cameraZ, cameraZ * 0.6, cameraZ);
    camera.near = Math.max(0.1, maxDim / 100);
    camera.far = Math.max(1000, maxDim * 10);
    camera.updateProjectionMatrix();

    // Centrer le modèle
    controls.target.set(0, 0, 0);
  }

  controls.update();
}

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
  
  // Note: savedStates removal - we use config now
  
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
    console.log(`[updateAlertPoints] Waiting for model to stabilize (${timeSinceLoad}ms elapsed)`);
    return;
  }

  console.log('[updateAlertPoints] Mise à jour de', points.length, 'points');

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
      console.log('[updateAlertPoints] Objet non trouvé pour', el.getAttribute('data-target-names'));
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
    
    console.log(`[updateAlertPoints] ${el.getAttribute('data-i18n-key')} (${target.name}):`, {
      worldPos: { x: worldPos.x.toFixed(2), y: worldPos.y.toFixed(2), z: worldPos.z.toFixed(2) },
      ndc: { x: ndc.x.toFixed(2), y: ndc.y.toFixed(2), z: ndc.z.toFixed(2) },
      inFrustum,
      cameraPos: { x: camera.position.x.toFixed(2), y: camera.position.y.toFixed(2), z: camera.position.z.toFixed(2) }
    });
    
    if (!inFrustum) {
      console.log(`[updateAlertPoints] ${target.name} hors frustum, masqué`);
      el.style.display = 'none';
      el.setAttribute('data-in-view', 'false');
      return;
    }
    
    // Double vérification : si les coordonnées NDC sont hors limites, masquer
    if (ndc.x < -1 || ndc.x > 1 || ndc.y < -1 || ndc.y > 1 || ndc.z < 0 || ndc.z > 1) {
      console.log(`[updateAlertPoints] ${target.name} NDC hors limites, masqué`);
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

    console.log(`[updateAlertPoints] ${target.name} visible à (${x.toFixed(0)}, ${y.toFixed(0)})`);

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
  ArrowRight: false
};

let bobbingPhase = 0;
const WALK_SPEED = 0.08; // Vitesse de marche plus réaliste
const BOBBING_SPEED = 0.25; // Fréquence des pas
const BOBBING_AMOUNT = 0.025; // Amplitude du mouvement de tête

function updateMovement() {
  // Si aucune touche n'est pressée, on ne fait rien
  if (!keysPressed.ArrowUp && !keysPressed.ArrowDown && !keysPressed.ArrowLeft && !keysPressed.ArrowRight) {
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
  
  if (keysPressed.ArrowUp) moveVector.add(forward);
  if (keysPressed.ArrowDown) moveVector.sub(forward);
  if (keysPressed.ArrowRight) moveVector.add(right);
  if (keysPressed.ArrowLeft) moveVector.sub(right);
  
  // Normaliser pour éviter d'aller plus vite en diagonale
  if (moveVector.lengthSq() > 0) {
      // Direction pour le raycast
      const direction = moveVector.clone().normalize();
      
      // Appliquer la vitesse
      moveVector.normalize().multiplyScalar(WALK_SPEED);
      
      // Détection de collision
      let blocked = false;
      if (modelRoot) {
          const raycaster = new THREE.Raycaster();
          // Rayon horizontal depuis la position de la caméra
          raycaster.set(camera.position, direction);
          raycaster.far = 0.8; // Distance de collision (80cm)
          
          const intersects = raycaster.intersectObject(modelRoot, true);
          // On vérifie si on touche un Mesh visible
          if (intersects.some(hit => hit.object.isMesh && hit.object.visible)) {
              blocked = true;
              // console.log("Collision détectée !");
          }
      }
      
      if (!blocked) {
          camera.position.add(moveVector);
          controls.target.add(moveVector);
          
          // Effet de marche (Head Bobbing)
          // On calcule la différence de hauteur à appliquer pour cette frame
          const oldBob = Math.sin(bobbingPhase) * BOBBING_AMOUNT;
          bobbingPhase += BOBBING_SPEED;
          const newBob = Math.sin(bobbingPhase) * BOBBING_AMOUNT;
          const bobDelta = newBob - oldBob;
          
          camera.position.y += bobDelta;
          controls.target.y += bobDelta;
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

  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
      e.preventDefault(); // Empêcher le scroll de la page
      keysPressed[e.key] = true;
  }
});

window.addEventListener('keyup', (e) => {
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
      keysPressed[e.key] = false;
  }
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
