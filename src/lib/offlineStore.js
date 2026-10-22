const DB_NAME = 'zazo-offline'
const DB_VERSION = 1
const CACHE_STORE = 'cache'
const QUEUE_STORE = 'queue'

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(CACHE_STORE)) db.createObjectStore(CACHE_STORE)
      if (!db.objectStoreNames.contains(QUEUE_STORE)) {
        const queue = db.createObjectStore(QUEUE_STORE, { keyPath: 'id', autoIncrement: true })
        queue.createIndex('createdAt', 'createdAt')
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function transaction(storeName, mode, callback) {
  const db = await openDatabase()
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, mode)
    const store = transaction.objectStore(storeName)
    let result
    try { result = callback(store) } catch (error) { reject(error); return }
    transaction.oncomplete = () => { db.close(); resolve(result) }
    transaction.onerror = () => { db.close(); reject(transaction.error) }
  })
}

export function createLocalId() {
  return globalThis.crypto?.randomUUID?.() || `local-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export async function readCache(key) {
  return transaction(CACHE_STORE, 'readonly', (store) => new Promise((resolve, reject) => {
    const request = store.get(key)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  }))
}

export async function writeCache(key, value) {
  return transaction(CACHE_STORE, 'readwrite', (store) => store.put(value, key))
}

export async function enqueueMutation(mutation) {
  return transaction(QUEUE_STORE, 'readwrite', (store) => store.add({ ...mutation, createdAt: Date.now() }))
}

export async function listMutations() {
  return transaction(QUEUE_STORE, 'readonly', (store) => new Promise((resolve, reject) => {
    const request = store.getAll()
    request.onsuccess = () => resolve(request.result.sort((a, b) => a.createdAt - b.createdAt))
    request.onerror = () => reject(request.error)
  }))
}

export async function removeMutation(id) {
  return transaction(QUEUE_STORE, 'readwrite', (store) => store.delete(id))
}

export async function countMutations() {
  return transaction(QUEUE_STORE, 'readonly', (store) => new Promise((resolve, reject) => {
    const request = store.count()
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  }))
}
