/**
 * Script de la page Paramètres: extrait depuis settings.html
 * - Aucune logique inline dans le HTML
 * - Requiert js/utils.js et js/config-loader.js
 */

let settingsConfig = null; // configuration courante (local à cette page)
let currentSection = "";
let wsManager = null;

// Initialize WebSocket connection
// Initialize WebSocket connection
document.addEventListener("DOMContentLoaded", () => {
  // Use global instance if available
  if (window.wsManager) {
    wsManager = window.wsManager;
    // Connection is already handled by websocket-manager.js
    if (!wsManager.isConnectionActive()) {
      wsManager.connect();
    }

    setupListeners();
  } else {
    // Fallback if not loaded globally (should not happen with correct script order)
    console.warn("Global WebSocketManager not found, creating local instance");
    if (typeof WebSocketManager !== "undefined") {
      wsManager = new WebSocketManager();
      wsManager.connect();
      setupListeners();
    }
  }

  function setupListeners() {
    // Listen for config updates
    wsManager.listeners.set("config_updated", (data) => {
      console.log("🔄 Config updated remotely:", data);
      if (data && data.config) {
        settingsConfig = data.config;

        // Refresh UI based on current section
        // We re-render everything to be safe
        loadConfigToUI();
        renderEnseignes();

        showNotification(
          window.i18n && window.i18n.t
            ? window.i18n.t("notifications.config_synced") ||
                "Configuration synchronisée"
            : "Configuration synchronisée",
        );
      }
    });

    // Also listen for generic 'all' topic if needed
    wsManager.listeners.set("all", (data) => {
      if (data.type === "config_updated" && data.config) {
        settingsConfig = data.config;
        loadConfigToUI();
        renderEnseignes();
      }
    });
  }
});

// Navigation des sections
function showSection(id) {
  document.querySelectorAll(".section").forEach((section) => {
    section.classList.remove("active");
  });
  const target = document.getElementById(id);
  if (target) target.classList.add("active");

  document
    .querySelectorAll(".menu li")
    .forEach((item) => item.classList.remove("active"));
  // prefer explicit data-section attribute (keeps ids stable across translations)
  const activeItem = [...document.querySelectorAll(".menu li")].find(
    (li) =>
      (li.dataset && li.dataset.section
        ? li.dataset.section
        : li.textContent.trim().toLowerCase()) === id,
  );
  if (activeItem) activeItem.classList.add("active");
}

// Modale d'info
function openModal() {
  ModalManager.open("infoModal");
}
function closeModal() {
  ModalManager.close("infoModal");
}

// Helpers chemin
function getByPath(obj, path) {
  return path.split(".").reduce((o, i) => (o ? o[i] : undefined), obj);
}
function setByPath(obj, path, value) {
  const parts = path.split(".");
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
  if (!s) return "file";
  try {
    // normalize and remove diacritics
    s = s.normalize("NFD").replace(/[\u0000-\u036f]/g, "");
  } catch (e) {}
  const res = String(s)
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_\-]/g, "");
  return res || "file";
}

// Groupe de champs dynamique pour la modale d'édition
function createFormGroup(label, path, value) {
  const group = document.createElement("div");
  group.className = "form-group";

  const labelEl = document.createElement("label");
  const t =
    window.i18n && typeof window.i18n.t === "function"
      ? window.i18n.t
      : () => undefined;
  // If caller passed an i18n key (contains a dot), use it directly
  if (typeof label === "string" && label.indexOf(".") >= 0) {
    const key = label;
    const resolved = (t && t(key)) || label;
    labelEl.textContent = resolved;
    try {
      labelEl.setAttribute("data-i18n", key);
    } catch (e) {}
  } else {
    // try to resolve a translation key from the human label (fallback to original)
    const sanitizeKey = (s) => {
      try {
        s = s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      } catch (e) {}
      return String(s)
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "");
    };
    // primary candidate
    const candidate = `settings.fields.${sanitizeKey(label)}`;
    // secondary candidate: remove short stop words like 'de','du','la','le','des','d'
    const stripped = String(label).replace(
      /\b(de|du|des|la|le|les|d')\b/gi,
      " ",
    );
    const candidate2 = `settings.fields.${sanitizeKey(stripped)}`;
    let translatedLabel = (t && t(candidate)) || (t && t(candidate2)) || label;
    labelEl.textContent = translatedLabel;
    // attach best candidate key if it exists in translations, otherwise attach candidate so MutationObserver can still try
    try {
      if (t && t(candidate)) labelEl.setAttribute("data-i18n", candidate);
      else if (t && t(candidate2))
        labelEl.setAttribute("data-i18n", candidate2);
      else labelEl.setAttribute("data-i18n", candidate);
    } catch (e) {}
  }

  let input;
  if (typeof value === "boolean") {
    const switchLabel = document.createElement("label");
    switchLabel.className = "switch";
    input = document.createElement("input");
    input.type = "checkbox";
    input.checked = value;
    input.name = path;
    const slider = document.createElement("span");
    slider.className = "slider";
    switchLabel.appendChild(input);
    switchLabel.appendChild(slider);
    input.className = "form-control";
    group.appendChild(labelEl);
    group.appendChild(switchLabel);
    return group;
  }

  if (Array.isArray(value)) {
    input = document.createElement("input");
    input.type = "text";
    input.value = value.join(", ");
    input.setAttribute("data-i18n-placeholder", "placeholders.comma_list");
  } else if (path.endsWith(".langue") || path === "affichage.langue") {
    input = document.createElement("select");
    input.name = path;
    // prefer language codes as option values so saving writes codes (fr/en) while keeping label for display
    const langs = [
      ["fr", "Français"],
      ["en", "English"],
      ["es", "Español"],
      ["de", "Deutsch"],
      ["it", "Italiano"],
    ];
    langs.forEach(([code, _label]) => {
      const o = document.createElement("option");
      // store the code as the option value (preferred)
      o.value = code;
      // also keep dataset.lang for compatibility
      o.dataset.lang = code;
      // use i18n for option label when available and attach data-i18n so it updates on language change
      const optKey = `languages.${code}`;
      const optText =
        t && typeof t === "function" ? t(optKey) || _label : _label;
      o.textContent = optText;
      try {
        o.setAttribute("data-i18n", optKey);
      } catch (e) {}
      // mark selected if stored value is either the code or the human label (backwards compatibility)
      if (
        (value || "").toString() === code ||
        (value || "").toString() === _label
      )
        o.selected = true;
      input.appendChild(o);
    });
  } else if (
    path.endsWith(".localisation") ||
    path === "affichage.localisation"
  ) {
    input = document.createElement("select");
    input.name = path;
    [
      "Europe, Paris",
      "Europe, Lyon",
      "North America, New York",
      "Asia, Tokyo",
      "Other",
    ].forEach((opt) => {
      const o = document.createElement("option");
      o.value = opt;
      o.textContent = opt;
      if ((value || "").toString() === opt) o.selected = true;
      input.appendChild(o);
    });
  } else if (path.endsWith(".email")) {
    input = document.createElement("input");
    input.type = "email";
    input.value = value || "";
  } else if (path.endsWith(".telephone")) {
    input = document.createElement("input");
    input.type = "tel";
    input.pattern = "[+0-9 ]{10,}";
    input.value = value || "";
  } else if (path.endsWith(".date_naissance")) {
    input = document.createElement("input");
    input.type = "date";
    input.value = value || "";
  } else {
    input = document.createElement("input");
    input.type = "text";
    input.value = value || "";
  }

  input.className = "form-control";
  input.name = path;
  group.appendChild(labelEl);
  group.appendChild(input);
  return group;
}

// Modale d'édition générique
function openEditModalWith(htmlTitle, formHtml, onsubmit) {
  const modal = document.getElementById("editModal");
  const form = document.getElementById("editForm");
  // allow passing an i18n key as title. If htmlTitle matches a key in translations, use it;
  // otherwise fall back to the provided string. Also attach data-i18n so it updates on language change.
  try {
    const titleEl = modal.querySelector("h2");
    if (titleEl) {
      titleEl.setAttribute("data-i18n", htmlTitle);
      const t =
        window.i18n && typeof window.i18n.t === "function"
          ? window.i18n.t
          : () => undefined;
      const resolved = (t && t(htmlTitle)) || htmlTitle;
      titleEl.textContent = resolved;
    }
  } catch (e) {
    try {
      modal.querySelector("h2").textContent = htmlTitle;
    } catch (_) {}
  }
  form.innerHTML = formHtml;
  form.onsubmit = async (e) => {
    e.preventDefault();
    await onsubmit(new FormData(form));
  };
  modal.style.display = "flex";
}

