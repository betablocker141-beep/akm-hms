import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { format, parseISO } from 'date-fns'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Format a date string to readable Pakistani format: 09 Apr 2026 */
export function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '—'
  try {
    return format(parseISO(dateStr), 'dd MMM yyyy')
  } catch {
    return dateStr
  }
}

/** Format datetime string */
export function formatDateTime(dateStr: string | null | undefined): string {
  if (!dateStr) return '—'
  try {
    return format(parseISO(dateStr), 'dd MMM yyyy, HH:mm')
  } catch {
    return dateStr
  }
}

/** Format PKR currency */
export function formatCurrency(amount: number): string {
  return `Rs. ${amount.toLocaleString('en-PK', { minimumFractionDigits: 0 })}`
}

/** Generate a UUID v4 */
export function generateUUID(): string {
  return crypto.randomUUID()
}

/** Normalise Pakistani phone to +92XXXXXXXXXX */
export function normalisePhone(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  if (digits.startsWith('0')) return '+92' + digits.slice(1)
  if (digits.startsWith('92')) return '+' + digits
  return '+92' + digits
}

/** Calculate age from DOB string — shows days/months for babies */
export function calculateAge(dob: string | null): string {
  if (!dob) return '—'
  try {
    const birth = parseISO(dob)
    const today = new Date()
    const diffMs = today.getTime() - birth.getTime()
    const diffDays = Math.floor(diffMs / 86400000)
    if (diffDays < 30) return `${diffDays} day${diffDays !== 1 ? 's' : ''}`
    const diffMonths = Math.floor(diffDays / 30.44)
    if (diffMonths < 24) return `${diffMonths} mo`
    let years = today.getFullYear() - birth.getFullYear()
    const m = today.getMonth() - birth.getMonth()
    if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) years--
    return `${years} yrs`
  } catch {
    return '—'
  }
}

/** Get today's date as YYYY-MM-DD */
export function todayString(): string {
  return format(new Date(), 'yyyy-MM-dd')
}

/** Pad number with leading zeros */
export function padNumber(n: number, width = 3): string {
  return String(n).padStart(width, '0')
}

/** Truncate long text */
export function truncate(text: string, maxLen = 50): string {
  return text.length > maxLen ? text.slice(0, maxLen) + '…' : text
}
