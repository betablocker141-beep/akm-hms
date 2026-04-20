import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { supabase } from '@/lib/supabase/client'
import type { AppUser, UserRole } from '@/types'

interface AuthState {
  user: AppUser | null
  isLoading: boolean
  error: string | null
  login: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
  setUser: (user: AppUser | null) => void
  hasPermission: (permission: string) => boolean
  canEditDeleteRecords: () => boolean
}

import { ROLE_PERMISSIONS } from '@/types'

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      isLoading: false,
      error: null,

      login: async (email: string, password: string) => {
        set({ isLoading: true, error: null })

        if (!navigator.onLine) {
          set({
            error: 'No internet connection. Please connect to the internet to sign in.',
            isLoading: false,
          })
          throw new Error('No internet connection')
        }

        try {
          const { data, error } = await supabase.auth.signInWithPassword({
            email,
            password,
          })
          if (error) throw error

          // Fetch user profile with role
          const { data: profile, error: profileError } = await supabase
            .from('users')
            .select('*')
            .eq('id', data.user.id)
            .single()

          if (profileError) {
            // Profile row missing — create a default admin profile (first-time setup)
            const fallback: AppUser = {
              id: data.user.id,
              email: data.user.email ?? email,
              name: data.user.user_metadata?.name ?? email.split('@')[0],
              role: 'admin',
              doctor_id: null,
              created_at: new Date().toISOString(),
            }
            // Try to insert profile row
            await supabase.from('users').upsert(fallback).select()
            set({ user: fallback, isLoading: false, error: null })
          } else {
            // Ensure name is always populated (backward compat with old rows)
            const userProfile: AppUser = {
              ...(profile as AppUser),
              name: (profile as AppUser).name || (data.user.user_metadata?.name ?? email.split('@')[0]),
            }
            set({
              user: userProfile,
              isLoading: false,
              error: null,
            })
          }
        } catch (err) {
          const raw = err instanceof Error ? err.message : 'Login failed'
          const isNetworkError =
            raw.includes('Failed to fetch') ||
            raw.includes('NetworkError') ||
            raw.toLowerCase().includes('network request failed') ||
            raw.toLowerCase().includes('connection')
          set({
            error: isNetworkError
              ? 'Network error. Please check your connection and try again.'
              : raw,
            isLoading: false,
          })
          throw err
        }
      },

      logout: async () => {
        await supabase.auth.signOut()
        set({ user: null, error: null })
      },

      setUser: (user) => set({ user }),

      hasPermission: (permission: string) => {
        const { user } = get()
        if (!user) return false
        const perms = ROLE_PERMISSIONS[user.role as UserRole]
        return perms ? !!(perms as unknown as Record<string, boolean>)[permission] : false
      },

      canEditDeleteRecords: () => {
        const { user } = get()
        if (!user) return false
        if (user.role === 'admin') return true
        // Dr. Waseem also gets edit/delete rights
        if (user.name?.toLowerCase().includes('waseem')) return true
        if (user.email?.toLowerCase().includes('waseem')) return true
        return false
      },
    }),
    {
      name: 'akm-auth',
      partialize: (state) => ({ user: state.user }),
    }
  )
)
