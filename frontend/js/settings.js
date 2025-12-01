/**
 * Script de la page Paramètres: extrait depuis settings.html
 * - Aucune logique inline dans le HTML
 * - Requiert js/utils.js et js/config-loader.js
 */

let settingsConfig = null; // configuration courante (local à cette page)
let currentSection = '';

// Navigation des sections
function showSection(id) {
  document.querySelectorAll('.section').forEach(section => {
    section.classList.remove('active');
  });
  const target = document.getElementById(id);
  if (target) target.classList.add('active');

  document.querySelectorAll('.menu li').forEach(item => item.classList.remove('active'));
  // prefer explicit data-section attribute (keeps ids stable across translations)
  const activeItem = [...document.querySelectorAll('.menu li')]
    .find(li => (li.dataset && li.dataset.section ? li.dataset.section : li.textContent.trim().toLowerCase()) === id);
  if (activeItem) activeItem.classList.add('active');
}

// Modale d'info
function openModal() { ModalManager.open('infoModal'); }
function closeModal() { ModalManager.close('infoModal'); }

// Helpers chemin
function getByPath(obj, path) { return path.split('.').reduce((o, i) => (o ? o[i] : undefined), obj); }
function setByPath(obj, path, value) {
  const parts = path.split('.');
  let current = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    current[parts[i]] = current[parts[i]] || {};
    current = current[parts[i]];
  }
  current[parts[parts.length - 1]] = value;
  return obj;
}

// Sanitize a string for use in filenames: remove diacritics, spaces -> _, keep a-z0-9_-
function sanitizeForFilename(s) {
  if (!s) return 'file';
  try {
    // normalize and remove diacritics
      s = s.normalize('NFD').replace(/[\u0000-\u036f]/g, '');
  } catch (e) {}
    const res = String(s).toLowerCase().trim().replace(/\s+/g, '_').replace(/[^a-z0-9_\-]/g, '');
    return res || 'file';
}

// Groupe de champs dynamique pour la modale d'édition
function createFormGroup(label, path, value) {
  const group = document.createElement('div');
  group.className = 'form-group';

  const labelEl = document.createElement('label');
  const t = (window.i18n && typeof window.i18n.t === 'function') ? window.i18n.t : (()=>undefined);
  // If caller passed an i18n key (contains a dot), use it directly
  if (typeof label === 'string' && label.indexOf('.') >= 0) {
    const key = label;
    const resolved = (t && t(key)) || label;
    labelEl.textContent = resolved;
    try { labelEl.setAttribute('data-i18n', key); } catch(e) {}
  } else {
    // try to resolve a translation key from the human label (fallback to original)
    const sanitizeKey = (s) => {
      try { s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, ''); } catch(e){}
      return String(s).toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    };
    // primary candidate
    const candidate = `settings.fields.${sanitizeKey(label)}`;
    // secondary candidate: remove short stop words like 'de','du','la','le','des','d'
    const stripped = String(label).replace(/\b(de|du|des|la|le|les|d')\b/gi, ' ');
    const candidate2 = `settings.fields.${sanitizeKey(stripped)}`;
    let translatedLabel = (t && t(candidate)) || (t && t(candidate2)) || label;
    labelEl.textContent = translatedLabel;
    // attach best candidate key if it exists in translations, otherwise attach candidate so MutationObserver can still try
    try {
      if (t && t(candidate)) labelEl.setAttribute('data-i18n', candidate);
      else if (t && t(candidate2)) labelEl.setAttribute('data-i18n', candidate2);
      else labelEl.setAttribute('data-i18n', candidate);
    } catch(e) {}
  }

  let input;
  if (typeof value === 'boolean') {
    const switchLabel = document.createElement('label');
    switchLabel.className = 'switch';
    input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = value;
    input.name = path;
    const slider = document.createElement('span');
    slider.className = 'slider';
    switchLabel.appendChild(input);
    switchLabel.appendChild(slider);
    input.className = 'form-control';
    group.appendChild(labelEl);
    group.appendChild(switchLabel);
    return group;
  }

    if (Array.isArray(value)) {
    input = document.createElement('input');
    input.type = 'text';
    input.value = value.join(', ');
    input.setAttribute('data-i18n-placeholder', 'placeholders.comma_list');
  } else if (path.endsWith('.langue') || path === 'affichage.langue') {
    input = document.createElement('select');
    input.name = path;
    // prefer language codes as option values so saving writes codes (fr/en) while keeping label for display
    const langs = [ ['fr','Français'], ['en','English'], ['es','Español'], ['de','Deutsch'], ['it','Italiano'] ];
    langs.forEach(([code, _label]) => {
      const o = document.createElement('option');
      // store the code as the option value (preferred)
      o.value = code;
      // also keep dataset.lang for compatibility
      o.dataset.lang = code;
      // use i18n for option label when available and attach data-i18n so it updates on language change
      const optKey = `languages.${code}`;
      const optText = (t && typeof t === 'function') ? (t(optKey) || _label) : _label;
      o.textContent = optText;
      try { o.setAttribute('data-i18n', optKey); } catch (e) {}
      // mark selected if stored value is either the code or the human label (backwards compatibility)
      if ((value || '').toString() === code || (value || '').toString() === _label) o.selected = true;
      input.appendChild(o);
    });
  } else if (path.endsWith('.localisation') || path === 'affichage.localisation') {
    input = document.createElement('select');
    input.name = path;
    ['Europe, Paris', 'Europe, Lyon', 'North America, New York', 'Asia, Tokyo', 'Other'].forEach(opt => {
      const o = document.createElement('option');
      o.value = opt; o.textContent = opt; if ((value || '').toString() === opt) o.selected = true; input.appendChild(o);
    });
  } else if (path.endsWith('.email')) {
    input = document.createElement('input'); input.type = 'email'; input.value = value || '';
  } else if (path.endsWith('.telephone')) {
    input = document.createElement('input'); input.type = 'tel'; input.pattern = "[+0-9 ]{10,}"; input.value = value || '';
  } else if (path.endsWith('.date_naissance')) {
    input = document.createElement('input'); input.type = 'date'; input.value = value || '';
  } else {
    input = document.createElement('input'); input.type = 'text'; input.value = value || '';
  }

  input.className = 'form-control';
  input.name = path;
  group.appendChild(labelEl);
  group.appendChild(input);
  return group;
}

// Modale d'édition générique
function openEditModalWith(htmlTitle, formHtml, onsubmit) {
  const modal = document.getElementById('editModal');
  const form = document.getElementById('editForm');
  // allow passing an i18n key as title. If htmlTitle matches a key in translations, use it;
  // otherwise fall back to the provided string. Also attach data-i18n so it updates on language change.
  try {
    const titleEl = modal.querySelector('h2');
    if (titleEl) {
      titleEl.setAttribute('data-i18n', htmlTitle);
      const t = (window.i18n && typeof window.i18n.t === 'function') ? window.i18n.t : (()=>undefined);
      const resolved = (t && t(htmlTitle)) || htmlTitle;
      titleEl.textContent = resolved;
    }
  } catch(e) { try { modal.querySelector('h2').textContent = htmlTitle; } catch(_){} }
  form.innerHTML = formHtml;
  form.onsubmit = async (e) => { e.preventDefault(); await onsubmit(new FormData(form)); };
  modal.style.display = 'flex';
}

// Ouvre le modal pour éditer un seul champ data-path
function openEditModal(element) {
  if (!element || element.dataset.readonly === 'true') return;
  const path = element.getAttribute('data-path');
  if (!path) return;
  const value = getByPath(settingsConfig, path);

  const modal = document.getElementById('editModal');
  const form = document.getElementById('editForm');
  form.innerHTML = '';

  const group = createFormGroup('Modifier', path, value);
  let inputEl = group.querySelector('input, select, textarea') || group.querySelector('.switch input');
  if (inputEl) { inputEl.dataset.path = path; inputEl.name = 'value'; }
  form.appendChild(group);

  form.onsubmit = async (e) => {
    e.preventDefault();
    let newVal;
    if (!inputEl) newVal = null;
    else if (inputEl.type === 'checkbox') newVal = !!inputEl.checked;
    else if (inputEl.tagName.toLowerCase() === 'select') newVal = inputEl.value;
    else newVal = inputEl.value;

    if (Array.isArray(value)) newVal = String(newVal || '').split(',').map(s => s.trim()).filter(Boolean);

  const updates = {}; setByPath(updates, path, newVal); setByPath(settingsConfig, path, newVal);
    try {
      const response = await fetch('http://localhost:8000/config', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updates)
      });
      if (!response.ok) throw new Error('Erreur lors de la sauvegarde');
  const result = await response.json(); if (result && result.config) settingsConfig = result.config;

  if (Array.isArray(newVal)) element.textContent = newVal.join(', ');
  else if (typeof newVal === 'boolean') element.innerHTML = `<span class="badge ${newVal ? 'badge-yes' : 'badge-no'}">${newVal ? (window.i18n && window.i18n.t ? window.i18n.t('actions.yes') || 'Oui' : 'Oui') : (window.i18n && window.i18n.t ? window.i18n.t('actions.no') || 'Non' : 'Non')}</span>`;
  else element.textContent = newVal || '—';

  // If the edited field is the language, apply it immediately (single-field edit flow)
  try {
    if (path === 'affichage.langue') {
      let appliedCode = null;
      if (inputEl && inputEl.tagName && inputEl.tagName.toLowerCase() === 'select') {
        const opt = inputEl.options[inputEl.selectedIndex];
        appliedCode = (opt && opt.value) ? opt.value : ((opt && opt.dataset && opt.dataset.lang) ? opt.dataset.lang : null);
      } else {
        // newVal may be a code or a human label; attempt to derive
        if (/^[a-z]{2}$/i.test(String(newVal || ''))) appliedCode = String(newVal).toLowerCase();
        else {
          try {
            const langsObj = (window.i18n && typeof window.i18n.t === 'function') ? window.i18n.t('languages') : null;
            if (langsObj) {
              for (const k in langsObj) {
                if (langsObj[k] && String(langsObj[k]).toLowerCase() === String(newVal).toLowerCase()) { appliedCode = k; break; }
              }
            }
          } catch(e){}
        }
      }
      if (appliedCode && window.i18n && typeof window.i18n.setLanguage === 'function') {
        try { window.i18n.setLanguage(appliedCode); } catch(e) { console.warn('i18n.setLanguage failed', e); }
      }
      // update displayed label to localized name if possible
      try {
        const t = (window.i18n && typeof window.i18n.t === 'function') ? window.i18n.t : (()=>undefined);
        const display = (t && appliedCode) ? (t(`languages.${appliedCode}`) || appliedCode) : (newVal || '—');
        if (element) element.textContent = display;
      } catch(e){}
    }
  } catch(e) { console.warn('language apply in openEditModal failed', e); }

  modal.style.display = 'none';
  showNotification((window.i18n && window.i18n.t) ? window.i18n.t('notifications.saved') || 'Modification sauvegardée' : 'Modification sauvegardée');
  } catch (err) { console.error(err); showNotification((window.i18n && window.i18n.t) ? window.i18n.t('notifications.save_error') || 'Erreur lors de la sauvegarde' : 'Erreur lors de la sauvegarde', true); }
  };

  modal.querySelector('h2').textContent = 'Modifier';
  modal.style.display = 'block';
}

