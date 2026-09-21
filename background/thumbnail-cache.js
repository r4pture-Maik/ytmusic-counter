/**
 * YTMusic Counter - Lightweight Local Thumbnail Database & Cache
 * Uses IndexedDB to store downscaled (128x128 WebP) album covers.
 * Provides in-memory Object URL caching for instant, zero-flicker UI painting.
 */

(function (global) {
  'use strict';

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
  function openDB() {
    if (dbPromise) return dbPromise;

    dbPromise = new Promise((resolve, reject) => {
      const indexedDB = global.indexedDB || global.mozIndexedDB || global.webkitIndexedDB;
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
  async function getRecord(albumKey) {
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
  async function putRecord(record) {
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
   * Downscales an image Blob to a compact 128x128 WebP Blob.
   * Utilizes createImageBitmap and OffscreenCanvas for hardware-accelerated processing.
   */
  async function downscaleImageBlob(rawBlob, targetSize = TARGET_SIZE, quality = WEBP_QUALITY) {
    if (!rawBlob || rawBlob.size === 0) return null;

    try {
      let bitmap = null;
      if (typeof global.createImageBitmap === 'function') {
        try {
          bitmap = await global.createImageBitmap(rawBlob);
        } catch (_) {
          bitmap = null;
        }
      }

      // If createImageBitmap failed or isn't available, fall back to Image element if document exists
      if (!bitmap) {
        if (typeof document !== 'undefined') {
          bitmap = await new Promise((resolve, reject) => {
            const img = new Image();
            const tempUrl = URL.createObjectURL(rawBlob);
            img.onload = () => {
              URL.revokeObjectURL(tempUrl);
              resolve(img);
            };
            img.onerror = (e) => {
              URL.revokeObjectURL(tempUrl);
              reject(e);
            };
            img.src = tempUrl;
          });
        } else {
          return rawBlob; // Return raw blob if unable to decode
        }
      }

      const srcWidth = bitmap.width || bitmap.naturalWidth || targetSize;
      const srcHeight = bitmap.height || bitmap.naturalHeight || targetSize;

      // Crop to square if aspect ratio is not 1:1
      let sx = 0, sy = 0, sSize = Math.min(srcWidth, srcHeight);
      if (srcWidth > srcHeight) {
        sx = Math.floor((srcWidth - srcHeight) / 2);
      } else if (srcHeight > srcWidth) {
        sy = Math.floor((srcHeight - srcWidth) / 2);
      }

      let optimizedBlob = null;

      // Check for OffscreenCanvas (available in worker & window)
      if (typeof OffscreenCanvas !== 'undefined') {
        const canvas = new OffscreenCanvas(targetSize, targetSize);
        const ctx = canvas.getContext('2d');
        ctx.drawImage(bitmap, sx, sy, sSize, sSize, 0, 0, targetSize, targetSize);

        try {
          optimizedBlob = await canvas.convertToBlob({
            type: 'image/webp',
            quality: quality
          });
        } catch (_) {
          // Fallback to jpeg if WebP conversion fails
          try {
            optimizedBlob = await canvas.convertToBlob({
              type: 'image/jpeg',
              quality: quality
            });
          } catch (_) {
            optimizedBlob = null;
          }
        }
      } else if (typeof document !== 'undefined') {
        // Fallback to DOM canvas
        const canvas = document.createElement('canvas');
        canvas.width = targetSize;
        canvas.height = targetSize;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(bitmap, sx, sy, sSize, sSize, 0, 0, targetSize, targetSize);

        optimizedBlob = await new Promise((resolve) => {
          canvas.toBlob((b) => {
            if (b) return resolve(b);
            canvas.toBlob(resolve, 'image/jpeg', quality);
          }, 'image/webp', quality);
        });
      }

      if (bitmap.close) bitmap.close();

      return optimizedBlob || rawBlob;
    } catch (err) {
      console.warn('[ThumbnailCache] Downscale error, using raw image:', err);
      return rawBlob;
    }
  }

  /**
   * Fetches, downscales, and caches a remote image into IndexedDB.
   * In-flight requests for the same key are deduplicated.
   */
  async function cacheRemoteThumbnail(albumKey, remoteUrl, targetSize = TARGET_SIZE) {
    if (!albumKey || !remoteUrl) return null;

    if (pendingFetches.has(albumKey)) {
      return pendingFetches.get(albumKey);
    }

    const promise = (async () => {
      try {
        const res = await fetch(remoteUrl, { mode: 'cors' });
        if (!res.ok) {
          throw new Error(`HTTP fetch failed with status: ${res.status}`);
        }
        const rawBlob = await res.blob();
        const optimizedBlob = await downscaleImageBlob(rawBlob, targetSize);

        if (!optimizedBlob) return null;

        const record = {
          albumKey,
          blob: optimizedBlob,
          format: optimizedBlob.type || 'image/webp',
          width: targetSize,
          height: targetSize,
          sizeBytes: optimizedBlob.size,
          updatedAt: Date.now(),
          status: 'cached'
        };

        await putRecord(record);

        // Update in-memory cache
        if (memoryUrlMap.has(albumKey)) {
          URL.revokeObjectURL(memoryUrlMap.get(albumKey));
        }
        const objectUrl = URL.createObjectURL(optimizedBlob);
        memoryUrlMap.set(albumKey, objectUrl);
        failedKeySet.delete(albumKey);

        return { objectUrl, blob: optimizedBlob, record };
      } catch (err) {
        console.warn('[ThumbnailCache] Failed to cache remote thumbnail for', albumKey, remoteUrl, err);
        return null;
      } finally {
        pendingFetches.delete(albumKey);
      }
    })();

    pendingFetches.set(albumKey, promise);
    return promise;
  }

  /**
   * Synchronously checks if an Object URL exists in memory.
   */
  function getMemoryObjectUrl(albumKey) {
    if (!albumKey) return null;
    return memoryUrlMap.get(albumKey) || null;
  }

  /**
   * Retrieves an Object URL for an album, checking memory then IndexedDB.
   */
  async function getThumbnailObjectUrl(albumKey) {
    if (!albumKey) return null;

    if (memoryUrlMap.has(albumKey)) {
      return memoryUrlMap.get(albumKey);
    }

    if (failedKeySet.has(albumKey)) {
      return null;
    }

    const record = await getRecord(albumKey);
    if (!record) return null;

    if (record.status === 'not_found') {
      if (Date.now() - (record.updatedAt || 0) < NEGATIVE_CACHE_TTL_MS) {
        failedKeySet.add(albumKey);
        return null;
      }
      return null;
    }

    if (record.blob) {
      const objectUrl = URL.createObjectURL(record.blob);
      memoryUrlMap.set(albumKey, objectUrl);
      return objectUrl;
    }

    return null;
  }

  /**
   * Marks an album as lacking cover art (Negative Caching).
   * Prevents repeated expensive network requests.
   */
  async function markThumbnailFailed(albumKey) {
    if (!albumKey) return;
    failedKeySet.add(albumKey);
    await putRecord({
      albumKey,
      status: 'not_found',
      updatedAt: Date.now(),
      sizeBytes: 0
    });
  }

  /**
   * Checks whether this album key was marked as having no cover art.
   */
  function isThumbnailFailed(albumKey) {
    if (!albumKey) return false;
    return failedKeySet.has(albumKey);
  }

  /**
   * Clears the entire IndexedDB thumbnail store and revokes in-memory Object URLs.
   */
  async function clearThumbnailCache() {
    try {
      // Revoke all in-memory object URLs to free memory immediately
      for (const url of memoryUrlMap.values()) {
        try {
          URL.revokeObjectURL(url);
        } catch (_) {}
      }
      memoryUrlMap.clear();
      failedKeySet.clear();
      pendingFetches.clear();

      const db = await openDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const req = store.clear();
        req.onsuccess = () => resolve({ cleared: true });
        req.onerror = () => reject(req.error);
      });
    } catch (err) {
      console.warn('[ThumbnailCache] Error clearing cache:', err);
      return { cleared: false, error: err.message };
    }
  }

  /**
   * Computes statistics regarding local thumbnail storage.
   */
  async function getThumbnailStats() {
    try {
      const db = await openDB();
      return new Promise((resolve) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        let count = 0;
        let totalBytes = 0;

        const req = store.openCursor();
        req.onsuccess = (event) => {
          const cursor = event.target.result;
          if (cursor) {
            const val = cursor.value;
            if (val && val.status === 'cached' && val.sizeBytes) {
              count++;
              totalBytes += val.sizeBytes;
            }
            cursor.continue();
          } else {
            resolve({
              count,
              totalBytes,
              formattedSize: (totalBytes / 1024).toFixed(1) + ' KB'
            });
          }
        };
        req.onerror = () => {
          resolve({ count: 0, totalBytes: 0, formattedSize: '0 KB' });
        };
      });
    } catch (err) {
      return { count: 0, totalBytes: 0, formattedSize: '0 KB', error: err.message };
    }
  }

  /**
   * Revokes all active object URLs. Call on page unload.
   */
  function revokeAllObjectUrls() {
    for (const url of memoryUrlMap.values()) {
      try {
        URL.revokeObjectURL(url);
      } catch (_) {}
    }
    memoryUrlMap.clear();
  }

  // Export interface
  const thumbnailCache = {
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

  global.thumbnailCache = thumbnailCache;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = thumbnailCache;
  }
})(typeof self !== 'undefined' ? self : this);
