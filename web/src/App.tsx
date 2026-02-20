import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { Navigation } from './components/Navigation'
import { Leaderboard } from './pages/Leaderboard'
import { Games, GameDetail } from './pages/Games'
import { LapTimes, TimeDetail } from './pages/LapTimes'

export function App() {
  return (
    <BrowserRouter>
      <div className="min-h-screen bg-gradient-to-br from-green-50 to-blue-50">
        <Navigation />
        
        <main className="max-w-6xl mx-auto px-4 py-8">
          <Routes>
            <Route path="/" element={<Leaderboard />} />
            <Route path="/games" element={<Games />} />
            <Route path="/games/:gameId" element={<GameDetail />} />
            <Route path="/times" element={<LapTimes />} />
            <Route path="/times/:timeId" element={<TimeDetail />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  )
}

export default App
