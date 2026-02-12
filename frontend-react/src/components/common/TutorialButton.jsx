import { HelpCircle } from 'lucide-react'
import './TutorialButton.css'

export default function TutorialButton({ onClick, position = 'fixed' }) {
  return (
    <button 
      className={`tutorial-button ${position}`}
      onClick={onClick}
      title="Lancer le tutoriel"
    >
      <HelpCircle size={24} />
      <span className="tutorial-tooltip">Aide</span>
    </button>
  )
}
