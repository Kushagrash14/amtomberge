import { Routes, Route } from 'react-router-dom'
import ProductionMonitor from './components/ProductionMonitor'


function App() {
  return (
    <Routes>
      <Route path="/" element={<ProductionMonitor />} />
    </Routes>
  )
}

export default App
