import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const dashboardPort = parseInt(process.env.DASHBOARD_PORT || '34234', 10)
const apiPort = parseInt(process.env.API_PORT || '3000', 10)

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: dashboardPort,
    proxy: {
      '/api': {
        target: `http://localhost:${apiPort}`,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, '')
      }
    }
  }
})
