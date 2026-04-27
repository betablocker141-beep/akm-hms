import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

// Service worker is registered automatically by vite-plugin-pwa via registerSW.js.
// registerType:'autoUpdate' keeps the SW current without manual intervention.

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
