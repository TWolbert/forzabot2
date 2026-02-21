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
  car_name?: string
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
    if (!playerData) return []
    
    const carMap: Record<string, number> = {}
    
    // Add cars from times
    playerData.times?.forEach(time => {
      carMap[time.car_name] = (carMap[time.car_name] || 0) + 1
    })
    
    // Add cars from games
    playerData.games?.forEach(game => {
      if (game.car_name) {
        carMap[game.car_name] = (carMap[game.car_name] || 0) + 1
      }
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
      <div className="bg-gradient-to-br from-gray-900 to-gray-800 rounded-xl p-8 border-4 border-green-500 drop-shadow-2xl">
        <Link
          to="/"
          className="flex items-center gap-2 text-green-400 hover:text-green-300 mb-6 font-black transition"
        >
          <ChevronLeft size={20} />
          Back to Leaderboard
        </Link>
        <p className="text-gray-400 text-lg font-bold">Player not found</p>
      </div>
    )
  }

  const { player, stats, games, times } = playerData

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="bg-gradient-to-br from-gray-900 to-gray-800 rounded-xl p-8 border-4 border-green-500 drop-shadow-2xl">
        <Link
          to="/"
          className="flex items-center gap-2 text-green-400 hover:text-green-300 mb-6 font-black transition"
        >
          <ChevronLeft size={20} />
          Back to Leaderboard
        </Link>

        <div className="mb-6">
          <h1 className="text-5xl font-black text-green-400 mb-2 drop-shadow-lg">
            {player.display_name}
          </h1>
          <p className="text-gray-400 font-bold">@{player.username}</p>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-gray-800 p-4 rounded-lg border-2 border-green-500">
            <p className="text-xs font-black text-green-400 mb-2 uppercase">Games Played</p>
            <p className="text-3xl font-black text-white drop-shadow-lg">{stats.games_played}</p>
          </div>
          <div className="bg-gray-800 p-4 rounded-lg border-2 border-yellow-500">
            <p className="text-xs font-black text-yellow-400 mb-2 flex items-center gap-1 uppercase">
              <Trophy size={16} className="text-yellow-400" /> Wins
            </p>
            <p className="text-3xl font-black text-white drop-shadow-lg">{stats.wins}</p>
          </div>
          <div className="bg-gray-800 p-4 rounded-lg border-2 border-cyan-500">
            <p className="text-xs font-black text-cyan-400 mb-2 uppercase">Times Recorded</p>
            <p className="text-3xl font-black text-white drop-shadow-lg">{stats.times_recorded}</p>
          </div>
          <div className="bg-gray-800 p-4 rounded-lg border-2 border-purple-500">
            <p className="text-xs font-black text-purple-400 mb-2 flex items-center gap-1 uppercase">
              <Clock size={16} className="text-purple-400" /> Fastest Time
            </p>
            <p className="text-3xl font-black text-white drop-shadow-lg">
              {stats.fastest_time ? formatTime(stats.fastest_time) : 'N/A'}
            </p>
          </div>
        </div>
      </div>

      {/* Games */}
      <div className="bg-gradient-to-br from-gray-900 to-gray-800 rounded-xl p-8 border-4 border-yellow-500 drop-shadow-2xl">
        <h2 className="text-3xl font-black text-yellow-400 mb-6 flex items-center gap-2 uppercase drop-shadow-lg">
          <Trophy className="text-yellow-400" size={32} />
          Games Played ({games.length})
        </h2>

        {games.length > 0 ? (
          <div className="space-y-3">
            {games.map(game => (
              <Link
                key={game.id}
                to={`/games/${game.id}`}
                className="border-4 border-yellow-500 rounded-lg p-4 hover:shadow-xl hover:bg-gray-700 transition block bg-gray-800 transform hover:scale-105 drop-shadow-lg"
              >
                <div className="flex justify-between items-start">
                  <div>
                    <p className="font-black text-yellow-300 text-lg">
                      {formatRaceType(game.race_type)}
                    </p>
                    <p className="text-sm text-gray-400 font-bold">
                      {formatDate(game.created_at)}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-black text-green-400 uppercase">
                      {game.winner_id === playerId ? '🏆 Won' : `${game.num_players} players`}
                    </p>
                    {game.winner_id !== playerId && (
                      <p className="text-sm text-gray-400 font-bold">Winner: {game.winner_name}</p>
                    )}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <p className="text-gray-400 font-bold">No games played yet</p>
        )}
      </div>

      {/* Cars Driven */}
      {carStats.length > 0 && (
        <div className="bg-gradient-to-br from-gray-900 to-gray-800 rounded-xl p-8 border-4 border-purple-500 drop-shadow-2xl">
          <h2 className="text-3xl font-black text-purple-400 mb-6 uppercase drop-shadow-lg">
            Cars Driven ({carStats.length})
          </h2>

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4 mb-6">
            {paginatedCars.map(car => (
              <div key={car.name} className="flex flex-col items-center">
                <div className="w-full aspect-video bg-gray-800 rounded-lg overflow-hidden mb-2 flex items-center justify-center border-2 border-purple-500">
                  {carImages[car.name] ? (
                    <img
                      src={carImages[car.name]}
                      alt={car.name}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center bg-gray-700">
                      <span className="text-gray-500 font-bold text-xs text-center px-2">No image</span>
                    </div>
                  )}
                </div>
                <p className="text-sm font-black text-purple-300 text-center line-clamp-2">
                  {car.name}
                </p>
                <p className="text-xs text-gray-400 mt-1 font-bold">
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
                className="p-2 rounded-lg border-2 border-purple-500 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-700 transition text-purple-400 font-black disabled:text-gray-600"
              >
                <ChevronLeft size={20} />
              </button>
              <span className="text-sm text-gray-400 font-bold">
                Page {carsPage + 1} of {totalPages}
              </span>
              <button
                onClick={() => setCarsPage(Math.min(totalPages - 1, carsPage + 1))}
                disabled={carsPage === totalPages - 1}
                className="p-2 rounded-lg border-2 border-purple-500 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-700 transition text-purple-400 font-black disabled:text-gray-600"
              >
                <ChevronRight size={20} />
              </button>
            </div>
          )}
        </div>
      )}

      {/* Times */}
      <div className="bg-gradient-to-br from-gray-900 to-gray-800 rounded-xl p-8 border-4 border-cyan-500 drop-shadow-2xl">
        <h2 className="text-3xl font-black text-cyan-400 mb-6 flex items-center gap-2 uppercase drop-shadow-lg">
          <Clock className="text-cyan-400" size={32} />
          Lap Times ({times.length})
        </h2>

        {times.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b-4 border-cyan-500 bg-gradient-to-r from-cyan-600 to-blue-600">
                  <th className="text-left py-4 px-4 font-black text-white text-lg">CAR</th>
                  <th className="text-left py-4 px-4 font-black text-white text-lg">TRACK</th>
                  <th className="text-center py-4 px-4 font-black text-white text-lg">TIME</th>
                  <th className="text-center py-4 px-4 font-black text-white text-lg">DATE</th>
                </tr>
              </thead>
              <tbody>
                {times.map(time => (
                  <tr
                    key={time.id}
                    onClick={() => (window.location.href = `/times/${time.id}`)}
                    className="border-b-2 border-gray-700 hover:bg-gray-700 transition cursor-pointer transform hover:scale-105"
                  >
                    <td className="py-4 px-4 text-white font-bold">{time.car_name}</td>
                    <td className="py-4 px-4 text-white font-bold">{time.race_name}</td>
                    <td className="py-4 px-4 text-center font-black text-cyan-300 text-lg">
                      {formatTime(time.time_ms)}
                    </td>
                    <td className="py-4 px-4 text-center text-gray-400 font-bold">
                      {formatDate(time.created_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-gray-400 font-bold">No lap times recorded yet</p>
        )}
      </div>
    </div>
  )
}
