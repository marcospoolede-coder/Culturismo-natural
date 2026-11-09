# Cuaderno de Fuerza

App web para seguir un plan de entrenamiento de culturismo natural por ciclos. Es el cuaderno
manuscrito de Marcos (31 de mayo de 2025) pasado a una app que dice qué toca hoy, con qué peso,
y apunta lo que has hecho.

- **App:** https://marcospoolede-coder.github.io/Culturismo-natural/
- **Panel de administración:** https://marcospoolede-coder.github.io/Culturismo-natural/panel.html
- **Versión 2:** es la principal desde el 5 de noviembre de 2026; cambios en `CAMBIOS.md`. La anterior queda en `v1.html` por si hay que volver.
- **Repositorio:** https://github.com/marcospoolede-coder/Culturismo-natural (GitHub Pages sirve la raíz)

Este documento está escrito para que cualquier persona, o cualquier Claude, se ponga al día
sin tener que leer 3.400 líneas de código ni rebuscar en conversaciones antiguas. Si cambias
algo importante, actualízalo aquí.

## 1. Cómo está hecha

Archivos sueltos, sin dependencias ni compilación. Se edita y se hace push; GitHub Pages
publica en un minuto.

    index.html            la app entera: estilos, datos del plan y lógica, en un solo archivo
    sw.js                 service worker: instalable y sin cobertura
    manifest.webmanifest  nombre, colores e iconos de la app instalada
    supabase-config.js    URL del proyecto y clave anon de Supabase (pública a propósito)
    supabase.sql          tabla entrenamientos y sus políticas
    aprobacion.sql        control de acceso: tabla acceso, trigger y políticas
    panel.sql             visitas, administradores y las funciones del panel
    panel.html            panel web de administración (altas, visitas, aprobar y denegar)
    push.sql              avisos fuera de la app: tabla, permisos y reloj de pg_cron
    supabase/empuja.ts    Edge Function que manda las notificaciones (ver AVISOS.md)
    AVISOS.md             cómo montar y depurar el aviso fuera de la app
    img/                  55 fotos de ejercicios en webp, dos fotogramas por foto; img/FUENTE.md
    icon-*.png, qr.png    iconos (David de Miguel Ángel) y QR para compartir
    CREDITOS.md           licencias de las imágenes; la del David exige acreditar

`index.html` empieza con unas 24 líneas de envoltorio (head, manifiesto, iconos y los dos
scripts de Supabase) y a partir de `<title>` va la app. Dentro, por orden:

1. CSS, con las variables de color en `:root` y el modo oscuro.
2. Datos del plan: `LIFTS`, `RUT`, `FOTOS`, `ALT`, `SERIES`, `FUERZA_SEM`, `FASES`.
3. Estado y persistencia: `state`, `save()`, `cargaNube()`, `guardaNube()`.
4. Cálculo: `seriesDe()`, `repsDe()`, `coefSerie()`, `cargas()`, `descansoDe()`, `rmTeorico()`.
5. Vistas: `render()` reparte a `vHoy()`, `vCal()`, `vPlan()`, `vRM()`, `vCom()`, `vAjustes()`
   y `vBienvenida()`.
6. Incentivos: `racha()`, escudos, puntos, `felicita()`, logros.
7. Cronómetro, eventos, descargas CSV, glosario (`GLOSARIO`, `info()`), service worker.

## 2. El plan de entrenamiento

Fuente de verdad: el cuaderno manuscrito y las tablas del curso que lo acompañan (fotos en el
Mac de Marcos, `~/Documents/Personal/Personal training/`). Un sistema son 8 bloques, casi un
año, y se repite.

| Bloque | Rutina | Intensidad | Reps básicos | Descanso | Nota |
|---|---|---|---|---|---|
| Ciclo 1 | A y B | 60% (coef 0,58 a 0,67) | 12, 10 | 1:30 | Punto de partida, test de maximales |
| Ciclo 2 | A y B | 65% (0,67) | 12, 10, 8 | 1:45 | Subir peso |
| Ciclo 3 | A y B | 70% (0,73) | 10, 8, 6 | 2:00 | |
| Ciclo 4 | A, B y C | 70 a 75% (0,73 a 0,79) | 10, 8, 6 | 2:00 | Test antes de abrir la fase |
| Ciclo 5 | A, B y C | 77,5 a 80% (0,79 a 0,82) | 8, 6, 4 | 2:00 | |
| Ciclo 6 | A, B y C | 80% (0,82) | 8, 6, 4 | 2:00 | Rest pause en el básico y drop en la última serie de los complementarios |
| Fuerza | A, B y C | 80 a 95%, 7 semanas | 7, 6, 5, 4, 3, 2, 1 | 3:00 | 4 series; coef 0,85 a 0,98 |
| Cierre | A, B y C | 80% (0,82) | 8 (complementarios 12) | 3:00 | 4 series; test con el pico de fuerza |

