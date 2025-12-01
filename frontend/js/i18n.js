/* Simple client-side i18n module
    - Loads /assets/i18n/{lang}.json
    - Applies keys to elements with data-i18n, data-i18n-html, data-i18n-placeholder, data-i18n-title
    - Exposes i18n.init(), i18n.setLanguage(lang), i18n.getLanguage()
    - Syncs across tabs via BroadcastChannel with localStorage fallback
*/
(function (window) {
  const STORAGE_KEY = "iaq-lang";
  const CHANNEL_NAME = "iaq-i18n";
  let translations = {};
  let current = null;

  function safeGet(obj, path) {
    return path
      .split(".")
      .reduce((s, k) => (s && s[k] != null ? s[k] : undefined), obj);
  }

  async function load(lang) {
    try {
      const res = await fetch(`/assets/i18n/${lang}.json`, {
        cache: "no-cache",
      });
      if (!res.ok) throw new Error("Not found");
      const json = await res.json();
      return json;
    } catch (e) {
      console.warn("i18n: failed to load", lang, e);
      return null;
    }
  }

  // shallow/deep merge: values from src override dst. Handles objects only.
  function deepMerge(dst, src) {
    if (!dst || typeof dst !== "object") dst = {};
    if (!src || typeof src !== "object") return dst;
    const out = Array.isArray(dst) ? dst.slice() : Object.assign({}, dst);
    Object.keys(src).forEach((k) => {
      if (
        src[k] &&
        typeof src[k] === "object" &&
        !Array.isArray(src[k]) &&
        typeof out[k] === "object"
      ) {
        out[k] = deepMerge(out[k], src[k]);
      } else {
        out[k] = src[k];
      }
    });
    return out;
  }

  function applyTranslations(root = document) {
    if (!translations) return;
    root.querySelectorAll("[data-i18n]").forEach((el) => {
      const key = el.getAttribute("data-i18n");
      const txt = safeGet(translations, key);
      if (txt != null) el.textContent = txt;
    });
    root.querySelectorAll("[data-i18n-html]").forEach((el) => {
      const key = el.getAttribute("data-i18n-html");
      const txt = safeGet(translations, key);
      if (txt != null) el.innerHTML = txt;
    });
    root.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
      const key = el.getAttribute("data-i18n-placeholder");
      const txt = safeGet(translations, key);
      if (txt != null) el.setAttribute("placeholder", txt);
    });
    root.querySelectorAll("[data-i18n-title]").forEach((el) => {
      const key = el.getAttribute("data-i18n-title");
      const txt = safeGet(translations, key);
      if (txt != null) el.setAttribute("title", txt);
    });
  }

  function setUISelect(lang) {
    const sel = document.getElementById("language-select");
    if (sel) sel.value = lang;
  }

  async function setLanguage(lang, broadcast = true) {
    if (!lang) return;
    console.info("i18n: setLanguage()", lang);
    // Load English base then overlay the requested language so missing keys fall back to English
    const base = (await load("en")) || {};
    const requested = lang === "en" ? {} : await load(lang);
    if (requested == null && lang !== "en") {
      console.warn(
        "i18n: requested language not found, falling back to English"
      );
    }
    translations = deepMerge(base, requested || {});
    current = lang;
    console.info(
      "i18n: translations keys after merge:",
      Object.keys(translations).length
    );
    applyTranslations(document);
    setUISelect(lang);
    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch (e) {}
    if (broadcast && window.BroadcastChannel) {
      try {
        new BroadcastChannel(CHANNEL_NAME).postMessage({ lang });
      } catch (e) {}
    }
    // notify other parts of the app
    try {
      window.dispatchEvent(
        new CustomEvent("language-changed", { detail: { lang } })
      );
    } catch (e) {}
  }

  function getLanguage() {
    return (
      current ||
      localStorage.getItem(STORAGE_KEY) ||
      navigator.language.split("-")[0]
    );
  }

  function handleRemoteMessage(msg) {
    if (!msg || !msg.lang) return;
    const lang = msg.lang;
    if (lang === current) return;
    setLanguage(lang, false);
  }

  function setupSync() {
    if (window.BroadcastChannel) {
      try {
        const bc = new BroadcastChannel(CHANNEL_NAME);
        bc.onmessage = (e) => handleRemoteMessage(e.data);
      } catch (e) {
        /* ignore */
      }
    }
    window.addEventListener("storage", (e) => {
      if (e.key === STORAGE_KEY && e.newValue)
        handleRemoteMessage({ lang: e.newValue });
    });
  }

  function attachSelectHandler() {
    const sel = document.getElementById("language-select");
    if (!sel) return;
    sel.addEventListener("change", () => {
      setLanguage(sel.value);
    });
  }

  // Observe DOM mutations and apply translations to newly added nodes
  function setupMutationObserver() {
    if (typeof MutationObserver === "undefined") return;
    const mo = new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (node && node.nodeType === 1) {
            try {
              applyTranslations(node);
            } catch (e) {}
          }
        }
      }
    });
    try {
      mo.observe(document.documentElement || document.body, {
        childList: true,
        subtree: true,
      });
    } catch (e) {}
  }

  async function init() {
    setupSync();
    attachSelectHandler();
    setupMutationObserver();
    // Default language preference: prefer stored value, otherwise default to French
    // (do NOT fall back to navigator.language so the app defaults to French)
    const preferred = localStorage.getItem(STORAGE_KEY) || "fr";
    await setLanguage(preferred, false);
  }

  // expose
  window.i18n = {
    init,
    setLanguage,
    getLanguage,
    t: (key) => safeGet(translations, key),
    _applyTranslations: applyTranslations,
  };

  // auto init on DOMContentLoaded
  document.addEventListener("DOMContentLoaded", () => {
    init().catch(() => {});
  });
})(window);
