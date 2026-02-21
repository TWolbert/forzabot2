import { Database } from 'bun:sqlite'
import { join } from 'path'

// Initialize database connection
// Use process.cwd() to ensure we get the project root
const dbPath = join(process.cwd(), 'forzabot.db')
console.log(`Connecting to database at: ${dbPath}`)

let db: Database
try {
  db = new Database(dbPath)
  db.exec('PRAGMA foreign_keys = ON')
  console.log(`✓ Database connected`)
} catch (error) {
  console.error(`✗ Failed to connect to database: ${error}`)
  process.exit(1)
}

// Get car image from Forza Fandom
async function getFandomCarImage(carName: string, index = 0): Promise<string | null> {
  const baseUrl = "https://forza.fandom.com/api.php"

  try {
    // Search for the car
    const searchUrl = new URL(baseUrl)
    searchUrl.searchParams.set("action", "query")
    searchUrl.searchParams.set("list", "search")
    searchUrl.searchParams.set("srsearch", carName)
    searchUrl.searchParams.set("srlimit", "10")
    searchUrl.searchParams.set("format", "json")

    const searchRes = await fetch(searchUrl.toString())
    const searchData = await searchRes.json() as any
    
    const safeIndex = Math.max(0, index)
    const topTitle = searchData?.query?.search?.[safeIndex]?.title
    if (!topTitle) return null

    // Get image for the top result
    const imageUrl = new URL(baseUrl)
    imageUrl.searchParams.set("action", "query")
    imageUrl.searchParams.set("prop", "pageimages")
    imageUrl.searchParams.set("pithumbsize", "800")
    imageUrl.searchParams.set("titles", topTitle)
    imageUrl.searchParams.set("format", "json")

    const imageRes = await fetch(imageUrl.toString())
    const imageData = await imageRes.json() as any

    const pages = imageData?.query?.pages ?? {}
    const firstPage = Object.values(pages)[0] as any
    return firstPage?.thumbnail?.source ?? null
  } catch (error) {
    console.error(`Error fetching Fandom image for ${carName}:`, error)
    return null
  }
}

// Get car image from Wikipedia
async function getWikipediaCarImage(carName: string, index = 0): Promise<string | null> {
  const baseUrl = "https://en.wikipedia.org/w/api.php"

  try {
    const searchUrl = new URL(baseUrl)
    searchUrl.searchParams.set("action", "query")
    searchUrl.searchParams.set("list", "search")
    searchUrl.searchParams.set("srsearch", carName)
    searchUrl.searchParams.set("srlimit", "10")
    searchUrl.searchParams.set("format", "json")
    searchUrl.searchParams.set("origin", "*")

    const searchRes = await fetch(searchUrl.toString())
    const searchData = await searchRes.json() as any

    const safeIndex = Math.max(0, index)
    const topTitle = searchData?.query?.search?.[safeIndex]?.title
    if (!topTitle) return null

    const imageUrl = new URL(baseUrl)
    imageUrl.searchParams.set("action", "query")
    imageUrl.searchParams.set("prop", "pageimages")
    imageUrl.searchParams.set("pithumbsize", "800")
    imageUrl.searchParams.set("titles", topTitle)
    imageUrl.searchParams.set("format", "json")
    imageUrl.searchParams.set("origin", "*")

    const imageRes = await fetch(imageUrl.toString())
    const imageData = await imageRes.json() as any

    const pages = imageData?.query?.pages ?? {}
    const firstPage = Object.values(pages)[0] as any
    return firstPage?.thumbnail?.source ?? null
  } catch (error) {
    console.error(`Error fetching Wikipedia image for ${carName}:`, error)
    return null
  }
}

// Get car image with fallback sources
async function getTopCarImage(carName: string, index = 0): Promise<string | null> {
  try {
    const confirmed = db.query("SELECT image_url FROM car_images WHERE car_name = ?").get(carName) as { image_url?: string } | null
    if (confirmed?.image_url) return confirmed.image_url
  } catch (error) {
    console.warn(`Failed to read confirmed image for ${carName}:`, error)
  }

  const fandomImage = await getFandomCarImage(carName, index)
  if (fandomImage) return fandomImage
  return getWikipediaCarImage(carName, index)
}

// Static file serving
const distPath = join(import.meta.dir, '../dist')

