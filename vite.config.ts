import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  // Fix: Cast process to any to resolve TS error 'Property cwd does not exist on type Process'
  const env = loadEnv(mode, (process as any).cwd(), '');
  return {
    plugins: [react()],
    define: {
      'process.env.API_KEY': JSON.stringify(env.API_KEY),
      'process.env.NEXT_PUBLIC_BASE_URL': JSON.stringify(env.NEXT_PUBLIC_BASE_URL),
      'process.env.LINKEDIN_CLIENT_ID': JSON.stringify(env.LINKEDIN_CLIENT_ID),
    },
    server: {
      port: 5173,
      proxy: {
        '/api': {
          target: 'http://localhost:3000',
          changeOrigin: true,
          secure: false,
        },
      },
    },
    build: {
      outDir: 'dist',
      rollupOptions: {
        output: {
          manualChunks: {
            'react-vendor': ['react', 'react-dom', 'react-router-dom'],
            'ui-library': ['lucide-react', 'recharts'],
            'supabase': ['@supabase/supabase-js'],
            'ai': ['@google/generative-ai'],
          },
        },
      },
      chunkSizeWarningLimit: 1000,
    },
  };
});