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
    <div className="bg-white rounded-lg shadow-lg p-8">
      <h2 className="text-3xl font-bold mb-6 text-gray-800 flex items-center gap-2">
        <Clock className="text-blue-500" size={32} />
        Lap Times
      </h2>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b-2 border-gray-300">
              <th className="text-left py-3 px-4 font-bold text-gray-700">Player</th>
              <th className="text-left py-3 px-4 font-bold text-gray-700">Car</th>
              <th className="text-left py-3 px-4 font-bold text-gray-700">Track</th>
              <th className="text-center py-3 px-4 font-bold text-gray-700">Time</th>
              <th className="text-center py-3 px-4 font-bold text-gray-700">Date</th>
            </tr>
          </thead>
          <tbody>
            {times.map(time => (
              <tr 
                key={time.id}
                onClick={() => window.location.href = `/times/${time.id}`}
                className="border-b border-gray-200 hover:bg-blue-50 transition cursor-pointer"
              >
                <td className="py-3 px-4 font-medium text-gray-800">
                  <Link
                    to={`/players/${time.player_id}`}
                    onClick={(e) => e.stopPropagation()}
                    className="text-green-600 hover:text-green-700 hover:underline"
                  >
                    {time.player_name}
                  </Link>
                </td>
                <td className="py-3 px-4 text-gray-700">
                  {time.car_name}
                </td>
                <td className="py-3 px-4 text-gray-700">
                  {time.race_name}
                </td>
                <td className="py-3 px-4 text-center font-bold text-blue-600">
                  {formatTime(time.time_ms)}
                </td>
                <td className="py-3 px-4 text-center text-gray-500">
                  {formatDate(time.created_at)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {times.length === 0 && (
        <div className="text-center py-8 text-gray-500">
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
      <div className="bg-white rounded-lg shadow-lg p-8">
        <Link
          to="/times"
          className="flex items-center gap-2 text-blue-600 hover:text-blue-700 mb-6 font-semibold"
        >
          <ChevronLeft size={20} />
          Back to Times
        </Link>
        <p className="text-gray-500">Time not found</p>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-lg shadow-lg p-8">
      <Link
        to="/times"
        className="flex items-center gap-2 text-blue-600 hover:text-blue-700 mb-6 font-semibold"
      >
        <ChevronLeft size={20} />
        Back to Times
      </Link>

      {selectedTime && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {/* Car Image */}
          <div className="md:col-span-1">
            {imageLoading ? (
              <div className="flex justify-center items-center h-80 bg-gray-100 rounded-lg">
                <Loader className="animate-spin" size={40} />
              </div>
            ) : selectedTime.car_image ? (
              <img
                src={selectedTime.car_image}
                alt={selectedTime.car_name}
                className="w-full h-auto rounded-lg shadow-md"
              />
            ) : (
              <div className="flex items-center justify-center h-80 bg-gray-100 rounded-lg text-gray-500">
                No image available
              </div>
            )}
          </div>

          {/* Details */}
          <div className="md:col-span-2">
            <h2 className="text-3xl font-bold text-gray-800 mb-6">Lap Time Details</h2>

            <div className="space-y-4">
              <div className="border-b border-gray-200 pb-4">
                <p className="text-sm text-gray-600">Player</p>
                <p className="text-2xl font-bold text-gray-800">{selectedTime.player_name}</p>
              </div>

              <div className="border-b border-gray-200 pb-4">
                <p className="text-sm text-gray-600">Car</p>
                <p className="text-2xl font-bold text-gray-800">{selectedTime.car_name}</p>
              </div>

              <div className="border-b border-gray-200 pb-4">
                <p className="text-sm text-gray-600">Track</p>
                <p className="text-2xl font-bold text-gray-800">{selectedTime.race_name}</p>
              </div>

              <div className="border-b border-gray-200 pb-4">
                <p className="text-sm text-gray-600">Lap Time</p>
                <p className="text-3xl font-bold text-blue-600">
                  {formatTime(selectedTime.time_ms)}
                </p>
              </div>

              <div className="bg-gray-50 p-4 rounded-lg">
                <p className="text-sm text-gray-600">Recorded</p>
                <p className="text-lg text-gray-800">{formatDate(selectedTime.created_at)}</p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
