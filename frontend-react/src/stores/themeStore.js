import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export const useThemeStore = create(
  persist(
    (set) => ({
      theme: 'clair',
      
      setTheme: (theme) => {
        set({ theme })
        if (theme === 'sombre') {
          document.documentElement.setAttribute('data-theme', 'sombre')
        } else {
          document.documentElement.removeAttribute('data-theme')
        }
      },
      
      toggleTheme: () => {
        set((state) => {
          const newTheme = state.theme === 'clair' ? 'sombre' : 'clair'
          if (newTheme === 'sombre') {
            document.documentElement.setAttribute('data-theme', 'sombre')
          } else {
            document.documentElement.removeAttribute('data-theme')
          }
          return { theme: newTheme }
        })
      },
    }),
    {
      name: 'iaq-theme',
    }
  )
)
