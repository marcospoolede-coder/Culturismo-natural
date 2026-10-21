# Avisos fuera de la app (notificaciones push)

Para que el final del descanso llegue como notificación aunque estés en WhatsApp o con el
móvil bloqueado, hace falta montar una vez el lado del servidor en Supabase. Son tres pasos
y diez minutos. La app ya trae todo lo demás.

## Cómo funciona

1. Al arrancar un descanso, la app apunta en la tabla `avisos` de Supabase: "a tal hora,
   manda esto a este móvil".
2. Si atiendes el descanso dentro de la app (paras el cronómetro, sumas 30 segundos o
   marcas la siguiente serie), la app borra el aviso y no llega nada.
3. Si no, un reloj de la base de datos (pg_cron, cada 10 segundos) ve el aviso vencido y
   llama a la Edge Function `empuja`, que manda la notificación. Llega con 0 a 12 segundos
   de retraso, que para un descanso es nada.

## Montarlo (una sola vez, en supabase.com, proyecto ocrmaythsawmuotoqvzr)

1. **SQL Editor**: pega el contenido de `push.sql` y Run. Crea la tabla, sus permisos y el
   reloj.
2. **Edge Functions, Deploy a new function, via Editor**: nombre exacto `empuja`, pega el
   contenido de `supabase/empuja.ts` y despliega. En los ajustes de la función, desactiva
   **Verify JWT** (la llama el reloj de la base de datos, no un usuario).
3. **Edge Functions, Secrets**: añade `VAPID_PUBLICA` y `VAPID_PRIVADA` con los valores del
   archivo `Claves_avisos_Cuaderno.txt` que Marcos guarda en su Drive (carpeta 10. Claude).
   La privada no entra nunca en este repositorio.

## Activarlo en cada móvil

En la app instalada (pantalla de inicio, iOS 16.4 o más): Ajustes, sección **Aviso fuera de
la app**, botón **Activar avisos**, y aceptar el permiso de notificaciones. El botón
**Probar aviso** manda uno de prueba: bloquea el móvil y tiene que llegar en unos 15
segundos.

## Si no llega

- ¿Se ejecutó `push.sql` sin errores y existe la función `empuja` con Verify JWT apagado?
- ¿Están los dos secretos VAPID puestos?
- ¿El reloj corre? En SQL Editor: `select jobname, schedule, active from cron.job;`
- ¿La app está instalada en la pantalla de inicio y el permiso de notificaciones concedido?
  (En Safari a pelo, iPhone no admite notificaciones de webs.)
- En iPhone, el sonido de la notificación sigue las reglas del sistema: en modo silencio
  vibra en vez de sonar, y los modos de concentración pueden silenciarla.
