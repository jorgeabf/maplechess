// Color de las barras del navegador en el móvil (<meta name="theme-color"> en
// Base.astro): el --bg de global.css, el fondo de la página. No el --surface de
// la cabecera: Chrome Android descarta los colores con luminosidad HSL mayor
// que 0,94 (ColorUtils.isThemeColorTooBright), y --surface da 0,98. --bg da
// 0,937, justo por debajo, y es el color que ya pone Safari 26, que tiñe con el
// fondo de la página. En modo oscuro, Chrome no usa el de la página en una
// pestaña normal (sólo en apps web instaladas). Una meta no lee variables CSS,
// así que va escrito; test/theme-color.test.ts comprueba el token y el límite.
export const THEME_COLOR = { light: '#f5f2ea', dark: '#15120f' } as const
