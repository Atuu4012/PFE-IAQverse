/**
 * Désactive les raccourcis clavier natifs du navigateur
 * Pour éviter les conflits avec l'application
 */

document.addEventListener('keydown', function(e) {
  // Liste des raccourcis à bloquer
  const isCtrl = e.ctrlKey || e.metaKey; // metaKey pour Mac (Cmd)
  const isShift = e.shiftKey;
  const key = e.key ? e.key.toLowerCase() : '';

  // Bloquer les raccourcis courants du navigateur
  if (isCtrl) {
    switch(key) {
      case 'd': // Ajouter aux favoris
      case 'w': // Fermer l'onglet
      case 't': // Nouvel onglet
      case 'n': // Nouvelle fenêtre
      case 'p': // Imprimer
      case 's': // Enregistrer
      case 'h': // Historique
      case 'j': // Téléchargements
      case 'k': // Barre de recherche
      case 'l': // Sélectionner l'URL
      case 'u': // Voir la source
        e.preventDefault();
        e.stopPropagation();
        return false;
    }
    
    // Ctrl+Shift combinés
    if (isShift) {
      switch(key) {
        case 'n': // Nouvelle fenêtre privée
        case 't': // Rouvrir onglet fermé
        case 'w': // Fermer fenêtre
        case 'delete': // Effacer données
          e.preventDefault();
          e.stopPropagation();
          return false;
      }
    }
  }
  
  // Bloquer F11 (plein écran)
  if (key === 'f11') {
    e.preventDefault();
    e.stopPropagation();
    return false;
  }
  
});
