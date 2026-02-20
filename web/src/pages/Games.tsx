import { useEffect, useState } from 'react'
import { getPastGames } from '../api'
import { Loader, Trophy } from 'lucide-react'

interface Game {
  id: string
  race_type: string
  winner_id: string
  winner_name: string
  num_players: number
  created_at: string
}

export function Games() {
  const [games, setGames] = useState<Game[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getPastGames()
      .then(setGames)
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

  const formatDate = (dateStr: string) => {
    try {
      return new Date(dateStr).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      })
    } catch {
      return dateStr
    }
  }

  const formatRaceType = (type: string) => {
    return type.charAt(0).toUpperCase() + type.slice(1)
  }

  return (
    <div className="bg-white rounded-lg shadow-lg p-8">
      <h2 className="text-3xl font-bold mb-6 text-gray-800 flex items-center gap-2">
        <Trophy className="text-yellow-500" size={32} />
        Past Games
      </h2>

      <div className="space-y-3">
        {games.map(game => (
          <div
            key={game.id}
            className="border border-gray-200 rounded-lg p-4 hover:shadow-md transition"
          >
            <div className="flex justify-between items-start mb-2">
              <div>
                <p className="font-semibold text-gray-800 text-lg">
                  {formatRaceType(game.race_type)}
                </p>
                <p className="text-sm text-gray-500">
                  {formatDate(game.created_at)}
                </p>
              </div>
              <div className="text-right">
                <p className="text-sm font-bold text-green-600">Winner</p>
                <p className="font-semibold text-gray-800">{game.winner_name}</p>
              </div>
            </div>
            <div className="text-xs text-gray-500">
              {game.num_players} players
            </div>
          </div>
        ))}
      </div>

      {games.length === 0 && (
        <div className="text-center py-8 text-gray-500">
          No games played yet
        </div>
      )}
    </div>
  )
}
