// Service worker mínimo: enseña las notificaciones Web Push y abre la app al tocarlas.
// No cachea nada (la app sigue siendo en línea); eso llega con la Fase 5.
self.addEventListener('push', (event) => {
  let datos = { title: 'Sports Predictor', body: '', url: '/' };
  try {
    datos = { ...datos, ...event.data.json() };
  } catch {
    datos.body = event.data ? event.data.text() : '';
  }
  event.waitUntil(self.registration.showNotification(datos.title, { body: datos.body, icon: '/icon-192.png', badge: '/icon-192.png', data: { url: datos.url } }));
});
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((lista) => {
      const abierta = lista.find((c) => 'focus' in c);
      if (abierta) {
        abierta.navigate(url);
        return abierta.focus();
      }
      return self.clients.openWindow(url);
    }),
  );
});
