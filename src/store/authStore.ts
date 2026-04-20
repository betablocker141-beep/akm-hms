import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { supabase } from '@/lib/supabase/client'
import type { AppUser, UserRole } from '@/types'
import { ROLE_PERMISSIONS } from '@/types'

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

// ── Offline credential cache ──────────────────────────────────────────────────
// After a successful online login we store a SHA-256 fingerprint of the
// credentials alongside the user profile. If the device is offline on the
// next login attempt we verify against this fingerprint so staff can still
// access the app without internet.

const OFFLINE_CRED_KEY = 'akm-offline-cred'

interface OfflineCred {
  email: string
  hash: string   // SHA-256 of "email:password"
  user: AppUser
}

async function computeHash(email: string, password: string): Promise<string> {
  const buf = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`${email}:${password}`),
  )
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

async function saveOfflineCred(email: string, password: string, user: AppUser) {
  try {
    const hash = await computeHash(email, password)
    localStorage.setItem(OFFLINE_CRED_KEY, JSON.stringify({ email, hash, user } satisfies OfflineCred))
  } catch { /* non-fatal */ }
}

async function verifyOfflineCred(email: string, password: string): Promise<AppUser | null> {
  try {
    const raw = localStorage.getItem(OFFLINE_CRED_KEY)
    if (!raw) return null
    const cred: OfflineCred = JSON.parse(raw)
    if (cred.email.toLowerCase() !== email.toLowerCase()) return null
    const hash = await computeHash(email, password)
    return hash === cred.hash ? cred.user : null
  } catch {
    return null
  }
}
// ─────────────────────────────────────────────────────────────────────────────

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      isLoading: false,
      error: null,

      login: async (email: string, password: string) => {
        set({ isLoading: true, error: null })

        // ── Offline login ─────────────────────────────────────────────────────
        if (!navigator.onLine) {
          const offlineUser = await verifyOfflineCred(email, password)
          if (offlineUser) {
            set({ user: offlineUser, isLoading: false, error: null })
            return
          }
          set({
            error: navigator.onLine === false && !localStorage.getItem(OFFLINE_CRED_KEY)
              ? 'No internet connection. Please connect to the internet to sign in for the first time.'
              : 'Incorrect password, or no internet connection. Connect to the internet to sign in.',
            isLoading: false,
          })
          throw new Error('Offline login failed')
        }
        // ─────────────────────────────────────────────────────────────────────

        try {
          const { data, error } = await supabase.auth.signInWithPassword({ email, password })
          if (error) throw error

          // Fetch user profile with role
          const { data: profile, error: profileError } = await supabase
            .from('users')
            .select('*')
            .eq('id', data.user.id)
            .single()

          let userProfile: AppUser

          if (profileError) {
            // Profile row missing — create a default admin profile (first-time setup)
            userProfile = {
              id: data.user.id,
              email: data.user.email ?? email,
              name: data.user.user_metadata?.name ?? email.split('@')[0],
              role: 'admin',
              doctor_id: null,
              created_at: new Date().toISOString(),
            }
            await supabase.from('users').upsert(userProfile).select()
          } else {
            userProfile = {
              ...(profile as AppUser),
              name: (profile as AppUser).name || (data.user.user_metadata?.name ?? email.split('@')[0]),
            }
          }

          // Persist credential fingerprint so this user can log in offline later
          await saveOfflineCred(email, password, userProfile)

          set({ user: userProfile, isLoading: false, error: null })
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
        // intentionally keep OFFLINE_CRED_KEY so the same user can log back
        // in offline after their shift without needing internet
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
