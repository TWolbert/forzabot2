import { Database } from 'bun:sqlite'
import { mkdir, unlink } from 'node:fs/promises'
import { join } from 'path'
import { randomUUID } from 'node:crypto'

// Initialize database connection
// Resolve to repo root so the API writes to the shared DB
const dbPath = join(import.meta.dir, '../../forzabot.db')
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

function initializeApiDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS web_users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      points INTEGER NOT NULL DEFAULT 100,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS auth_sessions (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES web_users (id)
    );
    CREATE TABLE IF NOT EXISTS bets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      round_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      predicted_player_id TEXT NOT NULL,
      points_wagered INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      payout INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      settled_at INTEGER,
      UNIQUE (round_id, user_id),
      FOREIGN KEY (round_id) REFERENCES rounds (id),
      FOREIGN KEY (user_id) REFERENCES web_users (id),
      FOREIGN KEY (predicted_player_id) REFERENCES players (id)
    );
    CREATE TABLE IF NOT EXISTS web_user_points_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      source TEXT NOT NULL,
      before_points INTEGER NOT NULL,
      after_points INTEGER NOT NULL,
      delta INTEGER NOT NULL,
      metadata TEXT,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES web_users (id)
    );
  `)

  try {
    db.exec(`ALTER TABLE players ADD COLUMN points INTEGER NOT NULL DEFAULT 100`)
  } catch {
    // ignore
  }

  try {
    db.exec(`UPDATE players SET points = 100 WHERE points IS NULL`)
  } catch {
    // ignore
  }
}

initializeApiDatabase()

type AuthUser = {
  id: string
  username: string
  points: number
}

type PointsLogSource =
  | 'bet_payout'
  | 'race_placement_1st'
  | 'race_placement_2nd'
  | 'admin_panel_set'

const ADMIN_PASSWORD = process.env.POINTS_ADMIN_PASSWORD?.trim() ?? ''
const ADMIN_SESSION_TTL_MS = 1000 * 60 * 60 * 12
const adminSessions = new Map<string, number>()

if (!ADMIN_PASSWORD) {
  console.warn('⚠ POINTS_ADMIN_PASSWORD is not set. Points management login is disabled.')
}

function getBearerToken(req: Request): string | null {
  const authHeader = req.headers.get('authorization')
  if (!authHeader) return null
  const [scheme, token] = authHeader.split(' ')
  if (!scheme || !token) return null
  if (scheme.toLowerCase() !== 'bearer') return null
  return token.trim() || null
}

function getAuthenticatedUser(req: Request): AuthUser | null {
  const token = getBearerToken(req)
  if (!token) return null

  const now = Date.now()
  const row = db.query(`
    SELECT wu.id, wu.username, wu.points, s.expires_at
    FROM auth_sessions s
    JOIN web_users wu ON wu.id = s.user_id
    WHERE s.token = ?
    LIMIT 1
  `).get(token) as (AuthUser & { expires_at: number }) | null

  if (!row) return null
  if (row.expires_at <= now) {
    db.prepare('DELETE FROM auth_sessions WHERE token = ?').run(token)
    return null
  }

  return {
    id: row.id,
    username: row.username,
    points: row.points
  }
}

function getAuthenticatedAdminToken(req: Request): string | null {
  const token = getBearerToken(req)
  if (!token) return null

  const expiresAt = adminSessions.get(token)
  if (!expiresAt) return null

  if (expiresAt <= Date.now()) {
    adminSessions.delete(token)
    return null
  }

  return token
}

function requireAuthenticatedAdmin(req: Request): Response | null {
  if (!ADMIN_PASSWORD) {
    return new Response(JSON.stringify({ error: 'Points management is not configured on the server' }), { status: 503 })
  }

  if (!getAuthenticatedAdminToken(req)) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
  }

  return null
}

function getWebUserPoints(userId: string): number {
  const row = db.query('SELECT points FROM web_users WHERE id = ? LIMIT 1').get(userId) as { points: number } | null
  if (!row) {
    throw new Error('USER_NOT_FOUND')
  }
  return row.points
}

function insertWebUserPointsLog(
  userId: string,
  source: PointsLogSource,
  beforePoints: number,
  afterPoints: number,
  metadata?: Record<string, unknown>
) {
  const delta = afterPoints - beforePoints
  db.prepare(`
    INSERT INTO web_user_points_log (user_id, source, before_points, after_points, delta, metadata, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    userId,
    source,
    beforePoints,
    afterPoints,
    delta,
    metadata ? JSON.stringify(metadata) : null,
    Date.now()
  )
}

function addWebUserPointsWithLog(
  userId: string,
  delta: number,
  source: PointsLogSource,
  metadata?: Record<string, unknown>
) {
  const beforePoints = getWebUserPoints(userId)
  const afterPoints = beforePoints + delta
  db.prepare('UPDATE web_users SET points = ? WHERE id = ?').run(afterPoints, userId)
  insertWebUserPointsLog(userId, source, beforePoints, afterPoints, metadata)
}

function setWebUserPointsWithLog(
  userId: string,
  newPoints: number,
  source: PointsLogSource,
  metadata?: Record<string, unknown>
) {
  const beforePoints = getWebUserPoints(userId)
  db.prepare('UPDATE web_users SET points = ? WHERE id = ?').run(newPoints, userId)
  insertWebUserPointsLog(userId, source, beforePoints, newPoints, metadata)
}

