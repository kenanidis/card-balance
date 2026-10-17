import { EMPTY_STATE, type HistoryEntry, type LocalState } from './types'

const DB_NAME = 'card-balance-web'
const DB_VERSION = 1
const DATA_STORE = 'data'
const KEY_STORE = 'keys'
const STATE_KEY = 'encrypted-state'
const CRYPTO_KEY = 'local-aes-key'

interface EncryptedRecord {
  iv: number[]
  ciphertext: ArrayBuffer
}

function requestValue<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(DATA_STORE)) db.createObjectStore(DATA_STORE)
      if (!db.objectStoreNames.contains(KEY_STORE)) db.createObjectStore(KEY_STORE)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function transactionGet<T>(storeName: string, key: string): Promise<T | undefined> {
  const db = await openDb()
  try {
    const tx = db.transaction(storeName, 'readonly')
    return await requestValue(tx.objectStore(storeName).get(key)) as T | undefined
  } finally {
    db.close()
  }
}

async function transactionPut(storeName: string, key: string, value: unknown): Promise<void> {
  const db = await openDb()
  try {
    const tx = db.transaction(storeName, 'readwrite')
    tx.objectStore(storeName).put(value, key)
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error)
    })
  } finally {
    db.close()
  }
}

async function localKey(): Promise<CryptoKey> {
  const existing = await transactionGet<CryptoKey>(KEY_STORE, CRYPTO_KEY)
  if (existing) return existing
  const created = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
  await transactionPut(KEY_STORE, CRYPTO_KEY, created)
  return created
}

export async function loadState(): Promise<LocalState> {
  const record = await transactionGet<EncryptedRecord>(DATA_STORE, STATE_KEY)
  if (!record) return structuredClone(EMPTY_STATE)
  try {
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: new Uint8Array(record.iv) },
      await localKey(),
      record.ciphertext
    )
    return { ...structuredClone(EMPTY_STATE), ...JSON.parse(new TextDecoder().decode(decrypted)) } as LocalState
  } catch {
    throw new Error('Τα τοπικά δεδομένα δεν ήταν δυνατό να αποκρυπτογραφηθούν.')
  }
}

export async function saveState(state: LocalState): Promise<void> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const plain = new TextEncoder().encode(JSON.stringify(state))
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await localKey(), plain)
  await transactionPut(DATA_STORE, STATE_KEY, { iv: Array.from(iv), ciphertext } satisfies EncryptedRecord)
}

export async function clearLocalData(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DB_NAME)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
    request.onblocked = () => reject(new Error('Η τοπική βάση χρησιμοποιείται ακόμη.'))
  })
}

export function exportBackup(state: LocalState): void {
  const safe = { formatVersion: 1, exportedAt: new Date().toISOString(), history: state.history }
  const blob = new Blob([JSON.stringify(safe, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `card_balance_history_${new Date().toISOString().slice(0, 10)}.json`
  anchor.click()
  URL.revokeObjectURL(url)
}

export async function importBackup(file: File): Promise<HistoryEntry[]> {
  const parsed = JSON.parse(await file.text()) as { formatVersion?: number; history?: HistoryEntry[] }
  if (parsed.formatVersion !== 1 || !Array.isArray(parsed.history)) throw new Error('Μη έγκυρο αρχείο backup.')
  return parsed.history.slice(0, 100)
}
