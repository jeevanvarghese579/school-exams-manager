import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
export default defineConfig({ plugins: [react(), VitePWA({ registerType: 'autoUpdate', manifest: { name: 'School Exams Manager', short_name: 'Exams Manager', theme_color: '#164e63', background_color: '#f8fafc', display: 'standalone', icons: [{ src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }] }, workbox: { navigateFallback: 'index.html' } })] });
