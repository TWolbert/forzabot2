import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { Shield, RefreshCw, Save, LogOut, Loader2 } from 'lucide-react'
import {
  adminLogin,
  adminLogout,
  adminVerify,
  getPointsManagementUsers,
  readAdminToken,
  updateUserPoints
} from '../api'

type ManagedUser = {
  id: string
  username: string
  points: number
  created_at: number
}

export function PointsManagement() {
  const [password, setPassword] = useState('')
  const [authenticating, setAuthenticating] = useState(false)
  const [authenticated, setAuthenticated] = useState(false)
  const [loadingUsers, setLoadingUsers] = useState(false)
  const [users, setUsers] = useState<ManagedUser[]>([])
  const [pointsDrafts, setPointsDrafts] = useState<Record<string, string>>({})
  const [savingByUserId, setSavingByUserId] = useState<Record<string, boolean>>({})
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const sortedUsers = useMemo(
    () => [...users].sort((a, b) => b.points - a.points || a.username.localeCompare(b.username)),
    [users]
  )

  const loadUsers = async () => {
    setLoadingUsers(true)
    setError(null)

    try {
      const data = await getPointsManagementUsers()
      setUsers(data.users)
      const drafts: Record<string, string> = {}
      for (const user of data.users) {
        drafts[user.id] = String(user.points)
      }
      setPointsDrafts(drafts)
    } catch (loadError) {
      setError((loadError as Error).message)
    } finally {
      setLoadingUsers(false)
    }
  }

  useEffect(() => {
    const token = readAdminToken()
    if (!token) return

    adminVerify()
      .then(async () => {
        setAuthenticated(true)
        await loadUsers()
      })
      .catch(async () => {
        setAuthenticated(false)
        await adminLogout()
      })
  }, [])

  const handleLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)
    setMessage(null)
    setAuthenticating(true)

    try {
      await adminLogin(password)
      setPassword('')
      setAuthenticated(true)
      await loadUsers()
    } catch (loginError) {
      setAuthenticated(false)
      setError((loginError as Error).message)
    } finally {
      setAuthenticating(false)
    }
  }

  const handleLogout = async () => {
    await adminLogout()
    setAuthenticated(false)
    setUsers([])
    setPointsDrafts({})
    setMessage('Signed out from points management')
  }

  const handlePointsSave = async (userId: string) => {
    const value = pointsDrafts[userId]?.trim() ?? ''
    const parsed = Number(value)

    if (!Number.isInteger(parsed) || parsed < 0) {
      setError('Points must be a non-negative integer')
      return
    }

    setError(null)
    setMessage(null)
    setSavingByUserId(prev => ({ ...prev, [userId]: true }))

    try {
      const response = await updateUserPoints(userId, parsed)
      setUsers(prev => prev.map(user => (user.id === userId ? response.user : user)))
      setMessage(`Updated points for ${response.user.username}`)
    } catch (saveError) {
      setError((saveError as Error).message)
    } finally {
      setSavingByUserId(prev => ({ ...prev, [userId]: false }))
    }
  }

  if (!authenticated) {
    return (
      <div className="min-h-screen bg-black">
        <main className="max-w-xl mx-auto px-4 py-10">
          <div className="bg-gradient-to-br from-gray-900 to-gray-800 rounded-xl p-8 border-4 border-orange-500 drop-shadow-2xl">
            <div className="flex items-center gap-2 mb-3">
              <Shield className="text-orange-400" size={28} />
              <h1 className="text-3xl font-black text-orange-400 uppercase">Points Management</h1>
            </div>
            <p className="text-gray-400 mb-6 font-bold">
              Enter the admin password configured in your server environment.
            </p>

            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label className="block text-sm font-black text-orange-300 uppercase mb-1">Admin Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={event => setPassword((event.target as { value: string }).value)}
                  className="w-full bg-gray-950 border-2 border-orange-500/40 rounded-lg px-3 py-2 text-white font-bold focus:outline-none focus:border-orange-400"
                  autoComplete="current-password"
                  required
                />
              </div>

              {error && <p className="text-red-400 font-bold text-sm">{error}</p>}

              <button
                type="submit"
                disabled={authenticating}
                className="w-full bg-orange-500 hover:bg-orange-400 disabled:opacity-60 text-white font-black py-3 rounded-lg transition"
              >
                {authenticating ? 'Checking...' : 'Access Points Manager'}
              </button>
            </form>
          </div>
        </main>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-black">
      <main className="max-w-4xl mx-auto px-4 py-10">
        <div className="bg-gradient-to-br from-gray-900 to-gray-800 rounded-xl p-6 border-4 border-orange-500 drop-shadow-2xl">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <div className="flex items-center gap-2">
              <Shield className="text-orange-400" size={28} />
              <h1 className="text-3xl font-black text-orange-400 uppercase">Points Management</h1>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={loadUsers}
                disabled={loadingUsers}
                className="inline-flex items-center gap-2 bg-gray-700 hover:bg-gray-600 disabled:opacity-60 text-white font-black px-3 py-2 rounded"
              >
                <RefreshCw size={16} className={loadingUsers ? 'animate-spin' : ''} />
                Refresh
              </button>
              <button
                type="button"
                onClick={handleLogout}
                className="inline-flex items-center gap-2 bg-red-600 hover:bg-red-500 text-white font-black px-3 py-2 rounded"
              >
                <LogOut size={16} />
                Sign Out
              </button>
            </div>
          </div>

          <p className="text-gray-400 text-sm mb-4">
            Set exact points totals for web users. Changes apply immediately.
          </p>

          {error && <p className="text-red-400 font-bold mb-3">{error}</p>}
          {message && <p className="text-green-400 font-bold mb-3">{message}</p>}

          {loadingUsers ? (
            <div className="flex justify-center items-center py-12">
              <Loader2 className="animate-spin text-orange-400" size={32} />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[620px] border-collapse">
                <thead>
                  <tr className="text-left text-orange-300 text-sm uppercase">
                    <th className="border-b border-orange-500/40 pb-2">Username</th>
                    <th className="border-b border-orange-500/40 pb-2">Current Points</th>
                    <th className="border-b border-orange-500/40 pb-2">New Points</th>
                    <th className="border-b border-orange-500/40 pb-2">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedUsers.map(user => {
                    const saving = !!savingByUserId[user.id]
                    return (
                      <tr key={user.id} className="text-white">
                        <td className="py-3 border-b border-gray-700/60 font-bold">{user.username}</td>
                        <td className="py-3 border-b border-gray-700/60 font-black text-orange-300">{user.points}</td>
                        <td className="py-3 border-b border-gray-700/60">
                          <input
                            value={pointsDrafts[user.id] ?? ''}
                            onChange={event => setPointsDrafts(prev => ({ ...prev, [user.id]: (event.target as { value: string }).value }))}
                            className="w-32 bg-gray-950 border border-orange-500/40 rounded px-3 py-2 text-white font-bold focus:outline-none focus:border-orange-400"
                            inputMode="numeric"
                          />
                        </td>
                        <td className="py-3 border-b border-gray-700/60">
                          <button
                            type="button"
                            onClick={() => handlePointsSave(user.id)}
                            disabled={saving}
                            className="inline-flex items-center gap-2 bg-orange-500 hover:bg-orange-400 disabled:opacity-60 text-white font-black px-3 py-2 rounded"
                          >
                            {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                            Save
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
