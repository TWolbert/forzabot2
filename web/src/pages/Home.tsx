import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Trophy, Gamepad2, Clock } from 'lucide-react'
import logo from '../5a59366f-e744-498c-9142-270c4f2069d1.png'

const PROMO_CARS = [
  'Lamborghini Huracán', 
  'Ferrari 458', 
  'Bugatti Veyron',
  'Porsche 911 Turbo',
  'McLaren 720S',
  'Chevrolet Corvette'
]

export function Home() {
  const [carImages, setCarImages] = useState<Record<string, string | null>>({})

  useEffect(() => {
    const fetchCarImages = async () => {
      const images: Record<string, string | null> = {}
      
      for (const car of PROMO_CARS) {
        try {
          const response = await fetch(`/api/car-image/${encodeURIComponent(car)}`)
          const data = await response.json()
          images[car] = data.imageUrl
        } catch (error) {
          console.error(`Failed to fetch image for ${car}:`, error)
          images[car] = null
        }
      }
      
      setCarImages(images)
    }

    fetchCarImages()
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
      <div className="relative h-96 bg-gradient-to-r from-red-600 via-orange-500 to-yellow-500 overflow-hidden mb-12">
        <div className="absolute inset-0 opacity-20">
          <div className="absolute inset-0 bg-black transform -skew-y-3" style={{backgroundImage: 'radial-gradient(circle at 20% 50%, rgba(255,100,0,0.5) 0%, transparent 50%)'}}></div>
        </div>
        <div className="relative h-full flex items-center justify-center">
          <div className="text-center text-white flex flex-col items-center gap-4">
            <img src={logo} alt="ForzaBot Logo" className="h-32 drop-shadow-2xl" />
            <h1 className="text-6xl font-black drop-shadow-lg">FORZABOT</h1>
            <p className="text-2xl font-bold drop-shadow-lg">Racing Statistics Dashboard</p>
          </div>
        </div>
      </div>

      {/* Main Grid */}
      <div className="max-w-7xl mx-auto px-4 pb-16">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 auto-rows-max">
          {/* Large Games Tile with Car Background */}
          <Link
            to="/games"
            className="md:col-span-2 md:row-span-2 group relative overflow-hidden rounded-xl shadow-2xl h-96 cursor-pointer transform transition hover:scale-105 border-4 border-yellow-500"
            style={{
              backgroundImage: carImages[PROMO_CARS[0]] 
                ? `linear-gradient(135deg, rgba(0,0,0,0.5) 0%, rgba(0,0,0,0.3) 100%), url('${carImages[PROMO_CARS[0]]}')` 
                : 'linear-gradient(135deg, rgb(250, 204, 21) 0%, rgb(217, 119, 6) 100%)',
              backgroundSize: 'cover',
              backgroundPosition: 'center'
            }}
          >
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
          >
            <div className="absolute inset-0 bg-gradient-to-br from-green-500 to-emerald-700"></div>
            <div className="absolute inset-0 opacity-30" style={{backgroundImage: 'repeating-linear-gradient(45deg, transparent, transparent 10px, rgba(0,0,0,0.1) 10px, rgba(0,0,0,0.1) 20px)'}}></div>
            <div className="relative h-full flex flex-col items-center justify-center text-white p-6">
              <Trophy size={40} className="mb-2 drop-shadow-lg" />
              <h3 className="text-2xl font-black text-center drop-shadow-lg">LEADERBOARD</h3>
            </div>
          </Link>

          {/* Lap Times Tile with Car Background */}
          <Link
            to="/times"
            className="group relative overflow-hidden rounded-xl shadow-2xl h-48 cursor-pointer transform transition hover:scale-105 border-4 border-blue-500"
            style={{
              backgroundImage: carImages[PROMO_CARS[1]] 
                ? `linear-gradient(135deg, rgba(0,0,0,0.5) 0%, rgba(0,0,0,0.3) 100%), url('${carImages[PROMO_CARS[1]]}')` 
                : 'linear-gradient(135deg, rgb(59, 130, 246) 0%, rgb(6, 182, 212) 100%)',
              backgroundSize: 'cover',
              backgroundPosition: 'center'
            }}
          >
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
              backgroundImage: carImages[PROMO_CARS[2]] 
                ? `linear-gradient(135deg, rgba(0,0,0,0.5) 0%, rgba(0,0,0,0.3) 100%), url('${carImages[PROMO_CARS[2]]}')` 
                : 'linear-gradient(135deg, rgb(168, 85, 247) 0%, rgb(190, 24, 93) 100%)',
              backgroundSize: 'cover',
              backgroundPosition: 'center'
            }}
          >
            <div className="absolute inset-0 opacity-30" style={{backgroundImage: 'repeating-linear-gradient(45deg, transparent, transparent 10px, rgba(0,0,0,0.1) 10px, rgba(0,0,0,0.1) 20px)'}}></div>
            <div className="relative h-full flex flex-col items-center justify-center text-white p-6">
              <Gamepad2 size={40} className="mb-2 drop-shadow-lg" />
              <h3 className="text-2xl font-black text-center drop-shadow-lg">RACES</h3>
            </div>
          </Link>
        </div>
      </div>
    </div>
  )
}
