// Service worker: notificaciones Web Push (Fase 3) y sin conexión (Fase 5.26).
//
// Sin conexión: el armazón (la página y sus ficheros con hash) y la última respuesta de cada
// GET de la API quedan guardados. Navegación y API van primero a la red y solo si falla se
// sirve lo guardado; los ficheros con hash, primero de lo guardado (no cambian nunca).
// Nunca se guardan la sesión, el canal en vivo ni las métricas.
const ARMAZON = 'predictor-armazon-v1';
const API = 'predictor-api-v1';
const NO_GUARDAR = ['/api/auth/', '/api/stream', '/api/metrics', '/api/export/'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(ARMAZON).then((c) => c.addAll(['/'])).catch(() => undefined));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((ks) => Promise.all(ks.filter((k) => k.startsWith('predictor-') && k !== ARMAZON && k !== API).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copia = res.clone();
          caches.open(ARMAZON).then((c) => c.put('/', copia)).catch(() => undefined);
          return res;
        })
        .catch(() => caches.match('/').then((r) => r || Response.error())),
    );
    return;
  }
  if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/flags/') || /\.(woff2?|svg|png)$/.test(url.pathname)) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) {
              const copia = res.clone();
              caches.open(ARMAZON).then((c) => c.put(req, copia)).catch(() => undefined);
            }
            return res;
          }),
      ),
    );
    return;
  }
  if (url.pathname.startsWith('/api/') && !NO_GUARDAR.some((p) => url.pathname.startsWith(p))) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copia = res.clone();
            caches.open(API).then((c) => c.put(req, copia)).catch(() => undefined);
          }
          return res;
        })
        .catch(() => caches.match(req).then((r) => r || Response.error())),
    );
  }
});

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
