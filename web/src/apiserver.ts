import { Database } from 'bun:sqlite'
import { join } from 'path'

// Initialize database connection
// Database is at root of project, apiserver runs from web/src
const dbPath = join(import.meta.dir, '../../forzabot.db')
const db = new Database(dbPath)

// Enable foreign keys
db.exec('PRAGMA foreign_keys = ON')

// API Handlers
const handlers: Record<string, (req: Request) => Response | Promise<Response>> = {
  // Leaderboard - top 10 players by wins
  '/api/leaderboard': () => {
    const result = db.query(`
      SELECT 
        p.id,
        p.username,
        p.display_name,
        COUNT(r.id) as wins
      FROM players p
      LEFT JOIN rounds r ON p.id = r.winner_id
      GROUP BY p.id
      ORDER BY wins DESC
      LIMIT 10
    `).all()

    return new Response(JSON.stringify(result || []), {
      headers: { 'Content-Type': 'application/json' }
    })
  },

  // Individual player stats
  '/api/player/:id': (req) => {
    const url = new URL(req.url)
    const playerId = url.pathname.split('/')[3]

    const player = db.query('SELECT * FROM players WHERE id = ?').get(playerId)
    if (!player) {
      return new Response(JSON.stringify({ error: 'Player not found' }), { status: 404 })
    }

    const stats = db.query(`
      SELECT
        COUNT(DISTINCT r.id) as games_played,
        COUNT(CASE WHEN r.winner_id = ? THEN 1 END) as wins,
        COUNT(DISTINCT t.id) as times_recorded,
        MIN(t.time_ms) as fastest_time
      FROM rounds r
      LEFT JOIN round_players rp ON r.id = rp.round_id AND rp.player_id = ?
      LEFT JOIN times t ON ? = t.player_id
      WHERE rp.player_id = ? OR r.winner_id = ?
    `).get(playerId, playerId, playerId, playerId, playerId)

    return new Response(JSON.stringify({ player, stats }), {
      headers: { 'Content-Type': 'application/json' }
    })
  },

  // Past games
  '/api/games': () => {
    const result = db.query(`
      SELECT
        r.id,
        r.race_type,
        r.winner_id,
        p.display_name as winner_name,
        COUNT(rp.player_id) as num_players,
        r.created_at
      FROM rounds r
      LEFT JOIN players p ON r.winner_id = p.id
      LEFT JOIN round_players rp ON r.id = rp.round_id
      WHERE r.status = 'finished'
      GROUP BY r.id
      ORDER BY r.created_at DESC
      LIMIT 50
    `).all()

    return new Response(JSON.stringify(result || []), {
      headers: { 'Content-Type': 'application/json' }
    })
  },

  // Lap times with optional filtering
  '/api/times': (req) => {
    const url = new URL(req.url)
    const raceFilter = url.searchParams.get('race')
    const carFilter = url.searchParams.get('car')

    let query = `
      SELECT
        t.id,
        p.display_name as player_name,
        c.name as car_name,
        r.name as race_name,
        t.time_ms,
        t.created_at
      FROM times t
      JOIN players p ON t.player_id = p.id
      JOIN car_choices c ON t.car_id = c.id
      JOIN races r ON t.race_id = r.id
    `

    const params: any[] = []

    if (raceFilter) {
      query += ` WHERE r.name ILIKE ?`
      params.push(`%${raceFilter}%`)
    }

    if (carFilter) {
      query += (raceFilter ? ' AND' : ' WHERE') + ` c.name ILIKE ?`
      params.push(`%${carFilter}%`)
    }

    query += ` ORDER BY t.created_at DESC LIMIT 100`

    const result = params.length > 0
      ? db.query(query).all(...params)
      : db.query(query).all()

    return new Response(JSON.stringify(result || []), {
      headers: { 'Content-Type': 'application/json' }
    })
  },

  // All races
  '/api/races': () => {
    const result = db.query(`
      SELECT
        r.id,
        r.name,
        r.created_by,
        COUNT(t.id) as num_times
      FROM races r
      LEFT JOIN times t ON r.id = t.race_id
      GROUP BY r.id
      ORDER BY r.name ASC
    `).all()

    return new Response(JSON.stringify(result || []), {
      headers: { 'Content-Type': 'application/json' }
    })
  }
}

const server = Bun.serve({
  port: 3000,
  async fetch(req) {
    const url = new URL(req.url)
    const pathname = url.pathname

    // Find route handler
    for (const [route, handler] of Object.entries(handlers)) {
      const routePattern = route.replace(/:id/g, '[^/]+')
      const regex = new RegExp(`^${routePattern}$`)

      if (regex.test(pathname)) {
        try {
          return await handler(req)
        } catch (error) {
          console.error(`Error in ${pathname}:`, error)
          return new Response(JSON.stringify({ error: 'Internal server error' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
          })
        }
      }
    }

    return new Response(JSON.stringify({ error: 'Not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' }
    })
  }
})

console.log(`🚀 API Server running on http://localhost:${server.port}`)
