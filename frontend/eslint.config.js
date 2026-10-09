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
  // Un `${x}` con x posiblemente `undefined` o `null` pinta «undefined» en
  // pantalla, y TypeScript no lo ve: un campo opcional dentro de una plantilla
  // compila. Así salió «undefined %» en el reparto del tamaño (V3, ítem 1.4).
  // Esta regla necesita los tipos, así que solo mira `src/`.
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } },
    rules: {
      '@typescript-eslint/restrict-template-expressions': [
        'error',
        { allowNumber: true, allowBoolean: true, allowNullish: false, allowAny: false, allowNever: false, allowRegExp: false },
      ],
    },
  },
  // Una cifra para una persona solo se escribe con `lib/formato.ts` (ítem 1.7):
  // cada `toFixed` suelto era un «21.3 %» con punto junto a un «0,56» con coma
  // (V4), y `toLocaleString('es')` no agrupa los números de cuatro cifras (V5).
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/lib/formato.ts', 'src/**/*.test.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression > MemberExpression.callee[property.name=/^(toFixed|toPrecision|toLocaleString|toLocaleDateString|toLocaleTimeString)$/]",
          message: 'Las cifras y fechas para el usuario se escriben con lib/formato.ts (fmtNum, fmtPct, fmtDinero, fmtFecha…).',
        },
        {
          selector: "NewExpression[callee.object.name='Intl'][callee.property.name=/^(NumberFormat|DateTimeFormat)$/]",
          message: 'Intl solo dentro de lib/formato.ts: un formateador propio es otro sistema de formato.',
        },
        // `${fmtNum(x, 1)} %` escribe un espacio normal: el «%» puede caer solo
        // en la línea siguiente (revisión de la Fase 1, 23 sitios).
        {
          selector: 'TemplateElement[value.raw=/^\\s+%/], JSXText[value=/^\\s+%/], Literal[value=/^\\s+%/]',
          message: 'Un porcentaje se escribe con fmtPct (con enPuntos si ya viene en %): lleva espacio duro antes de «%».',
        },
      ],
    },
  },
)
