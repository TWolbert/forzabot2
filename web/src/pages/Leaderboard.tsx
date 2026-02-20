import { useEffect, useState } from 'react'
import { getLeaderboard } from '../api'
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

  useEffect(() => {
    getLeaderboard()
      .then(setData)
      .catch(err => console.error(err))
      .finally(() => setLoading(false))
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
    <div className="bg-white rounded-lg shadow-lg p-8">
      <h2 className="text-3xl font-bold mb-6 text-gray-800">Leaderboard</h2>
      
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b-2 border-gray-300">
              <th className="text-left py-3 px-4 font-bold text-gray-700">#</th>
              <th className="text-left py-3 px-4 font-bold text-gray-700">Player</th>
              <th className="text-center py-3 px-4 font-bold text-gray-700">Wins</th>
            </tr>
          </thead>
          <tbody>
            {data.map((player, index) => (
              <tr key={player.id} className="border-b border-gray-200 hover:bg-gray-50 transition">
                <td className="py-4 px-4">
                  <span className="text-2xl">{medals[index] || `${index + 1}.`}</span>
                </td>
                <td className="py-4 px-4">
                  <span className="font-semibold text-gray-800">
                    {player.display_name || player.username}
                  </span>
                </td>
                <td className="py-4 px-4 text-center">
                  <span className="bg-green-100 text-green-800 px-3 py-1 rounded-full font-bold">
                    {player.wins}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {data.length === 0 && (
        <div className="text-center py-8 text-gray-500">
          No players yet
        </div>
      )}
    </div>
  )
}
