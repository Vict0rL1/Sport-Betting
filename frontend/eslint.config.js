// ESLint, de partida laxo (fase 0 del plan): solo lo que es un error seguro.
// Se endurece en la fase 4.5; aquí no se reformatea ni se reescribe nada.
import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['dist', 'node_modules'] },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: { ecmaVersion: 2022, globals: globals.browser },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  // Los scripts corren en Node (antes se ignoraban enteros).
  { files: ['scripts/**/*.ts'], languageOptions: { globals: globals.node } },
)