/* ========== Gestion des enseignes & pièces ========== */
function renderEnseignes() {
  const container = document.getElementById('enseignes-list');
  if (!container || !settingsConfig || !settingsConfig.lieux || !Array.isArray(settingsConfig.lieux.enseignes)) return;

  container.innerHTML = '';
  settingsConfig.lieux.enseignes.forEach(enseigne => {
    const card = document.createElement('div');
  card.className = 'location-card' + (settingsConfig.lieux.active === enseigne.id ? ' active' : '');
    const t = (window.i18n && typeof window.i18n.t === 'function') ? window.i18n.t : (()=>undefined);
    const editLabel = (t && t('actions.edit')) || 'Modifier';
    const removeLabel = (t && t('actions.remove')) || 'Supprimer';
    const addRoomLabel = (t && t('actions.add_location')) || 'Ajouter une pièce';
    const confirmTitle = (t && t('actions.confirm')) || 'Confirmation';
    const confirmMessage = (t && t('notifications.confirm_delete_message')) || 'Voulez-vous vraiment supprimer ?';
    const yesLabel = (t && t('actions.yes')) || 'Oui';
    const cancelLabel = (t && t('actions.cancel')) || 'Annuler';

    const roomsHtml = (enseigne.pieces || []).map(piece => {
      return `<span class="room-tag">${escapeHtml(piece.nom)} <button class="remove-btn" title="${removeLabel}" onclick="removePiece('${enseigne.id}','${piece.id}')">×</button></span>`;
    }).join('');

    card.innerHTML = `
      <div class="actions">
        <button class="edit-btn" title="${editLabel}" onclick="editEnseigne('${enseigne.id}')"><img src="/assets/icons/edit.png" alt="${editLabel}"></button>
        <button class="remove-btn" title="${removeLabel}" onclick="removeEnseigne('${enseigne.id}')"><img src="/assets/icons/delete.png" alt="${removeLabel}"></button>
      </div>
      <h3>${escapeHtml(enseigne.nom || '—')}</h3>
      <p class="muted">${escapeHtml(enseigne.adresse || '')}</p>
      <div class="rooms">${roomsHtml}</div>
      <button class="btn-room" onclick="addPiece('${enseigne.id}')"><img src="/assets/icons/add.png" alt=""></button>

      <div id="confirmModal" class="modal" style="display:none;">
        <div class="modal-content">
          <h3 id="confirmTitle">${confirmTitle}</h3>
          <p id="confirmMessage">${confirmMessage}</p>
          <div class="modal-actions">
            <button id="confirmYes">${yesLabel}</button>
            <button id="confirmNo">${cancelLabel}</button>
          </div>
        </div>
      </div>`;

    // After creating the innerHTML, ensure the add-room button contains a translatable label
    const btnRoom = card.querySelector('.btn-room');
    if (btnRoom) {
      // preserve img if present
      const img = btnRoom.querySelector('img');
      // clear and rebuild: <img> + <span data-i18n="actions.add_location">...</span>
      btnRoom.innerHTML = '';
      if (img) btnRoom.appendChild(img);
      const lbl = document.createElement('span');
      lbl.className = 'btn-room-label';
      lbl.setAttribute('data-i18n', 'actions.add_location');
      lbl.textContent = addRoomLabel;
      btnRoom.appendChild(lbl);
      // set tooltip/title to be translatable as well
      try { btnRoom.setAttribute('data-i18n-title', 'actions.add_location'); } catch(e) {}
    }

    container.appendChild(card);
  });

  enableDragAndDrop();
  enablePieceDragAndDrop();
}

