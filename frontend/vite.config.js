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

// Set only by the deploy-test job's CD script so the same config that serves
// local dev (localhost-only, default Host-header allowlist) can also serve
// the dev server publicly on the test EC2 host.
const publicDev = process.env.VITE_ALLOW_PUBLIC === 'true'

export default defineConfig({
  plugins: [react(), basicSsl()],
  resolve: {
    dedupe: ['react', 'react-dom'],
  },
  server: {
    ...(publicDev ? { host: '0.0.0.0', allowedHosts: true } : {}),
    proxy: {
      '/auth': proxyConfig,
      '/accounts': proxyConfig,
      '/transactions': proxyConfig,
      '/admin': proxyConfig,
      '/superadmin': proxyConfig,
      '/notifications': proxyConfig,
    },
  },
})