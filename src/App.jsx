import { Routes, Route } from 'react-router-dom'
import ProductionMonitor from './components/ProductionMonitor'

// App entry: routes production monitor as the home view

function App() {
  return (
    <Routes>
      <Route path="/" element={<ProductionMonitor />} />
    </Routes>
  )
}

export default App
