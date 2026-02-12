import { useTranslation } from 'react-i18next'
import { loadLanguage } from '../../i18n/config'
import { Languages } from 'lucide-react'
import './LanguageSelector.css'

const LANGUAGES = [
  { code: 'fr', name: 'Français', flag: '🇫🇷' },
  { code: 'en', name: 'English', flag: '🇬🇧' },
  { code: 'es', name: 'Español', flag: '🇪🇸' },
  { code: 'de', name: 'Deutsch', flag: '🇩🇪' },
  { code: 'it', name: 'Italiano', flag: '🇮🇹' },
]

export default function LanguageSelector() {
  const { i18n } = useTranslation()

  const handleLanguageChange = async (langCode) => {
    await loadLanguage(langCode)
  }

  const currentLang = LANGUAGES.find(lang => lang.code === i18n.language) || LANGUAGES[0]

  return (
    <div className="language-selector">
      <button className="language-button">
        <Languages size={20} />
        <span>{currentLang.flag}</span>
      </button>
      <div className="language-dropdown">
        {LANGUAGES.map(lang => (
          <button
            key={lang.code}
            className={`language-option ${lang.code === i18n.language ? 'active' : ''}`}
            onClick={() => handleLanguageChange(lang.code)}
          >
            <span className="language-flag">{lang.flag}</span>
            <span className="language-name">{lang.name}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