Cada ciclo son 3 semanas y la tercera es de descarga. Series por semana (`SERIES`):
básicos 3, 3, 2; complementarios 3, 2, 1; jump sets 3, 3, 2 vueltas.

**Rutina A y B** (full body, de la tabla "Símil Full Body"):

- A: box squat, press banca, remo o seal row. Jump set: curl con barra, hiperextensión, calf machine.
- B: peso muerto, press militar, dominadas supinas. Jump set: prensa 45, crunch invertido, fondos.

**Rutina A, B y C** (de la tabla azul "Push Pull"):

- A: squat, leg curl, press militar, press con mancuernas. Jump set: calf machine, crunch inverso.
- B: press banca, press inclinado, fondos de tríceps, remo o seal row como básico. Jump set:
  calf en prensa, hiperextensión 45. En la tabla original el cuarto ejercicio era box squat
  6×2 al 8RM; Marcos pidió sustituirlo por remo (septiembre de 2026).
- C: peso muerto, dominadas, curl con barra. Jump set: remo o seal row, leg extensión, crunch
  invertido. El remo va en la zona amarilla de la tabla, es jump set, no un tercer básico pesado
  (corregido el 7 de octubre de 2026).

Reglas que aplica la app:

- **Básicos**: peso = maximal × coeficiente del bloque, redondeado a discos reales. Barra de 20 kg
  incluida. En dominadas el lastre es la marca menos el peso corporal.
- **Complementarios**: al fallo, 2 minutos entre series, el peso lo elige la persona.
- **Jump sets**: dos o tres ejercicios alternando cada 30 segundos, por vueltas.
- **Entre ejercicios**: ni el cuaderno ni el curso fijan un descanso. La app arranca el
  cronómetro al apuntar la última serie con el descanso del ejercicio que acaba, así que del
  básico al complementario se descansa lo del básico (3:00 en fuerza) y entre complementarios
  2:00.
- **Convertidor Maurice y Rydin**: cada repetición vale un 3%. Factor = 1 + 0,03 × (reps − objetivo).
  Validado contra Nuzzo 2024: error menor del 2,5% en tren superior hasta 15 reps; sobreestima
  un 8 a 12% en tren inferior.
- **1RM teórico inverso** (`rmTeorico`): estima la marca a partir de las series del último ciclo
  con técnica A o B y recámara 4 o menos. Tiene fallos conocidos: no limita las reps y sobreestima
  en pierna. Pendiente de afinar si Marcos lo pide.

Hay más tablas del curso en las fotos (las de "1º, 2º y 3º micro" con drop sets y rest pause, y
la de encabezado rojo con superseries). Son otras variantes del curso, no la rutina base; no
hay que mezclarlas con `RUT`.

## 3. Lo que se registra

En los básicos, cada serie pide peso real, repeticiones reales, recámara (0 a 5) y técnica
(A limpia, B alguna rota, C rota). No se abre el siguiente ejercicio hasta rellenar el actual.
Los complementarios y jump sets se marcan como hechos. Todo se exporta a CSV desde Ajustes
(maximales, sesiones y series).

El estado vive en `state` y se guarda en `localStorage` (clave `cuaderno-fuerza-v1`) y, si hay
cuenta, en Supabase como JSONB en la tabla `entrenamientos`. Campos principales: `pos` (fase,
semana, sesión), `porSemana`, `orden`, `dias`, `rms`, `registros`, `hechas`, `marcas`,
`escudos`, `puntos`, `logros`, `salvadas`, `alt`, `peso`, `visto`. Pesa unos 310 KB por
persona como máximo, así que el plan gratuito de Supabase da para unas 1.600 personas.

## 4. Cuentas, acceso y panel

Supabase, proyecto `ocrmaythsawmuotoqvzr`. La clave anon va en el repo y es pública a propósito;
lo que protege los datos son las políticas de las tablas. **La service role key no entra nunca
en el repo ni en la app.**

Modelo de acceso (decisión de Marcos, 28 de septiembre de 2026): cualquiera puede registrarse,
pero no guarda en la nube hasta que se le aprueba. `aprobacion.sql` crea la tabla `acceso`
(pendiente, aprobado, denegado), un trigger que da de alta a cada usuario nuevo como pendiente,
y las políticas de `entrenamientos` exigen estar aprobado. Mientras tanto la app funciona igual
y guarda en el dispositivo.

`panel.sql` añade la tabla `visitas` (una fila por persona y día), la función `visita()` que
llama la app al arrancar, la tabla `admins` y las funciones `panel()` y `decide()`. Son
administradores marcos@relevofamiliar.com y marcospoolede@gmail.com. `panel.html` entra con la
cuenta, llama a `panel()` y muestra nombre, correo, alta, estado, último acceso, visitas de hoy,
semana y mes, sesiones y último entreno, con botones de aprobar y denegar.

