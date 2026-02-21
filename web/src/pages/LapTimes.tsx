import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { getTimes } from '../api'
import { Loader, Clock, ChevronLeft } from 'lucide-react'

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

export function LapTimes() {
  const [times, setTimes] = useState<Time[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getTimes()
      .then(setTimes)
      .catch(err => console.error(err))
      .finally(() => setLoading(false))
  }, [])

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
        <Loader className="animate-spin" size={40} />
      </div>
    )
  }

  return (
    <div className="bg-gradient-to-br from-gray-900 to-gray-800 rounded-xl p-8 border-4 border-cyan-500 drop-shadow-2xl">
      <h2 className="text-5xl font-black mb-6 text-cyan-400 flex items-center gap-3 drop-shadow-lg">
        <Clock className="text-cyan-400" size={40} />
        LAP TIMES
      </h2>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b-4 border-cyan-500 bg-gradient-to-r from-cyan-600 to-blue-600">
              <th className="text-left py-4 px-4 font-black text-white text-lg">PLAYER</th>
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
                onClick={() => window.location.href = `/times/${time.id}`}
                className="border-b-2 border-gray-700 hover:bg-gray-700 transition cursor-pointer transform hover:scale-105"
              >
                <td className="py-4 px-4 font-black text-cyan-300">
                  <Link
                    to={`/players/${time.player_id}`}
                    onClick={(e) => e.stopPropagation()}
                    className="text-cyan-300 hover:text-cyan-200 hover:underline transition"
                  >
                    {time.player_name}
                  </Link>
                </td>
                <td className="py-4 px-4 text-white font-bold">
                  {time.car_name}
                </td>
                <td className="py-4 px-4 text-white font-bold">
                  {time.race_name}
                </td>
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

      {times.length === 0 && (
        <div className="text-center py-8 text-gray-400 text-lg font-bold">
          No lap times recorded yet
        </div>
      )}
    </div>
  )
}

export function TimeDetail() {
  const { timeId } = useParams<{ timeId: string }>()
  const [selectedTime, setSelectedTime] = useState<Time | null>(null)
  const [imageLoading, setImageLoading] = useState(true)
  const [loading, setLoading] = useState(true)

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

        const imgResponse = await fetch(`/api/car-image/${encodeURIComponent(time.car_name)}`)
        const imgData = await imgResponse.json()
        setSelectedTime({ ...time, car_image: imgData.imageUrl })
      } catch (error) {
        console.error('Failed to fetch time details:', error)
      } finally {
        setImageLoading(false)
        setLoading(false)
      }
    }

    fetchTimeDetails()
  }, [timeId])

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
              <img
                src={selectedTime.car_image}
                alt={selectedTime.car_name}
                className="w-full aspect-video object-cover rounded-lg shadow-xl border-2 border-cyan-500 drop-shadow-lg"
              />
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
