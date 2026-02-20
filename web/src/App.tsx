import { BrowserRouter, Routes, Route, Outlet } from 'react-router-dom'
import { Navigation } from './components/Navigation'
import { Leaderboard } from './pages/Leaderboard'
import { Games, GameDetail } from './pages/Games'
import { LapTimes, TimeDetail } from './pages/LapTimes'
import { PlayerDetail } from './pages/PlayerDetail'

function GamesLayout() {
  return <Outlet />
}

function TimesLayout() {
  return <Outlet />
}

export function App() {
  return (
    <BrowserRouter>
      <div className="min-h-screen bg-gradient-to-br from-green-50 to-blue-50">
        <Navigation />
        
        <main className="max-w-6xl mx-auto px-4 py-8">
          <Routes>
            <Route path="/" element={<Leaderboard />} />
            <Route path="/players/:playerId" element={<PlayerDetail />} />
            <Route path="/games" element={<GamesLayout />}>
              <Route index element={<Games />} />
              <Route path=":gameId" element={<GameDetail />} />
            </Route>
            <Route path="/times" element={<TimesLayout />}>
              <Route index element={<LapTimes />} />
              <Route path=":timeId" element={<TimeDetail />} />
            </Route>
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  )
}

export default App
