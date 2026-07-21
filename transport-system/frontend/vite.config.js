import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true
      }
    }
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          // Core vendor — React runtime + router
          vendor: [
            'react',
            'react-dom',
            'react-router-dom',
          ],
          // Animation library — framer-motion is large
          animations: [
            'framer-motion',
          ],
          // HTTP client
          network: [
            'axios',
          ],
          // Google Maps — conditionally loaded
          maps: [
            '@react-google-maps/api',
          ],
        },
      },
    },
    // Generate source maps for debug builds only
    sourcemap: false,
    // Reduce CSS duplication
    cssCodeSplit: false,
  },
})

