import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { getLeaderboard } from '../api'
import { Loader } from 'lucide-react'

interface LeaderboardEntry {
  id: string
  username: string
  display_name: string
  wins: number
  avatar_url?: string
}

export function Leaderboard() {
  const [data, setData] = useState<LeaderboardEntry[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getLeaderboard()
      .then(setData)
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

  const medals = ['🥇', '🥈', '🥉']
  const topThree = data.slice(0, 3)
  const rest = data.slice(3)

  return (
    <div className="bg-gradient-to-br from-gray-950 via-gray-900 to-gray-950 rounded-2xl shadow-2xl p-8 border-2 border-green-500">
      <div className="flex flex-wrap items-end justify-between gap-4 mb-8">
        <div>
          <div className="text-xs font-black text-green-300 uppercase tracking-[0.3em] mb-2">Forza League</div>
          <h2 className="text-5xl font-black text-green-400 drop-shadow-lg">Leaderboard</h2>
          <p className="text-gray-400 font-bold mt-2">Ranked by total wins</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="bg-green-500/10 border border-green-500/40 px-4 py-2 rounded-full text-green-300 text-xs font-black uppercase">
            Season Standings
          </div>
          <div className="bg-gray-900/70 border border-gray-700 px-4 py-2 rounded-full text-gray-300 text-xs font-black">
            {data.length} Drivers
          </div>
        </div>
      </div>

      {data.length === 0 ? (
        <div className="text-center py-10 text-gray-400 text-xl">
          No players yet
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-10">
            {topThree.map((player, index) => (
              <div
                key={player.id}
                className="bg-gradient-to-br from-gray-900 to-gray-800 border-2 border-green-500/40 rounded-2xl p-6 shadow-lg relative overflow-hidden"
              >
                <div className="absolute inset-0 opacity-10" style={{backgroundImage: 'radial-gradient(circle at 20% 20%, rgba(16, 185, 129, 0.6) 0%, transparent 50%)'}}></div>
                <div className="relative">
                  <div className="flex items-center justify-between mb-6">
                    <span className="text-4xl">{medals[index]}</span>
                    <span className="text-xs font-black uppercase text-green-300">Rank {index + 1}</span>
                  </div>
                  <div className="flex items-center gap-4">
                    {player.avatar_url ? (
                      <img
                        src={player.avatar_url}
                        alt={player.display_name || player.username}
                        className="w-14 h-14 rounded-full border-2 border-green-400/80 shadow-lg object-cover"
                      />
                    ) : (
                      <div className="w-14 h-14 rounded-full border-2 border-green-400/50 bg-gray-800"></div>
                    )}
                    <div>
                      <Link
                        to={`/players/${player.id}`}
                        className="text-2xl font-black text-white hover:text-green-300 transition"
                      >
                        {player.display_name || player.username}
                      </Link>
                      <p className="text-xs text-gray-400 font-bold mt-1">Total Wins</p>
                    </div>
                  </div>
                  <div className="mt-6 flex items-end justify-between">
                    <span className="text-4xl font-black text-green-300 drop-shadow-lg">{player.wins}</span>
                    <span className="text-xs font-black uppercase text-green-300/70">Wins</span>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {rest.length > 0 && (
            <div className="space-y-3">
              {rest.map((player, index) => (
                <Link
                  key={player.id}
                  to={`/players/${player.id}`}
                  className="flex items-center gap-4 bg-gray-900/70 border border-gray-800 rounded-xl px-4 py-3 hover:bg-gray-800 transition"
                >
                  <div className="text-lg font-black text-gray-400 w-10 text-right">{index + 4}.</div>
                  {player.avatar_url ? (
                    <img
                      src={player.avatar_url}
                      alt={player.display_name || player.username}
                      className="w-10 h-10 rounded-full border-2 border-green-400/80 shadow-lg object-cover"
                    />
                  ) : (
                    <div className="w-10 h-10 rounded-full border-2 border-green-400/50 bg-gray-800"></div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="font-black text-white truncate">
                      {player.display_name || player.username}
                    </div>
                    <div className="text-xs text-gray-400 font-bold">Driver</div>
                  </div>
                  <div className="text-right">
                    <div className="text-2xl font-black text-green-300">{player.wins}</div>
                    <div className="text-xs text-gray-400 font-bold uppercase">Wins</div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
