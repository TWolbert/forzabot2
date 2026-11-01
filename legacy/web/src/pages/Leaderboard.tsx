import { useEffect, useMemo, useState } from 'react'
import { getLeaderboard } from '../api'
import { Loader } from 'lucide-react'
import { Link } from 'react-router-dom'

interface LeaderboardProgressionEntry {
  date: number
  cumulative_points: number
  delta: number
}

interface LeaderboardEntry {
  id: string
  username: string
  points: number
  linked_player_id?: string | null
  avatar_url?: string | null
  total_bets: number
  won_bets: number
  points_progression?: LeaderboardProgressionEntry[]
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

  const medals = ['🥇', '🥈', '🥉']
  const topThree = data.slice(0, 3)
  const rest = data.slice(3)
  const topThreeColors = ['#34d399', '#f59e0b', '#60a5fa']
  const initialsFor = (username: string) => (username || '?').slice(0, 1).toUpperCase()

  const topThreeChart = useMemo(() => {
    if (!topThree.length) return null

    const series = topThree.map((player, index) => {
      const progression = (player.points_progression && player.points_progression.length
        ? [...player.points_progression]
        : [{ date: Date.now(), cumulative_points: player.points, delta: 0 }]
      ).sort((a, b) => a.date - b.date)

      return {
        id: player.id,
        username: player.username,
        color: topThreeColors[index % topThreeColors.length],
        progression
      }
    })

    const timestamps = [...new Set(series.flatMap(player => player.progression.map(point => point.date)))].sort((a, b) => a - b)
    if (!timestamps.length) return null

    const resolvedTimestamps = timestamps.length === 1 ? [timestamps[0], timestamps[0] + 1] : timestamps

    const valueAt = (points: LeaderboardProgressionEntry[], ts: number) => {
      let current = points[0]?.cumulative_points ?? 0
      for (const point of points) {
        if (point.date <= ts) current = point.cumulative_points
        else break
      }
      return current
    }

    const values = series.flatMap(player => resolvedTimestamps.map(ts => valueAt(player.progression, ts)))
    const minValue = Math.min(...values)
    const maxValue = Math.max(...values, minValue + 1)
    const range = Math.max(1, maxValue - minValue)

    const width = 760
    const height = 280
    const paddingX = 34
    const paddingY = 28
    const chartWidth = width - paddingX * 2
    const chartHeight = height - paddingY * 2

    const xFor = (index: number) => paddingX + (resolvedTimestamps.length === 1 ? chartWidth / 2 : (index / (resolvedTimestamps.length - 1)) * chartWidth)
    const yFor = (value: number) => paddingY + (chartHeight - ((value - minValue) / range) * chartHeight)

    const chartSeries = series.map(player => {
      const points = resolvedTimestamps.map((ts, index) => {
        const value = valueAt(player.progression, ts)
        return {
          ts,
          value,
          x: xFor(index),
          y: yFor(value)
        }
      })

      const path = points
        .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`)
        .join(' ')

      return {
        ...player,
        points,
        path,
        latest: points[points.length - 1]?.value ?? 0
      }
    })

    const labelStep = Math.max(1, Math.ceil(resolvedTimestamps.length / 6))
    const labels = resolvedTimestamps.map((ts, index) => {
      if (index % labelStep !== 0 && index !== resolvedTimestamps.length - 1) return ''
      return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    })

    return {
      width,
      height,
      chartWidth,
      chartHeight,
      paddingX,
      paddingY,
      minValue,
      maxValue,
      labels,
      series: chartSeries
    }
  }, [topThree])

  if (loading) {
    return (
      <div className="flex justify-center items-center h-96">
        <Loader className="animate-spin" size={40} />
      </div>
    )
  }

  return (
    <div className="bg-gradient-to-br from-gray-950 via-gray-900 to-gray-950 rounded-2xl shadow-2xl p-8 border-2 border-green-500">
      <div className="flex flex-wrap items-end justify-between gap-4 mb-8">
        <div>
          <div className="text-xs font-black text-green-300 uppercase tracking-[0.3em] mb-2">Forza League</div>
          <h2 className="text-5xl font-black text-green-400 drop-shadow-lg">Leaderboard</h2>
          <p className="text-gray-400 font-bold mt-2">Ranked by total points</p>
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
          {topThreeChart && (
            <div className="mb-10 bg-gray-900/70 border border-green-500/30 rounded-2xl p-5">
              <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                <h3 className="text-lg font-black text-white">Top 3 Points Race</h3>
                <div className="flex flex-wrap items-center gap-3">
                  {topThreeChart.series.map((player) => (
                    <div key={player.id} className="flex items-center gap-2 text-xs font-black text-gray-200 uppercase tracking-wide">
                      <span className="w-3 h-3 rounded-full" style={{ backgroundColor: player.color }}></span>
                      <span>{player.username}</span>
                      <span className="text-gray-400">{player.latest} pts</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="overflow-x-auto">
                <svg viewBox={`0 0 ${topThreeChart.width} ${topThreeChart.height}`} className="w-full min-w-[680px] h-[260px]" role="img" aria-label="Top 3 points progression">
                  <defs>
                    <linearGradient id="leaderboardChartFade" x1="0" x2="0" y1="0" y2="1">
                      <stop offset="0%" stopColor="#22c55e" stopOpacity="0.16" />
                      <stop offset="100%" stopColor="#22c55e" stopOpacity="0" />
                    </linearGradient>
                  </defs>

                  <rect
                    x={topThreeChart.paddingX}
                    y={topThreeChart.paddingY}
                    width={topThreeChart.chartWidth}
                    height={topThreeChart.chartHeight}
                    fill="url(#leaderboardChartFade)"
                  />

                  {[0, 1, 2, 3, 4].map((step) => {
                    const y = topThreeChart.paddingY + (step / 4) * topThreeChart.chartHeight
                    return (
                      <line
                        key={step}
                        x1={topThreeChart.paddingX}
                        y1={y}
                        x2={topThreeChart.paddingX + topThreeChart.chartWidth}
                        y2={y}
                        stroke="rgba(75, 85, 99, 0.55)"
                        strokeDasharray="5 6"
                      />
                    )
                  })}

                  {topThreeChart.series.map((player) => (
                    <g key={player.id}>
                      <path d={player.path} fill="none" stroke={player.color} strokeWidth={3} strokeLinecap="round" />
                      {player.points.map((point, index) => (
                        <circle key={`${player.id}-${index}`} cx={point.x} cy={point.y} r={3.8} fill={player.color}>
                          <title>{`${player.username} | ${point.value} pts | ${new Date(point.ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`}</title>
                        </circle>
                      ))}
                    </g>
                  ))}

                  {topThreeChart.labels.map((label, index) => {
                    if (!label) return null
                    const x = topThreeChart.paddingX + (topThreeChart.labels.length === 1 ? topThreeChart.chartWidth / 2 : (index / (topThreeChart.labels.length - 1)) * topThreeChart.chartWidth)
                    return (
                      <text
                        key={`x-label-${index}`}
                        x={x}
                        y={topThreeChart.height - 8}
                        textAnchor="middle"
                        fontSize="11"
                        fill="#9ca3af"
                      >
                        {label}
                      </text>
                    )
                  })}

                  <text x={topThreeChart.paddingX - 8} y={topThreeChart.paddingY + 10} textAnchor="end" fontSize="11" fill="#9ca3af">
                    {Math.round(topThreeChart.maxValue)}
                  </text>
                  <text x={topThreeChart.paddingX - 8} y={topThreeChart.paddingY + topThreeChart.chartHeight} textAnchor="end" fontSize="11" fill="#9ca3af">
                    {Math.round(topThreeChart.minValue)}
                  </text>
                </svg>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-10">
            {topThree.map((player, index) => (
              player.linked_player_id ? (
                <Link
                  key={player.id}
                  to={`/players/${player.linked_player_id}`}
                  className="bg-gradient-to-br from-gray-900 to-gray-800 border-2 border-green-500/40 rounded-2xl p-6 shadow-lg relative overflow-hidden hover:border-green-300 transition block"
                >
                  <div className="absolute inset-0 opacity-10" style={{backgroundImage: 'radial-gradient(circle at 20% 20%, rgba(16, 185, 129, 0.6) 0%, transparent 50%)'}}></div>
                  <div className="relative">
                    <div className="flex items-center justify-between mb-6">
                      <span className="text-4xl">{medals[index]}</span>
                      <span className="text-xs font-black uppercase text-green-300">Rank {index + 1}</span>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="w-14 h-14 rounded-full border-2 border-green-400/50 bg-gray-800 overflow-hidden flex items-center justify-center">
                        {player.avatar_url ? (
                          <img
                            src={player.avatar_url}
                            alt={`${player.username} avatar`}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <span className="text-green-300 font-black text-lg">{initialsFor(player.username)}</span>
                        )}
                      </div>
                      <div>
                        <p className="text-2xl font-black text-white">{player.username}</p>
                        <p className="text-xs text-gray-400 font-bold mt-1">Bets Won: {player.won_bets}</p>
                      </div>
                    </div>
                    <div className="mt-6 flex items-end justify-between">
                      <span className="text-4xl font-black text-green-300 drop-shadow-lg">{player.points}</span>
                      <span className="text-xs font-black uppercase text-green-300/70">Points</span>
                    </div>
                  </div>
                </Link>
              ) : (
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
                      <div className="w-14 h-14 rounded-full border-2 border-green-400/50 bg-gray-800 overflow-hidden flex items-center justify-center">
                        {player.avatar_url ? (
                          <img
                            src={player.avatar_url}
                            alt={`${player.username} avatar`}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <span className="text-green-300 font-black text-lg">{initialsFor(player.username)}</span>
                        )}
                      </div>
                      <div>
                        <p className="text-2xl font-black text-white">{player.username}</p>
                        <p className="text-xs text-gray-400 font-bold mt-1">Bets Won: {player.won_bets}</p>
                      </div>
                    </div>
                    <div className="mt-6 flex items-end justify-between">
                      <span className="text-4xl font-black text-green-300 drop-shadow-lg">{player.points}</span>
                      <span className="text-xs font-black uppercase text-green-300/70">Points</span>
                    </div>
                  </div>
                </div>
              )
            ))}
          </div>

          {rest.length > 0 && (
            <div className="space-y-3">
              {rest.map((player, index) => (
                player.linked_player_id ? (
                  <Link
                    key={player.id}
                    to={`/players/${player.linked_player_id}`}
                    className="flex items-center gap-4 bg-gray-900/70 border border-gray-800 rounded-xl px-4 py-3 hover:bg-gray-800 transition"
                  >
                    <div className="text-lg font-black text-gray-400 w-10 text-right">{index + 4}.</div>
                    <div className="w-10 h-10 rounded-full border-2 border-green-400/50 bg-gray-800 overflow-hidden flex items-center justify-center">
                      {player.avatar_url ? (
                        <img
                          src={player.avatar_url}
                          alt={`${player.username} avatar`}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <span className="text-green-300 font-black text-sm">{initialsFor(player.username)}</span>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-black text-white truncate">
                        {player.username}
                      </div>
                      <div className="text-xs text-gray-400 font-bold">Bets: {player.total_bets}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-2xl font-black text-green-300">{player.points}</div>
                      <div className="text-xs text-gray-400 font-bold uppercase">Points</div>
                    </div>
                  </Link>
                ) : (
                  <div
                    key={player.id}
                    className="flex items-center gap-4 bg-gray-900/70 border border-gray-800 rounded-xl px-4 py-3"
                  >
                    <div className="text-lg font-black text-gray-400 w-10 text-right">{index + 4}.</div>
                    <div className="w-10 h-10 rounded-full border-2 border-green-400/50 bg-gray-800 overflow-hidden flex items-center justify-center">
                      {player.avatar_url ? (
                        <img
                          src={player.avatar_url}
                          alt={`${player.username} avatar`}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <span className="text-green-300 font-black text-sm">{initialsFor(player.username)}</span>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-black text-white truncate">
                        {player.username}
                      </div>
                      <div className="text-xs text-gray-400 font-bold">Bets: {player.total_bets}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-2xl font-black text-green-300">{player.points}</div>
                      <div className="text-xs text-gray-400 font-bold uppercase">Points</div>
                    </div>
                  </div>
                )
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