Orden para montarlo en un proyecto nuevo, en SQL Editor: `supabase.sql`, `aprobacion.sql`,
`panel.sql`. Si el panel dice "Could not find the function public.panel", es que falta
ejecutar `panel.sql`.

## 5. App instalable y actualizaciones

`sw.js` precachea solo el manifiesto y los iconos. La página va siempre de la red primero y
solo se sirve de la caché sin cobertura; precachear el HTML daba versiones viejas. Las fotos
van de la caché primero porque no cambian.

Para que una app instalada que lleva días abierta se entere de los cambios, `compruebaVersion()`
descarga `index.html` al volver a la app y compara la constante `VERSION`. Si cambia, muestra la
franja "Hay una versión nueva" con el botón Actualizar. En Ajustes hay una sección Versión con
el mismo botón.

**En cada despliegue hay que cambiar `var VERSION` en `index.html`** (fecha y hora), y si tocas
`sw.js` o los iconos, también `VERSION` en `sw.js`.

**Aviso fuera de la app**: iOS congela las webs en segundo plano, así que el pitido solo
suena con la app a la vista. Para avisar con el móvil bloqueado o en otra app hay
notificaciones push: la app apunta el aviso en la tabla `avisos` y un reloj de pg_cron
dispara la Edge Function `empuja`, que lo manda. Montaje y depuración en `AVISOS.md` (incluye el plan B con la app ntfy, que no necesita servidor); la
clave VAPID privada vive en los secretos de Supabase, nunca en el repo. Dentro de la app,
cada básico muestra antes de la primera serie sus series de aproximación.

Instalación: en iPhone solo desde Safari (Compartir, Añadir a pantalla de inicio); en Android y
ordenador, con el botón de instalar de Chrome o Edge. El QR de `qr.png` apunta a la app.

## 6. Incentivos

Adaptación del modelo de Duolingo a 3 sesiones por semana (investigación de septiembre de 2026):

- **Racha semanal**, no diaria: cuenta semanas seguidas cumpliendo los días elegidos en Ajustes.
- **Escudos**: uno cada 4 semanas cumplidas, máximo 2. Si una semana se queda corta, se gasta
  solo y la racha sigue.
- **Puntos y logros**: se mantienen porque Marcos lo quiso, aunque la evidencia avisa de que los
  puntos pueden restar motivación intrínseca.
- **Premio por estrenar cada bloque** (9 de noviembre de 2026): al cerrar la primera sesión
  que haces en un bloque cae un logro con nombre propio: Bautismo de hierro, Más chicha,
  Setenta y subiendo, Abecedario, Zona pesada, Pausa dramática, Modo Hulk y Hércules. Ids
  `f_` más el id de la fase, concedidos en `revisaLogros()`.
- Pendiente con mejor evidencia: preguntar al cerrar la sesión qué día y a qué hora será la
  siguiente (intenciones de implementación).

## 7. Alimentación y afiliados

La pestaña Comida habla solo de tres cosas: proteína (1,6 a 2 g por kg), creatina monohidrato
(5 g, mejor Creapure) y magnesio bisglicinato para el descanso (200 a 300 mg elementales antes
de dormir). Cada tarjeta explica cómo elegir un producto bueno sin atarse a marcas.

Desde el 9 de noviembre de 2026 hay una cuarta tarjeta, "Qué comer en cada ciclo"
(`comidaCicloHTML`), con la base anual y un desplegable por bloque que se abre solo en el que
toca: superávit del 5 al 20 % y 0,25 a 0,5 % del peso a la semana, los dos escalados por experiencia
(los avanzados, a la parte baja), y el peso estable de meses como mantenimiento; proteína 1,6 a 2,2 g/kg en
comidas de 0,4 a 0,55 g/kg, grasa 0,5 a 1,5 g/kg, hidratos el resto con un suelo de 3 a 5 g/kg,
más hidratos en los ciclos de volumen, mantenimiento o 5 a 10 % en fuerza, cafeína 3 mg/kg y
gelatina con vitamina C opcionales en fuerza, y nada de dieta en la descarga. Fuentes: Iraki,
Fitschen, Espinar y Helms 2019 (Sports 7:154), Helms y otros 2023 (Sports Med Open 9:102), posición de la ISSN sobre creatina (Kreider 2017)
y Shaw 2017 sobre gelatina y síntesis de colágeno. Las cifras se calculan con el peso de Ajustes.

### Lo que comes frente a lo que gastas (10 de noviembre de 2026)

