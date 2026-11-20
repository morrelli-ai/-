/// <reference types="vite/client" />
import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const configured = Boolean(url && key)
export const supabase = createClient(url || 'http://localhost', key || 'missing')
export const TOTAL = 76

export const OPGS = [
  { id: 'orekhovskaya', name: 'Ореховская ОПГ', color: '#e9a23b' },
  { id: 'tambovskaya', name: 'Тамбовская ОПГ', color: '#5aa9e6' },
  { id: 'kurganskaya', name: 'Курганская ОПГ', color: '#e5484d' },
  { id: 'kavkazskaya', name: 'Кавказская ОПГ', color: '#2fbf8f' },
] as const

export type Owner = (typeof OPGS)[number]['id'] | null
export interface Business { id: number; name: string; owner: Owner; updated_at: string }
export interface HistoryRow {
  id: number
  business_id: number
  business_name: string
  from_owner: Owner
  to_owner: Owner
  changed_by: string
  changed_at: string
}

export const opgName = (o: Owner) => OPGS.find(x => x.id === o)?.name ?? 'Свободен'
export const colorOf = (o: Owner) => OPGS.find(x => x.id === o)?.color ?? '#6b6b75'
