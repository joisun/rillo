import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { AppProviders } from './app/app-providers'
import { DashboardApp } from './app/dashboard-app'
import { migrateLegacyPreferences } from './lib/preferences/legacy-preferences'
import { RILLO_LOGO_URL } from './branding'

migrateLegacyPreferences()

const favicon = document.createElement('link')
favicon.rel = 'icon'
favicon.type = 'image/png'
favicon.href = RILLO_LOGO_URL
document.head.append(favicon)

const root = document.getElementById('root')
if (!root) throw new Error('React Dashboard root is missing')

createRoot(root).render(
  <StrictMode>
    <AppProviders>
      <DashboardApp />
    </AppProviders>
  </StrictMode>,
)
