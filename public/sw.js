/**
 * PTN Time Service Worker
 * Handles PWA caching, background push notifications, and local scheduled alarms
 */

const CACHE_NAME = 'ptntime-cache-v9.9';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    clients.claim().then(() => {
      // Clean old caches if any
      return caches.keys().then((keys) => {
        return Promise.all(
          keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
        );
      });
    })
  );
});

// Handle Notification Click (Focus or open app window)
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});

// Handle Push Events (from Web Push Server)
self.addEventListener('push', (event) => {
  let payload = {
    title: 'PTN Time แจ้งเตือน',
    body: 'มีการแจ้งเตือนใหม่ในระบบ',
    icon: 'https://cdn-icons-png.flaticon.com/512/2972/2972531.png',
    badge: 'https://cdn-icons-png.flaticon.com/512/2972/2972531.png',
    data: { url: '/' }
  };

  if (event.data) {
    try {
      const json = event.data.json();
      payload = { ...payload, ...json };
    } catch (e) {
      payload.body = event.data.text();
    }
  }

  const options = {
    body: payload.body,
    icon: payload.icon || 'https://cdn-icons-png.flaticon.com/512/2972/2972531.png',
    badge: payload.badge || 'https://cdn-icons-png.flaticon.com/512/2972/2972531.png',
    vibrate: [200, 100, 200],
    data: payload.data || { url: '/' },
    tag: payload.tag || 'ptntime-notification',
    renotify: true
  };

  event.waitUntil(self.registration.showNotification(payload.title, options));
});

// Handle Messages from Client App
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SHOW_NOTIFICATION') {
    const { title, options } = event.data;
    self.registration.showNotification(title, {
      icon: 'https://cdn-icons-png.flaticon.com/512/2972/2972531.png',
      badge: 'https://cdn-icons-png.flaticon.com/512/2972/2972531.png',
      vibrate: [200, 100, 200],
      ...options
    });
  }
});
