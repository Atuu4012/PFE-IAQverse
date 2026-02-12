# Scripts Utiles - IAQverse React

## 🚀 Démarrage Rapide

### Installation complète
```bash
# 1. Installer Node.js si nécessaire
# Télécharger depuis https://nodejs.org/

# 2. Installer les dépendances
cd frontend-react
npm install

# 3. Configurer l'environnement
cp .env.example .env
# Éditer .env avec vos clés Supabase

# 4. Copier les assets (Windows PowerShell)
Copy-Item -Path ..\frontend\assets -Destination .\public\assets -Recurse

# 5. Lancer le serveur
npm run dev
```

---

## 📝 Scripts NPM Disponibles

```bash
# Développement
npm run dev              # Lancer le serveur de dev (port 3000)
npm run build            # Build pour production
npm run preview          # Prévisualiser le build
npm run lint             # Vérifier le code avec ESLint

# Nettoyage
rm -rf node_modules dist  # Nettoyer et réinstaller
npm install
```

---

## 🔧 Commandes Utiles

### Ajouter de nouveaux packages

```bash
# UI Components
npm install @radix-ui/react-dialog
npm install @radix-ui/react-dropdown-menu

# Formulaires
npm install react-hook-form
npm install zod

# Utilitaires
npm install date-fns
npm install clsx
npm install tailwind-merge

# Animations
npm install framer-motion
```

### Tests (à configurer)

```bash
# Installer Vitest
npm install -D vitest @testing-library/react @testing-library/jest-dom

# Installer Playwright (E2E)
npm install -D @playwright/test
```

---

## 📱 Structure d'un Composant React

```jsx
import { useState, useEffect } from 'react'
import { useStore } from '../stores/yourStore'
import './Component.css'

export default function Component({ prop1, prop2 }) {
  const [localState, setLocalState] = useState(null)
  const { globalState, action } = useStore()

  useEffect(() => {
    // Logique side effect
    return () => {
      // Cleanup
    }
  }, [])

  return (
    <div className="component">
      {/* JSX */}
    </div>
  )
}
```

---

## 🎨 Ajouter un Nouveau Store Zustand

```javascript
// src/stores/myStore.js
import { create } from 'zustand'

export const useMyStore = create((set, get) => ({
  data: null,
  loading: false,
  
  fetchData: async () => {
    set({ loading: true })
    try {
      const response = await fetch('/api/data')
      const data = await response.json()
      set({ data, loading: false })
    } catch (error) {
      set({ loading: false })
      console.error(error)
    }
  },
}))
```

---

## 🌍 Ajouter une Nouvelle Traduction

1. Ajouter la clé dans tous les fichiers de langue :

```json
// public/assets/i18n/fr.json
{
  "new": {
    "key": "Nouvelle traduction"
  }
}
```

2. Utiliser dans un composant :

```jsx
import { useTranslation } from 'react-i18next'

function Component() {
  const { t } = useTranslation()
  return <p>{t('new.key')}</p>
}
```

---

## 📊 Ajouter un Graphique Chart.js

```jsx
import { Line } from 'react-chartjs-2'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend
} from 'chart.js'

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend
)

export default function MyChart({ data }) {
  const chartData = {
    labels: data.labels,
    datasets: [{
      label: 'Température',
      data: data.values,
      borderColor: 'rgb(59, 130, 246)',
      backgroundColor: 'rgba(59, 130, 246, 0.1)',
    }]
  }

  const options = {
    responsive: true,
    plugins: {
      legend: {
        position: 'top',
      },
      title: {
        display: true,
        text: 'Évolution de la température'
      }
    }
  }

  return <Line data={chartData} options={options} />
}
```

---

## 🎯 Ajouter une Nouvelle Route

1. Créer la page dans `src/pages/` :

```jsx
// src/pages/NewPage.jsx
export default function NewPage() {
  return (
    <div className="page">
      <Navbar />
      <div className="page-content">
        <div className="container">
          <h1>Nouvelle Page</h1>
        </div>
      </div>
    </div>
  )
}
```

2. Ajouter la route dans `App.jsx` :

```jsx
import NewPage from './pages/NewPage'

// Dans le <Routes>
<Route
  path="/new-page"
  element={
    <ProtectedRoute>
      <NewPage />
    </ProtectedRoute>
  }
/>
```

3. Ajouter le lien dans la Navbar :

```jsx
const navItems = [
  // ...
  { path: '/new-page', icon: Star, label: 'Nouvelle Page' },
]
```

---

## 🐛 Debugging

### React DevTools
```bash
# Installer l'extension Chrome/Firefox
# React Developer Tools
```

### Console Logs Utiles

```javascript
// Store state
console.log('Auth:', useAuthStore.getState())
console.log('WebSocket:', useWebSocketStore.getState())

// Props
console.log('Props:', { prop1, prop2 })

// Render cycles
useEffect(() => {
  console.log('Component mounted')
  return () => console.log('Component unmounted')
}, [])
```

---

## 🚀 Optimisations

### Code Splitting

```jsx
import { lazy, Suspense } from 'react'

const HeavyComponent = lazy(() => import('./HeavyComponent'))

function App() {
  return (
    <Suspense fallback={<LoadingScreen />}>
      <HeavyComponent />
    </Suspense>
  )
}
```

### Memoization

```jsx
import { useMemo, useCallback } from 'react'

function Component({ data }) {
  // Mémoriser un calcul coûteux
  const processedData = useMemo(() => {
    return data.map(item => complexCalculation(item))
  }, [data])

  // Mémoriser une fonction
  const handleClick = useCallback(() => {
    console.log('Clicked')
  }, [])

  return <div onClick={handleClick}>{processedData}</div>
}
```

---

## 📦 Build & Déploiement

### Build Local

```bash
npm run build
npm run preview  # Tester le build localement
```

### Variables d'Environnement

```bash
# .env.development
VITE_API_URL=http://localhost:8000

# .env.production
VITE_API_URL=https://api.production.com
```

### Déploiement Vercel

```bash
npm install -g vercel
vercel --prod
```

### Déploiement Netlify

```bash
npm run build
# Glisser-déposer le dossier dist/ sur netlify.com
```

---

## 🎓 Bonnes Pratiques

✅ **DO**
- Utiliser des composants fonctionnels
- Extraire la logique complexe dans des hooks personnalisés
- Typer avec PropTypes ou TypeScript
- Garder les composants petits et focalisés
- Utiliser les CSS modules ou styled-components

❌ **DON'T**
- Modifier directement le state
- Oublier les dépendances dans useEffect
- Faire des appels API dans le render
- Créer des composants trop grands
- Dupliquer le code

---

Bonne chance avec votre projet IAQverse ! 🚀