function enableDragAndDrop() {
  const container = document.getElementById('enseignes-list');
  if (!container) return;

  container.querySelectorAll('.location-card').forEach(card => {
    let draggedCard = null;
    card.draggable = true;

    card.addEventListener('dragstart', (e) => {
      draggedCard = card;
      e.dataTransfer.effectAllowed = 'move';
      card.classList.add('dragging');
    });

    card.addEventListener('dragend', () => {
      card.classList.remove('dragging');
      draggedCard = null;

      const newOrder = Array.from(container.children).map(el => {
        const name = el.querySelector('h3')?.textContent.trim();
  return settingsConfig.lieux.enseignes.find(e => e.nom === name)?.id;
      }).filter(Boolean);

  settingsConfig.lieux.enseignes.sort((a, b) => newOrder.indexOf(a.id) - newOrder.indexOf(b.id));
      if (settingsConfig.lieux.enseignes.length > 0) settingsConfig.lieux.active = settingsConfig.lieux.enseignes[0].id;

      fetch('http://localhost:8000/config', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(settingsConfig)
      }).then(() => showNotification((window.i18n && window.i18n.t) ? window.i18n.t('notifications.order_saved') || 'Nouvel ordre enregistré' : 'Nouvel ordre enregistré')).catch(err => console.error(err));
    });

    card.addEventListener('dragover', (e) => {
      e.preventDefault();
      const dragging = container.querySelector('.dragging');
      const afterElement = getDragAfterElementHorizontal(container, e.clientX);
      if (!afterElement) container.appendChild(dragging); else container.insertBefore(dragging, afterElement);
    });
  });

  function getDragAfterElementHorizontal(container, x) {
    const draggableElements = [...container.querySelectorAll('.location-card:not(.dragging)')];
    return draggableElements.reduce((closest, child) => {
      const box = child.getBoundingClientRect();
      const offset = x - box.left - box.width / 2;
      if (offset < 0 && offset > closest.offset) return { offset, element: child };
      else return closest;
    }, { offset: Number.NEGATIVE_INFINITY }).element;
  }
}

function enablePieceDragAndDrop() {
  document.querySelectorAll('.rooms').forEach(roomContainer => {
    roomContainer.querySelectorAll('.room-tag').forEach(tag => {
      let draggedTag = null;
      tag.draggable = true;

      tag.addEventListener('dragstart', (e) => {
        draggedTag = tag;
        e.dataTransfer.effectAllowed = 'move';
        tag.classList.add('dragging');
      });

      tag.addEventListener('dragend', () => {
        tag.classList.remove('dragging');
        draggedTag = null;

        const enseigneCard = tag.closest('.location-card');
        const enseigneName = enseigneCard.querySelector('h3').textContent.trim();
  const enseigne = settingsConfig.lieux.enseignes.find(e => e.nom === enseigneName);
        if (!enseigne) return;

        const newOrder = Array.from(roomContainer.children).map(el => {
          const name = el.textContent.replace('×', '').trim();
          return enseigne.pieces.find(p => p.nom === name)?.id;
        }).filter(Boolean);

        enseigne.pieces.sort((a, b) => newOrder.indexOf(a.id) - newOrder.indexOf(b.id));

        fetch('http://localhost:8000/config', {
          method: 'PUT',
          method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(settingsConfig)
  }).then(() => showNotification((window.i18n && window.i18n.t) ? window.i18n.t('notifications.rooms_order_saved') || 'Ordre des pièces enregistré' : 'Ordre des pièces enregistré')).catch(err => console.error(err));
      });

      tag.addEventListener('dragover', (e) => {
        e.preventDefault();
        const dragging = roomContainer.querySelector('.dragging');
        const afterElement = getDragAfterElement(roomContainer, e.clientX);
        if (!afterElement) roomContainer.appendChild(dragging); else roomContainer.insertBefore(dragging, afterElement);
      });
    });

    function getDragAfterElement(container, x) {
      const draggableElements = [...container.querySelectorAll('.room-tag:not(.dragging)')];
      return draggableElements.reduce((closest, child) => {
        const box = child.getBoundingClientRect();
        const offset = x - box.left - box.width / 2;
        if (offset < 0 && offset > closest.offset) return { offset, element: child };
        else return closest;
      }, { offset: Number.NEGATIVE_INFINITY }).element;
    }
  });
}

