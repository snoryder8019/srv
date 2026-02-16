// Minimal service worker for notifications
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window' }).then(list => {
      for (const client of list) {
        if (client.url.includes('/stevenClawbert') && 'focus' in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow('/stevenClawbert');
    })
  );
});
