import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Loader, ChevronLeft, Users, Trophy, Check } from 'lucide-react'
import { getCachedCarImage } from '../utils/carImageCache'
import { getMe, placeBet, readAuthToken } from '../api'

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
  user_bets?: Array<{
    id: number
    predicted_player_id: string
    points_wagered: number
    status: string
    payout: number
  }>
  all_bets?: Array<{
    id: number
    user_id: string
    username: string
    predicted_player_id: string
    points_wagered: number
    status: string
    payout: number
  }>
  candr?: {
    robber_player_id?: string
    robber_name?: string
    current_tile?: string | null
    previous_tile?: string | null
    started_at?: number
    last_tile_at?: number | null
    next_tile_due_at?: number | null
    finished_at?: number | null
    elapsed_ms?: number
    total_time_ms?: number | null
    map_url?: string
    roles?: Array<{
      player_id: string
      display_name: string
      role: 'robber' | 'cop'
    }>
  } | null
}

interface AuthUser {
  id: string
  username: string
  points: number
}

export function ActiveRound() {
  const navigate = useNavigate()
  const [round, setRound] = useState<ActiveRoundData | null>(null)
  const [loading, setLoading] = useState(true)
  const [playerCarImages, setPlayerCarImages] = useState<Record<string, string | null>>({})
  const [playerImageIndex, setPlayerImageIndex] = useState<Record<string, number>>({})
  const [confirmedImages, setConfirmedImages] = useState<Record<string, boolean>>({})
  const [authUser, setAuthUser] = useState<AuthUser | null>(null)
  const [betPlayerId, setBetPlayerId] = useState('')
  const [betPoints, setBetPoints] = useState('10')
  const [betMessage, setBetMessage] = useState<string | null>(null)
  const [betError, setBetError] = useState<string | null>(null)
  const [placingBet, setPlacingBet] = useState(false)
  const [now, setNow] = useState(Date.now())
  const lastRoundIdRef = useRef<string | null>(null)
  const redirectedRef = useRef(false)

  const getConfirmedKey = (carName: string) => `car-image-confirmed-${carName}`

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(interval)
  }, [])

  const formatDuration = (milliseconds: number) => {
    const safeMs = Math.max(0, milliseconds)
    const totalSeconds = Math.floor(safeMs / 1000)
    const minutes = Math.floor(totalSeconds / 60)
    const seconds = totalSeconds % 60
    return `${minutes}:${seconds.toString().padStart(2, '0')}`
  }

  const getTileStyle = (tile?: string | null) => {
    if (!tile) return null
    const match = tile.toUpperCase().match(/^([A-G])(\d{1,2})$/)
    if (!match) return null

    const rowLetter = match[1]
    const col = Number.parseInt(match[2], 10)
    if (!rowLetter || Number.isNaN(col) || col < 1 || col > 13) return null

    const rowIndex = rowLetter.charCodeAt(0) - 'A'.charCodeAt(0)
    if (rowIndex < 0 || rowIndex > 6) return null

    return {
      left: `${(col / 14) * 100}%`,
      top: `${((rowIndex + 1) / 8) * 100}%`,
      width: `${(1 / 14) * 100}%`,
      height: `${(1 / 8) * 100}%`
    }
  }

  useEffect(() => {
    const token = readAuthToken()
    if (!token) {
      setAuthUser(null)
      return
    }

    getMe()
      .then(result => setAuthUser(result.user))
      .catch(() => setAuthUser(null))
  }, [])

  useEffect(() => {
    let mounted = true
    
    const fetchActiveRound = async () => {
      try {
        const token = readAuthToken()
        const response = await fetch('/api/current-round', {
          headers: token ? { Authorization: `Bearer ${token}` } : undefined
        })
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

        // Populate form with first bet if exists (allows editing)
        if (data.user_bets && data.user_bets.length > 0) {
          const firstBet = data.user_bets[0]
          setBetPlayerId(firstBet.predicted_player_id)
          setBetPoints(String(firstBet.points_wagered))
        }
        
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

  const handlePlaceBet = async () => {
    if (!round) return
    setBetError(null)
    setBetMessage(null)

    if (!authUser) {
      setBetError('Sign in first to place a bet')
      return
    }

    const wager = Number.parseInt(betPoints, 10)
    if (!betPlayerId || Number.isNaN(wager) || wager <= 0) {
      setBetError('Choose a player and enter a valid wager')
      return
    }

    setPlacingBet(true)
    try {
      const result = await placeBet(round.id, betPlayerId, wager)
      setAuthUser(result.user)
      setBetMessage('Bet placed successfully')
      setBetPlayerId('')
      setBetPoints('10')
      setRound(prev => {
        if (!prev) return prev
        const newBet = {
          id: result.bet.id,
          predicted_player_id: result.bet.predicted_player_id,
          points_wagered: result.bet.points_wagered,
          status: result.bet.status,
          payout: result.bet.payout
        }
        return {
          ...prev,
          user_bets: [...(prev.user_bets || []), newBet]
        }
      })
    } catch (error) {
      setBetError((error as Error).message)
    } finally {
      setPlacingBet(false)
    }
  }

  const selectedBetPlayerName = round?.players.find(player => player.id === betPlayerId)?.display_name

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

  if (round.race_type?.toLowerCase() === 'candr') {
    const candr = round.candr
    const robberId = candr?.robber_player_id
    const robber = round.players.find(player => player.id === robberId)
    const cops = round.players.filter(player => player.id !== robberId)
    const tileStyle = getTileStyle(candr?.current_tile)
    const startedAt = candr?.started_at ?? null
    const elapsed = startedAt ? formatDuration(now - startedAt) : '0:00'
    const nextTileIn = candr?.next_tile_due_at ? formatDuration(candr.next_tile_due_at - now) : 'Ready'

    return (
      <div className="rounded-2xl border-2 border-amber-600/70 bg-[radial-gradient(circle_at_top,#6b5b3d_0%,#2f2922_35%,#1b1816_100%)] p-4 md:p-6 text-amber-100 shadow-2xl">
        <Link
          to="/"
          className="mb-4 inline-flex items-center gap-2 rounded-md border border-amber-500/50 bg-black/30 px-3 py-1 text-sm font-bold text-amber-200 hover:bg-black/45"
        >
          <ChevronLeft size={16} />
          Back
        </Link>

        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-400/50 bg-black/40 px-4 py-3">
          <h1 className="text-2xl md:text-3xl font-extrabold tracking-wide text-amber-100">CANDR (COPS AND ROBBERS)</h1>
          <div className="flex items-center gap-6 text-right">
            <div>
              <p className="text-xs uppercase text-amber-300/80">Current Target Tile</p>
              <p className="text-3xl font-black text-red-400">{candr?.current_tile ?? '---'}</p>
            </div>
            <div>
              <p className="text-xs uppercase text-amber-300/80">Time</p>
              <p className="text-3xl font-black text-amber-100">{elapsed}</p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr),280px] gap-4">
          <div className="rounded-lg border border-amber-500/60 bg-black/35 p-2">
            <div className="relative overflow-hidden rounded-md border border-amber-400/50">
              <img
                src={candr?.map_url || '/api/candr-map'}
                alt="Cops and Robbers grid map"
                className="block w-full"
              />
              {tileStyle && (
                <div
                  className="pointer-events-none absolute bg-red-500/50 ring-2 ring-red-300 shadow-[0_0_25px_rgba(239,68,68,0.55)]"
                  style={tileStyle}
                />
              )}
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm">
              <p className="font-bold text-amber-200">Previous Tile: <span className="text-amber-100">{candr?.previous_tile ?? 'None'}</span></p>
              <p className="font-bold text-amber-200">Next Tile In: <span className="text-red-300">{nextTileIn}</span></p>
            </div>
          </div>

          <aside className="space-y-3">
            <div className="rounded-lg border border-red-400/60 bg-red-900/20 p-4">
              <p className="text-xs uppercase text-red-200/90 mb-1">Robber</p>
              <p className="text-xl font-black text-red-300">{robber?.display_name || candr?.robber_name || 'Unassigned'}</p>
            </div>

            <div className="rounded-lg border border-blue-400/50 bg-blue-950/20 p-4">
              <p className="text-xs uppercase text-blue-200/90 mb-2">Cops</p>
              <div className="space-y-1">
                {cops.map(cop => (
                  <p key={cop.id} className="font-bold text-blue-100">{cop.display_name}</p>
                ))}
              </div>
            </div>

            <div className="rounded-lg border border-amber-400/50 bg-black/35 p-4">
              <p className="text-xs uppercase text-amber-300/80 mb-1">Round Budget</p>
              <p className="text-2xl font-black text-amber-100">{formatCurrency(round.value)}</p>
              <p className="mt-2 text-xs text-amber-200/80">Players can use preset or custom cars within this budget.</p>
            </div>
          </aside>
        </div>
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

      <div className="mb-8 bg-gray-900/80 border-2 border-orange-500 rounded-xl p-6">
        <h2 className="text-2xl font-black text-orange-400 mb-4 uppercase drop-shadow-lg">Betting</h2>

        {/* Show all bets */}
        {round.all_bets && round.all_bets.length > 0 && (
          <div className="mb-4 bg-gray-800 border border-orange-500/50 rounded-lg p-4">
            <p className="text-orange-300 font-bold text-sm mb-3">All Bets ({round.all_bets.length}):</p>
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {round.all_bets.map(bet => {
                const playerName = round.players.find(p => p.id === bet.predicted_player_id)?.display_name
                return (
                  <div key={bet.id} className="flex items-center justify-between bg-gray-900/50 rounded px-3 py-2">
                    <div className="flex items-center gap-2">
                      <span className="text-gray-400 text-xs font-bold">{bet.username}</span>
                      <span className="text-gray-500">→</span>
                      <span className="text-white text-sm font-bold">{playerName ?? 'Unknown'}</span>
                    </div>
                    <span className="text-orange-300 font-black text-sm">{bet.points_wagered}pts</span>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {!authUser ? (
          <div>
            <p className="text-gray-300 font-bold mb-3">Sign in to place bets. Every account starts with 100 points.</p>
            <Link
              to="/signin"
              className="inline-flex items-center bg-orange-500 hover:bg-orange-400 text-white font-black px-4 py-2 rounded-lg transition"
            >
              Sign In
            </Link>
          </div>
        ) : round.status === 'active' || round.status === 'finished' ? (
          <div className="bg-red-900/20 border border-red-500/50 rounded-lg p-4">
            <p className="text-red-300 font-black text-lg mb-2">🔒 Bets Locked</p>
            <p className="text-gray-300 text-sm">The game has started. No more bets can be placed.</p>
          </div>
        ) : (
          <div>
            <p className="text-gray-300 font-bold mb-3">{authUser.username} • {authUser.points} points available</p>

            {round.user_bets && round.user_bets.length > 0 && (
              <div className="mb-3 bg-gray-800 border border-orange-500/50 rounded-lg p-3">
                <p className="text-orange-300 font-bold text-sm mb-2">Your bets:</p>
                <div className="space-y-1">
                  {round.user_bets.map(bet => {
                    const playerName = round.players.find(p => p.id === bet.predicted_player_id)?.display_name
                    return (
                      <div key={bet.id} className="text-gray-300 text-sm font-bold">
                        {playerName ?? 'Unknown'} • {bet.points_wagered} points
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
              <select
                value={betPlayerId}
                onChange={event => setBetPlayerId(event.target.value)}
                className="bg-gray-800 border border-orange-500/50 rounded-lg px-3 py-2 text-white font-bold"
              >
                <option value="">Choose winner</option>
                {round.players.map(player => (
                  <option key={player.id} value={player.id}>{player.display_name}</option>
                ))}
              </select>

              <input
                type="number"
                min={1}
                value={betPoints}
                onChange={event => setBetPoints(event.target.value)}
                className="bg-gray-800 border border-orange-500/50 rounded-lg px-3 py-2 text-white font-bold"
                placeholder="Points"
              />

              <button
                type="button"
                disabled={placingBet}
                onClick={handlePlaceBet}
                className="bg-orange-500 hover:bg-orange-400 disabled:opacity-60 text-white font-black rounded-lg px-4 py-2 transition"
              >
                {placingBet ? 'Placing...' : 'Place Bet'}
              </button>
            </div>

            {betError && <p className="text-red-400 font-bold text-sm">{betError}</p>}
            {betMessage && <p className="text-green-400 font-bold text-sm">{betMessage}</p>}
          </div>
        )}
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