async function addEnseigne() {
  openEditModalWith('modals.add_brand', `
    <div class="form-group"><label data-i18n="settings.fields.nom">Nom</label><input name="nom" type="text" required></div>
    <div class="form-group"><label data-i18n="settings.fields.adresse">Adresse</label><input name="adresse" type="text"></div>
  `, async (formData) => {
  const newEn = { id: 'ens_' + Date.now(), nom: formData.get('nom'), adresse: formData.get('adresse') || '', pieces: [] };
  if (!settingsConfig.lieux) settingsConfig.lieux = { enseignes: [], active: null };
  if (!Array.isArray(settingsConfig.lieux.enseignes)) settingsConfig.lieux.enseignes = [];
  // validate unique enseigne name (case-insensitive)
  const newName = (newEn.nom || '').toString().trim().toLowerCase();
  const duplicate = (settingsConfig.lieux.enseignes || []).some(e => (e.nom || '').toString().trim().toLowerCase() === newName);
  if (duplicate) {
  showNotification((window.i18n && window.i18n.t) ? window.i18n.t('notifications.location_exists') || 'Une enseigne avec ce nom existe déjà' : 'Une enseigne avec ce nom existe déjà', true);
    // close modal and do not add
    document.getElementById('editModal').style.display = 'none';
    return;
  }
  settingsConfig.lieux.enseignes.push(newEn);
  settingsConfig.lieux.active = newEn.id;

    try {
  const response = await fetch('http://localhost:8000/config', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(settingsConfig) });
      if (!response.ok) throw new Error('Erreur lors de la sauvegarde');
  const result = await response.json(); if (result && result.config) settingsConfig = result.config;
  document.getElementById('editModal').style.display = 'none';
  showNotification((window.i18n && window.i18n.t) ? window.i18n.t('notifications.add_success') || 'Enseigne ajoutée avec succès' : 'Enseigne ajoutée avec succès');
      renderEnseignes();
  } catch (err) { console.error(err); showNotification((window.i18n && window.i18n.t) ? window.i18n.t('notifications.add_error') || "Erreur lors de l'ajout de l'enseigne" : "Erreur lors de l'ajout de l'enseigne", true); }
  });
}

async function addPiece(enseigneId) {
  openEditModalWith('modals.add_room', `
    <div class="form-group"><label data-i18n="settings.fields.nom">Nom de la pièce</label><input name="nom" type="text" required></div>
    <div class="form-group"><label data-i18n="settings.fields.type">Type</label>
      <select name="type"><option value="salon">Salon</option><option value="cuisine">Cuisine</option><option value="chambre">Chambre</option><option value="bureau">Bureau</option><option value="autre">Autre</option></select>
    </div>
    <div class="form-group">
      <label data-i18n="modals.glb_label">Modèle 3D (.glb)</label>
      <div id="glbDropZone" style="border: 2px dashed #ccc; padding: 20px; text-align: center; cursor: pointer;" data-i18n="modals.glb_drop">Glissez-déposez un fichier .glb ici</div>
      <input type="file" id="glbInput" accept=".glb" style="display: none;">
      <p id="glbFileName" style="font-size: 0.9em; color: #555;"></p>
    </div>
  `, async (formData) => {
  const enseigne = (settingsConfig.lieux.enseignes || []).find(e => e.id === enseigneId);
  if (!enseigne) { showNotification((window.i18n && window.i18n.t) ? window.i18n.t('notifications.location_not_found') || 'Enseigne non trouvée' : 'Enseigne non trouvée', true); return; }
    // get piece name + type
    const pieceName = formData.get('nom');
    const pieceType = formData.get('type');

    const piece = { id: 'piece_' + Date.now(), nom: pieceName, type: pieceType, glbModel: null };
    if (!Array.isArray(enseigne.pieces)) enseigne.pieces = [];
    enseigne.pieces.push(piece);
    // If a GLB file was selected, upload it to the backend with the naming convention enseigne_piece.glb
    try {
      if (glbFile) {
  // Build deterministic filename using enseigne and piece IDs but normalize them to avoid empty values
  const rawEns = String(enseigne.id || enseigneId || 'unknown');
  const rawPiece = String(piece.id || Date.now());
  // Use raw IDs and strip any existing 'ens'/'piece' prefixes — no sanitize here to debug the issue
  const ensSuffix = rawEns.replace(/^ens[_-]?/, '') || 'unknown';
  const pieceSuffix = rawPiece.replace(/^piece[_-]?/, '') || String(Date.now());
  const filename = `ens_${ensSuffix}_piece_${pieceSuffix}.glb`;
        const fd = new FormData();
        fd.append('file', glbFile, filename);
        fd.append('filename', filename);

        const upResp = await fetch('http://localhost:8000/api/rooms/files', {
          method: 'PUT', body: fd
        });
        if (!upResp.ok) throw new Error('Erreur upload');
        const upJson = await upResp.json();
        if (upJson && upJson.path) {
          piece.glbModel = upJson.path;
        } else {
          showNotification((window.i18n && window.i18n.t) ? window.i18n.t('notifications.upload_error') || 'Upload du modèle .glb échoué, la pièce sera créée sans 3D' : 'Upload du modèle .glb échoué, la pièce sera créée sans 3D', true);
        }
      }
    } catch (err) {
      console.error('Upload GLB error', err);
      showNotification((window.i18n && window.i18n.t) ? window.i18n.t('notifications.upload_error') || 'Erreur lors de l’upload du modèle 3D' : 'Erreur lors de l’upload du modèle 3D', true);
    }

    try {
      const response = await fetch('http://localhost:8000/config', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(settingsConfig) });
      if (!response.ok) throw new Error('Erreur lors de la sauvegarde');
      const result = await response.json(); if (result && result.config) settingsConfig = result.config;
  document.getElementById('editModal').style.display = 'none';
  showNotification((window.i18n && window.i18n.t) ? window.i18n.t('notifications.piece_added') || 'Pièce ajoutée avec succès' : 'Pièce ajoutée avec succès');
      renderEnseignes();
  } catch (err) { console.error(err); showNotification((window.i18n && window.i18n.t) ? window.i18n.t('notifications.piece_add_error') || "Erreur lors de l'ajout de la pièce" : "Erreur lors de l'ajout de la pièce", true); }
  });

  const dropZone = document.getElementById('glbDropZone');
  const fileInput = document.getElementById('glbInput');
  let glbFile = null;

  function handleGLBFile(file) {
  if (!file || !file.name.toLowerCase().endsWith('.glb')) { showNotification((window.i18n && window.i18n.t) ? window.i18n.t('notifications.file_invalid') || 'Fichier .glb invalide' : 'Fichier .glb invalide', true); return; }
    glbFile = file;
    document.getElementById('glbFileName').textContent = file.name;
  }

  dropZone.addEventListener('click', () => fileInput.click());
  dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.style.borderColor = '#4CAF50'; });
  dropZone.addEventListener('dragleave', () => { dropZone.style.borderColor = '#ccc'; });
  dropZone.addEventListener('drop', e => { e.preventDefault(); dropZone.style.borderColor = '#ccc'; handleGLBFile(e.dataTransfer.files[0]); });
  fileInput.addEventListener('change', () => { handleGLBFile(fileInput.files[0]); });
}

