import { Routes, Route } from 'react-router-dom'
import Home from './pages/Home'
import Properties from './pages/Properties'
import PropertyDetail from './pages/PropertyDetail'
import InvestorDashboard from './pages/InvestorDashboard'
import OwnerConsole from './pages/OwnerConsole'
import Disclosures from './pages/Disclosures'
import NotFound from './pages/NotFound'
import Navbar from './components/common/Navbar'
import Footer from './components/common/Footer'

function App() {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex flex-col">
      <Navbar />
      <main className="flex-grow">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/properties" element={<Properties />} />
          <Route path="/properties/:id" element={<PropertyDetail />} />
          <Route path="/dashboard" element={<InvestorDashboard />} />
          <Route path="/owner" element={<OwnerConsole />} />
          <Route path="/disclosures" element={<Disclosures />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>
      <Footer />
    </div>
  )
}

export default App