// Ouvre le modal pour éditer un seul champ data-path
function openEditModal(element) {
  if (!element || element.dataset.readonly === "true") return;
  const path = element.getAttribute("data-path");
  if (!path) return;
  const value = getByPath(settingsConfig, path);

  const modal = document.getElementById("editModal");
  const form = document.getElementById("editForm");
  form.innerHTML = "";

  const group = createFormGroup("Modifier", path, value);
  let inputEl =
    group.querySelector("input, select, textarea") ||
    group.querySelector(".switch input");
  if (inputEl) {
    inputEl.dataset.path = path;
    inputEl.name = "value";
  }
  form.appendChild(group);

  form.onsubmit = async (e) => {
    e.preventDefault();
    let newVal;
    if (!inputEl) newVal = null;
    else if (inputEl.type === "checkbox") newVal = !!inputEl.checked;
    else if (inputEl.tagName.toLowerCase() === "select") newVal = inputEl.value;
    else newVal = inputEl.value;

    if (Array.isArray(value))
      newVal = String(newVal || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

    const updates = {};
    setByPath(updates, path, newVal);
    setByPath(settingsConfig, path, newVal);
    try {
      await saveConfig(updates);

      if (Array.isArray(newVal)) element.textContent = newVal.join(", ");
      else if (typeof newVal === "boolean")
        element.innerHTML = `<span class="badge ${newVal ? "badge-yes" : "badge-no"}">${newVal ? (window.i18n && window.i18n.t ? window.i18n.t("actions.yes") || "Oui" : "Oui") : window.i18n && window.i18n.t ? window.i18n.t("actions.no") || "Non" : "Non"}</span>`;
      else element.textContent = newVal || "—";

      // If the edited field is the language, apply it immediately (single-field edit flow)
      try {
        if (path === "affichage.langue") {
          let appliedCode = null;
          if (
            inputEl &&
            inputEl.tagName &&
            inputEl.tagName.toLowerCase() === "select"
          ) {
            const opt = inputEl.options[inputEl.selectedIndex];
            appliedCode =
              opt && opt.value
                ? opt.value
                : opt && opt.dataset && opt.dataset.lang
                  ? opt.dataset.lang
                  : null;
          } else {
            // newVal may be a code or a human label; attempt to derive
            if (/^[a-z]{2}$/i.test(String(newVal || "")))
              appliedCode = String(newVal).toLowerCase();
            else {
              try {
                const langsObj =
                  window.i18n && typeof window.i18n.t === "function"
                    ? window.i18n.t("languages")
                    : null;
                if (langsObj) {
                  for (const k in langsObj) {
                    if (
                      langsObj[k] &&
                      String(langsObj[k]).toLowerCase() ===
                        String(newVal).toLowerCase()
                    ) {
                      appliedCode = k;
                      break;
                    }
                  }
                }
              } catch (e) {}
            }
          }
          if (
            appliedCode &&
            window.i18n &&
            typeof window.i18n.setLanguage === "function"
          ) {
            try {
              window.i18n.setLanguage(appliedCode);
            } catch (e) {
              console.warn("i18n.setLanguage failed", e);
            }
          }
          // update displayed label to localized name if possible
          try {
            const t =
              window.i18n && typeof window.i18n.t === "function"
                ? window.i18n.t
                : () => undefined;
            const display =
              t && appliedCode
                ? t(`languages.${appliedCode}`) || appliedCode
                : newVal || "—";
            if (element) element.textContent = display;
          } catch (e) {}
        }
      } catch (e) {
        console.warn("language apply in openEditModal failed", e);
      }

      modal.style.display = "none";
      showNotification(
        window.i18n && window.i18n.t
          ? window.i18n.t("notifications.saved") || "Modification sauvegardée"
          : "Modification sauvegardée",
      );
    } catch (err) {
      console.error(err);
      showNotification(
        window.i18n && window.i18n.t
          ? window.i18n.t("notifications.save_error") ||
              "Erreur lors de la sauvegarde"
          : "Erreur lors de la sauvegarde",
        true,
      );
    }
  };

  modal.querySelector("h2").textContent = "Modifier";
  modal.style.display = "block";
}

/* ========== Gestion des enseignes & pièces ========== */
function renderEnseignes() {
  const container = document.getElementById("enseignes-list");
  if (
    !container ||
    !settingsConfig ||
    !settingsConfig.lieux ||
    !Array.isArray(settingsConfig.lieux.enseignes)
  )
    return;

  container.innerHTML = "";
  settingsConfig.lieux.enseignes.forEach((enseigne) => {
    const card = document.createElement("div");
    card.className =
      "location-card" +
      (settingsConfig.lieux.active === enseigne.id ? " active" : "");
    const t =
      window.i18n && typeof window.i18n.t === "function"
        ? window.i18n.t
        : () => undefined;
    const editLabel = (t && t("actions.edit")) || "Modifier";
    const removeLabel = (t && t("actions.remove")) || "Supprimer";
    const addRoomLabel =
      (t && t("actions.add_location")) || "Ajouter une pièce";
    const confirmTitle = (t && t("actions.confirm")) || "Confirmation";
    const confirmMessage =
      (t && t("notifications.confirm_delete_message")) ||
      "Voulez-vous vraiment supprimer ?";
    const yesLabel = (t && t("actions.yes")) || "Oui";
    const cancelLabel = (t && t("actions.cancel")) || "Annuler";

    const roomsHtml = (enseigne.pieces || [])
      .map((piece) => {
        return `<span class="room-tag">
        ${escapeHtml(piece.nom)} 
        <button class="edit-room-btn" title="Gérer les modules" onclick="editRoomModules('${enseigne.id}','${piece.id}')" style="background:none; border:none; cursor:pointer; font-size:12px; margin-left:5px;">⚙️</button>
        <button class="remove-btn" title="${removeLabel}" onclick="removePiece('${enseigne.id}','${piece.id}')">×</button>
      </span>`;
      })
      .join("");

    card.innerHTML = `
      <div class="actions">
        <button class="edit-btn" onclick="editEnseigne('${enseigne.id}')"><img src="/assets/icons/edit.png" alt="${editLabel}"></button>
        <button class="remove-btn" onclick="removeEnseigne('${enseigne.id}')"><img src="/assets/icons/delete.png" alt="${removeLabel}"></button>
      </div>
      <h3>${escapeHtml(enseigne.nom || "—")}</h3>
      <p class="muted">${escapeHtml(enseigne.adresse || "")}</p>
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
    const btnRoom = card.querySelector(".btn-room");
    if (btnRoom) {
      // preserve img if present
      const img = btnRoom.querySelector("img");
      // clear and rebuild: <img> + <span data-i18n="actions.add_location">...</span>
      btnRoom.innerHTML = "";
      if (img) btnRoom.appendChild(img);
      const lbl = document.createElement("span");
      lbl.className = "btn-room-label";
      lbl.setAttribute("data-i18n", "actions.add_location");
      lbl.textContent = addRoomLabel;
      btnRoom.appendChild(lbl);
      // set tooltip/title to be translatable as well
      try {
        btnRoom.setAttribute("data-i18n-title", "actions.add_location");
      } catch (e) {}
    }

    container.appendChild(card);
  });

  enableDragAndDrop();
  enablePieceDragAndDrop();
}

function enableDragAndDrop() {
  const container = document.getElementById("enseignes-list");
  if (!container) return;

  container.querySelectorAll(".location-card").forEach((card) => {
    let draggedCard = null;
    card.draggable = true;

    card.addEventListener("dragstart", (e) => {
      draggedCard = card;
      e.dataTransfer.effectAllowed = "move";
      card.classList.add("dragging");
    });

    card.addEventListener("dragend", () => {
      card.classList.remove("dragging");
      draggedCard = null;

      const newOrder = Array.from(container.children)
        .map((el) => {
          const name = el.querySelector("h3")?.textContent.trim();
          return settingsConfig.lieux.enseignes.find((e) => e.nom === name)?.id;
        })
        .filter(Boolean);

      settingsConfig.lieux.enseignes.sort(
        (a, b) => newOrder.indexOf(a.id) - newOrder.indexOf(b.id),
      );
      if (settingsConfig.lieux.enseignes.length > 0)
        settingsConfig.lieux.active = settingsConfig.lieux.enseignes[0].id;

      saveConfig(settingsConfig)
        .then(() =>
          showNotification(
            window.i18n && window.i18n.t
              ? window.i18n.t("notifications.order_saved") ||
                  "Nouvel ordre enregistré"
              : "Nouvel ordre enregistré",
          ),
        )
        .catch((err) => console.error(err));
      e.preventDefault();
      const dragging = container.querySelector(".dragging");
      const afterElement = getDragAfterElementHorizontal(container, e.clientX);
      if (!afterElement) container.appendChild(dragging);
      else container.insertBefore(dragging, afterElement);
    });
  });

  function getDragAfterElementHorizontal(container, x) {
    const draggableElements = [
      ...container.querySelectorAll(".location-card:not(.dragging)"),
    ];
    return draggableElements.reduce(
      (closest, child) => {
        const box = child.getBoundingClientRect();
        const offset = x - box.left - box.width / 2;
        if (offset < 0 && offset > closest.offset)
          return { offset, element: child };
        else return closest;
      },
      { offset: Number.NEGATIVE_INFINITY },
    ).element;
  }
}

function enablePieceDragAndDrop() {
  document.querySelectorAll(".rooms").forEach((roomContainer) => {
    roomContainer.querySelectorAll(".room-tag").forEach((tag) => {
      let draggedTag = null;
      tag.draggable = true;

      tag.addEventListener("dragstart", (e) => {
        draggedTag = tag;
        e.dataTransfer.effectAllowed = "move";
        tag.classList.add("dragging");
      });

      tag.addEventListener("dragend", () => {
        tag.classList.remove("dragging");
        draggedTag = null;

        const enseigneCard = tag.closest(".location-card");
        const enseigneName = enseigneCard
          .querySelector("h3")
          .textContent.trim();
        const enseigne = settingsConfig.lieux.enseignes.find(
          (e) => e.nom === enseigneName,
        );
        if (!enseigne) return;

        const newOrder = Array.from(roomContainer.children)
          .map((el) => {
            const name = el.textContent.replace("×", "").trim();
            return enseigne.pieces.find((p) => p.nom === name)?.id;
          })
          .filter(Boolean);

        enseigne.pieces.sort(
          (a, b) => newOrder.indexOf(a.id) - newOrder.indexOf(b.id),
        );

        saveConfig(settingsConfig)
          .then(() =>
            showNotification(
              window.i18n && window.i18n.t
                ? window.i18n.t("notifications.rooms_order_saved") ||
                    "Ordre des pièces enregistré"
                : "Ordre des pièces enregistré",
            ),
          )
          .catch((err) => console.error(err));

        e.preventDefault();
        const dragging = roomContainer.querySelector(".dragging");
        const afterElement = getDragAfterElement(roomContainer, e.clientX);
        if (!afterElement) roomContainer.appendChild(dragging);
        else roomContainer.insertBefore(dragging, afterElement);
      });
    });

    function getDragAfterElement(container, x) {
      const draggableElements = [
        ...container.querySelectorAll(".room-tag:not(.dragging)"),
      ];
      return draggableElements.reduce(
        (closest, child) => {
          const box = child.getBoundingClientRect();
          const offset = x - box.left - box.width / 2;
          if (offset < 0 && offset > closest.offset)
            return { offset, element: child };
          else return closest;
        },
        { offset: Number.NEGATIVE_INFINITY },
      ).element;
    }
  });
}

async function addEnseigne() {
  openEditModalWith(
    "modals.add_brand",
    `
    <div class="form-group"><label data-i18n="settings.fields.nom">Nom</label><input name="nom" type="text" required></div>
    <div class="form-group"><label data-i18n="settings.fields.adresse">Adresse</label><input name="adresse" type="text"></div>
  `,
    async (formData) => {
      const newEn = {
        id: "ens_" + Date.now(),
        nom: formData.get("nom"),
        adresse: formData.get("adresse") || "",
        pieces: [],
      };
      if (!settingsConfig.lieux)
        settingsConfig.lieux = { enseignes: [], active: null };
      if (!Array.isArray(settingsConfig.lieux.enseignes))
        settingsConfig.lieux.enseignes = [];
      // validate unique enseigne name (case-insensitive)
      const newName = (newEn.nom || "").toString().trim().toLowerCase();
      const duplicate = (settingsConfig.lieux.enseignes || []).some(
        (e) => (e.nom || "").toString().trim().toLowerCase() === newName,
      );
      if (duplicate) {
        showNotification(
          window.i18n && window.i18n.t
            ? window.i18n.t("notifications.location_exists") ||
                "Une enseigne avec ce nom existe déjà"
            : "Une enseigne avec ce nom existe déjà",
          true,
        );
        // close modal and do not add
        document.getElementById("editModal").style.display = "none";
        return;
      }
      settingsConfig.lieux.enseignes.push(newEn);
      settingsConfig.lieux.active = newEn.id;

      try {
        await saveConfig(settingsConfig);
        document.getElementById("editModal").style.display = "none";
        showNotification(
          window.i18n && window.i18n.t
            ? window.i18n.t("notifications.add_success") ||
                "Enseigne ajoutée avec succès"
            : "Enseigne ajoutée avec succès",
        );
        renderEnseignes();
      } catch (err) {
        console.error(err);
        showNotification(
          window.i18n && window.i18n.t
            ? window.i18n.t("notifications.add_error") ||
                "Erreur lors de l'ajout de l'enseigne"
            : "Erreur lors de l'ajout de l'enseigne",
          true,
        );
      }
    },
  );
}

async function addPiece(enseigneId) {
  openEditModalWith(
    "modals.add_room",
    `
    <div class="form-group"><label data-i18n="settings.fields.nom">Nom de la pièce</label><input name="nom" type="text" required></div>
    <div class="form-group"><label data-i18n="settings.fields.type">Type</label>
      <select name="type" class="styled-select">
        <option value="salon">Salon</option>
        <option value="cuisine">Cuisine</option>
        <option value="chambre">Chambre</option>
        <option value="bureau">Bureau</option>
        <option value="autre">Autre</option>
      </select>
    </div>
    <div class="form-group">
      <label data-i18n="modals.glb_label">Modèle 3D (.glb)</label>
      <div id="glbDropZone" style="border: 2px dashed #ccc; padding: 20px; text-align: center; cursor: pointer;" data-i18n="modals.glb_drop">Glissez-déposez un fichier .glb ici</div>
      <input type="file" id="glbInput" accept=".glb" style="display: none;">
      <p id="glbFileName" style="font-size: 0.9em; color: #555;"></p>
    </div>
  `,
    async (formData) => {
      const enseigne = (settingsConfig.lieux.enseignes || []).find(
        (e) => e.id === enseigneId,
      );
      if (!enseigne) {
        showNotification(
          window.i18n && window.i18n.t
            ? window.i18n.t("notifications.location_not_found") ||
                "Enseigne non trouvée"
            : "Enseigne non trouvée",
          true,
        );
        return;
      }
      // get piece name + type
      const pieceName = formData.get("nom");
      const pieceType = formData.get("type");

      const piece = {
        id: "piece_" + Date.now(),
        nom: pieceName,
        type: pieceType,
        glbModel: null,
      };
      if (!Array.isArray(enseigne.pieces)) enseigne.pieces = [];
      enseigne.pieces.push(piece);
      try {
        if (glbFile) {
          // Build filename
          const rawEns = String(enseigne.id || enseigneId || "unknown");
          const rawPiece = String(piece.id || Date.now());
          const ensSuffix = rawEns.replace(/^ens[_-]?/, "") || "unknown";
          const pieceSuffix =
            rawPiece.replace(/^piece[_-]?/, "") || String(Date.now());
          const filename = `ens_${ensSuffix}_piece_${pieceSuffix}.glb`;

          // Upload direct via backend (multipart)
          const form = new FormData();
          form.append("file", glbFile, glbFile.name);
          form.append("filename", filename);

          let token = null;
          try {
            token = await getAuthToken();
          } catch (e) {}
          const headers = {};
          if (token) headers["Authorization"] = `Bearer ${token}`;

          const uploadResp = await fetch("/api/rooms/files", {
            method: "PUT",
            headers: headers,
            body: form,
          });

          if (!uploadResp.ok)
            throw new Error("Erreur lors de l'upload vers Storage");
          const uploadData = await uploadResp.json();

          // Save public URL in config
          piece.glbModel = uploadData.path;
        }
      } catch (err) {
        console.error("Upload GLB error", err);
        showNotification(
          window.i18n && window.i18n.t
            ? window.i18n.t("notifications.upload_error") ||
                "Erreur lors de l’upload du modèle 3D"
            : "Erreur lors de l’upload du modèle 3D",
          true,
        );
      }

      try {
        if (typeof saveConfigAll === "function") {
          await saveConfigAll();
        } else {
          // Fallback or old method
          await saveConfig(settingsConfig);
        }
        document.getElementById("editModal").style.display = "none";
        showNotification(
          window.i18n && window.i18n.t
            ? window.i18n.t("notifications.piece_added") ||
                "Pièce ajoutée avec succès"
            : "Pièce ajoutée avec succès",
        );
        renderEnseignes();
      } catch (err) {
        console.error(err);
        showNotification(
          window.i18n && window.i18n.t
            ? window.i18n.t("notifications.piece_add_error") ||
                "Erreur lors de l'ajout de la pièce"
            : "Erreur lors de l'ajout de la pièce",
          true,
        );
      }
    },
  );

  const dropZone = document.getElementById("glbDropZone");
  const fileInput = document.getElementById("glbInput");
  let glbFile = null;

  function handleGLBFile(file) {
    if (!file || !file.name.toLowerCase().endsWith(".glb")) {
      showNotification(
        window.i18n && window.i18n.t
          ? window.i18n.t("notifications.file_invalid") ||
              "Fichier .glb invalide"
          : "Fichier .glb invalide",
        true,
      );
      return;
    }
    glbFile = file;
    document.getElementById("glbFileName").textContent = file.name;
  }

  dropZone.addEventListener("click", () => fileInput.click());
  dropZone.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropZone.style.borderColor = "#4CAF50";
  });
  dropZone.addEventListener("dragleave", () => {
    dropZone.style.borderColor = "#ccc";
  });
  dropZone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropZone.style.borderColor = "#ccc";
    handleGLBFile(e.dataTransfer.files[0]);
  });
  fileInput.addEventListener("change", () => {
    handleGLBFile(fileInput.files[0]);
  });
}

async function editEnseigne(enseigneId) {
  const enseigne = (settingsConfig.lieux.enseignes || []).find(
    (e) => e.id === enseigneId,
  );
  if (!enseigne) {
    showNotification(
      window.i18n && window.i18n.t
        ? window.i18n.t("notifications.location_not_found") ||
            "Enseigne non trouvée"
        : "Enseigne non trouvée",
      true,
    );
    return;
  }

  openEditModalWith(
    "modals.edit_brand",
    `
    <div class="form-group"><label data-i18n="settings.fields.nom">Nom</label><input name="nom" type="text" value="${escapeHtml(enseigne.nom)}" required></div>
    <div class="form-group"><label data-i18n="settings.fields.adresse">Adresse</label><input name="adresse" type="text" value="${escapeHtml(enseigne.adresse || "")}"></div>
  `,
    async (formData) => {
      const newName = (formData.get("nom") || "").toString().trim();
      // check uniqueness among other enseignes
      const conflict = (settingsConfig.lieux.enseignes || []).some(
        (e) =>
          e.id !== enseigneId &&
          (e.nom || "").toString().trim().toLowerCase() ===
            newName.toLowerCase(),
      );
      if (conflict) {
        showNotification(
          window.i18n && window.i18n.t
            ? window.i18n.t("notifications.location_exists") ||
                "Une autre enseigne utilise déjà ce nom"
            : "Une autre enseigne utilise déjà ce nom",
          true,
        );
        return;
      }
      enseigne.nom = newName;
      enseigne.adresse = formData.get("adresse");

      try {
        await saveConfig(settingsConfig);
        document.getElementById("editModal").style.display = "none";
        showNotification(
          window.i18n && window.i18n.t
            ? window.i18n.t("notifications.update_success") ||
                "Enseigne modifiée avec succès"
            : "Enseigne modifiée avec succès",
        );
        renderEnseignes();
      } catch (err) {
        console.error(err);
        showNotification(
          window.i18n && window.i18n.t
            ? window.i18n.t("notifications.update_error") ||
                "Erreur lors de la modification de l'enseigne"
            : "Erreur lors de la modification de l'enseigne",
          true,
        );
        loadConfigToUI();
      }
    },
  );
}

function showConfirmation(message, callback) {
  const modal = document.getElementById("confirmModal");
  if (!modal) {
    callback(confirm(message));
    return;
  }
  document.getElementById("confirmMessage").textContent = message;
  modal.style.display = "flex";
  const yesBtn = document.getElementById("confirmYes");
  const noBtn = document.getElementById("confirmNo");
  const cleanup = () => {
    modal.style.display = "none";
    yesBtn.onclick = null;
    noBtn.onclick = null;
  };
  yesBtn.onclick = () => {
    cleanup();
    callback(true);
  };
  noBtn.onclick = () => {
    cleanup();
    callback(false);
  };
}

async function removeEnseigne(enseigneId) {
  showConfirmation("Supprimer cette enseigne ?", async (confirmed) => {
    if (!confirmed) return;
    // collect GLB paths to delete for all pieces of the enseigne
    const enseigne = (settingsConfig.lieux.enseignes || []).find(
      (e) => e.id === enseigneId,
    );
    const pathsToDelete = [];
    if (enseigne && Array.isArray(enseigne.pieces)) {
      enseigne.pieces.forEach((p) => {
        if (p && p.glbModel) pathsToDelete.push(p.glbModel);
      });
    }
    try {
      if (pathsToDelete.length > 0) {
        const delResp = await fetch("/api/rooms/files", {
          method: "DELETE",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(pathsToDelete),
        });
        if (!delResp.ok)
          console.error(
            "Delete files failed:",
            delResp.status,
            delResp.statusText,
          );
        else {
          const delResult = await delResp.json();
          console.log("Delete files result:", delResult);
        }
      }
    } catch (err) {
      console.error("Erreur suppression fichiers GLB:", err);
      showNotification(
        window.i18n && window.i18n.t
          ? window.i18n.t("notifications.delete_files_error") ||
              "Erreur lors de la suppression des fichiers 3D"
          : "Erreur lors de la suppression des fichiers 3D",
        true,
      );
    }

    settingsConfig.lieux.enseignes = (
      settingsConfig.lieux.enseignes || []
    ).filter((e) => e.id !== enseigneId);
    if (settingsConfig.lieux.active === enseigneId)
      settingsConfig.lieux.active =
        (settingsConfig.lieux.enseignes[0] || {}).id || null;
    await saveConfigAll();
    showNotification(
      window.i18n && window.i18n.t
        ? window.i18n.t("notifications.delete_success") ||
            "Enseigne supprimée avec succès"
        : "Enseigne supprimée avec succès",
    );
    renderEnseignes();
  });
}

async function removePiece(enseigneId, pieceId) {
  showConfirmation("Supprimer cette pièce ?", async (confirmed) => {
    if (!confirmed) return;
    const enseigne = (settingsConfig.lieux.enseignes || []).find(
      (e) => e.id === enseigneId,
    );
    if (!enseigne) return;
    const piece = (enseigne.pieces || []).find((p) => p.id === pieceId);
    const pathsToDelete = [];
    if (piece && piece.glbModel) pathsToDelete.push(piece.glbModel);
    try {
      if (pathsToDelete.length > 0) {
        const delResp = await fetch("/api/rooms/files", {
          method: "DELETE",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(pathsToDelete),
        });
        if (!delResp.ok)
          console.error(
            "Delete files failed:",
            delResp.status,
            delResp.statusText,
          );
        else {
          const delResult = await delResp.json();
          console.log("Delete files result:", delResult);
        }
      }
    } catch (err) {
      console.error("Erreur suppression fichier GLB:", err);
      showNotification(
        window.i18n && window.i18n.t
          ? window.i18n.t("notifications.delete_file_error") ||
              "Erreur lors de la suppression du fichier 3D"
          : "Erreur lors de la suppression du fichier 3D",
        true,
      );
    }

    enseigne.pieces = (enseigne.pieces || []).filter((p) => p.id !== pieceId);
    await saveConfigAll();
    showNotification(
      window.i18n && window.i18n.t
        ? window.i18n.t("notifications.piece_deleted") ||
            "Pièce supprimée avec succès"
        : "Pièce supprimée avec succès",
    );
    renderEnseignes();
  });
}

// Enregistrement global de la configuration (envoi complet si nécessaire)
async function saveConfigAll() {
  try {
    await saveConfig(settingsConfig);
  } catch (err) {
    console.error("Erreur lors de la sauvegarde:", err);
    throw new Error("Erreur lors de la sauvegarde");
  }
}

// Édition par section (modale multi-champs)
function editSection(sectionId) {
  currentSection = sectionId;
  const modal = document.getElementById("editModal");
  const form = document.getElementById("editForm");
  form.innerHTML = "";
  form.onsubmit = async (e) => {
    e.preventDefault();
    await saveConfigSection();
  };

  const sectionConfig = {
    vous: [
      ["settings.fields.nom", "vous.nom"],
      ["settings.fields.prenom", "vous.prenom"],
      ["settings.fields.date_naissance", "vous.date_naissance"],
      ["settings.fields.email", "vous.email"],
      ["settings.fields.telephone", "vous.telephone"],
      ["settings.fields.adresse", "vous.adresse"],
    ],
    assurance: [
      ["settings.fields.nom", "assurance.nom"],
      ["settings.fields.email", "assurance.email"],
      ["settings.fields.telephone", "assurance.telephone"],
      ["settings.fields.adresse", "assurance.adresse"],
    ],
    syndicat: [
      ["settings.fields.nom", "syndicat.nom"],
      ["settings.fields.email", "syndicat.email"],
      ["settings.fields.telephone", "syndicat.telephone"],
      ["settings.fields.adresse", "syndicat.adresse"],
    ],
    mode: [["settings.fields.mode_affichage", "affichage.mode"]],
    "langue & localisation": [
      ["settings.fields.langue", "affichage.langue"],
      ["settings.fields.localisation", "affichage.localisation"],
    ],
    technologies: [
      ["settings.fields.email", "notifications.technologies.email"],
      ["settings.fields.sms", "notifications.technologies.sms"],
      ["settings.fields.push", "notifications.technologies.push"],
    ],
    type: [
      ["settings.fields.alertes", "notifications.types.alertes"],
      ["settings.fields.rappels", "notifications.types.rappels"],
      ["settings.fields.newsletters", "notifications.types.newsletters"],
    ],
    enseigne: [
      ["settings.fields.nom", "lieux.enseigne"],
      ["settings.fields.pieces", "lieux.pieces"],
    ],
  };

  const fields = sectionConfig[sectionId] || [];
  fields.forEach(([label, path]) => {
    const value = getByPath(settingsConfig, path);
    form.appendChild(createFormGroup(label, path, value));
  });
  modal.style.display = "block";
}

async function saveConfigSection() {
  const form = document.getElementById("editForm");
  const formData = new FormData(form);
  let updates = {};
  // remember previous language to detect change
  const prevLang = getByPath(settingsConfig, "affichage.langue");
  for (const [path, value] of formData.entries()) {
    const input = form.querySelector(`[name="${path}"]`);
    let finalValue = value;
    if (input.type === "checkbox") finalValue = input.checked;
    else if (input.name.endsWith(".pieces"))
      finalValue = value
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    else if (typeof getByPath(settingsConfig, path) === "boolean")
      finalValue =
        value.toLowerCase() === "true" ||
        value === "1" ||
        value.toLowerCase() === "oui";
    // Special handling for language fields: store language code (fr/en) and include label for compatibility
    if (path.endsWith(".langue") || path === "affichage.langue") {
      try {
        const sel = input;
        const selectedOption =
          sel && sel.options && sel.options[sel.selectedIndex];
        // prefer the option.value (we store codes as values); fallback to dataset.lang
        const codeValue = selectedOption
          ? selectedOption.value ||
            (selectedOption.dataset && selectedOption.dataset.lang) ||
            finalValue
          : finalValue;
        const humanLabel = selectedOption
          ? selectedOption.textContent || finalValue
          : finalValue;
        setByPath(updates, path, codeValue);
        setByPath(settingsConfig, path, codeValue);
        // also include a label field for backend compatibility (non-destructive)
        try {
          setByPath(updates, `${path}.__label`, humanLabel);
        } catch (e) {}
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
    const payload =
      Object.keys(updates).length === 0 ? settingsConfig : updates;
    console.info("saveConfigSection: payload ->", payload);
    // Apply language immediately on the client so a backend save failure doesn't block UI language change
    try {
      const selForLang = form.querySelector('[name="affichage.langue"]');
      let immediateCode = null;
      if (selForLang && selForLang.options && selForLang.selectedIndex >= 0) {
        const opt = selForLang.options[selForLang.selectedIndex];
        // prefer the option value (we now store codes as values), fallback to dataset.lang
        immediateCode =
          opt && opt.value
            ? opt.value
            : opt && opt.dataset && opt.dataset.lang
              ? opt.dataset.lang
              : null;
      }
      // fallback: try to derive from stored value
      if (!immediateCode) {
        const derive = (s) => {
          if (!s) return null;
          const k = String(s).toLowerCase();
          if (k.includes("fr")) return "fr";
          if (k.includes("en")) return "en";
          if (k.includes("es")) return "es";
          if (k.includes("de")) return "de";
          if (k.includes("it")) return "it";
          return null;
        };
        immediateCode = derive(getByPath(settingsConfig, "affichage.langue"));
      }
      console.info(
        "saveConfigSection: immediate language code ->",
        immediateCode,
      );
      if (
        immediateCode &&
        window.i18n &&
        typeof window.i18n.setLanguage === "function"
      ) {
        try {
          window.i18n.setLanguage(immediateCode);
        } catch (e) {
          console.warn("i18n.setLanguage failed", e);
        }
      }
    } catch (e) {
      console.warn("saveConfigSection language apply failed", e);
    }

    await saveConfig(payload);

    document.getElementById("editModal").style.display = "none";
    showNotification(
      window.i18n && window.i18n.t
        ? window.i18n.t("notifications.config_saved") ||
            "Configuration sauvegardée avec succès"
        : "Configuration sauvegardée avec succès",
    );
    // rafraîchir affichage
    updateDataPathsDisplay();
    if (typeof renderEnseignes === "function") renderEnseignes();
    // if language changed via the settings modal, apply it through i18n
    try {
      // Try to obtain the language code from the form select (preferred), otherwise derive from stored value
      const sel = form.querySelector('[name="affichage.langue"]');
      let newCode = null;
      if (sel && sel.options && sel.selectedIndex >= 0) {
        const opt = sel.options[sel.selectedIndex];
        newCode =
          opt && opt.value
            ? opt.value
            : opt && opt.dataset && opt.dataset.lang
              ? opt.dataset.lang
              : null;
      }
      const newLangValue = getByPath(settingsConfig, "affichage.langue");
      // helper to derive code from a human value as fallback
      const deriveCodeFromValue = (s) => {
        if (!s) return null;
        const maybe = String(s).trim();
        if (/^[a-z]{2}$/i.test(maybe)) return maybe.toLowerCase();
        // try to find in current translations
        try {
          const langsObj =
            window.i18n && typeof window.i18n.t === "function"
              ? window.i18n.t("languages")
              : null;
          if (langsObj) {
            for (const k in langsObj) {
              if (
                langsObj[k] &&
                String(langsObj[k]).toLowerCase() === maybe.toLowerCase()
              )
                return k;
            }
          }
        } catch (e) {}
        // fallback substring heuristics
        const k = maybe.toLowerCase();
        if (k.includes("fr") || k.includes("franc")) return "fr";
        if (k.includes("en") || k.includes("anglais")) return "en";
        if (k.includes("es") || k.includes("esp")) return "es";
        if (k.includes("de") || k.includes("allem")) return "de";
        if (k.includes("it") || k.includes("ital")) return "it";
        return null;
      };

      const prevCode = deriveCodeFromValue(prevLang);
      if (!newCode) newCode = deriveCodeFromValue(newLangValue);
      if (
        newCode &&
        newCode !== prevCode &&
        window.i18n &&
        typeof window.i18n.setLanguage === "function"
      ) {
        window.i18n.setLanguage(newCode);
      }
    } catch (e) {
      console.warn("i18n apply failed", e);
    }
  } catch (err) {
    console.error(err);
    showNotification(
      window.i18n && window.i18n.t
        ? window.i18n.t("notifications.save_error") ||
            "Erreur lors de la sauvegarde"
        : "Erreur lors de la sauvegarde",
      true,
    );
  }
}

// Remplissage des spans [data-path]
function updateDataPathsDisplay() {
  document.querySelectorAll("[data-path]").forEach((el) => {
    const path = el.getAttribute("data-path");
    const value = getByPath(settingsConfig, path);

    // Handle inputs (text, email, tel, date, select)
    if (
      el.tagName === "INPUT" ||
      el.tagName === "SELECT" ||
      el.tagName === "TEXTAREA"
    ) {
      if (el.type === "checkbox") {
        el.checked = !!value;
      } else if (el.type === "file") {
        // Do nothing for file inputs
      } else {
        el.value = value || "";
      }

      // Handle email fields to make them clickable (mailto)
      if (path.endsWith(".email")) {
        if (el.hasAttribute("readonly")) {
          el.style.cursor = "pointer";
          el.onclick = () => {
            if (el.value) window.location.href = `mailto:${el.value}`;
          };
        } else {
          // For editable fields, add a mail icon button
          const parent = el.parentElement;
          if (parent && parent.classList.contains("form-group")) {
            parent.style.position = "relative";
            let mailBtn = parent.querySelector(".mail-action-btn");
            if (!mailBtn) {
              mailBtn = document.createElement("a");
              mailBtn.className = "mail-action-btn";

              const iconImg = document.createElement("img");
              iconImg.src = "/assets/icons/mail.png";
              iconImg.alt = "Email";
              iconImg.style.width = "20px";
              iconImg.style.height = "20px";
              iconImg.style.verticalAlign = "middle";
              // Invert color for dark mode if needed, or rely on CSS.
              // Assuming the icon is black/dark by default.
              // Let's add a class to the img to control it via CSS if needed.
              iconImg.className = "mail-icon";
              iconImg.style.filter =
                document.body.classList.contains("dark-mode") ||
                window.matchMedia("(prefers-color-scheme: dark)").matches
                  ? "invert(1)"
                  : "none";

              mailBtn.appendChild(iconImg);

              mailBtn.style.position = "absolute";
              mailBtn.style.right = "10px";
              mailBtn.style.bottom = "8px"; // Adjusted for image alignment
              mailBtn.style.textDecoration = "none";
              parent.appendChild(mailBtn);
              el.style.paddingRight = "35px";
            }
            mailBtn.href = value ? `mailto:${value}` : "#";
            mailBtn.style.display = value ? "block" : "none";
          }
        }
      }

      // Handle phone fields to make them clickable (tel)
      if (path.endsWith(".telephone")) {
        if (el.hasAttribute("readonly")) {
          el.style.cursor = "pointer";
          el.onclick = () => {
            if (el.value) window.location.href = `tel:${el.value}`;
          };
        } else {
          // For editable fields, add a phone icon button
          const parent = el.parentElement;
          if (parent && parent.classList.contains("form-group")) {
            parent.style.position = "relative";
            let phoneBtn = parent.querySelector(".phone-action-btn");
            if (!phoneBtn) {
              phoneBtn = document.createElement("a");
              phoneBtn.className = "phone-action-btn";

              const iconImg = document.createElement("img");
              // SVG Phone Icon
              iconImg.src = "../assets/icons/phone.png";
              iconImg.alt = "Téléphone";
              iconImg.style.width = "20px";
              iconImg.style.height = "20px";
              iconImg.style.verticalAlign = "middle";
              iconImg.className = "phone-icon";
              iconImg.style.filter =
                document.body.classList.contains("dark-mode") ||
                window.matchMedia("(prefers-color-scheme: dark)").matches
                  ? "invert(1)"
                  : "none";

              phoneBtn.appendChild(iconImg);

              phoneBtn.style.position = "absolute";
              phoneBtn.style.right = "10px";
              phoneBtn.style.bottom = "8px";
              phoneBtn.style.textDecoration = "none";
              parent.appendChild(phoneBtn);
              el.style.paddingRight = "35px";
            }
            phoneBtn.href = value ? `tel:${value}` : "#";
            phoneBtn.style.display = value ? "block" : "none";
          }
        }
      }

      // Handle address fields to make them clickable (Google Maps)
      if (path.endsWith(".adresse") || path.endsWith(".adresse_postale")) {
        if (el.hasAttribute("readonly")) {
          el.style.cursor = "pointer";
          el.onclick = () => {
            if (el.value)
              window.open(
                `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(el.value)}`,
                "_blank",
              );
          };
        } else {
          // For editable fields, add a map icon button
          const parent = el.parentElement;
          if (parent && parent.classList.contains("form-group")) {
            parent.style.position = "relative";
            let mapBtn = parent.querySelector(".map-action-btn");
            if (!mapBtn) {
              mapBtn = document.createElement("a");
              mapBtn.className = "map-action-btn";

              const iconImg = document.createElement("img");
              // SVG Map Pin Icon
              iconImg.src = "../assets/icons/maps.png";
              iconImg.alt = "Carte";
              iconImg.style.width = "20px";
              iconImg.style.height = "20px";
              iconImg.style.verticalAlign = "middle";
              iconImg.className = "map-icon";
              iconImg.style.filter =
                document.body.classList.contains("dark-mode") ||
                window.matchMedia("(prefers-color-scheme: dark)").matches
                  ? "invert(1)"
                  : "none";

              mapBtn.appendChild(iconImg);

              mapBtn.style.position = "absolute";
              mapBtn.style.right = "10px";
              mapBtn.style.bottom = "8px";
              mapBtn.style.textDecoration = "none";
              mapBtn.target = "_blank";
              parent.appendChild(mapBtn);
              el.style.paddingRight = "35px";
            }
            mapBtn.href = value
              ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(value)}`
              : "#";
            mapBtn.style.display = value ? "block" : "none";
          }
        }
      }

      return;
    }

    // Handle images (avatar)
    if (el.tagName === "IMG") {
      // Default avatar
      const defaultAvatar = "/assets/icons/profil.png";

      // Add timestamp to prevent caching if value exists
      if (value) {
        el.src = `${value}?t=${new Date().getTime()}`;
      } else {
        el.src = defaultAvatar;
      }

      // Add error handler to fallback if image is broken
      el.onerror = function () {
        if (this.getAttribute("src") !== defaultAvatar) {
          this.src = defaultAvatar;
        }
        this.onerror = null; // Prevent infinite loop
      };
      return;
    }

    el.classList.add("value-display");

    // Handle static text displays (like plan name)
    if (path === "abonnement.plan_actuel") {
      const planName = value
        ? String(value).charAt(0).toUpperCase() + String(value).slice(1)
        : "—";
      el.textContent = planName;
      return;
    }

    // Default text content for other non-input elements
    if (Array.isArray(value)) {
      el.textContent = value.join(", ");
    } else {
      el.textContent = value || "—";
    }
  });
}

