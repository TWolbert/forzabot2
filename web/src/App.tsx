import { BrowserRouter, Routes, Route, Outlet } from 'react-router-dom'
import { Navigation } from './components/Navigation'
import { Home } from './pages/Home'
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
      <div className="min-h-screen bg-black">
        <Navigation />
        
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/leaderboard" element={<div className="min-h-screen bg-black"><main className="max-w-6xl mx-auto px-4 py-8"><Leaderboard /></main></div>} />
          <Route path="/players/:playerId" element={<div className="min-h-screen bg-black"><main className="max-w-6xl mx-auto px-4 py-8"><PlayerDetail /></main></div>} />
          <Route path="/games" element={<GamesLayout />}>
            <Route index element={<div className="min-h-screen bg-black"><main className="max-w-6xl mx-auto px-4 py-8"><Games /></main></div>} />
            <Route path=":gameId" element={<div className="min-h-screen bg-black"><main className="max-w-6xl mx-auto px-4 py-8"><GameDetail /></main></div>} />
          </Route>
          <Route path="/times" element={<TimesLayout />}>
            <Route index element={<div className="min-h-screen bg-black"><main className="max-w-6xl mx-auto px-4 py-8"><LapTimes /></main></div>} />
            <Route path=":timeId" element={<div className="min-h-screen bg-black"><main className="max-w-6xl mx-auto px-4 py-8"><TimeDetail /></main></div>} />
          </Route>
        </Routes>
      </div>
    </BrowserRouter>
  )
}

export default App