async function editEnseigne(enseigneId) {
  const enseigne = (settingsConfig.lieux.enseignes || []).find(e => e.id === enseigneId);
  if (!enseigne) { showNotification((window.i18n && window.i18n.t) ? window.i18n.t('notifications.location_not_found') || 'Enseigne non trouvée' : 'Enseigne non trouvée', true); return; }

  openEditModalWith('modals.edit_brand', `
    <div class="form-group"><label data-i18n="settings.fields.nom">Nom</label><input name="nom" type="text" value="${escapeHtml(enseigne.nom)}" required></div>
    <div class="form-group"><label data-i18n="settings.fields.adresse">Adresse</label><input name="adresse" type="text" value="${escapeHtml(enseigne.adresse || '')}"></div>
  `, async (formData) => {
    const newName = (formData.get('nom') || '').toString().trim();
    // check uniqueness among other enseignes
    const conflict = (settingsConfig.lieux.enseignes || []).some(e => e.id !== enseigneId && (e.nom || '').toString().trim().toLowerCase() === newName.toLowerCase());
    if (conflict) {
      showNotification((window.i18n && window.i18n.t) ? window.i18n.t('notifications.location_exists') || 'Une autre enseigne utilise déjà ce nom' : 'Une autre enseigne utilise déjà ce nom', true);
      return;
    }
    enseigne.nom = newName;
    enseigne.adresse = formData.get('adresse');

    try {
      const response = await fetch('http://localhost:8000/config', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(settingsConfig) });
      if (!response.ok) throw new Error('Erreur lors de la sauvegarde');
      const result = await response.json(); if (result && result.config) settingsConfig = result.config;
  document.getElementById('editModal').style.display = 'none';
  showNotification((window.i18n && window.i18n.t) ? window.i18n.t('notifications.update_success') || 'Enseigne modifiée avec succès' : 'Enseigne modifiée avec succès');
      renderEnseignes();
  } catch (err) { console.error(err); showNotification((window.i18n && window.i18n.t) ? window.i18n.t('notifications.update_error') || "Erreur lors de la modification de l'enseigne" : "Erreur lors de la modification de l'enseigne", true); loadConfigToUI(); }
  });
}

function showConfirmation(message, callback) {
  const modal = document.getElementById('confirmModal');
  if (!modal) { callback(confirm(message)); return; }
  document.getElementById('confirmMessage').textContent = message;
  modal.style.display = 'flex';
  const yesBtn = document.getElementById('confirmYes');
  const noBtn = document.getElementById('confirmNo');
  const cleanup = () => { modal.style.display = 'none'; yesBtn.onclick = null; noBtn.onclick = null; };
  yesBtn.onclick = () => { cleanup(); callback(true); };
  noBtn.onclick = () => { cleanup(); callback(false); };
}

async function removeEnseigne(enseigneId) {
  showConfirmation('Supprimer cette enseigne ?', async (confirmed) => {
    if (!confirmed) return;
  // collect GLB paths to delete for all pieces of the enseigne
  const enseigne = (settingsConfig.lieux.enseignes || []).find(e => e.id === enseigneId);
  const pathsToDelete = [];
  if (enseigne && Array.isArray(enseigne.pieces)) {
    enseigne.pieces.forEach(p => { if (p && p.glbModel) pathsToDelete.push(p.glbModel); });
  }
  try {
    if (pathsToDelete.length > 0) {
      await fetch('http://localhost:8000/api/rooms/files', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(pathsToDelete) });
    }
    } catch (err) {
    console.error('Erreur suppression fichiers GLB:', err);
    showNotification((window.i18n && window.i18n.t) ? window.i18n.t('notifications.delete_files_error') || 'Erreur lors de la suppression des fichiers 3D' : 'Erreur lors de la suppression des fichiers 3D', true);
  }

  settingsConfig.lieux.enseignes = (settingsConfig.lieux.enseignes || []).filter(e => e.id !== enseigneId);
  if (settingsConfig.lieux.active === enseigneId) settingsConfig.lieux.active = (settingsConfig.lieux.enseignes[0] || {}).id || null;
  await saveConfigAll();
  showNotification((window.i18n && window.i18n.t) ? window.i18n.t('notifications.delete_success') || 'Enseigne supprimée avec succès' : 'Enseigne supprimée avec succès');
    renderEnseignes();
  });
}

async function removePiece(enseigneId, pieceId) {
  showConfirmation('Supprimer cette pièce ?', async (confirmed) => {
    if (!confirmed) return;
  const enseigne = (settingsConfig.lieux.enseignes || []).find(e => e.id === enseigneId);
    if (!enseigne) return;
    const piece = (enseigne.pieces || []).find(p => p.id === pieceId);
    const pathsToDelete = [];
    if (piece && piece.glbModel) pathsToDelete.push(piece.glbModel);
    try {
      if (pathsToDelete.length > 0) {
        await fetch('http://localhost:8000/api/rooms/files', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(pathsToDelete) });
      }
    } catch (err) {
      console.error('Erreur suppression fichier GLB:', err);
      showNotification((window.i18n && window.i18n.t) ? window.i18n.t('notifications.delete_file_error') || 'Erreur lors de la suppression du fichier 3D' : 'Erreur lors de la suppression du fichier 3D', true);
    }

    enseigne.pieces = (enseigne.pieces || []).filter(p => p.id !== pieceId);
  await saveConfigAll();
  showNotification((window.i18n && window.i18n.t) ? window.i18n.t('notifications.piece_deleted') || 'Pièce supprimée avec succès' : 'Pièce supprimée avec succès');
    renderEnseignes();
  });
}

// Enregistrement global de la configuration (envoi complet si nécessaire)
async function saveConfigAll() {
  const response = await fetch('http://localhost:8000/config', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(settingsConfig)
  });
  if (!response.ok) throw new Error('Erreur lors de la sauvegarde');
  const result = await response.json(); if (result && result.config) settingsConfig = result.config;
}