// Save card function
async function saveCard(sectionId) {
  const card = document.getElementById(`card-${sectionId}`);
  if (!card) return;

  const inputs = card.querySelectorAll("[data-path]");
  const updates = {};
  let modeChanged = false;
  let newModeVal = "";
  let langChanged = false;

  inputs.forEach((input) => {
    if (input.tagName === "IMG") return; // Skip images

    const path = input.getAttribute("data-path");
    let value = input.value;

    if (input.type === "checkbox") value = input.checked;

    if (path === "affichage.mode") {
      modeChanged = true;
      newModeVal = value;
    }
    if (path === "affichage.langue") {
      langChanged = true;
    }

    setByPath(updates, path, value);
    setByPath(settingsConfig, path, value);
  });

  try {
    await saveConfig(updates);

    showNotification(
      window.i18n && window.i18n.t
        ? window.i18n.t("notifications.saved") || "Modification sauvegardée"
        : "Modification sauvegardée",
    );

    if (modeChanged && typeof applyTheme === "function") {
      applyTheme(newModeVal);
    }

    if (langChanged) {
      // Reload to apply language change properly
      setTimeout(() => location.reload(), 500);
    }
  } catch (e) {
    console.error(e);
    showNotification(
      window.i18n && window.i18n.t
        ? window.i18n.t("notifications.save_error") ||
            "Erreur lors de la sauvegarde"
        : "Erreur lors de la sauvegarde",
      true,
    );
  }
}

