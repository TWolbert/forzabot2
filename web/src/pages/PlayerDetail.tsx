import { useEffect, useMemo, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { Loader, ChevronLeft, Trophy, Clock, ChevronRight, ChevronDown } from 'lucide-react'
import { getCachedCarImage } from '../utils/carImageCache'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Tooltip,
  Legend
} from 'chart.js'
import { Bar, Line } from 'react-chartjs-2'

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, Tooltip, Legend)

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
  const [gamesPage, setGamesPage] = useState(0)
  const [gamesExpanded, setGamesExpanded] = useState(true)
  const [selectedMap, setSelectedMap] = useState('')
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

  // Games pagination
  const GAMES_PER_PAGE = 10
  const paginatedGames = playerData?.games?.slice(gamesPage * GAMES_PER_PAGE, (gamesPage + 1) * GAMES_PER_PAGE) ?? []
  const gamesTotalPages = playerData?.games ? Math.ceil(playerData.games.length / GAMES_PER_PAGE) : 1

  const mapOptions = useMemo(() => {
    if (!playerData) return []
    return Array.from(new Set(playerData.times.map(time => time.race_name))).sort()
  }, [playerData])

  useEffect(() => {
    if (!selectedMap && mapOptions.length > 0) {
      setSelectedMap(mapOptions[0])
    }
  }, [mapOptions, selectedMap])

  const timesPerDay = useMemo(() => {
    if (!playerData) return { labels: [], values: [] as number[] }

    const counts = new Map<string, number>()
    for (const time of playerData.times) {
      const dayKey = new Date(time.created_at).toISOString().slice(0, 10)
      counts.set(dayKey, (counts.get(dayKey) ?? 0) + 1)
    }

    const sortedKeys = Array.from(counts.keys()).sort()
    const labels = sortedKeys.map(key => new Date(key).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }))
    const values = sortedKeys.map(key => counts.get(key) ?? 0)

    return { labels, values }
  }, [playerData])

  const mapProgression = useMemo(() => {
    if (!playerData || !selectedMap) return { labels: [], values: [] as number[] }

    const filtered = playerData.times
      .filter(time => time.race_name === selectedMap)
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())

    return {
      labels: filtered.map(time => formatDate(time.created_at)),
      values: filtered.map(time => time.time_ms)
    }
  }, [playerData, selectedMap])

  const timesPerDayData = {
    labels: timesPerDay.labels,
    datasets: [
      {
        label: 'Times per day',
        data: timesPerDay.values,
        backgroundColor: 'rgba(34, 211, 238, 0.35)',
        borderColor: 'rgba(34, 211, 238, 0.9)',
        borderWidth: 2
      }
    ]
  }

  const mapProgressionData = {
    labels: mapProgression.labels,
    datasets: [
      {
        label: selectedMap || 'Lap time progression',
        data: mapProgression.values,
        borderColor: 'rgba(59, 130, 246, 0.9)',
        backgroundColor: 'rgba(59, 130, 246, 0.25)',
        tension: 0.3,
        pointRadius: 3
      }
    ]
  }

  const countChartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    plugins: {
      legend: { display: false }
    },
    scales: {
      x: {
        ticks: { color: '#9CA3AF', font: { weight: '700' } },
        grid: { color: 'rgba(255,255,255,0.05)' }
      },
      y: {
        ticks: { color: '#9CA3AF', precision: 0 },
        grid: { color: 'rgba(255,255,255,0.05)' }
      }
    }
  }

  const progressChartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          label: (context: any) => `Lap Time: ${formatTime(Number(context.raw))}`
        }
      }
    },
    scales: {
      x: {
        ticks: { color: '#9CA3AF', font: { weight: '700' } },
        grid: { color: 'rgba(255,255,255,0.05)' }
      },
      y: {
        ticks: {
          color: '#9CA3AF',
          callback: (value: string | number) => formatTime(Number(value))
        },
        grid: { color: 'rgba(255,255,255,0.05)' }
      }
    }
  }

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
            const imageUrl = await getCachedCarImage(car.name)
            images[car.name] = imageUrl
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
  }, [carsPage, paginatedCars, carImages])

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

      {times.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-gradient-to-br from-gray-900 to-gray-800 rounded-xl p-6 border-4 border-cyan-500 drop-shadow-2xl">
            <h2 className="text-2xl font-black text-cyan-400 mb-4 uppercase drop-shadow-lg">Times Per Day</h2>
            {timesPerDay.labels.length > 0 ? (
              <div className="h-64">
                <Bar data={timesPerDayData} options={countChartOptions} />
              </div>
            ) : (
              <p className="text-gray-400 font-bold">No time trials recorded yet</p>
            )}
          </div>

          <div className="bg-gradient-to-br from-gray-900 to-gray-800 rounded-xl p-6 border-4 border-blue-500 drop-shadow-2xl">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <h2 className="text-2xl font-black text-blue-400 uppercase drop-shadow-lg">Map Progression</h2>
              <select
                value={selectedMap}
                onChange={event => setSelectedMap(event.target.value)}
                className="bg-gray-900 border-2 border-blue-500 text-blue-200 text-sm font-black rounded-lg px-3 py-2 focus:outline-none focus:border-blue-300"
              >
                {mapOptions.map(map => (
                  <option key={map} value={map}>
                    {map}
                  </option>
                ))}
              </select>
            </div>
            {selectedMap ? (
              <div className="h-64">
                <Line data={mapProgressionData} options={progressChartOptions} />
              </div>
            ) : (
              <p className="text-gray-400 font-bold">No maps available</p>
            )}
          </div>
        </div>
      )}

      {/* Games */}
      <div className="bg-gradient-to-br from-gray-900 to-gray-800 rounded-xl p-8 border-4 border-yellow-500 drop-shadow-2xl">
        <button
          onClick={() => setGamesExpanded(!gamesExpanded)}
          className="w-full flex items-center gap-2 hover:opacity-80 transition"
        >
          <h2 className="text-3xl font-black text-yellow-400 flex items-center gap-2 uppercase drop-shadow-lg flex-1">
            <Trophy className="text-yellow-400" size={32} />
            Games Played ({games.length})
          </h2>
          <ChevronDown 
            size={32} 
            className={`text-yellow-400 transition-transform ${gamesExpanded ? 'rotate-180' : ''}`}
          />
        </button>

        {gamesExpanded && (
          <>
            {games.length > 0 ? (
              <div className="space-y-3 mt-6">
                {paginatedGames.map(game => (
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
              <p className="text-gray-400 font-bold mt-6">No games played yet</p>
            )}

            {/* Pagination */}
            {gamesTotalPages > 1 && (
              <div className="flex items-center justify-center gap-4 mt-6">
                <button
                  onClick={() => setGamesPage(Math.max(0, gamesPage - 1))}
                  disabled={gamesPage === 0}
                  className="p-2 rounded-lg border-2 border-yellow-500 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-700 transition text-yellow-400 font-black disabled:text-gray-600"
                >
                  <ChevronLeft size={20} />
                </button>
                <span className="text-sm text-gray-400 font-bold">
                  Page {gamesPage + 1} of {gamesTotalPages}
                </span>
                <button
                  onClick={() => setGamesPage(Math.min(gamesTotalPages - 1, gamesPage + 1))}
                  disabled={gamesPage === gamesTotalPages - 1}
                  className="p-2 rounded-lg border-2 border-yellow-500 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-700 transition text-yellow-400 font-black disabled:text-gray-600"
                >
                  <ChevronRight size={20} />
                </button>
              </div>
            )}
          </>
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
