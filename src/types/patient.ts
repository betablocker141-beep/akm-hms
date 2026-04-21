export type BloodGroup = 'A+' | 'A-' | 'B+' | 'B-' | 'AB+' | 'AB-' | 'O+' | 'O-' | 'Unknown'
export type Gender = 'Male' | 'Female' | 'Other'

export interface Patient {
  id: string
  mrn: string
  name: string
  dob: string | null
  gender: Gender
  phone: string
  address: string | null
  blood_group: BloodGroup | null
  guardian_name: string | null
  created_at: string
  // Dexie extras
  sync_status?: SyncStatus
  local_id?: string
  server_id?: string | null
}

export type SyncStatus = 'synced' | 'pending' | 'conflict'
