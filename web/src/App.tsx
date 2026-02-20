import { useState, useEffect } from 'react'
import { Navigation } from './components/Navigation'
import { Leaderboard } from './pages/Leaderboard'
import { Games } from './pages/Games'
import { LapTimes } from './pages/LapTimes'

type Page = 'leaderboard' | 'games' | 'times'

function getPageFromHash(): Page {
  const hash = window.location.hash.slice(1)
  if (hash === 'games' || hash === 'times') return hash
  return 'leaderboard'
}

export function App() {
  const [currentPage, setCurrentPage] = useState<Page>(getPageFromHash())

  useEffect(() => {
    const handlePopState = () => {
      setCurrentPage(getPageFromHash())
    }

    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  const handlePageChange = (page: Page) => {
    setCurrentPage(page)
    window.history.pushState({ page }, '', `#${page === 'leaderboard' ? '' : page}`)
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 to-blue-50">
      <Navigation currentPage={currentPage} onPageChange={handlePageChange} />
      
      <main className="max-w-6xl mx-auto px-4 py-8">
        {currentPage === 'leaderboard' && <Leaderboard />}
        {currentPage === 'games' && <Games />}
        {currentPage === 'times' && <LapTimes />}
      </main>
    </div>
  )
}

export default App
