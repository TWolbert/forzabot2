const API_BASE = '/api'

export async function getLeaderboard() {
  const res = await fetch(`${API_BASE}/leaderboard`)
  if (!res.ok) throw new Error('Failed to fetch leaderboard')
  return res.json()
}

export async function getPlayerStats(userId: string) {
  const res = await fetch(`${API_BASE}/player/${userId}`)
  if (!res.ok) throw new Error('Failed to fetch player stats')
  return res.json()
}

export async function getPastGames() {
  const res = await fetch(`${API_BASE}/games`)
  if (!res.ok) throw new Error('Failed to fetch games')
  return res.json()
}

export async function getTimes(race?: string, car?: string) {
  const params = new URLSearchParams()
  if (race) params.append('race', race)
  if (car) params.append('car', car)
  const res = await fetch(`${API_BASE}/times?${params}`)
  if (!res.ok) throw new Error('Failed to fetch times')
  return res.json()
}

export async function getRaces() {
  const res = await fetch(`${API_BASE}/races`)
  if (!res.ok) throw new Error('Failed to fetch races')
  return res.json()
}
