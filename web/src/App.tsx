import { useState } from 'react'
import { Navigation } from './components/Navigation'
import { Leaderboard } from './pages/Leaderboard'
import { Games } from './pages/Games'
import { LapTimes } from './pages/LapTimes'

export function App() {
  const [currentPage, setCurrentPage] = useState<'leaderboard' | 'games' | 'times'>('leaderboard')

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 to-blue-50">
      <Navigation currentPage={currentPage} onPageChange={setCurrentPage} />
      
      <main className="max-w-6xl mx-auto px-4 py-8">
        {currentPage === 'leaderboard' && <Leaderboard />}
        {currentPage === 'games' && <Games />}
        {currentPage === 'times' && <LapTimes />}
      </main>
    </div>
  )
}

export default App