// Édition par section (modale multi-champs)
function editSection(sectionId) {
  currentSection = sectionId;
  const modal = document.getElementById('editModal');
  const form = document.getElementById('editForm');
  form.innerHTML = '';
  form.onsubmit = async (e) => { e.preventDefault(); await saveConfigSection(); };

  const sectionConfig = {
    vous: [ ['settings.fields.nom', 'vous.nom'], ['settings.fields.prenom', 'vous.prenom'], ['settings.fields.date_naissance', 'vous.date_naissance'], ['settings.fields.email', 'vous.email'], ['settings.fields.telephone', 'vous.telephone'], ['settings.fields.adresse', 'vous.adresse'] ],
    assurance: [ ['settings.fields.nom', 'assurance.nom'], ['settings.fields.email', 'assurance.email'], ['settings.fields.telephone', 'assurance.telephone'], ['settings.fields.adresse', 'assurance.adresse'] ],
    syndicat: [ ['settings.fields.nom', 'syndicat.nom'], ['settings.fields.email', 'syndicat.email'], ['settings.fields.telephone', 'syndicat.telephone'], ['settings.fields.adresse', 'syndicat.adresse'] ],
    mode: [ ['settings.fields.mode_affichage', 'affichage.mode'] ],
    'langue & localisation': [ ['settings.fields.langue', 'affichage.langue'], ['settings.fields.localisation', 'affichage.localisation'] ],
    technologies: [ ['settings.fields.email', 'notifications.technologies.email'], ['settings.fields.sms', 'notifications.technologies.sms'], ['settings.fields.push', 'notifications.technologies.push'] ],
    type: [ ['settings.fields.alertes', 'notifications.types.alertes'], ['settings.fields.rappels', 'notifications.types.rappels'], ['settings.fields.newsletters', 'notifications.types.newsletters'] ],
    enseigne: [ ['settings.fields.nom', 'lieux.enseigne'], ['settings.fields.pieces', 'lieux.pieces'] ]
  };

  const fields = sectionConfig[sectionId] || [];
  fields.forEach(([label, path]) => {
    const value = getByPath(settingsConfig, path);
    form.appendChild(createFormGroup(label, path, value));
  });
  modal.style.display = 'block';
}

