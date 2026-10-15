import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.tsx'
import { AuthGate } from './components/AuthGate.tsx'
import { I18nProvider } from './context/I18nContext.tsx'
import { LanguageProvider } from './context/LanguageContext.tsx'
import { StatsProvider } from './context/StatsContext.tsx'
import { ThemeProvider } from './context/ThemeContext.tsx'
import { WordTrailProvider } from './context/WordTrailContext.tsx'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nProvider>
      <ThemeProvider>
        <BrowserRouter>
          <AuthGate>
            <LanguageProvider>
              <StatsProvider>
                <WordTrailProvider>
                  <App />
                </WordTrailProvider>
              </StatsProvider>
            </LanguageProvider>
          </AuthGate>
        </BrowserRouter>
      </ThemeProvider>
    </I18nProvider>
  </StrictMode>,
)
