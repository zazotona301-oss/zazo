import { createClient } from '@supabase/supabase-js'

// These are public client values, not service-role credentials. A missing value
// should leave the interface loadable and let its existing request error states
// explain that backend configuration is needed.
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://missing-config.supabase.co'
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'missing-public-anon-key'

if (!import.meta.env.VITE_SUPABASE_URL || !import.meta.env.VITE_SUPABASE_ANON_KEY) {
  console.warn('Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY for production builds.')
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