async function saveConfigSection() {
  const form = document.getElementById('editForm');
  const formData = new FormData(form);
  let updates = {};
  // remember previous language to detect change
  const prevLang = getByPath(settingsConfig, 'affichage.langue');
  for (const [path, value] of formData.entries()) {
    const input = form.querySelector(`[name="${path}"]`);
    let finalValue = value;
    if (input.type === 'checkbox') finalValue = input.checked;
    else if (input.name.endsWith('.pieces')) finalValue = value.split(',').map(s => s.trim()).filter(Boolean);
    else if (typeof getByPath(settingsConfig, path) === 'boolean') finalValue = value.toLowerCase() === 'true' || value === '1' || value.toLowerCase() === 'oui';
    // Special handling for language fields: store language code (fr/en) and include label for compatibility
    if (path.endsWith('.langue') || path === 'affichage.langue') {
      try {
        const sel = input;
        const selectedOption = sel && sel.options && sel.options[sel.selectedIndex];
        // prefer the option.value (we store codes as values); fallback to dataset.lang
        const codeValue = selectedOption ? (selectedOption.value || (selectedOption.dataset && selectedOption.dataset.lang) || finalValue) : finalValue;
        const humanLabel = selectedOption ? (selectedOption.textContent || finalValue) : finalValue;
        setByPath(updates, path, codeValue);
        setByPath(settingsConfig, path, codeValue);
        // also include a label field for backend compatibility (non-destructive)
        try { setByPath(updates, `${path}.__label`, humanLabel); } catch(e){}
      } catch (e) {
        setByPath(updates, path, finalValue);
        setByPath(settingsConfig, path, finalValue);
      }
    } else {
      setByPath(updates, path, finalValue);
      setByPath(settingsConfig, path, finalValue);
    }
  }

  try {
  const payload = Object.keys(updates).length === 0 ? settingsConfig : updates;
    console.info('saveConfigSection: payload ->', payload);
    // Apply language immediately on the client so a backend save failure doesn't block UI language change
    try {
      const selForLang = form.querySelector('[name="affichage.langue"]');
      let immediateCode = null;
      if (selForLang && selForLang.options && selForLang.selectedIndex >= 0) {
        const opt = selForLang.options[selForLang.selectedIndex];
        // prefer the option value (we now store codes as values), fallback to dataset.lang
        immediateCode = (opt && opt.value) ? opt.value : ((opt && opt.dataset && opt.dataset.lang) ? opt.dataset.lang : null);
      }
      // fallback: try to derive from stored value
      if (!immediateCode) {
        const derive = (s) => { if(!s) return null; const k = String(s).toLowerCase(); if(k.includes('fr')) return 'fr'; if(k.includes('en')) return 'en'; if(k.includes('es')) return 'es'; if(k.includes('de')) return 'de'; if(k.includes('it')) return 'it'; return null; };
        immediateCode = derive(getByPath(settingsConfig, 'affichage.langue'));
      }
      console.info('saveConfigSection: immediate language code ->', immediateCode);
      if (immediateCode && window.i18n && typeof window.i18n.setLanguage === 'function') {
        try { window.i18n.setLanguage(immediateCode); } catch(e){ console.warn('i18n.setLanguage failed', e); }
      }

    } catch(e) { console.warn('saveConfigSection language apply failed', e); }

    const response = await fetch('http://localhost:8000/config', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const result = await response.json();
    console.info('saveConfigSection: save response ok=', response.ok, ' result=', result);
    if (!response.ok) throw new Error(result.detail || 'Erreur lors de la sauvegarde');
    if (result && result.config) settingsConfig = result.config;
    document.getElementById('editModal').style.display = 'none';
  showNotification((window.i18n && window.i18n.t) ? window.i18n.t('notifications.config_saved') || 'Configuration sauvegardée avec succès' : 'Configuration sauvegardée avec succès');
    // rafraîchir affichage
    updateDataPathsDisplay();
    if (typeof renderEnseignes === 'function') renderEnseignes();
    // if language changed via the settings modal, apply it through i18n
    try{
      // Try to obtain the language code from the form select (preferred), otherwise derive from stored value
      const sel = form.querySelector('[name="affichage.langue"]');
      let newCode = null;
      if (sel && sel.options && sel.selectedIndex >= 0) {
        const opt = sel.options[sel.selectedIndex];
        newCode = (opt && opt.value) ? opt.value : ((opt && opt.dataset && opt.dataset.lang) ? opt.dataset.lang : null);
      }
      const newLangValue = getByPath(settingsConfig, 'affichage.langue');
      // helper to derive code from a human value as fallback
      const deriveCodeFromValue = (s) => {
        if (!s) return null;
        const maybe = String(s).trim();
        if (/^[a-z]{2}$/i.test(maybe)) return maybe.toLowerCase();
        // try to find in current translations
        try{
          const langsObj = (window.i18n && typeof window.i18n.t === 'function') ? window.i18n.t('languages') : null;
          if (langsObj) {
            for (const k in langsObj) {
              if (langsObj[k] && String(langsObj[k]).toLowerCase() === maybe.toLowerCase()) return k;
            }
          }
        }catch(e){}
        // fallback substring heuristics
        const k = maybe.toLowerCase();
        if (k.includes('fr') || k.includes('franc')) return 'fr';
        if (k.includes('en') || k.includes('anglais')) return 'en';
        if (k.includes('es') || k.includes('esp')) return 'es';
        if (k.includes('de') || k.includes('allem')) return 'de';
        if (k.includes('it') || k.includes('ital')) return 'it';
        return null;
      };

      const prevCode = deriveCodeFromValue(prevLang);
      if (!newCode) newCode = deriveCodeFromValue(newLangValue);
      if (newCode && newCode !== prevCode && window.i18n && typeof window.i18n.setLanguage === 'function'){
        window.i18n.setLanguage(newCode);
      }
    }catch(e){console.warn('i18n apply failed', e);}
  } catch (err) { console.error(err); showNotification((window.i18n && window.i18n.t) ? window.i18n.t('notifications.save_error') || 'Erreur lors de la sauvegarde' : 'Erreur lors de la sauvegarde', true); }
}

// Remplissage des spans [data-path]
function updateDataPathsDisplay() {
  document.querySelectorAll('[data-path]').forEach(el => {
    const path = el.getAttribute('data-path');
    const value = getByPath(settingsConfig, path);
    el.classList.add('value-display');

    if (typeof value === 'boolean') {
      const t = (window.i18n && typeof window.i18n.t === 'function') ? window.i18n.t : (()=>undefined);
      const yes = (t && t('actions.yes')) || 'Oui';
      const no = (t && t('actions.no')) || 'Non';
      el.innerHTML = `<span class="badge ${value ? 'badge-yes' : 'badge-no'}">${value ? yes : no}</span>`;
      el.style.cursor = 'pointer';
      el.onclick = () => openEditModal(el);
      return;
    }

    if (path === 'affichage.mode') {
      const currentMode = String(value || '').toLowerCase();
      const select = document.createElement('select');
      select.className = 'form-control';
      const t = (window.i18n && typeof window.i18n.t === 'function') ? window.i18n.t : (()=>undefined);
      const light = (t && t('modes.light')) || 'Clair';
      const dark = (t && t('modes.dark')) || 'Sombre';
      [ {val:'clair', label: light}, {val:'sombre', label: dark} ].forEach(mode => {
        const option = document.createElement('option');
        option.value = mode.val; option.textContent = mode.label; if (mode.val === currentMode) option.selected = true; select.appendChild(option);
      });
      el.innerHTML = '';
      el.appendChild(select);
      select.addEventListener('change', async () => {
        const newMode = select.value === 'sombre' ? 'Sombre' : 'Clair';
  const updates = {}; setByPath(updates, 'affichage.mode', newMode); setByPath(settingsConfig, 'affichage.mode', newMode);
        try {
          const r = await fetch('http://localhost:8000/config', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updates) });
          if (r.ok) showNotification((window.i18n && window.i18n.t) ? window.i18n.t('notifications.mode_updated') || 'Mode mis à jour' : 'Mode mis à jour'); else showNotification((window.i18n && window.i18n.t) ? window.i18n.t('notifications.save_error') || 'Erreur lors de la sauvegarde' : 'Erreur lors de la sauvegarde', true);
        } catch (err) { console.error(err); showNotification((window.i18n && window.i18n.t) ? window.i18n.t('notifications.save_error') || 'Erreur lors de la sauvegarde' : 'Erreur lors de la sauvegarde', true); }
      });
      return;
    }

    if (Array.isArray(value)) el.textContent = value.join(', ');
    else if (path === 'affichage.langue') {
      const t = (window.i18n && typeof window.i18n.t === 'function') ? window.i18n.t : (()=>undefined);
      let display = '—';
      if (value) {
        const str = String(value).trim();
        // if it's already a 2-letter code
        if (/^[a-z]{2}$/i.test(str)) {
          const code = str.toLowerCase();
          display = (t && t(`languages.${code}`)) || code;
        } else {
          // try to find matching code from translations (label -> code)
          try {
            const langsObj = (t && typeof t === 'function') ? t('languages') : null;
            if (langsObj && typeof langsObj === 'object') {
              const found = Object.keys(langsObj).find(k => String(langsObj[k]).toLowerCase() === str.toLowerCase());
              if (found) display = (t && t(`languages.${found}`)) || langsObj[found];
              else {
                // fallback heuristics
                const s = str.toLowerCase();
                if (s.includes('fr')) display = (t && t('languages.fr')) || 'Français';
                else if (s.includes('en')) display = (t && t('languages.en')) || 'English';
                else if (s.includes('es')) display = (t && t('languages.es')) || 'Español';
                else if (s.includes('de')) display = (t && t('languages.de')) || 'Deutsch';
                else if (s.includes('it')) display = (t && t('languages.it')) || 'Italiano';
                else display = str;
              }
            } else {
              display = str;
            }
          } catch (e) { display = str; }
        }
      }
      el.textContent = display;
    } else if (path === 'abonnement.plan_actuel') {
      // Capitaliser la première lettre du nom du plan
      const planName = value ? String(value).charAt(0).toUpperCase() + String(value).slice(1) : '—';
      el.textContent = planName;
      el.style.cursor = 'pointer';
      el.onclick = (e) => openEditModal(e.target);
    } else if (path === 'contact.email' || path === 'vous.email' || path === 'assurance.email' || path === 'syndicat.email') {
      // Rendre l'email cliquable pour ouvrir le client mail
      if (value) {
        el.innerHTML = `<a href="mailto:${value}" style="color: inherit; text-decoration: underline;">${value}</a>`;
        el.removeAttribute('data-readonly'); // Permettre les clics sur le lien
        // Ne pas ajouter onclick pour éviter le conflit avec le lien
        return;
      } else {
        el.textContent = '—';
      }
      el.style.cursor = 'pointer';
      el.onclick = (e) => openEditModal(e.target);
    } else el.textContent = value || '—';
    
    // Ajouter onclick seulement pour les éléments éditables (pas pour contact.email)
    if (path !== 'contact.email') {
      el.style.cursor = 'pointer';
      el.onclick = (e) => openEditModal(e.target);
    }
  });
}

// Chargement config et initialisation UI
async function loadConfigToUI() {
  try {
  await loadConfig();
  settingsConfig = getConfig();
  if (!settingsConfig) { showNotification((window.i18n && window.i18n.t) ? window.i18n.t('notifications.load_error') || 'Impossible de charger la configuration' : 'Impossible de charger la configuration', true); return; }
    updateDataPathsDisplay();
    if (typeof renderEnseignes === 'function') renderEnseignes();
  if (settingsConfig?.affichage?.mode) applyTheme(settingsConfig.affichage.mode);
  } catch (error) {
    console.error('Erreur:', error);
    showNotification((window.i18n && window.i18n.t) ? window.i18n.t('notifications.load_failure') || 'Erreur lors du chargement de la configuration' : 'Erreur lors du chargement de la configuration', true);
  }
}

