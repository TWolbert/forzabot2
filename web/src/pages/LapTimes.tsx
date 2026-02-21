import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { getTimes } from '../api'
import { getCachedCarImage } from '../utils/carImageCache'
import { Loader, Clock, ChevronLeft, ChevronRight, Check } from 'lucide-react'

interface Time {
  id: string
  player_id: string
  player_name: string
  car_name: string
  race_name: string
  time_ms: number
  created_at: string
  car_image?: string
}

const ITEMS_PER_PAGE = 12

export function LapTimes() {
  const [times, setTimes] = useState<Time[]>([])
  const [loading, setLoading] = useState(true)
  const [currentPage, setCurrentPage] = useState(0)
  const [carImages, setCarImages] = useState<Record<string, string | null>>({})
  const [carImageIndex, setCarImageIndex] = useState<Record<string, number>>({})
  const [confirmedCars, setConfirmedCars] = useState<Record<string, boolean>>({})

  const getConfirmedKey = (carName: string) => `car-image-confirmed-${carName}`

  useEffect(() => {
    getTimes()
      .then(setTimes)
      .catch(err => console.error(err))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    const fetchCarImages = async () => {
      const images: Record<string, string | null> = {}
      const confirmed: Record<string, boolean> = {}
      
      for (const time of times) {
        if (!time.car_name || images[time.car_name]) continue
        try {
          const confirmedImage = localStorage.getItem(getConfirmedKey(time.car_name))
          if (confirmedImage) {
            images[time.car_name] = confirmedImage
            confirmed[time.car_name] = true
            continue
          }

          const index = carImageIndex[time.car_name] ?? 0
          const imageUrl = await getCachedCarImage(time.car_name, index, { forceRefresh: index !== 0 })
          images[time.car_name] = imageUrl
        } catch (error) {
          console.error(`Failed to fetch image for ${time.car_name}:`, error)
          images[time.car_name] = null
        }
      }
      
      setCarImages(images)
      setConfirmedCars(prev => ({ ...prev, ...confirmed }))
    }

    if (times.length > 0) {
      fetchCarImages()
    }
  }, [times, carImageIndex])

  const handleRetryCar = async (carName: string) => {
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

    setConfirmedCars(prev => ({
      ...prev,
      [carName]: false
    }))
    setCarImageIndex(prev => ({
      ...prev,
      [carName]: Math.floor(Math.random() * 10)
    }))
  }

  const handleConfirmCar = async (carName: string) => {
    const imageUrl = carImages[carName]
    if (!imageUrl) return

    localStorage.setItem(getConfirmedKey(carName), imageUrl)
    try {
      await fetch('/api/car-image/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ carName, imageUrl })
      })
    } catch (error) {
      console.error('Failed to confirm image:', error)
    }

    setConfirmedCars(prev => ({
      ...prev,
      [carName]: true
    }))
  }

  const handleManualCar = async (carName: string) => {
    const input = window.prompt('Paste image URL for this car:')
    if (!input) return

    const imageUrl = input.trim()
    if (!imageUrl) return

    localStorage.setItem(getConfirmedKey(carName), imageUrl)
    try {
      await fetch('/api/car-image/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ carName, imageUrl })
      })
    } catch (error) {
      console.error('Failed to confirm image:', error)
    }

    setCarImages(prev => ({
      ...prev,
      [carName]: imageUrl
    }))
    setConfirmedCars(prev => ({
      ...prev,
      [carName]: true
    }))
  }

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
        day: 'numeric'
      })
    } catch {
      return dateStr
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center items-center h-96">
        <Loader className="animate-spin text-cyan-400" size={40} />
      </div>
    )
  }

  const totalPages = Math.ceil(times.length / ITEMS_PER_PAGE)
  const paginatedTimes = times.slice(
    currentPage * ITEMS_PER_PAGE,
    (currentPage + 1) * ITEMS_PER_PAGE
  )

  return (
    <div className="bg-gradient-to-br from-gray-900 to-gray-800 rounded-xl p-8 border-4 border-cyan-500 drop-shadow-2xl">
      <h2 className="text-5xl font-black mb-8 text-cyan-400 flex items-center gap-3 drop-shadow-lg">
        <Clock className="text-cyan-400" size={40} />
        LAP TIMES
      </h2>

      {times.length === 0 ? (
        <div className="text-center py-12 text-gray-400 text-lg font-bold">
          No lap times recorded yet
        </div>
      ) : (
        <>
          {/* Grid of Tiles */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
            {paginatedTimes.map(time => {
              const imageUrl = carImages[time.car_name]
              const isConfirmed = confirmedCars[time.car_name]
              return (
                <Link
                  key={time.id}
                  to={`/times/${time.id}`}
                  className="group relative overflow-hidden rounded-xl shadow-2xl aspect-video cursor-pointer transform transition hover:scale-105 border-4 border-cyan-500"
                  style={{
                    backgroundImage: imageUrl
                      ? `linear-gradient(135deg, rgba(0,0,0,0.5) 0%, rgba(0,0,0,0.3) 100%), url('${imageUrl}')`
                      : 'linear-gradient(135deg, rgb(59, 130, 246) 0%, rgb(6, 182, 212) 100%)',
                    backgroundSize: 'cover',
                    backgroundPosition: 'center'
                  }}
                >
                  {/* Scanline effect overlay */}
                  <div className="absolute inset-0 opacity-20" style={{backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 10px, rgba(0,0,0,0.1) 10px, rgba(0,0,0,0.1) 20px)'}}></div>
                  
                  {/* Content overlay */}
                  <div className="absolute inset-0 bg-gradient-to-t from-black via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity"></div>

                  {!isConfirmed && (
                    <div className="absolute bottom-3 right-3 flex items-center gap-2 opacity-0 group-hover:opacity-100 transition">
                      <button
                        type="button"
                        onClick={(event) => {
                          event.preventDefault()
                          event.stopPropagation()
                          handleRetryCar(time.car_name)
                        }}
                        className="bg-cyan-500/90 hover:bg-cyan-400 text-white text-xs font-black px-3 py-1 rounded-full shadow-lg"
                      >
                        Retry
                      </button>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.preventDefault()
                          event.stopPropagation()
                          handleConfirmCar(time.car_name)
                        }}
                        className="bg-green-500/90 hover:bg-green-400 text-white text-xs font-black px-3 py-1 rounded-full shadow-lg"
                      >
                        Confirm
                      </button>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.preventDefault()
                          event.stopPropagation()
                          handleManualCar(time.car_name)
                        }}
                        className="bg-gray-900/90 hover:bg-gray-800 text-white text-xs font-black px-3 py-1 rounded-full shadow-lg"
                      >
                        Set URL
                      </button>
                    </div>
                  )}

                  {isConfirmed && (
                    <div className="absolute top-3 left-3 flex items-center justify-center bg-green-500/90 text-white text-xs font-black w-7 h-7 rounded-full shadow-lg">
                      <Check size={14} />
                    </div>
                  )}
                  
                  <div className="relative h-full flex flex-col justify-between p-6 text-white">
                    {/* Top: Track and Time */}
                    <div className="flex flex-col justify-center flex-1">
                      <h3 className="text-3xl font-black drop-shadow-2xl mb-2">
                        {formatTime(time.time_ms)}
                      </h3>
                      <p className="text-lg font-black text-cyan-300 drop-shadow-lg">
                        {time.race_name}
                      </p>
                    </div>

                    {/* Bottom: Player and Car */}
                    <div className="mt-auto">
                      <Link
                        to={`/players/${time.player_id}`}
                        onClick={(e) => e.stopPropagation()}
                        className="font-black text-cyan-300 hover:text-cyan-200 underline drop-shadow-lg hover:no-underline transition"
                      >
                        {time.player_name}
                      </Link>
                      <p className="text-sm text-gray-300 font-bold drop-shadow-lg">
                        {time.car_name}
                      </p>
                      <p className="text-xs text-gray-400 font-bold mt-1">
                        {formatDate(time.created_at)}
                      </p>
                    </div>
                  </div>
                </Link>
              )
            })}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-4 mt-8">
              <button
                onClick={() => setCurrentPage(Math.max(0, currentPage - 1))}
                disabled={currentPage === 0}
                className="p-2 rounded-lg border-2 border-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-700 transition text-cyan-400 font-black disabled:text-gray-600"
              >
                <ChevronLeft size={24} />
              </button>
              <span className="text-sm text-gray-400 font-bold">
                Page {currentPage + 1} of {totalPages}
              </span>
              <button
                onClick={() => setCurrentPage(Math.min(totalPages - 1, currentPage + 1))}
                disabled={currentPage === totalPages - 1}
                className="p-2 rounded-lg border-2 border-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-700 transition text-cyan-400 font-black disabled:text-gray-600"
              >
                <ChevronRight size={24} />
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

export function TimeDetail() {
  const { timeId } = useParams<{ timeId: string }>()
  const [selectedTime, setSelectedTime] = useState<Time | null>(null)
  const [imageLoading, setImageLoading] = useState(true)
  const [loading, setLoading] = useState(true)
  const [imageIndex, setImageIndex] = useState(0)
  const [isConfirmed, setIsConfirmed] = useState(false)

  const getConfirmedKey = (carName: string) => `car-image-confirmed-${carName}`

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

  useEffect(() => {
    if (!timeId) return

    const fetchTimeDetails = async () => {
      setImageLoading(true)
      setLoading(true)
      try {
        const response = await fetch(`/api/times/${timeId}`)
        if (!response.ok) throw new Error('Time not found')
        
        const time = await response.json()
        const confirmedImage = localStorage.getItem(getConfirmedKey(time.car_name))
        if (confirmedImage) {
          setSelectedTime({ ...time, car_image: confirmedImage })
          setIsConfirmed(true)
          return
        }

        const carImage = await getCachedCarImage(time.car_name, imageIndex, { forceRefresh: imageIndex !== 0 })
        setSelectedTime({ ...time, car_image: carImage })
        setIsConfirmed(false)
      } catch (error) {
        console.error('Failed to fetch time details:', error)
      } finally {
        setImageLoading(false)
        setLoading(false)
      }
    }

    fetchTimeDetails()
  }, [timeId, imageIndex])

  const handleRetryImage = async () => {
    if (!selectedTime) return
    localStorage.removeItem(getConfirmedKey(selectedTime.car_name))
    try {
      await fetch('/api/car-image/confirm', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ carName: selectedTime.car_name })
      })
    } catch (error) {
      console.error('Failed to clear confirmed image:', error)
    }
    setIsConfirmed(false)
    setImageIndex(Math.floor(Math.random() * 10))
  }

  const handleConfirmImage = async () => {
    if (!selectedTime?.car_image) return

    localStorage.setItem(getConfirmedKey(selectedTime.car_name), selectedTime.car_image)
    try {
      await fetch('/api/car-image/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ carName: selectedTime.car_name, imageUrl: selectedTime.car_image })
      })
    } catch (error) {
      console.error('Failed to confirm image:', error)
    }
    setIsConfirmed(true)
  }

  const handleManualImage = async () => {
    if (!selectedTime) return
    const input = window.prompt('Paste image URL for this car:')
    if (!input) return

    const imageUrl = input.trim()
    if (!imageUrl) return

    localStorage.setItem(getConfirmedKey(selectedTime.car_name), imageUrl)
    try {
      await fetch('/api/car-image/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ carName: selectedTime.car_name, imageUrl })
      })
    } catch (error) {
      console.error('Failed to confirm image:', error)
    }
    setSelectedTime(prev => (prev ? { ...prev, car_image: imageUrl } : prev))
    setIsConfirmed(true)
  }

  if (loading) {
    return (
      <div className="flex justify-center items-center h-96">
        <Loader className="animate-spin" size={40} />
      </div>
    )
  }

  if (!selectedTime) {
    return (
      <div className="bg-gradient-to-br from-gray-900 to-gray-800 rounded-xl p-8 border-4 border-cyan-500 drop-shadow-2xl">
        <Link
          to="/times"
          className="flex items-center gap-2 text-cyan-400 hover:text-cyan-300 mb-6 font-black transition"
        >
          <ChevronLeft size={20} />
          Back to Times
        </Link>
        <p className="text-gray-400 text-lg font-bold">Time not found</p>
      </div>
    )
  }

  return (
    <div className="bg-gradient-to-br from-gray-900 to-gray-800 rounded-xl p-8 border-4 border-cyan-500 drop-shadow-2xl">
      <Link
        to="/times"
        className="flex items-center gap-2 text-cyan-400 hover:text-cyan-300 mb-6 font-black transition"
      >
        <ChevronLeft size={20} />
        Back to Times
      </Link>

      {selectedTime && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {/* Car Image */}
          <div className="md:col-span-1">
            {imageLoading ? (
              <div className="flex justify-center items-center h-80 bg-gray-800 rounded-lg border-2 border-cyan-500">
                <Loader className="animate-spin text-cyan-400" size={40} />
              </div>
            ) : selectedTime.car_image ? (
              <div className="relative group">
                <img
                  src={selectedTime.car_image}
                  alt={selectedTime.car_name}
                  className="w-full aspect-video object-cover rounded-lg shadow-xl border-2 border-cyan-500 drop-shadow-lg"
                />
                {!isConfirmed && (
                  <div className="absolute bottom-3 right-3 flex items-center gap-2 opacity-0 group-hover:opacity-100 transition">
                    <button
                      type="button"
                      onClick={handleRetryImage}
                      className="bg-cyan-500/90 hover:bg-cyan-400 text-white text-xs font-black px-3 py-1 rounded-full shadow-lg"
                    >
                      Retry
                    </button>
                    <button
                      type="button"
                      onClick={handleConfirmImage}
                      className="bg-green-500/90 hover:bg-green-400 text-white text-xs font-black px-3 py-1 rounded-full shadow-lg"
                    >
                      Confirm
                    </button>
                    <button
                      type="button"
                      onClick={handleManualImage}
                      className="bg-gray-900/90 hover:bg-gray-800 text-white text-xs font-black px-3 py-1 rounded-full shadow-lg"
                    >
                      Set URL
                    </button>
                  </div>
                )}
                {isConfirmed && (
                  <div className="absolute top-3 left-3 flex items-center justify-center bg-green-500/90 text-white text-xs font-black w-7 h-7 rounded-full shadow-lg">
                    <Check size={14} />
                  </div>
                )}
              </div>
            ) : (
              <div className="flex items-center justify-center w-full aspect-video bg-gray-800 rounded-lg text-gray-500 border-2 border-cyan-500">
                No image available
              </div>
            )}
          </div>

          {/* Details */}
          <div className="md:col-span-2">
            <h2 className="text-5xl font-black text-cyan-400 mb-6 drop-shadow-lg">LAP TIME DETAILS</h2>

            <div className="space-y-4">
              <div className="border-b-2 border-gray-700 pb-4">
                <p className="text-xs font-black text-cyan-400 uppercase">Player</p>
                <Link
                  to={`/players/${selectedTime.player_id}`}
                  className="text-3xl font-black text-cyan-300 hover:text-cyan-200 hover:underline transition drop-shadow-lg"
                >
                  {selectedTime.player_name}
                </Link>
              </div>

              <div className="border-b-2 border-gray-700 pb-4">
                <p className="text-xs font-black text-cyan-400 uppercase">Car</p>
                <p className="text-2xl font-black text-white drop-shadow-lg">{selectedTime.car_name}</p>
              </div>

              <div className="border-b-2 border-gray-700 pb-4">
                <p className="text-xs font-black text-cyan-400 uppercase">Track</p>
                <p className="text-2xl font-black text-white drop-shadow-lg">{selectedTime.race_name}</p>
              </div>

              <div className="border-b-2 border-gray-700 pb-4">
                <p className="text-xs font-black text-cyan-400 uppercase">Lap Time</p>
                <p className="text-4xl font-black text-cyan-300 drop-shadow-lg">
                  {formatTime(selectedTime.time_ms)}
                </p>
              </div>

              <div className="bg-gray-800 p-4 rounded-lg border-2 border-cyan-500">
                <p className="text-xs font-black text-cyan-400 uppercase">Recorded</p>
                <p className="text-lg font-bold text-white">{formatDate(selectedTime.created_at)}</p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
