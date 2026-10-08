/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      // El frontend habla siempre con el backend local; nada de keys en el navegador.
      '/api': 'http://localhost:8000',
    },
  },
  test: {
    // Componentes de React en un DOM simulado. Los tests viven junto al código
    // (`*.test.ts(x)`) y los comprueba también `tsc -b`, como el resto.
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
