import react from '@vitejs/plugin-react'
import basicSsl from '@vitejs/plugin-basic-ssl'
import { defineConfig } from 'vite'

// The dev server runs over HTTPS by default (self-signed certificate).
// Browsers only allow microphone access on localhost or a secure origin, so
// this is what lets you record when testing from a phone over the local
// network. Set HTTPS=off (see the `dev:http` script) for plain HTTP.
const useHttps = process.env.HTTPS !== 'off'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), ...(useHttps ? [basicSsl()] : [])],
  server: {
    host: true,
    // Pinned: Supabase and Google sign-in are configured for this exact
    // address (https://localhost:5180), so it must not drift to another port.
    port: 5180,
    strictPort: true,
  },
})
