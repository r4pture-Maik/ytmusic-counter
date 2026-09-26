/**
 * YTMusic Counter - Lightweight Local Thumbnail Database & Cache
 * Uses IndexedDB to store downscaled (128x128 WebP) album covers.
 * Provides in-memory Object URL caching for instant, zero-flicker UI painting.
 * Native ES module with globalThis fallback.
 */

const DB_NAME = 'ytm_media_cache';
const DB_VERSION = 1;
const STORE_NAME = 'album_covers';
const TARGET_SIZE = 128;
const WEBP_QUALITY = 0.8;
const NEGATIVE_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

let dbPromise = null;
const memoryUrlMap = new Map(); // albumKey -> objectUrl
const failedKeySet = new Set(); // albumKey -> boolean
const pendingFetches = new Map(); // albumKey -> Promise

/**
 * Opens or upgrades the IndexedDB database.
 * Singleton Promise prevents parallel open calls.
 */
export function openDB() {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const globalObj = typeof window !== 'undefined' ? window : (typeof self !== 'undefined' ? self : globalThis);
    const indexedDB = globalObj.indexedDB || globalObj.mozIndexedDB || globalObj.webkitIndexedDB;
    if (!indexedDB) {
      return reject(new Error('IndexedDB not supported in this environment'));
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'albumKey' });
      }
    };

    request.onsuccess = (event) => {
      const db = event.target.result;
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };

    request.onerror = (event) => {
      dbPromise = null;
      reject(event.target.error);
    };
  });

  return dbPromise;
}

/**
 * Retrieves a record from IndexedDB by albumKey.
 */
export async function getRecord(albumKey) {
  if (!albumKey) return null;
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(albumKey);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn('[ThumbnailCache] Error reading record for', albumKey, err);
    return null;
  }
}

/**
 * Stores a record in IndexedDB.
 */
export async function putRecord(record) {
  if (!record || !record.albumKey) return;
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.put(record);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn('[ThumbnailCache] Error storing record for', record.albumKey, err);
  }
}

/**
 * Resizes an image Blob into 128x128 WebP blob using OffscreenCanvas or HTML Canvas
 */
export async function downscaleImageBlob(sourceBlob) {
  const globalObj = typeof window !== 'undefined' ? window : (typeof self !== 'undefined' ? self : globalThis);
  if (typeof createImageBitmap === 'function') {
    const imgBitmap = await createImageBitmap(sourceBlob);
    let canvas;
    if (typeof OffscreenCanvas !== 'undefined') {
      canvas = new OffscreenCanvas(TARGET_SIZE, TARGET_SIZE);
    } else if (typeof document !== 'undefined') {
      canvas = document.createElement('canvas');
      canvas.width = TARGET_SIZE;
      canvas.height = TARGET_SIZE;
    } else {
      return sourceBlob;
    }

    const ctx = canvas.getContext('2d');
    ctx.drawImage(imgBitmap, 0, 0, TARGET_SIZE, TARGET_SIZE);
    imgBitmap.close();

    if (canvas.convertToBlob) {
      return canvas.convertToBlob({ type: 'image/webp', quality: WEBP_QUALITY });
    } else if (canvas.toBlob) {
      return new Promise((resolve) => {
        canvas.toBlob((b) => resolve(b || sourceBlob), 'image/webp', WEBP_QUALITY);
      });
    }
    return sourceBlob;
  }
  return sourceBlob;
}

/**
 * Fetches remote image, downscales it, and caches in IndexedDB
 */
