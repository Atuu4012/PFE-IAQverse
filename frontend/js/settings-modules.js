// --- Gestion des Modules (Fenetres, HVAC, etc.) ---

function editRoomModules(enseigneId, pieceId) {
  const enseigne = settingsConfig.lieux.enseignes.find(
    (e) => e.id === enseigneId,
  );
  if (!enseigne) return;
  const piece = enseigne.pieces.find((p) => p.id === pieceId);
  if (!piece) return;

  // Initialiser les modules s'ils n'existent pas
  if (!piece.modules) piece.modules = [];

  // Utiliser modulesModal au lieu de editModal
  const modal = document.getElementById("modulesModal");
  const title = document.getElementById("modalTitle");
  const body = document.getElementById("modalBody");
  const footer = document.getElementById("modalFooter");

  title.textContent = `Modules - ${piece.nom}`;

  let html = `<div style="margin-bottom:15px; font-style:italic;">Cochez les modules pilotables à distance.</div>`;

  if (piece.modules.length === 0) {
    html += `<p class="muted">Aucun module configuré pour cette pièce.</p>`;
    // Bouton pour ajouter des defaults ?
    html += `<button onclick="addDefaultModules('${enseigneId}', '${pieceId}')" class="btn-secondary">Ajouter les modules par défaut</button>`;
  } else {
    html += `<div class="modules-list">`;
    piece.modules.forEach((mod, idx) => {
      html += `
            <div class="form-group" style="display:flex; align-items:center; justify-content:space-between; border-bottom:1px solid #eee; padding:5px 0;">
                <div>
                    <strong>${escapeHtml(mod.name || mod.type)}</strong> 
                    <span class="muted" style="font-size:0.8em">(${mod.type})</span>
                </div>
                <label class="switch">
                    <input type="checkbox" id="mod_iot_${idx}" ${mod.is_iot ? "checked" : ""}>
                    <span class="slider round"></span>
                </label>
            </div>
          `;
    });
    html += `</div>`;
  }

  body.innerHTML = html;

  footer.innerHTML = `
    <button onclick="saveRoomModules('${enseigneId}', '${pieceId}')" class="btn-primary">Enregistrer</button>
    <button onclick="closeEditModal()" class="btn-secondary">Annuler</button>
  `;

  // Ouvrir la modal (gestion simple via style display)
  modal.style.display = "block";
}

function addDefaultModules(enseigneId, pieceId) {
  const enseigne = settingsConfig.lieux.enseignes.find(
    (e) => e.id === enseigneId,
  );
  const piece = enseigne.pieces.find((p) => p.id === pieceId);

  piece.modules = [
    {
      id: "window_1",
      name: "Fenêtre",
      type: "window",
      is_iot: true,
      state: "closed",
    },
    {
      id: "hvac_1",
      name: "Climatisation",
      type: "hvac",
      is_iot: true,
      state: "off",
      target_temp: 21,
    },
    {
      id: "door_1",
      name: "Porte",
      type: "door",
      is_iot: false,
      state: "closed",
    },
  ];

  editRoomModules(enseigneId, pieceId); // Refresh
}

function saveRoomModules(enseigneId, pieceId) {
  const enseigne = settingsConfig.lieux.enseignes.find(
    (e) => e.id === enseigneId,
  );
  const piece = enseigne.pieces.find((p) => p.id === pieceId);

  if (piece && piece.modules) {
    piece.modules.forEach((mod, idx) => {
      const cb = document.getElementById(`mod_iot_${idx}`);
      if (cb) {
        mod.is_iot = cb.checked;
      }
    });
  }

  // Sauvegarde en utilisant le même endpoint que settings.js
  saveConfig(settingsConfig)
    .then(() => {
      if (typeof showNotification === "function")
        showNotification("Modules enregistrés");
      closeEditModal();
    })
    .catch((err) => {
      console.error(err);
      if (typeof showNotification === "function")
        showNotification("Erreur lors de la sauvegarde", true);
    });
}

function closeEditModal() {
  const modal = document.getElementById("modulesModal");
  if (modal) modal.style.display = "none";
}
