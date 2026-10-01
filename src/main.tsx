import { createRoot } from 'react-dom/client'
import App from './App'
import { ErrorBoundary } from './ErrorBoundary'
import './styles.css'
import './operations.css'
import './facility.css'
import './refresh.css'
createRoot(document.getElementById('root')!).render(<ErrorBoundary><App /></ErrorBoundary>)
