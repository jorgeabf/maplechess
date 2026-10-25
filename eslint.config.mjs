import eslintPluginAstro from 'eslint-plugin-astro'
import tseslint from 'typescript-eslint'

export default [
	...tseslint.configs.recommended,
	...eslintPluginAstro.configs.recommended,
	{
		rules: {
			// Omitir campos con { campo: _x, ...resto } es intencionado.
			'@typescript-eslint/no-unused-vars': [
				'error',
				{ ignoreRestSiblings: true, argsIgnorePattern: '^_', varsIgnorePattern: '^_' }
			]
		}
	},
	{
		ignores: [
			// Las copias de trabajo de las sesiones de Claude Code.
			'.claude/',
			'dist/',
			'.astro/',
			'.wrangler/',
			'node_modules/',
			'public/',
			'worker-configuration.d.ts'
		]
	}
]