Arriba de la pestaña Comida hay un registro de comidas con semáforo. Vive en Supabase
(`nutricion.sql`): tablas `comidas`, `gasto_diario`, `peso_corporal`, `integraciones`,
`whoop_tokens` y `whoop_estados`, el bucket privado `comidas` para las fotos y la columna
`plan` de `acceso`.

- Planes, en `acceso.plan`:
  - `gratis`: comidas a mano y repetir comidas de días anteriores.
  - `pago`: foto y descripción con IA por la API de Claude, en la Edge Function
    `analiza-comida` (secreto `ANTHROPIC_API_KEY`, modelo `claude-opus-5-5` con esfuerzo bajo,
    tope de 15 al día). Sin la clave, la función contesta `sin_clave` y la app lo explica.
  - `propio`: lo mismo, pero lo calcula el Mac de Marcos con su suscripción de Claude
    (`trabajador/comidas_suscripcion.py`, launchd cada minuto, `trabajador/instala.sh`). Si la
    suscripción está en su límite de uso, la comida espera y sale sola después.
- Gasto, por orden de preferencia: WHOOP (Edge Function `whoop`, OAuth con refresco y reloj
  cada hora), Apple Salud (Edge Function `salud`, que recibe un atajo del iPhone con un código
  personal), a mano, el mantenimiento que ponga la persona o una estimación con Mifflin-St Jeor.
  WHOOP solo deja guardar copias el tiempo justo: se guarda el total de kcal por día y se borra
  a los 30 días.
- Semáforo: verde si la media de 7 días cae en la horquilla de superávit (Helms 2023: 10 a 20 %
  con menos de un año entrenando, 7 a 15 % de uno a tres, 5 a 10 % con más de tres; mitad baja
  en la descarga), naranja hasta 7 puntos fuera y rojo más allá. Con tres semanas de pesos
  manda la báscula (0,25 a 0,5 %, 0,25 a 0,4 % o 0,1 a 0,25 % del peso a la semana), porque los
  relojes fallan un 10 a 40 % en el gasto.
- Recomendaciones: kcal que faltan o sobran con ejemplos de comida, proteína corta frente a
  1,6 g/kg y aviso de comidas de más de 900 kcal si luego hay que rendir trabajando.
- Despliegue sin panel: `bash supabase/despliega.sh` (tablas, funciones, secretos y reloj).

Los botones de compra llevan la etiqueta de Amazon Afiliados de Marcos, `cuadernofuerz-21`
(constante `AFILIADO`, cuenta creada el 6 de octubre de 2026). Con la etiqueta puesta aparece
sola la línea de aviso de afiliado que exige Amazon. Pendiente de Marcos: datos de pago en la
central de afiliados y 3 ventas en 180 días para confirmar la cuenta.

## 8. Estilo

Grecia clásica. Cinzel para los títulos, EB Garamond para el texto (18 px), IBM Plex Mono para
los números. Paleta clara: fondo #EAE7DF, acento egeo #1D5B82, aviso terracota #9B3B2E, ok oliva
#5A7638, descarga oro #A87B2E. Modo oscuro obsidiana. Greca en el borde de la cabecera. El icono
es el David de Miguel Ángel a dos tintas (foto de Jörg Bittner Unna, CC BY 3.0, se acredita en
el pie y en `CREDITOS.md`).

Copy: lo esencial, explicado para que lo entienda cualquiera. La jerga se mantiene pero cada
término lleva la "i" del glosario. Sin puntos medios ni rayas largas. Español con todas sus
tildes.

## 9. Cómo se trabaja en este repo

- Los cambios se hacen solo aquí, en GitHub. Los artefactos de claude.ai que hubo quedaron
  congelados el 28 de septiembre de 2026.
- Flujo: clonar o `git pull`, editar `index.html` (sustituciones exactas), comprobar sintaxis
  (`node --check` del bloque de script), probar en local con `python3 -m http.server` si cambia
  la interfaz, subir `VERSION`, commit, push y verificar con `curl` que GitHub Pages ya lo sirve.
- Depura en local antes de culpar al código: una vez el service worker servía una copia vieja y
  pareció un fallo del calendario.
- En `vCal()` las variables `m` y `k` ya las usa la rejilla del calendario; no reutilizarlas.
- La clase `.info` es de los avisos; los botones del glosario usan `.gi`.
- Nada que lleve la service role key, ni correos ni datos de personas, entra en el repo.

## 10. Para que Claude lea esto

El repositorio es público: basta con pasar el enlace a Claude o pegar la dirección raw de
`index.html`. En claude.ai se puede conectar el conector de GitHub; en Claude Code se clona y
se trabaja encima. Si algún día se quiere que Claude lea también los entrenos guardados de una
persona, eso sería una MCP pequeña que entre en Supabase con la cuenta de esa persona; hoy no
existe y no hace falta para entender la app.
