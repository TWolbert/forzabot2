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
  confirmed_image_url?: string | null
}

interface ActiveRoundData {
  id: string
  class: string
  restrict_class?: number
  value: number
  race_type: string
  series_race?: string | null
  year?: number
  status: string
  created_at: string
  players: Player[]
  scores?: Array<{ player_id: string; display_name: string; points: number }>
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

  const getConfirmedKey = (carName: string) => `car-image-confirmed-${carName}`

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
      const confirmed: Record<string, boolean> = {}
      
      for (const player of round.players) {
        if (!player.car_name) continue
        try {
          if (player.confirmed_image_url) {
            images[player.id] = player.confirmed_image_url
            confirmed[player.id] = true
            localStorage.setItem(getConfirmedKey(player.car_name), player.confirmed_image_url)
            continue
          }

          const confirmedKey = getConfirmedKey(player.car_name)
          const confirmedImage = localStorage.getItem(confirmedKey)
          if (confirmedImage) {
            images[player.id] = confirmedImage
            confirmed[player.id] = true
            continue
          }

          const index = playerImageIndex[player.id] ?? 0
          const imageUrl = await getCachedCarImage(player.car_name, index, { forceRefresh: index !== 0 })
          images[player.id] = imageUrl
        } catch (error) {
          console.error(`Failed to fetch image for ${player.car_name}:`, error)
          images[player.id] = null
        }
      }
      
      setPlayerCarImages(prev => ({ ...prev, ...images }))
      setConfirmedImages(prev => ({ ...prev, ...confirmed }))
    }

    fetchCarImages()
  }, [round, playerImageIndex])

  const handleRetryImage = async (playerId: string) => {
    const carName = round?.players.find(player => player.id === playerId)?.car_name
    if (carName) {
      localStorage.removeItem(getConfirmedKey(carName))
      try {
        await fetch('/api/car-image/confirm', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ carName })
        })
      } catch (error) {
        console.error('Failed to clear confirmed image:', error)
      }
    }
    setPlayerImageIndex(prev => ({
      ...prev,
      [playerId]: Math.floor(Math.random() * 10)
    }))
    setConfirmedImages(prev => ({
      ...prev,
      [playerId]: false
    }))
  }

  const handleConfirmImage = async (playerId: string) => {
    const carName = round?.players.find(player => player.id === playerId)?.car_name
    const imageUrl = playerCarImages[playerId]
    if (carName && imageUrl) {
      try {
        const response = await fetch('/api/car-image/confirm', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ carName, imageUrl })
        })
        if (!response.ok) {
          throw new Error('Confirm failed')
        }
        const data = await response.json()
        const confirmedUrl = data?.imageUrl || imageUrl
        localStorage.setItem(getConfirmedKey(carName), confirmedUrl)
        setPlayerCarImages(prev => ({
          ...prev,
          [playerId]: confirmedUrl
        }))
        setConfirmedImages(prev => ({
          ...prev,
          [playerId]: true
        }))
      } catch (error) {
        console.error('Failed to confirm image:', error)
      }
    }
  }

  const handleManualImage = async (playerId: string) => {
    const carName = round?.players.find(player => player.id === playerId)?.car_name
    if (!carName) return

    const input = window.prompt('Paste image URL for this car:')
    if (!input) return

    const imageUrl = input.trim()
    if (!imageUrl) return

    try {
      const response = await fetch('/api/car-image/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ carName, imageUrl })
      })
      if (!response.ok) {
        throw new Error('Confirm failed')
      }
      const data = await response.json()
      const confirmedUrl = data?.imageUrl || imageUrl
      localStorage.setItem(getConfirmedKey(carName), confirmedUrl)
      setPlayerCarImages(prev => ({
        ...prev,
        [playerId]: confirmedUrl
      }))
      setConfirmedImages(prev => ({
        ...prev,
        [playerId]: true
      }))
    } catch (error) {
      console.error('Failed to confirm image:', error)
    }
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
        {round.series_race && (
          <div className="bg-gray-800 p-4 rounded-lg border-2 border-orange-500">
            <p className="text-xs font-black text-orange-400 uppercase mb-1">Series Race</p>
            <p className="text-2xl font-black text-white drop-shadow-lg">
              {formatRaceType(round.series_race)}
            </p>
          </div>
        )}
        {round.restrict_class !== 0 && (
          <div className="bg-gray-800 p-4 rounded-lg border-2 border-orange-500">
            <p className="text-xs font-black text-orange-400 uppercase mb-1">Class</p>
            <p className="text-2xl font-black text-white drop-shadow-lg">{round.class || 'N/A'}</p>
          </div>
        )}
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

      {round.scores && round.scores.length > 0 && (
        <div className="mb-8 bg-gray-900/80 border-2 border-orange-500 rounded-xl p-6">
          <h2 className="text-2xl font-black text-orange-400 mb-4 uppercase drop-shadow-lg">Live Scores</h2>
          <div className="space-y-2">
            {round.scores.map((score, index) => (
              <div
                key={score.player_id}
                className="flex items-center justify-between bg-gray-800/80 border border-orange-500/40 rounded-lg px-4 py-2"
              >
                <div className="flex items-center gap-3">
                  <span className="text-orange-300 font-black w-6 text-right">{index + 1}.</span>
                  <span className="font-black text-white">{score.display_name}</span>
                </div>
                <span className="text-orange-300 font-black text-lg">{score.points}</span>
              </div>
            ))}
          </div>
        </div>
      )}

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
                    <div className="w-full aspect-[16/10] overflow-hidden rounded-t-lg border-b-2 border-orange-500 bg-gradient-to-br from-gray-700 to-gray-800">
                      {carImage && (
                        <img
                          src={carImage}
                          alt={player.car_name}
                          className="w-full h-full object-cover"
                        />
                      )}
                    </div>
                    {!isConfirmed && (
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
                        <button
                          type="button"
                          onClick={() => handleManualImage(player.id)}
                          className="bg-gray-900/90 hover:bg-gray-800 text-white text-xs font-black px-3 py-1 rounded-full shadow-lg"
                        >
                          Set URL
                        </button>
                      </div>
                    )}
                    {isConfirmed && (
                      <div className="absolute top-2 left-2 flex items-center justify-center bg-green-500/90 text-white text-xs font-black w-7 h-7 rounded-full shadow-lg">
                        <Check size={14} />
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
