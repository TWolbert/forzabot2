import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { Loader, ChevronLeft, Trophy, Clock, ChevronRight } from 'lucide-react'

interface Player {
  id: string
  username: string
  display_name: string
}

interface Stats {
  games_played: number
  wins: number
  times_recorded: number
  fastest_time?: number
}

interface Game {
  id: string
  race_type: string
  winner_id: string
  winner_name: string
  num_players: number
  created_at: string
}

interface Time {
  id: string
  car_name: string
  race_name: string
  time_ms: number
  created_at: string
}

interface PlayerData {
  player: Player
  stats: Stats
  games: Game[]
  times: Time[]
}

export function PlayerDetail() {
  const { playerId } = useParams<{ playerId: string }>()
  const [playerData, setPlayerData] = useState<PlayerData | null>(null)
  const [loading, setLoading] = useState(true)
  const [carsPage, setCarsPage] = useState(0)
  const [carImages, setCarImages] = useState<Record<string, string | null>>({})

  const formatTime = (ms: number) => {
    const totalSeconds = Math.floor(ms / 1000)
    const minutes = Math.floor(totalSeconds / 60)
    const seconds = totalSeconds % 60
    const milliseconds = ms % 1000
    return `${minutes}:${seconds.toString().padStart(2, '0')}.${milliseconds.toString().padStart(3, '0')}`
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

  // Get distinct cars and their counts
  const getCarStats = () => {
    if (!playerData?.times) return []
    
    const carMap: Record<string, number> = {}
    playerData.times.forEach(time => {
      carMap[time.car_name] = (carMap[time.car_name] || 0) + 1
    })
    
    return Object.entries(carMap)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
  }

  const carStats = getCarStats()
  const CARS_PER_PAGE = 10
  const paginatedCars = carStats.slice(carsPage * CARS_PER_PAGE, (carsPage + 1) * CARS_PER_PAGE)
  const totalPages = Math.ceil(carStats.length / CARS_PER_PAGE)

  useEffect(() => {
    if (!playerId) return

    const fetchPlayerData = async () => {
      try {
        const response = await fetch(`/api/player/${playerId}`)
        if (!response.ok) throw new Error('Player not found')
        const data = await response.json()
        setPlayerData(data)
      } catch (error) {
        console.error('Failed to fetch player data:', error)
      } finally {
        setLoading(false)
      }
    }

    fetchPlayerData()
  }, [playerId])

  // Fetch car images
  useEffect(() => {
    const fetchCarImages = async () => {
      const images: Record<string, string | null> = {}
      
      for (const car of paginatedCars) {
        if (!carImages[car.name]) {
          try {
            const response = await fetch(`/api/car-image/${encodeURIComponent(car.name)}`)
            const data = await response.json()
            images[car.name] = data.imageUrl
          } catch (error) {
            console.error(`Failed to fetch image for ${car.name}:`, error)
            images[car.name] = null
          }
        }
      }
      
      setCarImages(prev => ({ ...prev, ...images }))
    }

    if (paginatedCars.length > 0) {
      fetchCarImages()
    }
  }, [carsPage, paginatedCars])

  if (loading) {
    return (
      <div className="flex justify-center items-center h-96">
        <Loader className="animate-spin" size={40} />
      </div>
    )
  }

  if (!playerData) {
    return (
      <div className="bg-white rounded-lg shadow-lg p-8">
        <Link
          to="/"
          className="flex items-center gap-2 text-green-600 hover:text-green-700 mb-6 font-semibold"
        >
          <ChevronLeft size={20} />
          Back to Leaderboard
        </Link>
        <p className="text-gray-500">Player not found</p>
      </div>
    )
  }

  const { player, stats, games, times } = playerData

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="bg-white rounded-lg shadow-lg p-8">
        <Link
          to="/"
          className="flex items-center gap-2 text-green-600 hover:text-green-700 mb-6 font-semibold"
        >
          <ChevronLeft size={20} />
          Back to Leaderboard
        </Link>

        <div className="mb-6">
          <h1 className="text-4xl font-bold text-gray-800 mb-2">
            {player.display_name}
          </h1>
          <p className="text-gray-500">@{player.username}</p>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-green-50 p-4 rounded-lg">
            <p className="text-sm text-gray-600 mb-1">Games Played</p>
            <p className="text-3xl font-bold text-green-600">{stats.games_played}</p>
          </div>
          <div className="bg-yellow-50 p-4 rounded-lg">
            <p className="text-sm text-gray-600 mb-1 flex items-center gap-1">
              <Trophy size={16} className="text-yellow-500" /> Wins
            </p>
            <p className="text-3xl font-bold text-yellow-600">{stats.wins}</p>
          </div>
          <div className="bg-blue-50 p-4 rounded-lg">
            <p className="text-sm text-gray-600 mb-1">Times Recorded</p>
            <p className="text-3xl font-bold text-blue-600">{stats.times_recorded}</p>
          </div>
          <div className="bg-purple-50 p-4 rounded-lg">
            <p className="text-sm text-gray-600 mb-1 flex items-center gap-1">
              <Clock size={16} className="text-purple-500" /> Fastest Time
            </p>
            <p className="text-3xl font-bold text-purple-600">
              {stats.fastest_time ? formatTime(stats.fastest_time) : 'N/A'}
            </p>
          </div>
        </div>
      </div>

      {/* Games */}
      <div className="bg-white rounded-lg shadow-lg p-8">
        <h2 className="text-2xl font-bold text-gray-800 mb-6 flex items-center gap-2">
          <Trophy className="text-yellow-500" size={28} />
          Games Played ({games.length})
        </h2>

        {games.length > 0 ? (
          <div className="space-y-3">
            {games.map(game => (
              <Link
                key={game.id}
                to={`/games/${game.id}`}
                className="border border-gray-200 rounded-lg p-4 hover:shadow-md hover:bg-gray-50 transition block"
              >
                <div className="flex justify-between items-start">
                  <div>
                    <p className="font-semibold text-gray-800">
                      {formatRaceType(game.race_type)}
                    </p>
                    <p className="text-sm text-gray-500">
                      {formatDate(game.created_at)}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold text-green-600">
                      {game.winner_id === playerId ? '🏆 Won' : `${game.num_players} players`}
                    </p>
                    {game.winner_id !== playerId && (
                      <p className="text-sm text-gray-600">Winner: {game.winner_name}</p>
                    )}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <p className="text-gray-500">No games played yet</p>
        )}
      </div>

      {/* Cars Driven */}
      {carStats.length > 0 && (
        <div className="bg-white rounded-lg shadow-lg p-8">
          <h2 className="text-2xl font-bold text-gray-800 mb-6">
            Cars Driven ({carStats.length})
          </h2>

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4 mb-6">
            {paginatedCars.map(car => (
              <div key={car.name} className="flex flex-col items-center">
                <div className="w-full aspect-square bg-gray-100 rounded-lg overflow-hidden mb-2 flex items-center justify-center">
                  {carImages[car.name] ? (
                    <img
                      src={carImages[car.name]}
                      alt={car.name}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center bg-gray-200">
                      <span className="text-gray-400 text-xs text-center px-2">No image</span>
                    </div>
                  )}
                </div>
                <p className="text-sm font-medium text-gray-800 text-center line-clamp-2">
                  {car.name}
                </p>
                <p className="text-xs text-gray-500 mt-1">
                  {car.count} time{car.count !== 1 ? 's' : ''}
                </p>
              </div>
            ))}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-4">
              <button
                onClick={() => setCarsPage(Math.max(0, carsPage - 1))}
                disabled={carsPage === 0}
                className="p-2 rounded-lg border border-gray-300 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50 transition"
              >
                <ChevronLeft size={20} />
              </button>
              <span className="text-sm text-gray-600">
                Page {carsPage + 1} of {totalPages}
              </span>
              <button
                onClick={() => setCarsPage(Math.min(totalPages - 1, carsPage + 1))}
                disabled={carsPage === totalPages - 1}
                className="p-2 rounded-lg border border-gray-300 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50 transition"
              >
                <ChevronRight size={20} />
              </button>
            </div>
          )}
        </div>
      )}

      {/* Times */}
      <div className="bg-white rounded-lg shadow-lg p-8">
        <h2 className="text-2xl font-bold text-gray-800 mb-6 flex items-center gap-2">
          <Clock className="text-blue-500" size={28} />
          Lap Times ({times.length})
        </h2>

        {times.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b-2 border-gray-300">
                  <th className="text-left py-3 px-4 font-bold text-gray-700">Car</th>
                  <th className="text-left py-3 px-4 font-bold text-gray-700">Track</th>
                  <th className="text-center py-3 px-4 font-bold text-gray-700">Time</th>
                  <th className="text-center py-3 px-4 font-bold text-gray-700">Date</th>
                </tr>
              </thead>
              <tbody>
                {times.map(time => (
                  <tr
                    key={time.id}
                    onClick={() => (window.location.href = `/times/${time.id}`)}
                    className="border-b border-gray-200 hover:bg-blue-50 transition cursor-pointer"
                  >
                    <td className="py-3 px-4 text-gray-700">{time.car_name}</td>
                    <td className="py-3 px-4 text-gray-700">{time.race_name}</td>
                    <td className="py-3 px-4 text-center font-bold text-blue-600">
                      {formatTime(time.time_ms)}
                    </td>
                    <td className="py-3 px-4 text-center text-gray-500">
                      {formatDate(time.created_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-gray-500">No lap times recorded yet</p>
        )}
      </div>
    </div>
  )
}
