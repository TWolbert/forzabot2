import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Trophy, Gamepad2, Clock, Zap } from 'lucide-react'
import { getCachedCarImage } from '../utils/carImageCache'
import logo from '../5a59366f-e744-498c-9142-270c4f2069d1.png'

const PROMO_CARS = [
  'Lamborghini Huracán', 
  'Ferrari 458', 
  'Bugatti Veyron',
  'Porsche 911 Turbo',
  'McLaren 720S',
  'Chevrolet Corvette',
  'McLaren P1'
]

export function Home() {
  const [carImages, setCarImages] = useState<Record<string, string | null>>({})
  const [hasActiveRound, setHasActiveRound] = useState(false)
  const [activeRoundImage, setActiveRoundImage] = useState<string | null>(null)
  const [activeRoundPlayers, setActiveRoundPlayers] = useState<Array<{ id: string; avatar_url?: string }>>([])
  const [fastestLapImage, setFastestLapImage] = useState<string | null>(null)
  const [fastestLapCar, setFastestLapCar] = useState<string | null>(null)

  useEffect(() => {
    const fetchCarImages = async () => {
      const images: Record<string, string | null> = {}
      
      for (const car of PROMO_CARS) {
        try {
          const imageUrl = await getCachedCarImage(car)
          images[car] = imageUrl
        } catch (error) {
          console.error(`Failed to fetch image for ${car}:`, error)
          images[car] = null
        }
      }
      
      setCarImages(images)
    }

    fetchCarImages()
  }, [])

  useEffect(() => {
    let mounted = true

    const fetchFastestLap = async () => {
      try {
        const response = await fetch('/api/fastest-time')
        if (!response.ok) return
        const data = await response.json()
        const carName = data?.car_name as string | undefined
        if (!carName) return

        const imageUrl = await getCachedCarImage(carName)
        if (!mounted) return
        setFastestLapCar(carName)
        setFastestLapImage(imageUrl)
      } catch (error) {
        if (mounted) {
          console.error('Failed to fetch fastest lap time:', error)
        }
      }
    }

    fetchFastestLap()
    return () => {
      mounted = false
    }
  }, [])

  useEffect(() => {
    let mounted = true

    const fetchActiveRound = async () => {
      try {
        const response = await fetch('/api/current-round')
        if (!mounted) return
        if (!response.ok) {
          setHasActiveRound(false)
          setActiveRoundImage(null)
          setActiveRoundPlayers([])
          return
        }

        const data = await response.json()
        const players = (data?.players ?? []) as Array<{ id: string; avatar_url?: string; car_name?: string }>
        const chosenCars = (data?.players ?? [])
          .map((player: { car_name?: string }) => player.car_name)
          .filter((name: string | undefined): name is string => Boolean(name))

        const fallbackCar = 'Aston Martin Valkyrie AMR Pro'
        const carName = chosenCars.length > 0 ? chosenCars[0] : fallbackCar
        const imageUrl = await getCachedCarImage(carName)

        if (!mounted) return
        setHasActiveRound(true)
        setActiveRoundImage(imageUrl)
        setActiveRoundPlayers(players)
      } catch (error) {
        if (mounted) {
          console.error('Failed to fetch active round:', error)
          setHasActiveRound(false)
          setActiveRoundImage(null)
          setActiveRoundPlayers([])
        }
      }
    }

    fetchActiveRound()
    const interval = setInterval(fetchActiveRound, 5000)

    return () => {
      mounted = false
      clearInterval(interval)
    }
  }, [])

  const getTileBackground = (carName: string, defaultGradient: string) => {
    const imageUrl = carImages[carName]
    if (imageUrl) {
      return {
        backgroundImage: `linear-gradient(135deg, rgba(0,0,0,0.6) 0%, rgba(0,0,0,0.4) 100%), url('${imageUrl}')`,
        backgroundSize: 'cover',
        backgroundPosition: 'center'
      }
    }
    return {
      backgroundImage: `linear-gradient(135deg, var(--tw-gradient-stops))`
    }
  }

  return (
    <div className="min-h-screen bg-black">
      {/* Hero Section */}
      <div className="relative h-56 bg-gradient-to-r from-red-600 via-orange-500 to-yellow-500 overflow-hidden mb-10">
        <div className="absolute inset-0 opacity-20">
          <div className="absolute inset-0 bg-black transform -skew-y-3" style={{backgroundImage: 'radial-gradient(circle at 20% 50%, rgba(255,100,0,0.5) 0%, transparent 50%)'}}></div>
        </div>
        <div className="relative h-full flex items-center justify-center">
          <div className="text-center text-white flex flex-col items-center gap-4">
            <img src={logo} alt="ForzaBot Logo" className="h-[90%] drop-shadow-2xl" />
          </div>
        </div>
      </div>

      {/* Main Grid */}
      <div className="mx-auto px-4 pb-16 flex justify-center">
        <div className="w-full max-w-6xl">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 auto-rows-max">
            {hasActiveRound && (
              <Link
                to="/active-round"
                className="md:col-span-2 group relative overflow-hidden rounded-xl shadow-2xl h-64 cursor-pointer transform transition hover:scale-105 border-4 border-orange-500"
                style={{
                  backgroundImage: activeRoundImage
                    ? `linear-gradient(135deg, rgba(249, 115, 22, 0.85) 0%, rgba(239, 68, 68, 0.75) 100%), url('${activeRoundImage}')`
                    : 'linear-gradient(135deg, rgb(249, 115, 22) 0%, rgb(239, 68, 68) 100%)',
                  backgroundSize: 'cover',
                  backgroundPosition: 'center'
                }}
              >
                <div className="absolute inset-0 opacity-30" style={{backgroundImage: 'repeating-linear-gradient(45deg, transparent, transparent 10px, rgba(0,0,0,0.15) 10px, rgba(0,0,0,0.15) 20px)'}}></div>
                <div className="absolute top-3 left-3 flex items-center gap-1">
                  {activeRoundPlayers
                    .filter(player => player.avatar_url)
                    .slice(0, 6)
                    .map(player => (
                      <img
                        key={player.id}
                        src={player.avatar_url}
                        alt=""
                        className="w-8 h-8 rounded-full border-2 border-white/80 shadow-lg object-cover"
                      />
                    ))}
                </div>
                <div className="absolute top-3 right-3 flex items-center gap-2 text-white font-black text-xs bg-red-600/90 px-3 py-1 rounded-full shadow-lg">
                  <span className="w-2 h-2 rounded-full bg-white animate-pulse"></span>
                  LIVE
                </div>
                <div className="relative h-full flex flex-col items-center justify-center text-white p-6">
                  <Zap size={40} className="mb-2 drop-shadow-lg" />
                  <h3 className="text-2xl font-black text-center drop-shadow-lg">ACTIVE ROUND</h3>
                </div>
              </Link>
            )}
            {/* Large Games Tile with Car Background */}
            <Link
              to="/games"
              className="md:col-span-2 group relative overflow-hidden rounded-xl shadow-2xl h-96 cursor-pointer transform transition hover:scale-105 border-4 border-yellow-500"
            style={{
              backgroundImage: 'linear-gradient(135deg, rgb(250, 204, 21) 0%, rgb(217, 119, 6) 100%)',
              backgroundSize: 'cover',
              backgroundPosition: 'center'
            }}
          >
            {carImages[PROMO_CARS[0]] && (
              <img
                src={carImages[PROMO_CARS[0]]}
                alt={PROMO_CARS[0]}
                className="absolute right-0 top-0 h-full object-contain opacity-80 group-hover:opacity-100 transition-opacity"
              />
            )}
            <div className="absolute inset-0 opacity-30" style={{backgroundImage: 'repeating-linear-gradient(45deg, transparent, transparent 10px, rgba(0,0,0,0.1) 10px, rgba(0,0,0,0.1) 20px)'}}></div>
            <div className="relative h-full flex flex-col items-center justify-center text-white p-8">
              <Trophy size={80} className="mb-4 drop-shadow-2xl" />
              <h2 className="text-5xl font-black text-center drop-shadow-2xl">PAST GAMES</h2>
            </div>
          </Link>

          {/* Small Leaderboard Tile */}
          <Link
            to="/leaderboard"
            className="group relative overflow-hidden rounded-xl shadow-2xl h-48 cursor-pointer transform transition hover:scale-105 border-4 border-green-500"
            style={{
              backgroundImage: 'linear-gradient(135deg, rgb(34, 197, 94) 0%, rgb(5, 150, 105) 100%)',
              backgroundSize: 'cover',
              backgroundPosition: 'center'
            }}
          >
            {carImages[PROMO_CARS[6]] && (
              <img
                src={carImages[PROMO_CARS[6]]}
                alt={PROMO_CARS[6]}
                className="absolute right-0 top-0 h-full object-contain opacity-80 group-hover:opacity-100 transition-opacity"
              />
            )}
            <div className="absolute inset-0 opacity-30" style={{backgroundImage: 'repeating-linear-gradient(45deg, transparent, transparent 10px, rgba(0,0,0,0.1) 10px, rgba(0,0,0,0.1) 20px)'}}></div>
            <div className="relative h-full flex flex-col items-center justify-center text-white p-6">
              <Trophy size={40} className="mb-2 drop-shadow-lg" />
              <h3 className="text-2xl font-black text-center drop-shadow-lg">LEADERBOARD</h3>
            </div>
          </Link>

          {/* Lap Times Tile with Car Background */}
          <Link
            to="/times"
            className="group relative overflow-hidden rounded-xl shadow-2xl h-48 cursor-pointer transform transition hover:scale-105 border-4 border-cyan-500"
            style={{
              backgroundImage: 'linear-gradient(135deg, rgb(59, 130, 246) 0%, rgb(6, 182, 212) 100%)',
              backgroundSize: 'cover',
              backgroundPosition: 'center'
            }}
          >
            {(fastestLapImage || carImages[PROMO_CARS[1]]) && (
              <img
                src={fastestLapImage || carImages[PROMO_CARS[1]] || ''}
                alt={fastestLapCar || PROMO_CARS[1]}
                className="absolute right-0 top-0 h-full object-contain opacity-80 group-hover:opacity-100 transition-opacity"
              />
            )}
            <div className="absolute inset-0 opacity-30" style={{backgroundImage: 'repeating-linear-gradient(45deg, transparent, transparent 10px, rgba(0,0,0,0.1) 10px, rgba(0,0,0,0.1) 20px)'}}></div>
            <div className="relative h-full flex flex-col items-center justify-center text-white p-6">
              <Clock size={40} className="mb-2 drop-shadow-lg" />
              <h3 className="text-2xl font-black text-center drop-shadow-lg">LAP TIMES</h3>
            </div>
          </Link>

          {/* Races Tile with Car Background */}
          <Link
            to="/games"
            className="group relative overflow-hidden rounded-xl shadow-2xl h-48 cursor-pointer transform transition hover:scale-105 border-4 border-purple-500"
            style={{
              backgroundImage: 'linear-gradient(135deg, rgb(168, 85, 247) 0%, rgb(190, 24, 93) 100%)',
              backgroundSize: 'cover',
              backgroundPosition: 'center'
            }}
          >
            {carImages[PROMO_CARS[2]] && (
              <img
                src={carImages[PROMO_CARS[2]]}
                alt={PROMO_CARS[2]}
                className="absolute right-0 top-0 h-full object-contain opacity-80 group-hover:opacity-100 transition-opacity"
              />
            )}
            <div className="absolute inset-0 opacity-30" style={{backgroundImage: 'repeating-linear-gradient(45deg, transparent, transparent 10px, rgba(0,0,0,0.1) 10px, rgba(0,0,0,0.1) 20px)'}}></div>
            <div className="relative h-full flex flex-col items-center justify-center text-white p-6">
              <Gamepad2 size={40} className="mb-2 drop-shadow-lg" />
              <h3 className="text-2xl font-black text-center drop-shadow-lg">RACES</h3>
            </div>
          </Link>
        </div>
        </div>
      </div>
    </div>
  )
}
