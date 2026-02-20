import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { getPastGames } from '../api'
import { Loader, Trophy, ChevronLeft } from 'lucide-react'

interface Player {
  id: string
  display_name: string
  car_name?: string
  car_image?: string
}

interface Game {
  id: string
  race_type: string
  winner_id: string
  winner_name: string
  num_players: number
  created_at: string
  class?: string
  value?: number
  year?: number
  players?: Player[]
}

interface GameDetail extends Game {
  players: Player[]
  class: string
  value: number
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

  if (loading) {
    return (
      <div className="flex justify-center items-center h-96">
        <Loader className="animate-spin" size={40} />
      </div>
    )
  }

  return (
    <div className="bg-white rounded-lg shadow-lg p-8">
      <h2 className="text-3xl font-bold mb-6 text-gray-800 flex items-center gap-2">
        <Trophy className="text-yellow-500" size={32} />
        Past Games
      </h2>

      <div className="space-y-3">
        {games.map(game => (
          <Link
            key={game.id}
            to={`/games/${game.id}`}
            className="border border-gray-200 rounded-lg p-4 hover:shadow-md hover:bg-gray-50 transition cursor-pointer block"
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
          </Link>
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

export function GameDetail() {
  const { gameId } = useParams<{ gameId: string }>()
  const navigate = useNavigate()
  const [selectedGame, setSelectedGame] = useState<GameDetail | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!gameId) return

    const fetchGameDetails = async () => {
      setLoading(true)
      try {
        const response = await fetch(`/api/games/${gameId}`)
        const data = await response.json()
        
        // Fetch car images for each player
        const playersWithImages = await Promise.all(
          data.players.map(async (player: Player) => {
            if (!player.car_name) return player
            try {
              const imgResponse = await fetch(`/api/car-image/${encodeURIComponent(player.car_name)}`)
              const imgData = await imgResponse.json()
              return { ...player, car_image: imgData.imageUrl }
            } catch (error) {
              console.error(`Failed to fetch image for ${player.car_name}:`, error)
              return player
            }
          })
        )
        
        setSelectedGame({ ...data, players: playersWithImages })
      } catch (error) {
        console.error('Failed to fetch game details:', error)
      } finally {
        setLoading(false)
      }
    }

    fetchGameDetails()
  }, [gameId])

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

  const formatCurrency = (value: number) => {
    return `$${(value / 1000).toFixed(0)}k`
  }

  if (loading) {
    return (
      <div className="flex justify-center items-center h-96">
        <Loader className="animate-spin" size={40} />
      </div>
    )
  }

  if (!selectedGame) {
    return (
      <div className="bg-white rounded-lg shadow-lg p-8">
        <p>Game not found</p>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-lg shadow-lg p-8">
      <Link
        to="/games"
        className="flex items-center gap-2 text-green-600 hover:text-green-700 mb-6 font-semibold"
      >
        <ChevronLeft size={20} />
        Back to Games
      </Link>

      <div className="mb-6">
        <div className="flex justify-between items-start mb-4">
          <div>
            <h2 className="text-3xl font-bold text-gray-800">
              {formatRaceType(selectedGame.race_type)}
            </h2>
            <p className="text-gray-500 mt-2">
              {formatDate(selectedGame.created_at)}
            </p>
          </div>
          <div className="text-right">
            <p className="text-sm font-bold text-green-600">Winner</p>
            <Link
              to={`/players/${selectedGame.winner_id}`}
              className="text-2xl font-bold text-green-600 hover:text-green-700 hover:underline"
            >
              {selectedGame.winner_name}
            </Link>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 mb-6">
          <div className="bg-gray-50 p-4 rounded-lg">
            <p className="text-sm text-gray-600">Class</p>
            <p className="text-xl font-bold text-gray-800">{selectedGame.class || 'N/A'}</p>
          </div>
          <div className="bg-gray-50 p-4 rounded-lg">
            <p className="text-sm text-gray-600">Value Range</p>
            <p className="text-xl font-bold text-gray-800">
              {selectedGame.value ? formatCurrency(selectedGame.value) : 'N/A'}
            </p>
          </div>
        </div>
      </div>

      <div>
        <h3 className="text-xl font-bold text-gray-800 mb-4">Players ({selectedGame.players.length})</h3>
        <div className="grid grid-cols-1 gap-3">
          {selectedGame.players.map(player => (
            <div
              key={player.id}
              className="flex items-center gap-4 bg-gray-50 p-3 rounded-lg"
            >
              {player.car_image && (
                <img
                  src={player.car_image}
                  alt={player.car_name}
                  className="w-20 h-20 object-cover rounded"
                />
              )}
              <div className="flex-1">
                <div className="flex items-center justify-between">
                  <Link
                    to={`/players/${player.id}`}
                    className="font-medium text-green-600 hover:text-green-700 hover:underline"
                  >
                    {player.display_name}
                  </Link>
                  {selectedGame.winner_id === player.id && (
                    <Trophy className="text-yellow-500" size={18} />
                  )}
                </div>
                {player.car_name && (
                  <span className="text-sm text-gray-600">{player.car_name}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
