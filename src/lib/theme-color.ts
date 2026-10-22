// Color de las barras del navegador en el móvil (<meta name="theme-color"> en
// Base.astro): el --surface de global.css, el fondo de la cabecera, para que
// barra y cabecera sean una sola franja. Una meta no lee variables CSS, así que
// va escrito; test/theme-color.test.ts comprueba que sigue siendo el del token.
export const THEME_COLOR = { light: '#fffdf8', dark: '#1f1b17' } as const
