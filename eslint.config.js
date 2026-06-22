import js from '@eslint/js'
import globals from 'globals'
import ts from 'typescript-eslint'
import svelte from 'eslint-plugin-svelte'
import astro from 'eslint-plugin-astro'
import prettier from 'eslint-config-prettier'

/** @type {import('eslint').Linter.Config[]} */
export default ts.config(
  { ignores: ['dist/', '.astro/', 'node_modules/', 'docs/', 'public/'] },
  js.configs.recommended,
  ...ts.configs.recommended,
  ...svelte.configs.recommended,
  ...astro.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
  },
  {
    files: ['**/*.svelte', '**/*.svelte.ts'],
    languageOptions: {
      parserOptions: { parser: ts.parser },
    },
  },
  // prettier last: turns off all stylistic rules that conflict with Prettier
  prettier,
  ...svelte.configs.prettier,
)