async function serveStaticFile(pathname: string): Promise<Response | null> {
  try {
    const filePath = join(distPath, pathname === '/' ? 'index.html' : pathname)
    const file = await Bun.file(filePath).exists()
    
    if (!file) return null
    
    const content = await Bun.file(filePath).bytes()
    const ext = filePath.split('.').pop()
    
    const mimeTypes: Record<string, string> = {
      'html': 'text/html',
      'css': 'text/css',
      'js': 'application/javascript',
      'json': 'application/json',
      'svg': 'image/svg+xml',
      'png': 'image/png',
      'jpg': 'image/jpeg',
      'ico': 'image/x-icon'
    }
    
    const contentType = mimeTypes[ext as string] || 'text/plain'
    return new Response(content, { headers: { 'Content-Type': contentType } })
  } catch {
    return null
  }
}

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

  // Individual player stats and details
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
        MIN(t.laptime) as fastest_time
      FROM rounds r
      LEFT JOIN round_players rp ON r.id = rp.round_id AND rp.player_id = ?
      LEFT JOIN times t ON ? = t.player_id
      WHERE rp.player_id = ? OR r.winner_id = ?
    `).get(playerId, playerId, playerId, playerId, playerId)

    // Get player's games
    const games = db.query(`
      SELECT
        r.id,
        r.race_type,
        r.winner_id,
        p.display_name as winner_name,
        COUNT(rp.player_id) as num_players,
        r.created_at,
        cc.car_name
      FROM rounds r
      LEFT JOIN players p ON r.winner_id = p.id
      LEFT JOIN round_players rp ON r.id = rp.round_id
      LEFT JOIN car_choices cc ON r.id = cc.round_id AND cc.player_id = ?
      WHERE r.status = 'finished' AND rp.player_id = ?
      GROUP BY r.id
      ORDER BY r.created_at DESC
    `).all(playerId, playerId)

    // Get player's times
    const times = db.query(`
      SELECT
        t.id,
        t.car_name,
        r.name as race_name,
        t.laptime as time_ms,
        t.created_at
      FROM times t
      JOIN races r ON t.race_id = r.id
      WHERE t.player_id = ?
      ORDER BY t.created_at DESC
    `).all(playerId)

    return new Response(JSON.stringify({ player, stats, games, times }), {
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

  // Game details with all players
  '/api/games/:id': (req) => {
    const url = new URL(req.url)
    const gameId = url.pathname.split('/')[3]

    const game = db.query(`
      SELECT
        r.id,
        r.class,
        r.restrict_class,
        r.value,
        r.race_type,
        r.year,
        r.winner_id,
        p.display_name as winner_name,
        r.created_at
      FROM rounds r
      LEFT JOIN players p ON r.winner_id = p.id
      WHERE r.id = ?
    `).get(gameId)

    if (!game) {
      return new Response(JSON.stringify({ error: 'Game not found' }), { status: 404 })
    }

    const players = db.query(`
      SELECT
        p.id,
        p.display_name,
        cc.car_name
      FROM round_players rp
      JOIN players p ON rp.player_id = p.id
      LEFT JOIN car_choices cc ON rp.round_id = cc.round_id AND rp.player_id = cc.player_id
      WHERE rp.round_id = ?
      ORDER BY p.display_name ASC
    `).all(gameId)

    return new Response(JSON.stringify({ ...game, players }), {
      headers: { 'Content-Type': 'application/json' }
    })
  },

  // Current active round
  '/api/current-round': () => {
    const result = db.query(`
      SELECT
        r.id,
        r.class,
        r.restrict_class,
        r.value,
        r.race_type,
        r.year,
        r.status,
        r.created_at
      FROM rounds r
      WHERE (r.status = 'pending' OR r.status = 'active') AND r.winner_id IS NULL
      LIMIT 1
    `).get()

    if (!result) {
      return new Response(JSON.stringify({ error: 'No active round' }), { status: 404 })
    }

    const players = db.query(`
      SELECT
        p.id,
        p.display_name,
        cc.car_name,
        da.avatar_url
      FROM round_players rp
      JOIN players p ON rp.player_id = p.id
      LEFT JOIN car_choices cc ON rp.round_id = cc.round_id AND rp.player_id = cc.player_id
      LEFT JOIN discord_avatars da ON p.id = da.player_id
      WHERE rp.round_id = ?
      ORDER BY p.display_name ASC
    `).all(result.id)

    return new Response(JSON.stringify({ ...result, players }), {
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
        t.player_id,
        p.display_name as player_name,
        t.car_name,
        r.name as race_name,
        t.laptime as time_ms,
        t.created_at
      FROM times t
      JOIN players p ON t.player_id = p.id
      JOIN races r ON t.race_id = r.id
    `

    const params: any[] = []

    if (raceFilter) {
      query += ` WHERE r.name ILIKE ?`
      params.push(`%${raceFilter}%`)
    }

    if (carFilter) {
      query += (raceFilter ? ' AND' : ' WHERE') + ` t.car_name ILIKE ?`
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

  // Individual time details
  '/api/times/:id': (req) => {
    const url = new URL(req.url)
    const timeId = url.pathname.split('/')[3]

    const time = db.query(`
      SELECT
        t.id,
        t.player_id,
        p.display_name as player_name,
        t.car_name,
        r.name as race_name,
        t.laptime as time_ms,
        t.created_at
      FROM times t
      JOIN players p ON t.player_id = p.id
      JOIN races r ON t.race_id = r.id
      WHERE t.id = ?
    `).get(timeId)

    if (!time) {
      return new Response(JSON.stringify({ error: 'Time not found' }), { status: 404 })
    }

    return new Response(JSON.stringify(time), {
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
  },

  // Car image by name
  '/api/car-image/:carName': async (req) => {
    const url = new URL(req.url)
    const carName = decodeURIComponent(url.pathname.split('/')[3])
    const indexParam = url.searchParams.get('index')
    const index = indexParam ? Number.parseInt(indexParam, 10) : 0

    try {
      const imageUrl = await getTopCarImage(carName, Number.isNaN(index) ? 0 : index)
      return new Response(JSON.stringify({ imageUrl }), {
        headers: { 'Content-Type': 'application/json' }
      })
    } catch (error) {
      console.error(`Error fetching car image for ${carName}:`, error)
      return new Response(JSON.stringify({ imageUrl: null }), {
        headers: { 'Content-Type': 'application/json' }
      })
    }
  },

  // Confirm or clear car image
  '/api/car-image/confirm': async (req) => {
    if (req.method === 'POST') {
      try {
        const body = await req.json() as { carName?: string; imageUrl?: string }
        if (!body?.carName || !body?.imageUrl) {
          return new Response(JSON.stringify({ error: 'Missing carName or imageUrl' }), { status: 400 })
        }

        const stmt = db.prepare(
          "INSERT INTO car_images (car_name, image_url, confirmed_at) VALUES (?, ?, ?) ON CONFLICT(car_name) DO UPDATE SET image_url = ?, confirmed_at = ?"
        )
        stmt.run(body.carName, body.imageUrl, Date.now(), body.imageUrl, Date.now())

        return new Response(JSON.stringify({ ok: true }), {
          headers: { 'Content-Type': 'application/json' }
        })
      } catch (error) {
        console.error('Error confirming car image:', error)
        return new Response(JSON.stringify({ error: 'Failed to confirm image' }), { status: 500 })
      }
    }

    if (req.method === 'DELETE') {
      try {
        const body = await req.json() as { carName?: string }
        if (!body?.carName) {
          return new Response(JSON.stringify({ error: 'Missing carName' }), { status: 400 })
        }

        db.prepare("DELETE FROM car_images WHERE car_name = ?").run(body.carName)

        return new Response(JSON.stringify({ ok: true }), {
          headers: { 'Content-Type': 'application/json' }
        })
      } catch (error) {
        console.error('Error clearing car image:', error)
        return new Response(JSON.stringify({ error: 'Failed to clear image' }), { status: 500 })
      }
    }

    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 })
  }
}

const port = parseInt(process.env.DASHBOARD_PORT || '34234', 10)

const server = Bun.serve({
  host: '0.0.0.0',
  port,
  async fetch(req) {
    const url = new URL(req.url)
    const pathname = url.pathname

    // Try serving API routes first
    for (const [route, handler] of Object.entries(handlers)) {
      const routePattern = route.replace(/:[^/]+/g, '[^/]+')
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

    // Try serving static files
    const staticFile = await serveStaticFile(pathname)
    if (staticFile) return staticFile

    // Fall back to index.html for SPA routing
    const indexFile = await serveStaticFile('/')
    if (indexFile) return indexFile

    return new Response(JSON.stringify({ error: 'Not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' }
    })
  }
})

console.log(`🚀 API Server running on http://localhost:${server.port}`)
