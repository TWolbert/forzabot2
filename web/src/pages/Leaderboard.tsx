import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { getLeaderboard } from '../api'
import { getCachedCarImage } from '../utils/carImageCache'
import { Loader } from 'lucide-react'

interface LeaderboardEntry {
  id: string
  username: string
  display_name: string
  wins: number
}

export function Leaderboard() {
  const [data, setData] = useState<LeaderboardEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [carImage, setCarImage] = useState<string | null>(null)

  useEffect(() => {
    getLeaderboard()
      .then(setData)
      .catch(err => console.error(err))
      .finally(() => setLoading(false))
    
    getCachedCarImage('McLaren Sabre')
      .then(setCarImage)
      .catch(err => console.error('Failed to fetch car image:', err))
  }, [])

  if (loading) {
    return (
      <div className="flex justify-center items-center h-96">
        <Loader className="animate-spin" size={40} />
      </div>
    )
  }

  const medals = ['🥇', '🥈', '🥉']

  return (
    <div 
      className="bg-gradient-to-br from-gray-900 to-gray-800 rounded-xl shadow-2xl p-8 border-2 border-green-500 relative overflow-hidden"
      style={{
        backgroundImage: carImage ? `url(${carImage})` : undefined,
        backgroundSize: 'cover',
        backgroundPosition: 'right center',
        backgroundAttachment: 'fixed'
      }}
    >
      {/* Gradient overlay */}
      {carImage && (
        <div className="absolute inset-0 bg-gradient-to-r from-gray-900 via-gray-800/80 to-gray-900/50 pointer-events-none" />
      )}
      
      {/* Content */}
      <div className="relative z-10">
        <h2 className="text-5xl font-black mb-8 text-green-400 drop-shadow-lg" style={{textShadow: '2px 2px 4px rgba(0,0,0,0.8)'}}>🏆 LEADERBOARD 🏆</h2>
        
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b-4 border-green-500 bg-gradient-to-r from-green-600 to-emerald-600">
                <th className="text-left py-4 px-4 font-black text-white text-2xl">#</th>
                <th className="text-left py-4 px-4 font-black text-white text-2xl">PLAYER</th>
                <th className="text-center py-4 px-4 font-black text-white text-2xl">WINS</th>
              </tr>
            </thead>
            <tbody>
              {data.map((player, index) => (
                <tr key={player.id} className="border-b-2 border-gray-700 hover:bg-gray-700 transition">
                  <td className="py-4 px-4">
                    <span className="text-4xl font-black">{medals[index] || `${index + 1}.`}</span>
                  </td>
                  <td className="py-4 px-4">
                    <Link
                      to={`/players/${player.id}`}
                      className="font-bold text-white text-xl hover:text-green-400 transition"
                    >
                      {player.display_name || player.username}
                    </Link>
                  </td>
                  <td className="py-4 px-4 text-center">
                    <span className="bg-gradient-to-r from-green-400 to-emerald-400 text-gray-900 px-4 py-2 rounded-full font-black text-lg">
                      {player.wins}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {data.length === 0 && (
          <div className="text-center py-8 text-gray-400 text-xl">
            No players yet
          </div>
        )}
      </div>
    </div>
  )
}
