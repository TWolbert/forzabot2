import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Loader, ChevronLeft, Users, Trophy, Check } from 'lucide-react'
import { getCachedCarImage } from '../utils/carImageCache'

interface Player {
  id: string
  display_name: string
  car_name?: string
  car_image?: string
  avatar_url?: string
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
  const navigate = useNavigate()
  const [round, setRound] = useState<ActiveRoundData | null>(null)
  const [loading, setLoading] = useState(true)
  const [playerCarImages, setPlayerCarImages] = useState<Record<string, string | null>>({})
  const [playerImageIndex, setPlayerImageIndex] = useState<Record<string, number>>({})
  const [confirmedImages, setConfirmedImages] = useState<Record<string, boolean>>({})
  const lastRoundIdRef = useRef<string | null>(null)
  const redirectedRef = useRef(false)

  useEffect(() => {
    let mounted = true
    
    const fetchActiveRound = async () => {
      try {
        const response = await fetch('/api/current-round')
        if (!mounted) return
        
        if (!response.ok) {
          if (lastRoundIdRef.current && !redirectedRef.current) {
            redirectedRef.current = true
            navigate(`/games/${lastRoundIdRef.current}`)
            return
          }
          throw new Error('No active round')
        }

        const data = await response.json()
        lastRoundIdRef.current = data.id
        
        // Only update state if data has changed
        setRound(prevRound => {
          if (!prevRound || JSON.stringify(prevRound) !== JSON.stringify(data)) {
            return data
          }
          return prevRound
        })
        
        setLoading(false)
      } catch (error) {
        if (mounted) {
          console.error('Failed to fetch active round:', error)
          setLoading(false)
        }
      }
    }

    fetchActiveRound()
    // Poll every 5 seconds to update if round ends
    const interval = setInterval(fetchActiveRound, 5000)
    
    return () => {
      mounted = false
      clearInterval(interval)
    }
  }, [])

  useEffect(() => {
    if (!round) return

    const fetchCarImages = async () => {
      const images: Record<string, string | null> = {}
      
      for (const player of round.players) {
        if (!player.car_name) continue
        try {
          const index = playerImageIndex[player.id] ?? 0
          const imageUrl = await getCachedCarImage(player.car_name, index, { forceRefresh: index !== 0 })
          images[player.id] = imageUrl
        } catch (error) {
          console.error(`Failed to fetch image for ${player.car_name}:`, error)
          images[player.id] = null
        }
      }
      
      setPlayerCarImages(prev => ({ ...prev, ...images }))
    }

    fetchCarImages()
  }, [round, playerImageIndex])

  const handleRetryImage = (playerId: string) => {
    setPlayerImageIndex(prev => ({
      ...prev,
      [playerId]: Math.floor(Math.random() * 10)
    }))
    setConfirmedImages(prev => ({
      ...prev,
      [playerId]: false
    }))
  }

  const handleConfirmImage = (playerId: string) => {
    setConfirmedImages(prev => ({
      ...prev,
      [playerId]: true
    }))
  }

  const formatRaceType = (type: string) => {
    return type.charAt(0).toUpperCase() + type.slice(1)
  }

  const formatCurrency = (value: number) => {
    return `$${value.toLocaleString()}`
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

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {round.players.map(player => {
            const carImage = playerCarImages[player.id]
            const isConfirmed = confirmedImages[player.id]
            
            return (
              <div
                key={player.id}
                className="bg-gray-800 p-4 rounded-lg border-4 border-orange-500 hover:bg-gray-700 transform transition hover:scale-105 drop-shadow-lg"
              >
                {/* Car Image */}
                {player.car_name && (
                  <div className="mb-3 -mx-4 -mt-4 group relative">
                    <div className="w-full h-32 overflow-hidden rounded-t-lg border-b-2 border-orange-500 bg-gradient-to-br from-gray-700 to-gray-800">
                      {carImage && (
                        <img
                          src={carImage}
                          alt={player.car_name}
                          className="w-full h-32 object-cover"
                        />
                      )}
                    </div>
                    <div className="absolute bottom-2 right-2 flex items-center gap-2 opacity-0 group-hover:opacity-100 transition">
                      <button
                        type="button"
                        onClick={() => handleRetryImage(player.id)}
                        className="bg-orange-500/90 hover:bg-orange-400 text-white text-xs font-black px-3 py-1 rounded-full shadow-lg"
                      >
                        Retry search
                      </button>
                      <button
                        type="button"
                        onClick={() => handleConfirmImage(player.id)}
                        className="bg-green-500/90 hover:bg-green-400 text-white text-xs font-black px-3 py-1 rounded-full shadow-lg"
                      >
                        Confirm
                      </button>
                    </div>
                    {isConfirmed && (
                      <div className="absolute top-2 left-2 flex items-center gap-1 bg-green-500/90 text-white text-xs font-black px-2 py-1 rounded-full shadow-lg">
                        <Check size={14} />
                        Correct
                      </div>
                    )}
                  </div>
                )}

                {/* Player Info */}
                <div className="flex items-start gap-3">
                  {/* Discord Avatar */}
                  {player.avatar_url && (
                    <img
                      src={player.avatar_url}
                      alt={player.display_name}
                      className="w-12 h-12 rounded-full border-2 border-orange-400 drop-shadow-lg flex-shrink-0"
                    />
                  )}
                  
                  <div className="flex-1 min-w-0">
                    <Link
                      to={`/players/${player.id}`}
                      className="font-black text-orange-300 hover:text-orange-200 text-base mb-1 block hover:underline transition truncate"
                    >
                      {player.display_name}
                    </Link>
                    {player.car_name ? (
                      <p className="text-sm text-gray-400 font-bold truncate">🏎️ {player.car_name}</p>
                    ) : (
                      <p className="text-sm text-gray-500 font-bold italic">Car to be chosen...</p>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
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
