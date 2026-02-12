import { create } from 'zustand'
import { supabase } from '../services/supabase'

export const useAuthStore = create((set, get) => ({
  user: null,
  session: null,
  loading: false,
  initialized: false,

  // Vérifier l'authentification au démarrage
  checkAuth: async () => {
    try {
      set({ loading: true })
      const { data: { session }, error } = await supabase.auth.getSession()
      
      if (error) throw error

      set({
        user: session?.user ?? null,
        session: session ?? null,
        initialized: true,
        loading: false,
      })

      // Écouter les changements d'authentification
      supabase.auth.onAuthStateChange((_event, session) => {
        set({
          user: session?.user ?? null,
          session: session ?? null,
        })
      })
    } catch (error) {
      console.error('Erreur checkAuth:', error)
      set({ user: null, session: null, initialized: true, loading: false })
    }
  },

  // Connexion
  signIn: async (email, password) => {
    try {
      set({ loading: true })
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      })
      
      if (error) throw error

      set({
        user: data.user,
        session: data.session,
        loading: false,
      })

      return { success: true }
    } catch (error) {
      set({ loading: false })
      return { success: false, error: error.message }
    }
  },

  // Inscription
  signUp: async (email, password, metadata = {}) => {
    try {
      set({ loading: true })
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: metadata,
        },
      })
      
      if (error) throw error

      set({ loading: false })
      return { success: true, data }
    } catch (error) {
      set({ loading: false })
      return { success: false, error: error.message }
    }
  },

  // Déconnexion
  signOut: async () => {
    try {
      set({ loading: true })
      const { error } = await supabase.auth.signOut()
      
      if (error) throw error

      set({
        user: null,
        session: null,
        loading: false,
      })

      return { success: true }
    } catch (error) {
      set({ loading: false })
      return { success: false, error: error.message }
    }
  },

  // Réinitialisation du mot de passe
  resetPassword: async (email) => {
    try {
      set({ loading: true })
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
      })
      
      if (error) throw error

      set({ loading: false })
      return { success: true }
    } catch (error) {
      set({ loading: false })
      return { success: false, error: error.message }
    }
  },

  // Mettre à jour le mot de passe
  updatePassword: async (newPassword) => {
    try {
      set({ loading: true })
      const { error } = await supabase.auth.updateUser({
        password: newPassword,
      })
      
      if (error) throw error

      set({ loading: false })
      return { success: true }
    } catch (error) {
      set({ loading: false })
      return { success: false, error: error.message }
    }
  },

  // Obtenir le token d'authentification
  getToken: async () => {
    const session = get().session
    return session?.access_token ?? null
  },
}))
