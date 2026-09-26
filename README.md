# Cuaderno de Fuerza

App web para seguir un plan de entrenamiento de culturismo natural por ciclos.

**Abrir: https://marcospoolede-coder.github.io/Culturismo-natural/**

Funciona en el móvil y en el ordenador, sin instalar nada. Desde el navegador se puede añadir a la pantalla de inicio y queda como una app, con su icono y a pantalla completa.

## Qué hace

- Dice qué entreno toca hoy, con las series, las repeticiones y el peso de cada ejercicio.
- Calcula el peso a partir de tus maximales y te dice los discos que van por lado.
- Cronómetro de descanso que arranca solo al marcar una serie, con el tiempo que toca a ese ejercicio.
- Avisa de las semanas de descarga, de cuánto queda para cerrar el ciclo y de cuándo toca test de maximales.
- Guarda la progresión de tus marcas y la exporta a CSV.
- Convertidor de pesos Maurice y Rydin: cada repetición vale un 3%.

## Privacidad

No hay cuentas ni servidor. Cada persona guarda su entrenamiento en su propio navegador y nadie más lo ve, tampoco quien reparte el enlace. Por eso conviene exportar el CSV de vez en cuando: si se borran los datos del navegador, se pierde el historial.

## Estructura

Son archivos sueltos, sin dependencias ni compilación.

    index.html            la app entera
    manifest.webmanifest  la convierte en app instalable
    icon-180/192/512.png  iconos de la pantalla de inicio
