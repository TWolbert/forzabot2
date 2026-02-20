import { useEffect, useState } from 'react'
import { getTimes } from '../api'
import { Loader, Clock } from 'lucide-react'

interface Time {
  id: string
  player_name: string
  car_name: string
  race_name: string
  time_ms: number
  created_at: string
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

  if (loading) {
    return (
      <div className="flex justify-center items-center h-96">
        <Loader className="animate-spin" size={40} />
      </div>
    )
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
              <tr key={time.id} className="border-b border-gray-200 hover:bg-gray-50 transition">
                <td className="py-3 px-4 font-medium text-gray-800">
                  {time.player_name}
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