// Chargement config et initialisation UI
async function loadConfigToUI() {
  try {
    await loadConfig();
    settingsConfig = getConfig();
    if (!settingsConfig) {
      showNotification(
        window.i18n && window.i18n.t
          ? window.i18n.t("notifications.load_error") ||
              "Impossible de charger la configuration"
          : "Impossible de charger la configuration",
        true,
      );
      return;
    }
    updateDataPathsDisplay();
    if (typeof renderEnseignes === "function") renderEnseignes();
    if (settingsConfig?.affichage?.mode)
      applyTheme(settingsConfig.affichage.mode);

    // Update plan buttons state
    if (
      settingsConfig?.abonnement?.plan_actuel &&
      typeof updatePlanButtons === "function"
    ) {
      updatePlanButtons(settingsConfig.abonnement.plan_actuel);
    }
  } catch (error) {
    console.error("Erreur:", error);
    showNotification(
      window.i18n && window.i18n.t
        ? window.i18n.t("notifications.load_failure") ||
            "Erreur lors du chargement de la configuration"
        : "Erreur lors du chargement de la configuration",
      true,
    );
  }
}

// Restauration de l'état UI et listeners
document.addEventListener("DOMContentLoaded", async () => {
  // Charger la config dans l'UI d'abord pour avoir les préférences sauvegardées
  await loadConfigToUI();

  // Section active
  const savedSection =
    (settingsConfig &&
      settingsConfig.affichage &&
      settingsConfig.affichage.lastSection) ||
    "compte";
  showSection(savedSection);

  document.querySelectorAll(".menu li").forEach((item) => {
    item.addEventListener("click", () => {
      const id =
        item.dataset && item.dataset.section
          ? item.dataset.section
          : item.textContent.trim().toLowerCase();
      // Update local config object
      if (!settingsConfig) settingsConfig = {};
      if (!settingsConfig.affichage) settingsConfig.affichage = {};
      settingsConfig.affichage.lastSection = id;

      // Save to backend silently
      if (typeof saveConfig === "function") {
        saveConfig({ affichage: { lastSection: id } }).catch((e) =>
          console.warn("Failed to save lastSection", e),
        );
      }
    });
  });

  // Gestion accordéon: n'autoriser qu'un seul <details> ouvert à la fois
  const allDetails = document.querySelectorAll("details.settings-section");
  allDetails.forEach((d) => {
    d.addEventListener("toggle", () => {
      if (d.open) {
        // Fermer tous les autres quand celui-ci s'ouvre
        allDetails.forEach((other) => {
          if (other !== d) other.open = false;
        });

        // Save open detail
        if (!settingsConfig) settingsConfig = {};
        if (!settingsConfig.affichage) settingsConfig.affichage = {};
        settingsConfig.affichage.openDetail = d.id;

        if (typeof saveConfig === "function") {
          saveConfig({ affichage: { openDetail: d.id } }).catch((e) =>
            console.warn("Failed to save openDetail", e),
          );
        }
      } else {
        // Si aucun n'est ouvert
        const anyOpen = Array.from(allDetails).some((x) => x.open);
        if (!anyOpen) {
          if (settingsConfig && settingsConfig.affichage)
            settingsConfig.affichage.openDetail = null;
          if (typeof saveConfig === "function") {
            saveConfig({ affichage: { openDetail: null } }).catch((e) =>
              console.warn("Failed to save openDetail", e),
            );
          }
        }
      }
    });
  });

  // Restore open detail
  const openDetail =
    settingsConfig &&
    settingsConfig.affichage &&
    settingsConfig.affichage.openDetail;
  if (openDetail) {
    const el = document.getElementById(openDetail);
    if (el && el.tagName.toLowerCase() === "details") el.open = true;
  }

  // Cliquer hors modale -> utils.js prend en charge .close, etc.
});

