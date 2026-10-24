// Punto de entrada del código de los tableros: el visor de partidas y el
// explorador del repertorio, en un solo archivo (lo carga ScriptTableros.astro).
// Con un script por componente, Vite sacaba lo que comparten (chessground,
// chessops y el panel del motor) a un tercer archivo que el navegador sólo
// descubría al leer el primero: una ida y vuelta más antes de pintar el
// tablero. Astro no emite modulepreload. Cada página trae así el código del
// otro elemento, unos pocos KB, y el motor sigue cargándose aparte al encenderlo.
import './visor/visor-partida'
import './repertorio/explorador-repertorio'
