import babel from '@rolldown/plugin-babel'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    babel({ presets: [reactCompilerPreset()] })
  ],
  server: {
    watch: {
      // Ignore atomic-write temp dirs (`.name.pid.uuid.tmpdir/`): a transient
      // lock on them crashes the watcher with EBUSY on Windows.
      ignored: ["**/*.tmpdir/**", "**/.*.tmpdir/**"],
    },
  },
})
