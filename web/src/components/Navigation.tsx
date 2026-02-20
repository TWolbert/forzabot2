import { Link, useLocation } from 'react-router-dom'
import { Trophy, Gamepad2, Clock } from 'lucide-react'

export function Navigation() {
  const location = useLocation()

  const isActive = (path: string) => {
    if (path === '/') return location.pathname === '/'
    return location.pathname.startsWith(path)
  }

  return (
    <nav className="bg-gradient-to-r from-green-600 to-green-700 text-white shadow-lg">
      <div className="max-w-7xl mx-auto px-4 py-4">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-3xl font-bold">🏁 ForzaBot Dashboard</h1>
        </div>
        <div className="flex gap-2">
          <Link
            to="/"
            className={`flex items-center gap-2 px-4 py-2 rounded-lg font-semibold transition ${
              isActive('/')
                ? 'bg-white text-green-600'
                : 'hover:bg-green-500'
            }`}
          >
            <Trophy size={20} />
            Leaderboard
          </Link>
          <Link
            to="/games"
            className={`flex items-center gap-2 px-4 py-2 rounded-lg font-semibold transition ${
              isActive('/games')
                ? 'bg-white text-green-600'
                : 'hover:bg-green-500'
            }`}
          >
            <Gamepad2 size={20} />
            Games
          </Link>
          <Link
            to="/times"
            className={`flex items-center gap-2 px-4 py-2 rounded-lg font-semibold transition ${
              isActive('/times')
                ? 'bg-white text-green-600'
                : 'hover:bg-green-500'
            }`}
          >
            <Clock size={20} />
            Lap Times
          </Link>
        </div>
      </div>
    </nav>
  )
}
