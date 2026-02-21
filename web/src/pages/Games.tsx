import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { getPastGames } from '../api'
import { getCachedCarImage } from '../utils/carImageCache'
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
  restrict_class?: number
  value?: number
  year?: number
  players?: Player[]
}

interface GameDetail extends Game {
  players: Player[]
  class: string
  value: number
  scores?: Array<{ player_id: string; display_name: string; points: number }>
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
    <div className="bg-gradient-to-br from-gray-900 to-gray-800 rounded-xl shadow-2xl p-8 border-4 border-yellow-500">
      <h2 className="text-5xl font-black mb-8 text-yellow-400 drop-shadow-lg flex items-center gap-2" style={{textShadow: '2px 2px 4px rgba(0,0,0,0.8)'}}>
        <Trophy className="text-yellow-400" size={50} />
        PAST GAMES
      </h2>

      <div className="space-y-4">
        {games.map(game => (
          <Link
            key={game.id}
            to={`/games/${game.id}`}
            className="border-4 border-yellow-500 rounded-lg p-4 hover:shadow-xl hover:bg-gray-700 transition cursor-pointer block bg-gray-800 transform hover:scale-105"
          >
            <div className="flex justify-between items-start mb-2">
              <div>
                <p className="font-black text-yellow-300 text-2xl">
                  {formatRaceType(game.race_type)}
                </p>
                <p className="text-sm text-gray-400">
                  {formatDate(game.created_at)}
                </p>
              </div>
              <div className="text-right">
                <p className="text-sm font-black text-green-400">Winner</p>
                <p className="font-black text-white text-lg">{game.winner_name}</p>
              </div>
            </div>
            <div className="text-xs text-gray-400 font-bold">
              {game.num_players} PLAYERS
            </div>
          </Link>
        ))}
      </div>

      {games.length === 0 && (
        <div className="text-center py-8 text-gray-400 text-lg font-bold">
          No games played yet
        </div>
      )}
    </div>
  )
}

export function GameDetail() {
  const { gameId } = useParams<{ gameId: string }>()
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
              const carImage = await getCachedCarImage(player.car_name)
              return { ...player, car_image: carImage }
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
    <div className="bg-gradient-to-br from-gray-900 to-gray-800 rounded-xl p-8 border-4 border-yellow-500 drop-shadow-2xl">
      <div className="bg-gray-800 p-4 rounded-lg border-2 border-green-500 mb-6 flex items-center justify-between">
        <div>
          <p className="text-xs font-black text-green-400 uppercase mb-1">Winner</p>
          <Link
            to={`/players/${selectedGame.winner_id}`}
            className="text-3xl font-black text-green-400 hover:text-green-300 hover:underline transition drop-shadow-lg"
          >
            {selectedGame.winner_name}
          </Link>
        </div>
        <Trophy className="text-green-400 drop-shadow-lg" size={36} />
      </div>
      <Link
        to="/games"
        className="flex items-center gap-2 text-yellow-400 hover:text-yellow-300 mb-6 font-black transition"
      >
        <ChevronLeft size={20} />
        Back to Games
      </Link>

      <div className="mb-6">
        <div className="flex justify-between items-start mb-4">
          <div>
            <h2 className="text-5xl font-black text-yellow-400 drop-shadow-lg">
              {formatRaceType(selectedGame.race_type)}
            </h2>
            <p className="text-gray-400 mt-2 font-bold">
              {formatDate(selectedGame.created_at)}
            </p>
          </div>
          <div className="text-right">
            <p className="text-sm font-black text-green-400 uppercase">Winner</p>
            <Link
              to={`/players/${selectedGame.winner_id}`}
              className="text-3xl font-black text-green-400 hover:text-green-300 hover:underline transition drop-shadow-lg"
            >
              {selectedGame.winner_name}
            </Link>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 mb-6">
          {selectedGame.restrict_class !== 0 && (
            <div className="bg-gray-800 p-4 rounded-lg border-2 border-yellow-500">
              <p className="text-xs font-black text-yellow-400 uppercase">Class</p>
              <p className="text-2xl font-black text-white drop-shadow-lg">{selectedGame.class || 'N/A'}</p>
            </div>
          )}
          <div className="bg-gray-800 p-4 rounded-lg border-2 border-yellow-500">
            <p className="text-xs font-black text-yellow-400 uppercase">Value Range</p>
            <p className="text-2xl font-black text-white drop-shadow-lg">
              {selectedGame.value ? formatCurrency(selectedGame.value) : 'N/A'}
            </p>
          </div>
        </div>
      </div>

      <div>
        <h3 className="text-3xl font-black text-yellow-400 mb-4 uppercase drop-shadow-lg">Players ({selectedGame.players.length})</h3>
        <div className="grid grid-cols-1 gap-3">
          {selectedGame.players.map(player => (
            <div
              key={player.id}
              className="flex items-center gap-4 bg-gray-800 p-4 rounded-lg border-4 border-yellow-500 hover:bg-gray-700 hover:scale-105 transform transition drop-shadow-lg"
            >
              {player.car_image && (
                <img
                  src={player.car_image}
                  alt={player.car_name}
                  className="w-32 aspect-video object-cover rounded border-2 border-yellow-500"
                />
              )}
              <div className="flex-1">
                <div className="flex items-center justify-between">
                  <Link
                    to={`/players/${player.id}`}
                    className="font-black text-yellow-300 hover:text-yellow-200 hover:underline transition text-lg"
                  >
                    {player.display_name}
                  </Link>
                  {selectedGame.winner_id === player.id && (
                    <Trophy className="text-yellow-400 drop-shadow-lg" size={24} />
                  )}
                </div>
                {player.car_name && (
                  <span className="text-sm text-gray-400 font-bold">{player.car_name}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {selectedGame.scores && selectedGame.scores.length > 0 && (
        <div className="mt-8 bg-gray-900/80 border-2 border-yellow-500 rounded-xl p-6">
          <h3 className="text-2xl font-black text-yellow-300 mb-4 uppercase drop-shadow-lg">Final Scores</h3>
          <div className="space-y-2">
            {selectedGame.scores.map((score, index) => (
              <div
                key={score.player_id}
                className="flex items-center justify-between bg-gray-800/80 border border-yellow-500/40 rounded-lg px-4 py-2"
              >
                <div className="flex items-center gap-3">
                  <span className="text-yellow-300 font-black w-6 text-right">{index + 1}.</span>
                  <span className="font-black text-white">{score.display_name}</span>
                </div>
                <span className="text-yellow-300 font-black text-lg">{score.points}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
