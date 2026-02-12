import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

// Initialisation de i18next
i18n
  .use(initReactI18next)
  .init({
    resources: {}, // Les traductions seront chargées dynamiquement
    lng: 'fr', // Langue par défaut
    fallbackLng: 'en',
    interpolation: {
      escapeValue: false, // React échappe déjà les valeurs
    },
  })

// Fonction pour charger les traductions dynamiquement
export async function loadLanguage(lang) {
  try {
    const response = await fetch(`/assets/i18n/${lang}.json`, {
      cache: 'no-cache',
      headers: { 'ngrok-skip-browser-warning': 'true' }
    })
    
    if (!response.ok) {
      throw new Error(`Impossible de charger la langue ${lang}`)
    }
    
    const translations = await response.json()
    i18n.addResourceBundle(lang, 'translation', translations, true, true)
    await i18n.changeLanguage(lang)
    
    // Sauvegarder la préférence
    localStorage.setItem('iaq-language', lang)
    
    return true
  } catch (error) {
    console.error('Erreur lors du chargement de la langue:', error)
    return false
  }
}

// Charger la langue sauvegardée au démarrage
const savedLang = localStorage.getItem('iaq-language') || 'fr'
loadLanguage(savedLang)

export default i18n
