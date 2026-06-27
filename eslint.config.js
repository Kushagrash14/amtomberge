import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist', 'node_modules', 'atm-server/node_modules']),
  {
    files: ['src/**/*.{js,jsx}', '*.js'],
    ignores: ['src/components/ProductionMonitor.jsx'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
  },
  {
    files: ['src/components/ProductionMonitor.jsx'],
    extends: [js.configs.recommended],
    languageOptions: {
      globals: {
        ...globals.browser,
        google: 'readonly',
      },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: {
      'no-empty': 'off',
      'no-unused-vars': ['error', {
        varsIgnorePattern: '^(SS_ID|LOGO_B64|chartsRef|chartInit|isOp|isSuperAdmin)$',
        argsIgnorePattern: '^(e|S|onLogout)$',
        caughtErrorsIgnorePattern: '^e$',
      }],
    },
  },
  {
    files: ['atm-server/**/*.js'],
    ignores: ['atm-server/node_modules/**'],
    extends: [js.configs.recommended],
    languageOptions: {
      globals: globals.node,
    },
  },
])
