/* Cuaderno de Fuerza, trabajador de servicio.
   Sirve para dos cosas: que la aplicación se instale en el móvil como una app
   y que funcione sin cobertura, que en un sótano de gimnasio es lo normal.
   Sube VERSION en cada despliegue para que el móvil recoja los cambios. */
var VERSION = "cuaderno-v4";
var BASE = new URL("./", self.location).pathname;
/* La página no se precachea a propósito: si se guarda en la instalación, la
   primera visita tras un cambio sirve la copia vieja. Se guarda sola al
   visitarla y solo se usa cuando no hay red. */
var NUCLEO = [BASE + "manifest.webmanifest",
              BASE + "icon-180.png", BASE + "icon-192.png", BASE + "icon-512.png"];

self.addEventListener("install", function(ev){
  ev.waitUntil(
    caches.open(VERSION).then(function(c){
      return Promise.all(NUCLEO.map(function(u){
        return c.add(new Request(u, {cache:"reload"}))["catch"](function(){});
      }));
    }).then(function(){ return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function(ev){
  ev.waitUntil(
    caches.keys().then(function(ns){
      return Promise.all(ns.filter(function(n){ return n !== VERSION; })
                           .map(function(n){ return caches["delete"](n); }));
    }).then(function(){ return self.clients.claim(); })
  );
});

/* La página siempre de la red primero, para que los cambios lleguen solos.
   Las fotos y los iconos, de la caché primero: no cambian nunca. */
self.addEventListener("fetch", function(ev){
  var req = ev.request;
  if(req.method !== "GET") return;
  var url = new URL(req.url);

  if(req.mode === "navigate" || (url.origin === self.location.origin && url.pathname === BASE + "index.html")){
    ev.respondWith(
      fetch(req).then(function(r){
        var copia = r.clone();
        caches.open(VERSION).then(function(c){ c.put(BASE + "index.html", copia); });
        return r;
      })["catch"](function(){
        return caches.match(BASE + "index.html").then(function(r){
          return r || caches.match(BASE);
        });
      })
    );
    return;
  }

  if(url.origin === self.location.origin || /fonts\.(googleapis|gstatic)\.com|cdn\.jsdelivr\.net/.test(url.host)){
    ev.respondWith(
      caches.match(req).then(function(hit){
        if(hit) return hit;
        return fetch(req).then(function(r){
          if(r && (r.status === 200 || r.type === "opaque")){
            var copia = r.clone();
            caches.open(VERSION).then(function(c){ c.put(req, copia); });
          }
          return r;
        });
      })
    );
  }
});
