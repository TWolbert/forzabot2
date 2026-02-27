const API_BASE = '/api'

const AUTH_TOKEN_KEY = 'forzabot-auth-token'

type HttpMethod = 'GET' | 'POST'

function getAuthToken(): string | null {
  return localStorage.getItem(AUTH_TOKEN_KEY)
}

function setAuthToken(token: string | null) {
  if (!token) {
    localStorage.removeItem(AUTH_TOKEN_KEY)
    window.dispatchEvent(new Event('forzabot-auth-changed'))
    return
  }
  localStorage.setItem(AUTH_TOKEN_KEY, token)
  window.dispatchEvent(new Event('forzabot-auth-changed'))
}

async function apiRequest(path: string, method: HttpMethod = 'GET', body?: unknown, withAuth = false) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json'
  }

  if (withAuth) {
    const token = getAuthToken()
    if (token) {
      headers.Authorization = `Bearer ${token}`
    }
  }

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  })

  const json = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error((json as { error?: string })?.error ?? 'Request failed')
  }

  return json
}

export function readAuthToken() {
  return getAuthToken()
}

export async function register(username: string, password: string) {
  const data = await apiRequest('/auth/register', 'POST', { username, password }) as {
    token: string
    user: { id: string; username: string; points: number }
  }
  setAuthToken(data.token)
  return data
}

export async function login(username: string, password: string) {
  const data = await apiRequest('/auth/login', 'POST', { username, password }) as {
    token: string
    user: { id: string; username: string; points: number }
  }
  setAuthToken(data.token)
  return data
}

export async function getMe() {
  return apiRequest('/auth/me', 'GET', undefined, true) as Promise<{
    user: { id: string; username: string; points: number }
  }>
}

export async function logout() {
  try {
    await apiRequest('/auth/logout', 'POST', {}, true)
  } finally {
    setAuthToken(null)
  }
}

export async function linkDiscord(discordUsername: string) {
  return apiRequest('/auth/link-discord', 'POST', { discord_username: discordUsername }, true) as Promise<{
    ok: boolean
    discord_username: string | null
  }>
}

export async function getDiscordLink() {
  return apiRequest('/auth/discord-link', 'GET', undefined, true) as Promise<{
    discord_username: string | null
  }>
}

export async function updateUsername(newUsername: string) {
  const data = await apiRequest('/auth/update-username', 'POST', { username: newUsername }, true) as {
    user: { id: string; username: string; points: number }
  }
  return data
}

export async function placeBet(roundId: string, predictedPlayerId: string, points: number) {
  return apiRequest('/bets/place', 'POST', { roundId, predictedPlayerId, points }, true) as Promise<{
    user: { id: string; username: string; points: number }
    bet: { id: number; round_id: string; predicted_player_id: string; points_wagered: number; status: string; payout: number }
  }>
}

export async function getLeaderboard() {
  return apiRequest('/leaderboard')
}

export async function getPlayerStats(userId: string) {
  return apiRequest(`/player/${userId}`)
}

export async function getPastGames() {
  return apiRequest('/games')
}

export async function getTimes(race?: string, car?: string) {
  const params = new URLSearchParams()
  if (race) params.append('race', race)
  if (car) params.append('car', car)
  return apiRequest(`/times?${params}`)
}

export async function getRaces() {
  return apiRequest('/races')
}