// Re-apply displayed values (labels) when language changes so translations loaded later update UI
if (typeof window !== "undefined") {
  window.addEventListener("language-changed", () => {
    try {
      updateDataPathsDisplay();
    } catch (e) {
      /* ignore */
    }
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
document.addEventListener("DOMContentLoaded", function () {
  // Avatar upload with backend persistence
  const avatarInput = document.getElementById("avatar-upload");
  if (avatarInput) {
    avatarInput.addEventListener("change", async function (e) {
      if (this.files && this.files[0]) {
        const file = this.files[0];

        // 1. Preview immediately
        const reader = new FileReader();
        reader.onload = function (e) {
          const img = document.getElementById("avatar-img");
          if (img) img.src = e.target.result;
        };
        reader.readAsDataURL(file);

        // 2. Upload to backend
        const formData = new FormData();
        formData.append("file", file);

        try {
          const headers = {};
          try {
            if (!supabaseClient && typeof initSupabase === "function") {
              await initSupabase();
            }
            if (supabaseClient) {
              const { data } = await supabaseClient.auth.getSession();
              const token = data.session?.access_token;
              if (token) headers.Authorization = `Bearer ${token}`;
            }
          } catch (e) {
            console.warn("Avatar upload auth token unavailable", e);
          }

          const response = await fetch("/api/uploadAvatar", {
            method: "POST",
            headers,
            body: formData,
          });

          if (response.ok) {
            const result = await response.json();
            if (result.path) {
              // 3. Update config and save
              setByPath(settingsConfig, "vous.avatar", result.path);

              // Save config to persist the path
              if (typeof saveConfig === "function") {
                await saveConfig(settingsConfig);
              }

              showNotification(
                window.i18n && window.i18n.t
                  ? window.i18n.t("notifications.avatar_updated") ||
                      "Avatar mis à jour"
                  : "Avatar mis à jour",
              );
            }
          } else {
            throw new Error("Upload failed");
          }
        } catch (err) {
          console.error("Avatar upload error:", err);
          showNotification("Erreur lors de l'upload de l'avatar", true);
        }
      }
    });
  }

  // Attacher les événements aux boutons de plan
  document.querySelectorAll(".plan-btn").forEach((btn) => {
    btn.addEventListener("click", async function () {
      const planType = this.closest(".plan-card").dataset.plan;
      await selectPlan(planType);
    });
  });

  // Initialiser l'état des boutons selon le plan actuel
  if (
    settingsConfig &&
    settingsConfig.abonnement &&
    settingsConfig.abonnement.plan_actuel
  ) {
    updatePlanButtons(settingsConfig.abonnement.plan_actuel);
  }
});

async function selectPlan(planType) {
  // Cas spécial pour le plan Entreprise
  if (planType === "entreprise") {
    showEnterpriseContactModal();
    return;
  }

  try {
    // Mettre à jour la configuration locale
    if (!settingsConfig) settingsConfig = {};
    if (!settingsConfig.abonnement) {
      settingsConfig.abonnement = {};
    }
    settingsConfig.abonnement.plan_actuel = planType;

    // Prepare updates object for partial update
    const updates = {
      abonnement: {
        plan_actuel: planType,
      },
    };

    // Sauvegarder via l'API
    if (typeof saveConfig === "function") {
      await saveConfig(updates);
    } else {
      // Fallback manual fetch using correct API endpoint if saveConfig is somehow missing
      const response = await fetch("/api/config", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(updates),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
    }

    // Mettre à jour l'affichage
    const planDisplay = document.querySelector(
      '[data-path="abonnement.plan_actuel"]',
    );
    if (planDisplay) {
      // Capitaliser la première lettre du plan
      const planName = planType.charAt(0).toUpperCase() + planType.slice(1);
      planDisplay.textContent = planName;
    }

    // Mettre à jour l'état visuel des boutons
    updatePlanButtons(planType);

    showNotification(
      window.i18n && window.i18n.t
        ? window.i18n.t("notifications.plan_saved") ||
            "Plan d'abonnement mis à jour"
        : "Plan d'abonnement mis à jour",
    );
  } catch (err) {
    console.error("Erreur lors de la sauvegarde du plan:", err);
    showNotification(
      window.i18n && window.i18n.t
        ? window.i18n.t("notifications.save_error") ||
            "Erreur lors de la sauvegarde"
        : "Erreur lors de la sauvegarde",
      true,
    );
  }
}

function updatePlanButtons(selectedPlan) {
  document.querySelectorAll(".plan-card").forEach((card) => {
    const btn = card.querySelector(".plan-btn");
    if (card.dataset.plan === selectedPlan) {
      btn.textContent =
        window.i18n && window.i18n.t
          ? window.i18n.t("actions.selected") || "Sélectionné"
          : "Sélectionné";
      btn.style.background = "var(--success-color)";
      card.style.borderColor = "var(--success-color)";
    } else {
      btn.textContent =
        window.i18n && window.i18n.t
          ? window.i18n.t("actions.select") || "Sélectionner"
          : "Sélectionner";
      btn.style.background = "var(--accent-color)";
      card.style.borderColor = "var(--border-color)";
    }
  });
}

function showEnterpriseContactModal() {
  const modal = document.createElement("div");
  modal.className = "modal enterprise-modal";

  const contactInfo = settingsConfig.contact || {};
  const email = contactInfo.email || "support@iaqverse.local";
  const telephone = contactInfo.telephone || "+33 1 23 45 67 89";
  const adresse = contactInfo.adresse_postale || "1 rue Support, 75000 Paris";

  const t =
    window.i18n && typeof window.i18n.t === "function"
      ? window.i18n.t
      : () => undefined;
  const title =
    (t && t("settings.enterprise_modal.title")) ||
    "Contact pour Plan Entreprise";
  const closeBtn = (t && t("settings.enterprise_modal.close")) || "Fermer";
  const introText =
    (t && t("settings.enterprise_modal.intro")) ||
    "Pour le plan Entreprise, veuillez nous contacter directement :";
  const footerText =
    (t && t("settings.enterprise_modal.footer")) ||
    "Notre équipe vous aidera à configurer la solution parfaite pour votre organisation.";

  modal.innerHTML = `
    <div class="modal-content enterprise-contact">
      <span class="close" onclick="this.closest('.modal').remove()">&times;</span>
      <h2>${title}</h2>
      <div class="enterprise-contact-body">
        <p class="enterprise-intro">${introText}</p>
        <div class="enterprise-info-grid">
          <div class="enterprise-info-row">
            <div class="enterprise-info-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path>
                <polyline points="22,6 12,13 2,6"></polyline>
              </svg>
            </div>
            <div class="enterprise-info-content">
              <span class="enterprise-info-label">Email</span>
              <a href="mailto:${email}" class="enterprise-info-value">${email}</a>
            </div>
          </div>
          <div class="enterprise-info-row">
            <div class="enterprise-info-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"></path>
              </svg>
            </div>
            <div class="enterprise-info-content">
              <span class="enterprise-info-label">Téléphone</span>
              <a href="tel:${telephone.replace(/\s/g, "")}" class="enterprise-info-value">${telephone}</a>
            </div>
          </div>
          <div class="enterprise-info-row">
            <div class="enterprise-info-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
                <circle cx="12" cy="10" r="3"></circle>
              </svg>
            </div>
            <div class="enterprise-info-content">
              <span class="enterprise-info-label">Adresse</span>
              <a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(adresse)}" target="_blank" rel="noopener noreferrer" class="enterprise-info-value">${adresse}</a>
            </div>
          </div>
        </div>
        <p class="enterprise-footer">${footerText}</p>
      </div>
      <div class="modal-actions">
        <button class="btn-secondary" onclick="this.closest('.modal').remove()">${closeBtn}</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);
  modal.style.display = "block";
}

/* ========== Gestion de la Modale Compte ========== */
function toggleAccountModal() {
  const modal = document.getElementById("accountModal");
  if (modal) {
    if (modal.style.display === "block") {
      modal.style.display = "none";
      modal.classList.remove("show");
    } else {
      modal.style.display = "block";
      modal.classList.add("show");
    }
  }
}
// Expose globally
window.toggleAccountModal = toggleAccountModal;

// Logic for account actions moved to utils.js

// --- Password Management ---

function openPasswordModal() {
  const modal = document.getElementById("passwordModal");
  if (modal) {
    modal.style.display = "block";
    document.getElementById("passwordForm").reset();
    document.getElementById("password-error").style.display = "none";
  }
}

function closePasswordModal() {
  const modal = document.getElementById("passwordModal");
  if (modal) modal.style.display = "none";
}

document.addEventListener("DOMContentLoaded", () => {
  const passwordForm = document.getElementById("passwordForm");
  if (passwordForm) {
    passwordForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const oldPass = document.getElementById("old-password").value;
      const newPass = document.getElementById("new-password").value;
      const confirmPass = document.getElementById("confirm-password").value;
      const errorDiv = document.getElementById("password-error");

      errorDiv.style.display = "none";

      if (newPass !== confirmPass) {
        errorDiv.textContent = "Les mots de passe ne correspondent pas.";
        errorDiv.style.display = "block";
        return;
      }

      if (newPass.length < 6) {
        errorDiv.textContent =
          "Le mot de passe doit contenir au moins 6 caractères.";
        errorDiv.style.display = "block";
        return;
      }

      // 1. Verify old password
      if (typeof verifyPassword === "function") {
        const verifyResult = await verifyPassword(oldPass);
        if (!verifyResult.success) {
          errorDiv.textContent = verifyResult.error;
          errorDiv.style.display = "block";
          return;
        }
      }

      // 2. Update password
      if (typeof updateUserPassword === "function") {
        const result = await updateUserPassword(newPass);
        if (result.success) {
          closePasswordModal();
          // Fix: 2nd argument must be false for success (green), not "success" string which is truthy (red)
          showNotification("Mot de passe mis à jour avec succès !", false);
        } else {
          errorDiv.textContent =
            result.error || "Erreur lors de la mise à jour.";
          errorDiv.style.display = "block";
        }
      } else {
        console.error("updateUserPassword function not found");
      }
    });
  }
});

// Windows global exports
window.openPasswordModal = openPasswordModal;
window.closePasswordModal = closePasswordModal;

// Gestion de la Suppression de Compte
function openDeleteAccountModal() {
  ModalManager.open("deleteAccountModal");
  // Clear previous errors/inputs
  const err = document.getElementById("delete-error-msg");
  if (err) err.style.display = "none";
  const pwd = document.getElementById("delete-password-input");
  if (pwd) pwd.value = "";
}

function closeDeleteAccountModal() {
  ModalManager.close("deleteAccountModal");
}

async function confirmDeleteAccount() {
  const pwdInput = document.getElementById("delete-password-input");
  const errMsg = document.getElementById("delete-error-msg");
  const pwd = pwdInput ? pwdInput.value : "";

  if (!pwd) {
    if (errMsg) {
      errMsg.textContent =
        window.i18n && window.i18n.t
          ? window.i18n.t("settings.delete_modal.error_empty") ||
            "Mot de passe requis"
          : "Mot de passe requis";
      errMsg.style.display = "block";
    }
    return;
  }

  if (errMsg) {
    errMsg.style.display = "none";
  }

  // 1. Verify Password via Auth (from js/auth.js)
  if (typeof window.verifyPassword === "function") {
    const verification = await window.verifyPassword(pwd);
    if (!verification.success) {
      if (errMsg) {
        errMsg.textContent = verification.error || "Mot de passe incorrect";
        errMsg.style.display = "block";
      }
      return;
    }
  } else {
    console.error("verifyPassword function missing");
    if (errMsg) {
      errMsg.textContent = "Erreur technique: Script auth manquant";
      errMsg.style.display = "block";
    }
    return;
  }

  // 2. Call Delete API
  try {
    const token = await getAuthToken();
    const response = await fetch("/api/auth/account", {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });

    if (response.ok) {
      // 3. Logout & Redirect
      alert("Votre compte a été supprimé définitivement.");
      if (typeof logout === "function") {
        logout();
      } else {
        window.location.href = "login.html";
      }
    } else {
      const errData = await response.json();
      if (errMsg) {
        errMsg.textContent =
          errData.detail || "Erreur lors de la suppression du compte.";
        errMsg.style.display = "block";
      }
    }
  } catch (e) {
    console.error("Delete account error:", e);
    if (errMsg) {
      errMsg.textContent = "Erreur de connexion au serveur.";
      errMsg.style.display = "block";
    }
  }
}
window.openDeleteAccountModal = openDeleteAccountModal;
window.closeDeleteAccountModal = closeDeleteAccountModal;
window.confirmDeleteAccount = confirmDeleteAccount;
