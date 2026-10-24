import react from '@vitejs/plugin-react'
import basicSsl from '@vitejs/plugin-basic-ssl'
import { defineConfig } from 'vite'

// The dev server runs over HTTPS by default (self-signed certificate).
// Browsers only allow microphone access on localhost or a secure origin, so
// this is what lets you record when testing from a phone over the local
// network. Set HTTPS=off (see the `dev:http` script) for plain HTTP.
const useHttps = process.env.HTTPS !== 'off'

// https://vite.dev/config/
// The build's short commit id (Netlify sets COMMIT_REF) is sent with every feedback report so the owner knows which version a
// person was using. On a local run it reads "local".
const appBuild = (process.env.COMMIT_REF ?? 'local').slice(0, 7)

export default defineConfig({
  define: { __APP_BUILD__: JSON.stringify(appBuild) },
  plugins: [react(), ...(useHttps ? [basicSsl()] : [])],
  server: {
    host: true,
    // Pinned: Supabase and Google sign-in are configured for this exact
    // address (https://localhost:5180), so it must not drift to another port.
    port: 5180,
    strictPort: true,
  },
})
