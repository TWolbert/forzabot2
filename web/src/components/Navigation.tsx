import { Trophy, Gamepad2, Clock } from 'lucide-react'

interface NavProps {
  currentPage: string
  onPageChange: (page: string) => void
}

export function Navigation({ currentPage, onPageChange }: NavProps) {
  const isActive = (page: string) => currentPage === page

  return (
    <nav className="bg-gradient-to-r from-green-600 to-green-700 text-white shadow-lg">
      <div className="max-w-7xl mx-auto px-4 py-4">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-3xl font-bold">🏁 ForzaBot Dashboard</h1>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => onPageChange('leaderboard')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg font-semibold transition ${
              isActive('leaderboard')
                ? 'bg-white text-green-600'
                : 'hover:bg-green-500'
            }`}
          >
            <Trophy size={20} />
            Leaderboard
          </button>
          <button
            onClick={() => onPageChange('games')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg font-semibold transition ${
              isActive('games')
                ? 'bg-white text-green-600'
                : 'hover:bg-green-500'
            }`}
          >
            <Gamepad2 size={20} />
            Games
          </button>
          <button
            onClick={() => onPageChange('times')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg font-semibold transition ${
              isActive('times')
                ? 'bg-white text-green-600'
                : 'hover:bg-green-500'
            }`}
          >
            <Clock size={20} />
            Lap Times
          </button>
        </div>
      </div>
    </nav>
  )
}
