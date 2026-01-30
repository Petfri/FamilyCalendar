const CACHE_NAME = 'family-sync-v2';
const ASSETS = [
    './',
    './index.html',
    './style.css',
    './app.js'
];

// Install Event
self.addEventListener('install', (e) => {
    self.skipWaiting(); // Force update
    e.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(ASSETS);
        })
    );
});

// Activate Event - Clean up old caches
self.addEventListener('activate', (e) => {
    e.waitUntil(
        caches.keys().then((keys) => {
            return Promise.all(keys.map((key) => {
                if (key !== CACHE_NAME) return caches.delete(key);
            }));
        })
    );
});

// Fetch Event - Network First Strategy (Better for Sync Apps)
self.addEventListener('fetch', (e) => {
    e.respondWith(
        fetch(e.request).catch(() => {
            return caches.match(e.request);
        })
    );
});