// Restauration de l'état UI et listeners
document.addEventListener('DOMContentLoaded', () => {
  // Section active
  const savedSection = localStorage.getItem('lastSection') || 'compte';
  showSection(savedSection);
  document.querySelectorAll('.menu li').forEach(item => {
    item.addEventListener('click', () => {
      const id = (item.dataset && item.dataset.section) ? item.dataset.section : item.textContent.trim().toLowerCase();
      localStorage.setItem('lastSection', id);
    });
  });

  // Gestion accordéon: n'autoriser qu'un seul <details> ouvert à la fois
  const allDetails = document.querySelectorAll('details.settings-section');
  allDetails.forEach(d => {
    d.addEventListener('toggle', () => {
      if (d.open) {
        // Fermer tous les autres quand celui-ci s'ouvre
        allDetails.forEach(other => { if (other !== d) other.open = false; });
        localStorage.setItem('openDetail', d.id);
      } else {
        // Si aucun n'est ouvert, nettoyer la clé
        const anyOpen = Array.from(allDetails).some(x => x.open);
        if (!anyOpen) localStorage.removeItem('openDetail');
      }
    });
  });
  const openDetail = localStorage.getItem('openDetail');
  if (openDetail) {
    const el = document.getElementById(openDetail);
    if (el && el.tagName.toLowerCase() === 'details') el.open = true;
  }

  // Cliquer hors modale -> utils.js prend en charge .close, etc.

  // Charger la config dans l'UI
  loadConfigToUI();
});

// Re-apply displayed values (labels) when language changes so translations loaded later update UI
if (typeof window !== 'undefined') {
  window.addEventListener('language-changed', () => {
    try { updateDataPathsDisplay(); } catch (e) { /* ignore */ }
  });
}

// Exposer global pour les onclick existants
window.showSection = showSection;
window.openModal = openModal;
window.closeModal = closeModal;
window.openEditModalWith = openEditModalWith;
window.openEditModal = openEditModal;
window.renderEnseignes = renderEnseignes;
window.addEnseigne = addEnseigne;
window.addPiece = addPiece;
window.editEnseigne = editEnseigne;
window.removeEnseigne = removeEnseigne;
window.removePiece = removePiece;
window.editSection = editSection;

// Gestion de la sélection de plan d'abonnement
document.addEventListener('DOMContentLoaded', function() {
  // Attacher les événements aux boutons de plan
  document.querySelectorAll('.plan-btn').forEach(btn => {
    btn.addEventListener('click', async function() {
      const planType = this.closest('.plan-card').dataset.plan;
      await selectPlan(planType);
    });
  });

  // Initialiser l'état des boutons selon le plan actuel
  if (settingsConfig && settingsConfig.abonnement && settingsConfig.abonnement.plan_actuel) {
    updatePlanButtons(settingsConfig.abonnement.plan_actuel);
  }
});

async function selectPlan(planType) {
  // Cas spécial pour le plan Entreprise
  if (planType === 'entreprise') {
    showEnterpriseContactModal();
    return;
  }

  try {
    // Mettre à jour la configuration locale
    if (!settingsConfig.abonnement) {
      settingsConfig.abonnement = {};
    }
    settingsConfig.abonnement.plan_actuel = planType;

    // Sauvegarder via l'API
    const response = await fetch('http://localhost:8000/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settingsConfig)
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    // Mettre à jour l'affichage
    const planDisplay = document.querySelector('[data-path="abonnement.plan_actuel"]');
    if (planDisplay) {
      // Capitaliser la première lettre du plan
      const planName = planType.charAt(0).toUpperCase() + planType.slice(1);
      planDisplay.textContent = planName;
    }

    // Mettre à jour l'état visuel des boutons
    updatePlanButtons(planType);

    showNotification((window.i18n && window.i18n.t) ? window.i18n.t('notifications.plan_saved') || 'Plan d\'abonnement mis à jour' : 'Plan d\'abonnement mis à jour');

  } catch (err) {
    console.error('Erreur lors de la sauvegarde du plan:', err);
    showNotification((window.i18n && window.i18n.t) ? window.i18n.t('notifications.save_error') || 'Erreur lors de la sauvegarde' : 'Erreur lors de la sauvegarde', true);
  }
}

function updatePlanButtons(selectedPlan) {
  document.querySelectorAll('.plan-card').forEach(card => {
    const btn = card.querySelector('.plan-btn');
    if (card.dataset.plan === selectedPlan) {
      btn.textContent = (window.i18n && window.i18n.t) ? window.i18n.t('actions.selected') || 'Sélectionné' : 'Sélectionné';
      btn.style.background = 'var(--success-color)';
      card.style.borderColor = 'var(--success-color)';
    } else {
      btn.textContent = (window.i18n && window.i18n.t) ? window.i18n.t('actions.select') || 'Sélectionner' : 'Sélectionner';
      btn.style.background = 'var(--accent-color)';
      card.style.borderColor = 'var(--border-color)';
    }
  });
}

function showEnterpriseContactModal() {
  // Créer la modale de contact pour le plan Entreprise
  const modal = document.createElement('div');
  modal.className = 'modal enterprise-modal';
  
  // Récupérer les informations de contact depuis la configuration
  const contactInfo = settingsConfig.contact || {};
  const email = contactInfo.email || 'support@iaqverse.local';
  const telephone = contactInfo.telephone || '+33 1 23 45 67 89';
  const adresse = contactInfo.adresse_postale || '1 rue Support, 75000 Paris';
  
  // Obtenir les traductions
  const t = (window.i18n && typeof window.i18n.t === 'function') ? window.i18n.t : (() => undefined);
  const title = t && t('settings.enterprise_modal.title') || 'Contact for Enterprise Plan';
  const closeBtn = t && t('settings.enterprise_modal.close') || 'Close';
  
  // Message avec informations dynamiques
  const baseMessage = t && t('settings.enterprise_modal.message') || 'For the Enterprise plan, please contact us directly:\n\nEmail: {email}\nPhone: {phone}\nAddress: {address}\n\nOur team will help you configure the perfect solution for your organization.';
  const message = baseMessage
    .replace('{email}', `<a href="mailto:${email}" style="color: inherit; text-decoration: underline;">${email}</a>`)
    .replace('{phone}', telephone)
    .replace('{address}', adresse);
  
  modal.innerHTML = `
    <div class="modal-content enterprise-contact">
      <span class="close" onclick="this.closest('.modal').remove()">&times;</span>
      <h2>${title}</h2>
      <div class="contact-message">
        <p>${message}</p>
      </div>
      <div class="modal-actions">
        <button class="btn-secondary" onclick="this.closest('.modal').remove()">${closeBtn}</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);
  modal.style.display = 'block';
}
