import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Loader, ChevronLeft, Users, Trophy } from 'lucide-react'

interface Player {
  id: string
  display_name: string
  car_name?: string
}

interface ActiveRoundData {
  id: string
  class: string
  value: number
  race_type: string
  year?: number
  status: string
  created_at: string
  players: Player[]
}

export function ActiveRound() {
  const [round, setRound] = useState<ActiveRoundData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchActiveRound = async () => {
      setLoading(true)
      try {
        const response = await fetch('/api/current-round')
        if (!response.ok) {
          throw new Error('No active round')
        }
        const data = await response.json()
        setRound(data)
      } catch (error) {
        console.error('Failed to fetch active round:', error)
      } finally {
        setLoading(false)
      }
    }

    fetchActiveRound()
    // Poll every 5 seconds to update if round ends
    const interval = setInterval(fetchActiveRound, 5000)
    return () => clearInterval(interval)
  }, [])

  const formatRaceType = (type: string) => {
    return type.charAt(0).toUpperCase() + type.slice(1)
  }

  const formatCurrency = (value: number) => {
    return `$${(value / 1_000_000).toFixed(1)}M`
  }

  if (loading) {
    return (
      <div className="flex justify-center items-center h-96">
        <Loader className="animate-spin text-orange-400" size={40} />
      </div>
    )
  }

  if (!round) {
    return (
      <div className="bg-gradient-to-br from-gray-900 to-gray-800 rounded-xl p-8 border-4 border-orange-500 drop-shadow-2xl text-center">
        <p className="text-gray-400 text-xl font-black">No Active Round</p>
        <p className="text-gray-500 mt-2">Check back when a game is in progress!</p>
      </div>
    )
  }

  return (
    <div className="bg-gradient-to-br from-gray-900 to-gray-800 rounded-xl p-8 border-4 border-orange-500 drop-shadow-2xl">
      <Link
        to="/"
        className="flex items-center gap-2 text-orange-400 hover:text-orange-300 mb-6 font-black transition"
      >
        <ChevronLeft size={20} />
        Back
      </Link>

      <div className="mb-8">
        <div className="flex items-center gap-3 mb-3">
          <Trophy className="text-orange-400 drop-shadow-lg" size={40} />
          <h1 className="text-5xl font-black text-orange-400 drop-shadow-lg">ACTIVE GAME</h1>
        </div>
        <p className="text-gray-400 font-bold text-sm">Live Round in Progress</p>
      </div>

      {/* Game Details Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <div className="bg-gray-800 p-4 rounded-lg border-2 border-orange-500">
          <p className="text-xs font-black text-orange-400 uppercase mb-1">Race Type</p>
          <p className="text-2xl font-black text-white drop-shadow-lg">
            {formatRaceType(round.race_type)}
          </p>
        </div>
        <div className="bg-gray-800 p-4 rounded-lg border-2 border-orange-500">
          <p className="text-xs font-black text-orange-400 uppercase mb-1">Class</p>
          <p className="text-2xl font-black text-white drop-shadow-lg">{round.class || 'N/A'}</p>
        </div>
        <div className="bg-gray-800 p-4 rounded-lg border-2 border-orange-500">
          <p className="text-xs font-black text-orange-400 uppercase mb-1">Value</p>
          <p className="text-2xl font-black text-white drop-shadow-lg">
            {round.value ? formatCurrency(round.value) : 'N/A'}
          </p>
        </div>
        <div className="bg-gray-800 p-4 rounded-lg border-2 border-orange-500">
          <p className="text-xs font-black text-orange-400 uppercase mb-1">Players</p>
          <p className="text-2xl font-black text-white drop-shadow-lg">{round.players.length}</p>
        </div>
      </div>

      {/* Players Section */}
      <div>
        <h2 className="text-3xl font-black text-orange-400 mb-4 uppercase drop-shadow-lg flex items-center gap-2">
          <Users size={32} className="text-orange-400" />
          Competing
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {round.players.map(player => (
            <div
              key={player.id}
              className="bg-gray-800 p-4 rounded-lg border-4 border-orange-500 hover:bg-gray-700 transform transition drop-shadow-lg"
            >
              <Link
                to={`/players/${player.id}`}
                className="font-black text-orange-300 hover:text-orange-200 text-lg mb-2 block hover:underline transition"
              >
                {player.display_name}
              </Link>
              {player.car_name ? (
                <p className="text-sm text-gray-400 font-bold">🏎️ {player.car_name}</p>
              ) : (
                <p className="text-sm text-gray-500 font-bold italic">Car to be chosen...</p>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Live Indicator */}
      <div className="mt-8 flex items-center gap-2 justify-center">
        <div className="w-3 h-3 bg-red-500 rounded-full animate-pulse drop-shadow-lg"></div>
        <p className="text-gray-400 font-black text-sm">LIVE</p>
      </div>
    </div>
  )
}
