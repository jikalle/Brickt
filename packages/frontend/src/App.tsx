import { Routes, Route } from 'react-router-dom'
import Home from './pages/Home'
import Properties from './pages/Properties'
import PropertyDetail from './pages/PropertyDetail'
import InvestorDashboard from './pages/InvestorDashboard'
import OwnerConsole from './pages/OwnerConsole'
import AdminActivities from './pages/AdminActivities'
import AdminSystemStatus from './pages/AdminSystemStatus'
import Disclosures from './pages/Disclosures'
import NotFound from './pages/NotFound'
import Navbar from './components/common/Navbar'
import Footer from './components/common/Footer'
import NightSkyBackground from './components/common/NightSkyBackground'

function App() {
  return (
    <NightSkyBackground>
      <div className="min-h-screen flex flex-col">
        <Navbar />
        <main className="flex-grow">
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/properties" element={<Properties />} />
            <Route path="/properties/:id" element={<PropertyDetail />} />
            <Route path="/dashboard" element={<InvestorDashboard />} />
            <Route path="/admin" element={<OwnerConsole />} />
            <Route path="/owner" element={<OwnerConsole />} />
            <Route path="/admin/activities" element={<AdminActivities />} />
            <Route path="/admin/system" element={<AdminSystemStatus />} />
            <Route path="/disclosures" element={<Disclosures />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </main>
        <Footer />
      </div>
    </NightSkyBackground>
  )
}

export default App
