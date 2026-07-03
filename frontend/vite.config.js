import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import basicSsl from '@vitejs/plugin-basic-ssl'

const backend = 'http://127.0.0.1:8000'

const proxyConfig = {
  target: backend,
  changeOrigin: false,
  secure: false,
  headers: {
    'X-Forwarded-Proto': 'https',
  },
}

export default defineConfig({
  plugins: [react(), basicSsl()],
  resolve: {
    dedupe: ['react', 'react-dom'],
  },
  server: {
    proxy: {
      '/auth': proxyConfig,
      '/accounts': proxyConfig,
      '/transactions': proxyConfig,
      '/admin': proxyConfig,
    },
  },
})