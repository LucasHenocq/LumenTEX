import { createRoot } from 'react-dom/client'
import 'katex/dist/katex.min.css'
import './styles/app.css'
import App from './components/App'

createRoot(document.getElementById('root')!).render(<App />)