function settleFinishedBets() {
  const pendingBets = db.query(`
    SELECT b.id, b.round_id, b.user_id, b.predicted_player_id, b.points_wagered, r.winner_id
    FROM bets b
    JOIN rounds r ON r.id = b.round_id
    WHERE b.status = 'locked'
      AND r.status = 'finished'
      AND r.winner_id IS NOT NULL
  `).all() as Array<{
    id: number
    round_id: string
    user_id: string
    predicted_player_id: string
    points_wagered: number
    winner_id: string
  }>

  if (pendingBets.length === 0) return

  const markSettledStmt = db.prepare('UPDATE bets SET status = ?, payout = ?, settled_at = ? WHERE id = ?')
  const now = Date.now()

  for (const bet of pendingBets) {
    const won = bet.predicted_player_id === bet.winner_id
    const payout = won ? bet.points_wagered * 2 : 0

    db.transaction(() => {
      if (payout > 0) {
        addWebUserPointsWithLog(bet.user_id, payout, 'bet_payout', {
          bet_id: bet.id,
          round_id: bet.round_id,
          wagered: bet.points_wagered
        })
      }
      markSettledStmt.run(won ? 'won' : 'lost', payout, now, bet.id)
    })()
  }
}

function lockBetsForRound(roundId: string) {
  db.prepare('UPDATE bets SET status = ? WHERE round_id = ? AND status = ?')
    .run('locked', roundId, 'pending')
}

