import { Link, useLocation } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { Home, Trophy, Gamepad2, Clock, Zap, Shield } from 'lucide-react'
import logo from '../5a59366f-e744-498c-9142-270c4f2069d1.png'
import { getMe, logout, readAuthToken } from '../api'

interface AuthUser {
  id: string
  username: string
  points: number
}

export function Navigation() {
  const location = useLocation()
  const [hasActiveRound, setHasActiveRound] = useState(false)
  const [authUser, setAuthUser] = useState<AuthUser | null>(null)

  useEffect(() => {
    let mounted = true
    
    const checkActiveRound = async () => {
      try {
        const response = await fetch('/api/current-round')
        if (mounted) {
          setHasActiveRound(response.ok)
        }
      } catch (error) {
        if (mounted) {
          setHasActiveRound(false)
        }
      }
    }

    checkActiveRound()

    const fetchAuth = async () => {
      const token = readAuthToken()
      if (!token) {
        setAuthUser(null)
        return
      }

      try {
        const result = await getMe()
        if (mounted) {
          setAuthUser(result.user)
        }
      } catch {
        if (mounted) {
          setAuthUser(null)
        }
      }
    }

    fetchAuth()

    const onAuthChanged = () => {
      fetchAuth()
    }

    const onStorage = (event: StorageEvent) => {
      if (event.key === 'forzabot-auth-token') {
        fetchAuth()
      }
    }

    window.addEventListener('forzabot-auth-changed', onAuthChanged)
    window.addEventListener('storage', onStorage)

    // Check every 5 seconds for active round status
    const interval = setInterval(checkActiveRound, 5000)
    
    return () => {
      mounted = false
      clearInterval(interval)
      window.removeEventListener('forzabot-auth-changed', onAuthChanged)
      window.removeEventListener('storage', onStorage)
    }
  }, [])

  const isActive = (path: string) => {
    if (path === '/') return location.pathname === '/'
    return location.pathname === path || location.pathname.startsWith(path + '/')
  }

  const handleLogout = async () => {
    await logout()
    setAuthUser(null)
  }

  return (
    <nav className="bg-gradient-to-r from-red-700 via-orange-600 to-yellow-600 text-white shadow-2xl border-b-4 border-orange-400">
      <div className="max-w-7xl mx-auto px-4 py-3">
        <div className="flex items-center justify-between gap-6">
          <Link to="/" className="flex items-center gap-2 hover:opacity-80 transition">
            <img src={logo} alt="ForzaBot Logo" className="h-12" />
            <span className="text-2xl font-black hidden sm:inline">FORZABOT</span>
          </Link>
          
          <div className="flex gap-1 items-center">
            {hasActiveRound && (
              <Link
                to="/active-round"
                className={`flex items-center gap-2 px-4 py-2 font-bold transition transform hover:scale-110 animate-pulse ${
                  location.pathname === '/active-round'
                    ? 'bg-white text-red-600 shadow-lg'
                    : 'bg-red-600 hover:bg-red-700 shadow-lg'
                }`}
                style={{clipPath: 'polygon(0 0, calc(100% - 10px) 0, 100% 10px, 100% 100%, 0 100%)'}}
                title="Active game in progress!"
              >
                <Zap size={18} />
                LIVE
              </Link>
            )}
            <Link
              to="/"
              className={`flex items-center gap-2 px-4 py-2 font-bold transition transform hover:scale-110 ${
                location.pathname === '/'
                  ? 'bg-white text-orange-600 shadow-lg'
                  : 'hover:bg-orange-500 hover:shadow-lg'
              }`}
              style={{clipPath: 'polygon(0 0, calc(100% - 10px) 0, 100% 10px, 100% 100%, 0 100%)'}}
            >
              <Home size={18} />
              HOME
            </Link>
            <Link
              to="/leaderboard"
              className={`flex items-center gap-2 px-4 py-2 font-bold transition transform hover:scale-110 ${
                isActive('/leaderboard')
                  ? 'bg-white text-green-600 shadow-lg'
                  : 'hover:bg-orange-500 hover:shadow-lg'
              }`}
              style={{clipPath: 'polygon(10px 0, 100% 0, 100% 100%, 0 100%, 0 10px)'}}
            >
              <Trophy size={18} />
              BOARD
            </Link>
            <Link
              to="/games"
              className={`flex items-center gap-2 px-4 py-2 font-bold transition transform hover:scale-110 ${
                isActive('/games')
                  ? 'bg-white text-yellow-600 shadow-lg'
                  : 'hover:bg-orange-500 hover:shadow-lg'
              }`}
              style={{clipPath: 'polygon(10px 0, 100% 0, 100% calc(100% - 10px), calc(100% - 10px) 100%, 0 100%, 0 10px)'}}
            >
              <Gamepad2 size={18} />
              GAMES
            </Link>
            <Link
              to="/times"
              className={`flex items-center gap-2 px-4 py-2 font-bold transition transform hover:scale-110 ${
                isActive('/times')
                  ? 'bg-white text-blue-600 shadow-lg'
                  : 'hover:bg-orange-500 hover:shadow-lg'
              }`}
              style={{clipPath: 'polygon(10px 0, 100% 0, 100% calc(100% - 10px), calc(100% - 10px) 100%, 0 100%, 0 10px)'}}
            >
              <Clock size={18} />
              TIMES
            </Link>
            <Link
              to="/points"
              className={`flex items-center gap-2 px-4 py-2 font-bold transition transform hover:scale-110 ${
                isActive('/points')
                  ? 'bg-white text-emerald-700 shadow-lg'
                  : 'hover:bg-orange-500 hover:shadow-lg'
              }`}
              style={{clipPath: 'polygon(10px 0, 100% 0, 100% calc(100% - 10px), calc(100% - 10px) 100%, 0 100%, 0 10px)'}}
            >
              <Shield size={18} />
              POINTS
            </Link>

            {authUser ? (
              <>
                <Link
                  to="/profile"
                  className={`flex items-center gap-2 px-4 py-2 font-bold transition transform hover:scale-110 ${
                    location.pathname === '/profile'
                      ? 'bg-white text-purple-600 shadow-lg'
                      : 'hover:bg-orange-500 hover:shadow-lg'
                  }`}
                  style={{clipPath: 'polygon(10px 0, 100% 0, 100% calc(100% - 10px), calc(100% - 10px) 100%, 0 100%, 0 10px)'}}
                  title="View your profile and link Discord"
                >
                  PROFILE
                </Link>
                <div className="px-3 py-2 bg-black/30 border border-orange-300/60 rounded text-xs font-black">
                  {authUser.username} • {authUser.points} pts
                </div>
                <button
                  type="button"
                  onClick={handleLogout}
                  className="px-3 py-2 font-bold hover:bg-orange-500 hover:shadow-lg transition"
                  style={{clipPath: 'polygon(10px 0, 100% 0, 100% 100%, 0 100%, 0 10px)'}}
                >
                  SIGN OUT
                </button>
              </>
            ) : (
              <Link
                to="/signin"
                className={`flex items-center gap-2 px-4 py-2 font-bold transition transform hover:scale-110 ${
                  isActive('/signin')
                    ? 'bg-white text-purple-700 shadow-lg'
                    : 'hover:bg-orange-500 hover:shadow-lg'
                }`}
                style={{clipPath: 'polygon(10px 0, 100% 0, 100% 100%, 0 100%, 0 10px)'}}
              >
                SIGN IN
              </Link>
            )}
          </div>
        </div>
      </div>
    </nav>
  )
}
