import { Link } from 'react-router-dom'
import { Trophy, Gamepad2, Clock } from 'lucide-react'

export function Home() {
  return (
    <div className="min-h-screen bg-black">
      {/* Hero Section */}
      <div className="relative h-96 bg-gradient-to-r from-red-600 via-orange-500 to-yellow-500 overflow-hidden mb-12">
        <div className="absolute inset-0 opacity-20">
          <div className="absolute inset-0 bg-black transform -skew-y-3" style={{backgroundImage: 'radial-gradient(circle at 20% 50%, rgba(255,100,0,0.5) 0%, transparent 50%)'}}></div>
        </div>
        <div className="relative h-full flex items-center justify-center">
          <div className="text-center text-white">
            <h1 className="text-7xl font-black mb-4 drop-shadow-lg">🏁 FORZABOT</h1>
            <p className="text-2xl font-bold drop-shadow-lg">Racing Statistics Dashboard</p>
          </div>
        </div>
      </div>

      {/* Main Grid */}
      <div className="max-w-7xl mx-auto px-4 pb-16">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 auto-rows-max">
          {/* Large Leaderboard Tile */}
          <Link
            to="/games"
            className="md:col-span-2 md:row-span-2 group relative overflow-hidden rounded-xl shadow-2xl h-96 cursor-pointer transform transition hover:scale-105"
          >
            <div className="absolute inset-0 bg-gradient-to-br from-yellow-400 via-yellow-500 to-orange-600"></div>
            <div className="absolute inset-0 opacity-30 group-hover:opacity-50 transition" style={{backgroundImage: 'repeating-linear-gradient(45deg, transparent, transparent 10px, rgba(0,0,0,0.1) 10px, rgba(0,0,0,0.1) 20px)'}}></div>
            <div className="relative h-full flex flex-col items-center justify-center text-white p-8">
              <Trophy size={80} className="mb-4 drop-shadow-lg" />
              <h2 className="text-5xl font-black text-center drop-shadow-lg">PAST GAMES</h2>
            </div>
          </Link>

          {/* Small Leaderboard Tile */}
          <Link
            to="/"
            className="group relative overflow-hidden rounded-xl shadow-2xl h-48 cursor-pointer transform transition hover:scale-105"
          >
            <div className="absolute inset-0 bg-gradient-to-br from-green-500 to-emerald-700"></div>
            <div className="absolute inset-0 opacity-30 group-hover:opacity-50 transition" style={{backgroundImage: 'repeating-linear-gradient(45deg, transparent, transparent 10px, rgba(0,0,0,0.1) 10px, rgba(0,0,0,0.1) 20px)'}}></div>
            <div className="relative h-full flex flex-col items-center justify-center text-white p-6">
              <Trophy size={40} className="mb-2 drop-shadow-lg" />
              <h3 className="text-2xl font-black text-center drop-shadow-lg">LEADERBOARD</h3>
            </div>
          </Link>

          {/* Small Lap Times Tile 1 */}
          <Link
            to="/times"
            className="group relative overflow-hidden rounded-xl shadow-2xl h-48 cursor-pointer transform transition hover:scale-105"
          >
            <div className="absolute inset-0 bg-gradient-to-br from-blue-500 to-cyan-700"></div>
            <div className="absolute inset-0 opacity-30 group-hover:opacity-50 transition" style={{backgroundImage: 'repeating-linear-gradient(45deg, transparent, transparent 10px, rgba(0,0,0,0.1) 10px, rgba(0,0,0,0.1) 20px)'}}></div>
            <div className="relative h-full flex flex-col items-center justify-center text-white p-6">
              <Clock size={40} className="mb-2 drop-shadow-lg" />
              <h3 className="text-2xl font-black text-center drop-shadow-lg">LAP TIMES</h3>
            </div>
          </Link>

          {/* Small Games Tile 2 */}
          <Link
            to="/games"
            className="group relative overflow-hidden rounded-xl shadow-2xl h-48 cursor-pointer transform transition hover:scale-105"
          >
            <div className="absolute inset-0 bg-gradient-to-br from-purple-500 to-pink-700"></div>
            <div className="absolute inset-0 opacity-30 group-hover:opacity-50 transition" style={{backgroundImage: 'repeating-linear-gradient(45deg, transparent, transparent 10px, rgba(0,0,0,0.1) 10px, rgba(0,0,0,0.1) 20px)'}}></div>
            <div className="relative h-full flex flex-col items-center justify-center text-white p-6">
              <Gamepad2 size={40} className="mb-2 drop-shadow-lg" />
              <h3 className="text-2xl font-black text-center drop-shadow-lg">RACES</h3>
            </div>
          </Link>
        </div>
      </div>
    </div>
  )
}
