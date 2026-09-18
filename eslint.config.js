import js from '@eslint/js'
import { defineConfig, globalIgnores } from 'eslint/config'
import globals from 'globals'
import ts from 'typescript-eslint'
import svelte from 'eslint-plugin-svelte'
import astro from 'eslint-plugin-astro'
import prettier from 'eslint-config-prettier'

export default defineConfig(
  globalIgnores(['dist/', '.astro/', 'node_modules/', 'docs/', 'public/', '.qlty/']),
  js.configs.recommended,
  ts.configs.recommended,
  svelte.configs.recommended,
  astro.configs.recommended,
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
  // เทมเพลต service worker รันในบริบท worker (self/caches/clients) ไม่ใช่ window
  // และ `__SW_PRECACHE__` เป็น placeholder ที่ integration แทนค่าให้ตอน build
  {
    files: ['src/pwa/service-worker.js'],
    languageOptions: {
      globals: { ...globals.serviceworker, __SW_PRECACHE__: 'readonly' },
    },
  },
  // prettier last: turns off all stylistic rules that conflict with Prettier
  prettier,
  svelte.configs.prettier,
)