export async function cacheRemoteThumbnail(albumKey, remoteUrl) {
  if (!albumKey || !remoteUrl) return null;
  if (pendingFetches.has(albumKey)) {
    return pendingFetches.get(albumKey);
  }

  const fetchPromise = (async () => {
    try {
      const response = await fetch(remoteUrl, { mode: 'cors' });
      if (!response.ok) {
        throw new Error(`Fetch failed: ${response.status}`);
      }
      const rawBlob = await response.blob();
      let optimizedBlob = rawBlob;
      try {
        optimizedBlob = await downscaleImageBlob(rawBlob);
      } catch (downscaleErr) {
        console.warn('[ThumbnailCache] Downscaling failed, storing original blob:', downscaleErr);
      }

      const record = {
        albumKey,
        blob: optimizedBlob,
        cachedAt: Date.now()
      };
      await putRecord(record);

      if (typeof URL !== 'undefined' && URL.createObjectURL) {
        const objectUrl = URL.createObjectURL(optimizedBlob);
        memoryUrlMap.set(albumKey, objectUrl);
        return objectUrl;
      }
      return null;
    } catch (err) {
      console.warn('[ThumbnailCache] Remote fetch failed for', albumKey, err);
      failedKeySet.add(albumKey);
      return null;
    } finally {
      pendingFetches.delete(albumKey);
    }
  })();

  pendingFetches.set(albumKey, fetchPromise);
  return fetchPromise;
}

/**
 * Returns memory object URL if already converted, else null
 */
export function getMemoryObjectUrl(albumKey) {
  return memoryUrlMap.get(albumKey) || null;
}

/**
 * Retrieves cached object URL from memory or IndexedDB
 */
export async function getThumbnailObjectUrl(albumKey) {
  if (!albumKey) return null;
  if (memoryUrlMap.has(albumKey)) {
    return memoryUrlMap.get(albumKey);
  }
  if (failedKeySet.has(albumKey)) {
    return null;
  }

  const record = await getRecord(albumKey);
  if (!record || !record.blob) {
    return null;
  }

  if (typeof URL !== 'undefined' && URL.createObjectURL) {
    const objectUrl = URL.createObjectURL(record.blob);
    memoryUrlMap.set(albumKey, objectUrl);
    return objectUrl;
  }
  return null;
}

export async function markThumbnailFailed(albumKey) {
  if (!albumKey) return;
  failedKeySet.add(albumKey);
}

export function isThumbnailFailed(albumKey) {
  return failedKeySet.has(albumKey);
}

export async function clearThumbnailCache() {
  revokeAllObjectUrls();
  failedKeySet.clear();
  pendingFetches.clear();

  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.clear();
      req.onsuccess = () => resolve({ cleared: true });
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn('[ThumbnailCache] Error clearing store:', err);
    return { cleared: false, error: err.message };
  }
}

export async function getThumbnailStats() {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      let count = 0;
      let totalBytes = 0;

      const cursorReq = store.openCursor();
      cursorReq.onsuccess = (e) => {
        const cursor = e.target.result;
        if (cursor) {
          count++;
          if (cursor.value && cursor.value.blob) {
            totalBytes += cursor.value.blob.size || 0;
          }
          cursor.continue();
        } else {
          let formattedSize = '0 KB';
          if (totalBytes > 1024 * 1024) {
            formattedSize = `${(totalBytes / (1024 * 1024)).toFixed(2)} MB`;
          } else if (totalBytes > 0) {
            formattedSize = `${(totalBytes / 1024).toFixed(1)} KB`;
          }
          resolve({ count, totalBytes, formattedSize });
        }
      };
      cursorReq.onerror = () => {
        resolve({ count: 0, totalBytes: 0, formattedSize: '0 KB' });
      };
    });
  } catch (err) {
    return { count: 0, totalBytes: 0, formattedSize: '0 KB', error: err.message };
  }
}

export function revokeAllObjectUrls() {
  for (const url of memoryUrlMap.values()) {
    try {
      URL.revokeObjectURL(url);
    } catch (_) {}
  }
  memoryUrlMap.clear();
}

export const thumbnailCache = {
  openDB,
  getRecord,
  putRecord,
  downscaleImageBlob,
  cacheRemoteThumbnail,
  getMemoryObjectUrl,
  getThumbnailObjectUrl,
  markThumbnailFailed,
  isThumbnailFailed,
  clearThumbnailCache,
  getThumbnailStats,
  revokeAllObjectUrls
};

// Global fallback for content pages and details.html
if (typeof globalThis !== 'undefined') {
  globalThis.thumbnailCache = thumbnailCache;
}

export default thumbnailCache;