function awardPlacementPoints(roundId: string) {
  const round = db.query('SELECT race_type FROM rounds WHERE id = ?').get(roundId) as { race_type: string } | null
  if (!round) {
    console.log(`⚠ Round ${roundId} not found, cannot award placement points`)
    return
  }

  console.log(`🏁 Awarding placement points for round ${roundId} (race type: ${round.race_type || 'unknown'})`)

  const scores = db.query(`
    SELECT player_id, points FROM round_scores WHERE round_id = ? ORDER BY points DESC LIMIT 2
  `).all(roundId) as Array<{ player_id: string; points: number }> | null

  if (!scores || scores.length === 0) {
    console.log(`⚠ No scores found for round ${roundId}, cannot award placement points`)
    return
  }

  // Always award 50 points to 1st place winner, regardless of race type
  const winnerPlayerId = scores[0]?.player_id
  if (winnerPlayerId) {
    const winnerUser = db.query(`
      SELECT web_user_id FROM web_users_discord WHERE discord_user_id = ?
    `).get(winnerPlayerId) as { web_user_id: string } | null

    if (winnerUser) {
      const winnerWebUser = db.query('SELECT username FROM web_users WHERE id = ?').get(winnerUser.web_user_id) as { username: string } | null
      addWebUserPointsWithLog(winnerUser.web_user_id, 50, 'race_placement_1st', {
        round_id: roundId,
        race_type: round.race_type,
        discord_user_id: winnerPlayerId
      })
      console.log(`✓ Awarded 50 points to web user ${winnerUser.web_user_id} (${winnerWebUser?.username ?? 'unknown username'}) for 1st place (Discord ID: ${winnerPlayerId}, race type: ${round.race_type})`)
    } else {
      console.log(`⚠ No linked web account found for 1st place winner (Discord ID: ${winnerPlayerId}) - no points awarded`)
    }
  }

  // Only award 25 points to 2nd place for "all" race types
  if (round.race_type?.toLowerCase() === 'all' && scores.length >= 2) {
    const secondPlayerId = scores[1]?.player_id
    if (secondPlayerId) {
      const secondUser = db.query(`
        SELECT web_user_id FROM web_users_discord WHERE discord_user_id = ?
      `).get(secondPlayerId) as { web_user_id: string } | null

      if (secondUser) {
        const secondWebUser = db.query('SELECT username FROM web_users WHERE id = ?').get(secondUser.web_user_id) as { username: string } | null
        addWebUserPointsWithLog(secondUser.web_user_id, 25, 'race_placement_2nd', {
          round_id: roundId,
          race_type: round.race_type,
          discord_user_id: secondPlayerId
        })
        console.log(`✓ Awarded 25 points to web user ${secondUser.web_user_id} (${secondWebUser?.username ?? 'unknown username'}) for 2nd place (Discord ID: ${secondPlayerId})`)
      } else {
        console.log(`⚠ No linked web account found for 2nd place (Discord ID: ${secondPlayerId}) - no points awarded`)
      }
    }
  }
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
      const confirmed = db.query("SELECT image_url FROM car_images WHERE lower(car_name) = lower(?)").get(carName) as { image_url?: string } | null
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
const carImagesPath = join(import.meta.dir, '../car-images')

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

async function serveCarImage(pathname: string): Promise<Response | null> {
  try {
    const filePath = join(carImagesPath, pathname.replace(/^\/car-images\//, ''))
    const file = await Bun.file(filePath).exists()

    if (!file) return null

    const content = await Bun.file(filePath).bytes()
    const ext = filePath.split('.').pop()

    const mimeTypes: Record<string, string> = {
      'jpg': 'image/jpeg',
      'jpeg': 'image/jpeg',
      'png': 'image/png',
      'webp': 'image/webp'
    }

    const contentType = mimeTypes[ext as string] || 'application/octet-stream'
    return new Response(content, { headers: { 'Content-Type': contentType } })
  } catch {
    return null
  }
}

// API Handlers
const handlers: Record<string, (req: Request) => Response | Promise<Response>> = {
  // Register a web user
  '/api/auth/register': async (req) => {
    if (req.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 })
    }

    const body = await req.json() as { username?: string; password?: string }
    const username = (body.username ?? '').trim().toLowerCase()
    const password = body.password ?? ''

    if (!username || !password) {
      return new Response(JSON.stringify({ error: 'Missing username or password' }), { status: 400 })
    }

    if (username.length < 3 || password.length < 6) {
      return new Response(JSON.stringify({ error: 'Username must be 3+ chars and password must be 6+ chars' }), { status: 400 })
    }

    const existingUser = db.query('SELECT id FROM web_users WHERE lower(username) = lower(?)').get(username) as { id: string } | null
    if (existingUser) {
      return new Response(JSON.stringify({ error: 'Username already exists' }), { status: 409 })
    }

    const passwordHash = await Bun.password.hash(password, {
      algorithm: 'bcrypt',
      cost: 10
    })
    const userId = randomUUID()
    const now = Date.now()
    db.prepare('INSERT INTO web_users (id, username, password_hash, points, created_at) VALUES (?, ?, ?, 100, ?)')
      .run(userId, username, passwordHash, now)

    const token = `${randomUUID()}-${randomUUID()}`
    const expiresAt = now + 1000 * 60 * 60 * 24 * 30
    db.prepare('INSERT INTO auth_sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
      .run(token, userId, now, expiresAt)

    return new Response(JSON.stringify({
      token,
      user: {
        id: userId,
        username,
        points: 100
      }
    }), {
      headers: { 'Content-Type': 'application/json' }
    })
  },

  // Login existing web user
  '/api/auth/login': async (req) => {
    if (req.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 })
    }

    const body = await req.json() as { username?: string; password?: string }
    const username = (body.username ?? '').trim().toLowerCase()
    const password = body.password ?? ''

    if (!username || !password) {
      return new Response(JSON.stringify({ error: 'Missing username or password' }), { status: 400 })
    }

    const user = db.query('SELECT id, username, password_hash, points FROM web_users WHERE lower(username) = lower(?)')
      .get(username) as { id: string; username: string; password_hash: string; points: number } | null

    if (!user) {
      return new Response(JSON.stringify({ error: 'Invalid credentials' }), { status: 401 })
    }

    const isValidPassword = await Bun.password.verify(password, user.password_hash, 'bcrypt')
    if (!isValidPassword) {
      return new Response(JSON.stringify({ error: 'Invalid credentials' }), { status: 401 })
    }

    const now = Date.now()
    const token = `${randomUUID()}-${randomUUID()}`
    const expiresAt = now + 1000 * 60 * 60 * 24 * 30
    db.prepare('INSERT INTO auth_sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
      .run(token, user.id, now, expiresAt)

    return new Response(JSON.stringify({
      token,
      user: {
        id: user.id,
        username: user.username,
        points: user.points
      }
    }), {
      headers: { 'Content-Type': 'application/json' }
    })
  },

  '/api/auth/me': (req) => {
    settleFinishedBets()
    const user = getAuthenticatedUser(req)
    if (!user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
    }

    return new Response(JSON.stringify({ user }), {
      headers: { 'Content-Type': 'application/json' }
    })
  },

  '/api/auth/points-history': (req) => {
    settleFinishedBets()
    const user = getAuthenticatedUser(req)
    if (!user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
    }

    const history = db.query(`
      SELECT id, source, before_points, after_points, delta, created_at
      FROM web_user_points_log
      WHERE user_id = ?
        AND delta > 0
        AND source IN ('bet_payout', 'race_placement_1st', 'race_placement_2nd')
      ORDER BY created_at ASC
    `).all(user.id)

    return new Response(JSON.stringify({ history }), {
      headers: { 'Content-Type': 'application/json' }
    })
  },

  '/api/auth/logout': (req) => {
    if (req.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 })
    }

    const token = getBearerToken(req)
    if (token) {
      db.prepare('DELETE FROM auth_sessions WHERE token = ?').run(token)
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { 'Content-Type': 'application/json' }
    })
  },

  '/api/auth/link-discord': async (req) => {
    if (req.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 })
    }

    const user = getAuthenticatedUser(req)
    if (!user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
    }

    const body = await req.json() as { discord_user_id?: string }
    const discordUserId = (body.discord_user_id ?? '').trim()

    if (!discordUserId) {
      return new Response(JSON.stringify({ error: 'Missing discord_user_id' }), { status: 400 })
    }

    // Verify the Discord user exists in players table
    const discordUser = db.query(`
      SELECT id, display_name FROM players WHERE id = ?
      LIMIT 1
    `).get(discordUserId) as { id: string; display_name: string } | null

    if (!discordUser) {
      return new Response(JSON.stringify({ error: 'Discord user not found. Make sure they have participated in a race.' }), { status: 404 })
    }

    const now = Date.now()
    try {
      db.prepare(`
        INSERT INTO web_users_discord (web_user_id, discord_username, discord_user_id, linked_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(web_user_id)
        DO UPDATE SET discord_username = excluded.discord_username, discord_user_id = excluded.discord_user_id, linked_at = excluded.linked_at
      `).run(user.id, discordUser.display_name, discordUser.id, now)

      const linked = db.query('SELECT discord_username, discord_user_id FROM web_users_discord WHERE web_user_id = ?')
        .get(user.id) as { discord_username: string; discord_user_id: string } | null
      const avatar = linked?.discord_user_id
        ? db.query('SELECT avatar_url FROM discord_avatars WHERE player_id = ?').get(linked.discord_user_id) as { avatar_url: string } | null
        : null

      return new Response(JSON.stringify({
        ok: true,
        discord_username: linked?.discord_username,
        discord_user_id: linked?.discord_user_id,
        avatar_url: avatar?.avatar_url ?? null
      }), {
        headers: { 'Content-Type': 'application/json' }
      })
    } catch (error) {
      console.error('Error linking discord:', error)
      return new Response(JSON.stringify({ error: 'Failed to link discord account' }), { status: 500 })
    }
  },

  '/api/auth/discord-link': (req) => {
    const user = getAuthenticatedUser(req)
    if (!user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
    }

    const link = db.query('SELECT discord_username, discord_user_id FROM web_users_discord WHERE web_user_id = ?')
      .get(user.id) as { discord_username: string; discord_user_id: string } | null
    const avatar = link?.discord_user_id
      ? db.query('SELECT avatar_url FROM discord_avatars WHERE player_id = ?').get(link.discord_user_id) as { avatar_url: string } | null
      : null

    return new Response(JSON.stringify({
      discord_username: link?.discord_username || null,
      discord_user_id: link?.discord_user_id || null,
      avatar_url: avatar?.avatar_url || null
    }), {
      headers: { 'Content-Type': 'application/json' }
    })
  },

  '/api/auth/unlink-discord': (req) => {
    if (req.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 })
    }

    const user = getAuthenticatedUser(req)
    if (!user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
    }

    try {
      db.prepare('DELETE FROM web_users_discord WHERE web_user_id = ?').run(user.id)
      return new Response(JSON.stringify({ ok: true }), {
        headers: { 'Content-Type': 'application/json' }
      })
    } catch (error) {
      console.error('Error unlinking discord:', error)
      return new Response(JSON.stringify({ error: 'Failed to unlink discord account' }), { status: 500 })
    }
  },

  '/api/auth/update-username': async (req) => {
    if (req.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 })
    }

    const user = getAuthenticatedUser(req)
    if (!user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
    }

    const body = await req.json() as { username?: string }
    const newUsername = (body.username ?? '').trim()

    if (!newUsername) {
      return new Response(JSON.stringify({ error: 'Username cannot be empty' }), { status: 400 })
    }

    if (newUsername.length < 3) {
      return new Response(JSON.stringify({ error: 'Username must be at least 3 characters' }), { status: 400 })
    }

    if (newUsername.length > 32) {
      return new Response(JSON.stringify({ error: 'Username must be 32 characters or less' }), { status: 400 })
    }

    // Check if username is already taken
    const existing = db.query('SELECT id FROM web_users WHERE username = ? AND id != ?')
      .get(newUsername, user.id) as { id: string } | null

    if (existing) {
      return new Response(JSON.stringify({ error: 'Username is already taken' }), { status: 400 })
    }

    try {
      db.prepare('UPDATE web_users SET username = ? WHERE id = ?').run(newUsername, user.id)

      const updatedUser = db.query('SELECT id, username, points FROM web_users WHERE id = ?')
        .get(user.id) as { id: string; username: string; points: number } | null

      return new Response(JSON.stringify({ user: updatedUser }), {
        headers: { 'Content-Type': 'application/json' }
      })
    } catch (error) {
      console.error('Error updating username:', error)
      return new Response(JSON.stringify({ error: 'Failed to update username' }), { status: 500 })
    }
  },

  '/api/admin/login': async (req) => {
    if (req.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 })
    }

    if (!ADMIN_PASSWORD) {
      return new Response(JSON.stringify({ error: 'Points management is not configured on the server' }), { status: 503 })
    }

    const body = await req.json() as { password?: string }
    const password = (body.password ?? '').trim()

    if (!password) {
      return new Response(JSON.stringify({ error: 'Missing password' }), { status: 400 })
    }

    if (password !== ADMIN_PASSWORD) {
      return new Response(JSON.stringify({ error: 'Invalid password' }), { status: 401 })
    }

    const token = `${randomUUID()}-${randomUUID()}`
    const expiresAt = Date.now() + ADMIN_SESSION_TTL_MS
    adminSessions.set(token, expiresAt)

    return new Response(JSON.stringify({ token, expires_at: expiresAt }), {
      headers: { 'Content-Type': 'application/json' }
    })
  },

  '/api/admin/logout': (req) => {
    if (req.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 })
    }

    const token = getBearerToken(req)
    if (token) {
      adminSessions.delete(token)
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { 'Content-Type': 'application/json' }
    })
  },

  '/api/admin/verify': (req) => {
    const unauthorized = requireAuthenticatedAdmin(req)
    if (unauthorized) return unauthorized

    return new Response(JSON.stringify({ ok: true }), {
      headers: { 'Content-Type': 'application/json' }
    })
  },

  '/api/admin/users': (req) => {
    const unauthorized = requireAuthenticatedAdmin(req)
    if (unauthorized) return unauthorized

    const users = db.query(`
      SELECT id, username, points, created_at
      FROM web_users
      ORDER BY points DESC, username ASC
    `).all()

    return new Response(JSON.stringify({ users }), {
      headers: { 'Content-Type': 'application/json' }
    })
  },

  '/api/admin/users/:id/points': async (req) => {
    if (req.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 })
    }

    const unauthorized = requireAuthenticatedAdmin(req)
    if (unauthorized) return unauthorized

    const url = new URL(req.url)
    const userId = url.pathname.split('/')[4]
    if (!userId) {
      return new Response(JSON.stringify({ error: 'Missing user id' }), { status: 400 })
    }

    const body = await req.json() as { points?: number }
    const points = Number(body.points)

    if (!Number.isInteger(points) || points < 0) {
      return new Response(JSON.stringify({ error: 'Points must be a non-negative integer' }), { status: 400 })
    }

    const existing = db.query('SELECT id FROM web_users WHERE id = ? LIMIT 1').get(userId) as { id: string } | null
    if (!existing) {
      return new Response(JSON.stringify({ error: 'User not found' }), { status: 404 })
    }

    const adminSession = getAuthenticatedAdminToken(req)
    setWebUserPointsWithLog(userId, points, 'admin_panel_set', {
      admin_session: adminSession ? adminSession.slice(0, 8) : null
    })

    const user = db.query('SELECT id, username, points, created_at FROM web_users WHERE id = ? LIMIT 1')
      .get(userId)

    return new Response(JSON.stringify({ user }), {
      headers: { 'Content-Type': 'application/json' }
    })
  },

  '/api/admin/points-log': (req) => {
    const unauthorized = requireAuthenticatedAdmin(req)
    if (unauthorized) return unauthorized

    const logs = db.query(`
      SELECT
        l.id,
        l.user_id,
        wu.username,
        l.source,
        l.before_points,
        l.after_points,
        l.delta,
        l.metadata,
        l.created_at
      FROM web_user_points_log l
      JOIN web_users wu ON wu.id = l.user_id
      ORDER BY l.created_at DESC
      LIMIT 200
    `).all()

    return new Response(JSON.stringify({ logs }), {
      headers: { 'Content-Type': 'application/json' }
    })
  },

  '/api/bets/lock/:roundId': (req) => {
    if (req.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 })
    }

    const url = new URL(req.url)
    const roundId = url.pathname.split('/')[4]

    if (!roundId) {
      return new Response(JSON.stringify({ error: 'Missing roundId' }), { status: 400 })
    }

    try {
      lockBetsForRound(roundId)
      return new Response(JSON.stringify({ ok: true }), {
        headers: { 'Content-Type': 'application/json' }
      })
    } catch (error) {
      console.error('Error locking bets:', error)
      return new Response(JSON.stringify({ error: 'Failed to lock bets' }), { status: 500 })
    }
  },

  '/api/bets/settle/:roundId': (req) => {
    if (req.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 })
    }

    const url = new URL(req.url)
    const roundId = url.pathname.split('/')[4]

    if (!roundId) {
      return new Response(JSON.stringify({ error: 'Missing roundId' }), { status: 400 })
    }

    console.log(`📊 API: Settling bets for round ${roundId}...`)
    try {
      // Settle bets for this specific round
      const pendingBets = db.query(`
        SELECT b.id, b.round_id, b.user_id, b.predicted_player_id, b.points_wagered, r.winner_id
        FROM bets b
        JOIN rounds r ON r.id = b.round_id
        WHERE b.status = 'locked'
          AND r.status = 'finished'
          AND r.winner_id IS NOT NULL
          AND r.id = ?
      `).all(roundId) as Array<{
        id: number
        round_id: string
        user_id: string
        predicted_player_id: string
        points_wagered: number
        winner_id: string
      }>

      if (pendingBets.length > 0) {
        const markSettledStmt = db.prepare('UPDATE bets SET status = ?, payout = ?, settled_at = ? WHERE id = ?')
        const now = Date.now()

        for (const bet of pendingBets) {
          const won = bet.predicted_player_id === bet.winner_id
          const payout = won ? bet.points_wagered * 2 : 0

          db.transaction(() => {
            if (payout > 0) {
              addWebUserPointsWithLog(bet.user_id, payout, 'bet_payout', {
                bet_id: bet.id,
                round_id: bet.round_id,
                wagered: bet.points_wagered
              })
            }
            markSettledStmt.run(won ? 'won' : 'lost', payout, now, bet.id)
          })()
        }
      }

      console.log(`✓ API: Settled ${pendingBets.length} bets for round ${roundId}`)
      return new Response(JSON.stringify({ ok: true }), {
        headers: { 'Content-Type': 'application/json' }
      })
    } catch (error) {
      console.error('❌ API: Error settling bets:', error)
      return new Response(JSON.stringify({ error: 'Failed to settle bets' }), { status: 500 })
    }
  },

  '/api/bets/award-placement/:roundId': (req) => {
    if (req.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 })
    }

    const url = new URL(req.url)
    const roundId = url.pathname.split('/')[4]

    if (!roundId) {
      return new Response(JSON.stringify({ error: 'Missing roundId' }), { status: 400 })
    }

    console.log(`🏆 API: Awarding placement points for round ${roundId}...`)
    try {
      awardPlacementPoints(roundId)
      console.log(`✓ API: Placement points awarded for round ${roundId}`)
      return new Response(JSON.stringify({ ok: true }), {
        headers: { 'Content-Type': 'application/json' }
      })
    } catch (error) {
      console.error('❌ API: Error awarding placement points:', error)
      return new Response(JSON.stringify({ error: 'Failed to award placement points' }), { status: 500 })
    }
  },

  '/api/points-history/log/:roundId': (req) => {
    if (req.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 })
    }

    const url = new URL(req.url)
    const roundId = url.pathname.split('/')[4]

    if (!roundId) {
      return new Response(JSON.stringify({ error: 'Missing roundId' }), { status: 400 })
    }

    console.log(`📊 API: Logging points history for round ${roundId}...`)
    try {
      const players = db.query(`
        SELECT DISTINCT player_id FROM round_players WHERE round_id = ?
      `).all(roundId) as Array<{ player_id: string }>

      const round = db.query(`
        SELECT created_at FROM rounds WHERE id = ?
      `).get(roundId) as { created_at: number } | null

      if (!round) {
        console.warn(`⚠️ Round ${roundId} not found`)
        return new Response(JSON.stringify({ error: 'Round not found' }), { status: 404 })
      }

      for (const { player_id } of players) {
        const roundScore = db.query(`
          SELECT points FROM round_scores WHERE round_id = ? AND player_id = ?
        `).get(roundId, player_id) as { points: number } | null

        const pointsEarned = roundScore?.points ?? 0

        // Calculate cumulative total from all rounds up to and including this one
        const cumulativeResult = db.query(`
          SELECT COALESCE(SUM(rs.points), 0) as total
          FROM round_scores rs
          JOIN rounds r ON r.id = rs.round_id
          WHERE rs.player_id = ? 
            AND r.created_at <= (SELECT created_at FROM rounds WHERE id = ?)
            AND r.status = 'finished'
        `).get(player_id, roundId) as { total: number } | null

        const totalPoints = cumulativeResult?.total ?? 0

        try {
          db.prepare(`
            INSERT OR REPLACE INTO player_points_history
            (player_id, round_id, points_earned, total_points, created_at)
            VALUES (?, ?, ?, ?, ?)
          `).run(player_id, roundId, pointsEarned, totalPoints, Math.floor(Date.now() / 1000))
        } catch (error) {
          console.error(`⚠️ Error logging points for player ${player_id}:`, error)
        }
      }

      console.log(`✓ API: Points history logged for round ${roundId}`)
      return new Response(JSON.stringify({ ok: true }), {
        headers: { 'Content-Type': 'application/json' }
      })
    } catch (error) {
      console.error('❌ API: Error logging points history:', error)
      return new Response(JSON.stringify({ error: 'Failed to log points history' }), { status: 500 })
    }
  },

  // Leaderboard - top 10 users by points
  '/api/leaderboard': () => {
    settleFinishedBets()
    const result = db.query(`
      SELECT 
        wu.id,
        wu.username,
        wu.points,
        wud.discord_user_id as linked_player_id,
        da.avatar_url,
        COUNT(b.id) as total_bets,
        SUM(CASE WHEN b.status = 'won' THEN 1 ELSE 0 END) as won_bets
      FROM web_users wu
      LEFT JOIN bets b ON b.user_id = wu.id
      LEFT JOIN web_users_discord wud ON wud.web_user_id = wu.id
      LEFT JOIN discord_avatars da ON da.player_id = wud.discord_user_id
      GROUP BY wu.id
      ORDER BY wu.points DESC, wu.username ASC
      LIMIT 50
    `).all()

    return new Response(JSON.stringify(result || []), {
      headers: { 'Content-Type': 'application/json' }
    })
  },

  // Individual player stats and details
  '/api/player/:id': (req) => {
    const url = new URL(req.url)
    const playerId = url.pathname.split('/')[3]

    const player = db.query(`
      SELECT p.*, da.avatar_url
      FROM players p
      LEFT JOIN discord_avatars da ON da.player_id = p.id
      WHERE p.id = ?
      LIMIT 1
    `).get(playerId)
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
        t.created_at,
        ci.image_url as confirmed_image_url
      FROM times t
      JOIN races r ON t.race_id = r.id
      LEFT JOIN car_images ci ON lower(t.car_name) = lower(ci.car_name)
      WHERE t.player_id = ?
      ORDER BY t.created_at DESC
    `).all(playerId)

    const carNames = new Set<string>()
    for (const time of times as Array<{ car_name?: string }>) {
      if (time.car_name) carNames.add(time.car_name)
    }
    for (const game of games as Array<{ car_name?: string }>) {
      if (game.car_name) carNames.add(game.car_name)
    }

    const confirmedImages = carNames.size
      ? db.query(
          `SELECT car_name, image_url FROM car_images WHERE lower(car_name) IN (${[...carNames].map(() => 'lower(?)').join(', ')})`
        ).all(...[...carNames])
      : []

    // Build points progression from web_user_points_log (used by /points admin panel)
    const linkedWebUser = db.query(`
      SELECT web_user_id
      FROM web_users_discord
      WHERE discord_user_id = ?
      LIMIT 1
    `).get(playerId) as { web_user_id: string } | null

    let pointsProgressionData: Array<{ date: number; cumulative_points: number; round_points: number }> = []

    if (linkedWebUser) {
      const logs = db.query(`
        SELECT before_points, delta, created_at
        FROM web_user_points_log
        WHERE user_id = ?
          AND delta > 0
          AND source IN ('bet_payout', 'race_placement_1st', 'race_placement_2nd')
        ORDER BY created_at ASC
      `).all(linkedWebUser.web_user_id) as Array<{ before_points: number; delta: number; created_at: number }>

      if (logs.length > 0) {
        const startPoints = logs[0].before_points
        pointsProgressionData.push({
          date: logs[0].created_at,
          cumulative_points: startPoints,
          round_points: 0
        })

        let runningPoints = startPoints
        for (const log of logs) {
          runningPoints += log.delta
          pointsProgressionData.push({
            date: log.created_at,
            cumulative_points: runningPoints,
            round_points: log.delta
          })
        }
      }
    }

    return new Response(JSON.stringify({ player, stats, games, times, confirmed_images: confirmedImages, points_progression: pointsProgressionData }), {
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

    const scores = db.query(`
      SELECT
        rs.player_id,
        p.display_name,
        rs.points
      FROM round_scores rs
      JOIN players p ON rs.player_id = p.id
      WHERE rs.round_id = ?
      ORDER BY rs.points DESC, p.display_name ASC
    `).all(gameId)

    return new Response(JSON.stringify({ ...game, players, scores }), {
      headers: { 'Content-Type': 'application/json' }
    })
  },

  // Current active round
  '/api/current-round': (req) => {
    settleFinishedBets()
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
        da.avatar_url,
        ci.image_url as confirmed_image_url
      FROM round_players rp
      JOIN players p ON rp.player_id = p.id
      LEFT JOIN car_choices cc ON rp.round_id = cc.round_id AND rp.player_id = cc.player_id
      LEFT JOIN discord_avatars da ON p.id = da.player_id
      LEFT JOIN car_images ci ON lower(cc.car_name) = lower(ci.car_name)
      WHERE rp.round_id = ?
      ORDER BY p.display_name ASC
    `).all(result.id)

    const scores = db.query(`
      SELECT
        rs.player_id,
        p.display_name,
        rs.points
      FROM round_scores rs
      JOIN players p ON rs.player_id = p.id
      WHERE rs.round_id = ?
      ORDER BY rs.points DESC, p.display_name ASC
    `).all(result.id)

    let seriesRace: string | null = null
    if (result.race_type?.toLowerCase() === 'all') {
      const baseSequence = ['drag', 'circuit', 'rally', 'goliath']
      const completed = db.query(
        "SELECT COUNT(DISTINCT race_index) as count FROM round_race_results WHERE round_id = ?"
      ).get(result.id) as { count?: number } | null
      const completedCount = completed?.count ?? 0

      seriesRace = baseSequence[completedCount] ?? null

      if (!seriesRace && completedCount === baseSequence.length) {
        const topScore = db.query(
          "SELECT points FROM round_scores WHERE round_id = ? ORDER BY points DESC LIMIT 1"
        ).get(result.id) as { points?: number } | null
        if (topScore?.points !== undefined) {
          const tied = db.query(
            "SELECT COUNT(*) as tied FROM round_scores WHERE round_id = ? AND points = ?"
          ).get(result.id, topScore.points) as { tied?: number } | null
          if ((tied?.tied ?? 0) > 1) {
            seriesRace = 'offroad'
          }
        }
      }
    }

    const authUser = getAuthenticatedUser(req)
    const userBets = authUser
      ? db.query(`
          SELECT
            b.id,
            b.predicted_player_id,
            b.points_wagered,
            b.status,
            b.payout
          FROM bets b
          WHERE b.round_id = ? AND b.user_id = ?
          ORDER BY b.created_at DESC
        `).all(result.id, authUser.id)
      : []

    // Get all bets for this round (visible to everyone)
    const allBets = db.query(`
      SELECT
        b.id,
        b.user_id,
        b.predicted_player_id,
        b.points_wagered,
        b.status,
        b.payout,
        wu.username
      FROM bets b
      JOIN web_users wu ON b.user_id = wu.id
      WHERE b.round_id = ?
      ORDER BY b.created_at DESC
    `).all(result.id)

    return new Response(JSON.stringify({ ...result, players, scores, series_race: seriesRace, user_bets: userBets, all_bets: allBets }), {
      headers: { 'Content-Type': 'application/json' }
    })
  },

  '/api/bets/current': (req) => {
    settleFinishedBets()
    const user = getAuthenticatedUser(req)
    if (!user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
    }

    const activeRound = db.query(`
      SELECT id
      FROM rounds
      WHERE (status = 'pending' OR status = 'active') AND winner_id IS NULL
      LIMIT 1
    `).get() as { id: string } | null

    if (!activeRound) {
      return new Response(JSON.stringify({ bet: null, user }), {
        headers: { 'Content-Type': 'application/json' }
      })
    }

    const bet = db.query(`
      SELECT id, round_id, predicted_player_id, points_wagered, status, payout
      FROM bets
      WHERE round_id = ? AND user_id = ?
      LIMIT 1
    `).get(activeRound.id, user.id)

    return new Response(JSON.stringify({ bet, user }), {
      headers: { 'Content-Type': 'application/json' }
    })
  },

  '/api/bets/place': async (req) => {
    if (req.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 })
    }

    settleFinishedBets()
    const user = getAuthenticatedUser(req)
    if (!user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
    }

    const body = await req.json() as { roundId?: string; predictedPlayerId?: string; points?: number }
    const roundId = (body.roundId ?? '').trim()
    const predictedPlayerId = (body.predictedPlayerId ?? '').trim()
    const points = Number(body.points)

    if (!roundId || !predictedPlayerId || !Number.isInteger(points) || points <= 0) {
      return new Response(JSON.stringify({ error: 'Invalid bet payload' }), { status: 400 })
    }

    const activeRound = db.query(`
      SELECT id
      FROM rounds
      WHERE id = ?
        AND (status = 'pending' OR status = 'active')
        AND winner_id IS NULL
      LIMIT 1
    `).get(roundId) as { id: string } | null

    if (!activeRound) {
      return new Response(JSON.stringify({ error: 'Round is not available for betting' }), { status: 400 })
    }

    const playerInRound = db.query(`
      SELECT 1 as exists_flag
      FROM round_players
      WHERE round_id = ? AND player_id = ?
      LIMIT 1
    `).get(roundId, predictedPlayerId) as { exists_flag: number } | null

    if (!playerInRound) {
      return new Response(JSON.stringify({ error: 'Selected player is not in this round' }), { status: 400 })
    }

    const now = Date.now()
    let updatedUser: AuthUser | null = null
    let betRecord: { id: number; round_id: string; predicted_player_id: string; points_wagered: number; status: string; payout: number } | null = null

    try {
      db.transaction(() => {
        const currentUser = db.query('SELECT id, username, points FROM web_users WHERE id = ? LIMIT 1')
          .get(user.id) as AuthUser | null

        if (!currentUser) {
          throw new Error('USER_NOT_FOUND')
        }

        const existingBet = db.query(`
          SELECT id, points_wagered
          FROM bets
          WHERE round_id = ? AND user_id = ? AND predicted_player_id = ? AND status = 'pending'
          LIMIT 1
        `).get(roundId, user.id, predictedPlayerId) as { id: number; points_wagered: number } | null

        const totalWageredOnRound = db.query(`
          SELECT SUM(points_wagered) as total
          FROM bets
          WHERE round_id = ? AND user_id = ? AND status = 'pending'
        `).get(roundId, user.id) as { total: number | null } | null

        const currentWagered = totalWageredOnRound?.total ?? 0
        const availablePoints = currentUser.points + (existingBet?.points_wagered ?? 0)
        
        if (points > availablePoints) {
          throw new Error('INSUFFICIENT_POINTS')
        }

        if (existingBet) {
          db.prepare('UPDATE web_users SET points = points + ? WHERE id = ?').run(existingBet.points_wagered, user.id)
        }

        db.prepare('UPDATE web_users SET points = points - ? WHERE id = ?').run(points, user.id)

        // Delete existing bet for this round/player/user combination, then insert new one
        db.prepare('DELETE FROM bets WHERE round_id = ? AND user_id = ? AND predicted_player_id = ?').run(roundId, user.id, predictedPlayerId)
        
        db.prepare(`
          INSERT INTO bets (round_id, user_id, predicted_player_id, points_wagered, status, payout, created_at, settled_at)
          VALUES (?, ?, ?, ?, 'pending', 0, ?, NULL)
        `).run(roundId, user.id, predictedPlayerId, points, now)

        updatedUser = db.query('SELECT id, username, points FROM web_users WHERE id = ? LIMIT 1').get(user.id) as AuthUser | null
        betRecord = db.query(`
          SELECT id, round_id, predicted_player_id, points_wagered, status, payout
          FROM bets
          WHERE round_id = ? AND user_id = ? AND predicted_player_id = ?
          LIMIT 1
        `).get(roundId, user.id, predictedPlayerId) as { id: number; round_id: string; predicted_player_id: string; points_wagered: number; status: string; payout: number } | null
      })()
    } catch (error) {
      if ((error as Error).message === 'INSUFFICIENT_POINTS') {
        return new Response(JSON.stringify({ error: 'Not enough points' }), { status: 400 })
      }
      if ((error as Error).message === 'USER_NOT_FOUND') {
        return new Response(JSON.stringify({ error: 'User not found' }), { status: 404 })
      }
      throw error
    }

    if (!updatedUser || !betRecord) {
      return new Response(JSON.stringify({ error: 'Failed to place bet' }), { status: 500 })
    }

    return new Response(JSON.stringify({ user: updatedUser, bet: betRecord }), {
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
        t.created_at,
        ci.image_url as confirmed_image_url
      FROM times t
      JOIN players p ON t.player_id = p.id
      JOIN races r ON t.race_id = r.id
      LEFT JOIN car_images ci ON lower(t.car_name) = lower(ci.car_name)
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

  // Fastest lap time (current best)
  '/api/fastest-time': () => {
    const result = db.query(`
      SELECT
        t.id,
        t.car_name,
        t.laptime as time_ms,
        r.name as race_name
      FROM times t
      JOIN races r ON t.race_id = r.id
      WHERE t.is_historic = 0
      ORDER BY t.laptime ASC
      LIMIT 1
    `).get()

    if (!result) {
      return new Response(JSON.stringify({ error: 'No times found' }), { status: 404 })
    }

    return new Response(JSON.stringify(result), {
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
    if (req.method !== 'GET') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 })
    }
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
        const carName = body?.carName?.trim()
        if (!carName || !body?.imageUrl) {
          return new Response(JSON.stringify({ error: 'Missing carName or imageUrl' }), { status: 400 })
        }

        await mkdir(carImagesPath, { recursive: true })

        const slug = carName
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/(^-|-$)/g, '')

        const imageResponse = await fetch(body.imageUrl)
        if (!imageResponse.ok) {
          return new Response(JSON.stringify({ error: 'Failed to download image' }), { status: 400 })
        }

        const contentType = imageResponse.headers.get('content-type') || ''
        const extensionMap: Record<string, string> = {
          'image/jpeg': 'jpg',
          'image/png': 'png',
          'image/webp': 'webp'
        }
        const extension = extensionMap[contentType] || 'jpg'
        const filename = `${slug || 'car'}-${Date.now()}.${extension}`
        const filePath = join(carImagesPath, filename)
        const buffer = new Uint8Array(await imageResponse.arrayBuffer())
        await Bun.write(filePath, buffer)
        const previous = db.query("SELECT image_url FROM car_images WHERE lower(car_name) = lower(?)").get(carName) as { image_url?: string } | null
        if (previous?.image_url && previous.image_url.startsWith('/car-images/')) {
          const previousFile = join(carImagesPath, previous.image_url.replace('/car-images/', ''))
          if (previousFile !== filePath) {
            await unlink(previousFile).catch(() => undefined)
          }
        }

        const localUrl = `/car-images/${filename}`

        const stmt = db.prepare(
          "INSERT INTO car_images (car_name, image_url, confirmed_at) VALUES (?, ?, ?) ON CONFLICT(car_name) DO UPDATE SET image_url = ?, confirmed_at = ?"
        )
        stmt.run(carName, localUrl, Date.now(), localUrl, Date.now())

        return new Response(JSON.stringify({ ok: true, imageUrl: localUrl }), {
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
        const carName = body?.carName?.trim()
        if (!carName) {
          return new Response(JSON.stringify({ error: 'Missing carName' }), { status: 400 })
        }

        db.prepare("DELETE FROM car_images WHERE lower(car_name) = lower(?)").run(carName)

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
    let pathname = url.pathname

    if (pathname.length > 1 && pathname.endsWith('/')) {
      pathname = pathname.slice(0, -1)
    }

    const exactHandler = handlers[pathname]
    if (exactHandler) {
      try {
        return await exactHandler(req)
      } catch (error) {
        console.error(`Error in ${pathname}:`, error)
        return new Response(JSON.stringify({ error: 'Internal server error' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        })
      }
    }

    if (pathname.startsWith('/car-images/')) {
      const imageResponse = await serveCarImage(pathname)
      if (imageResponse) return imageResponse
    }

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
