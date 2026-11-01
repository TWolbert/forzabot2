import { FormEvent, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getMe, login, register, readAuthToken } from '../api'

export function SignIn() {
  const navigate = useNavigate()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [mode, setMode] = useState<'signin' | 'register'>('signin')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const token = readAuthToken()
    if (!token) return

    getMe()
      .then(() => navigate('/active-round'))
      .catch(() => {
        // ignore invalid token, user can sign in again
      })
  }, [navigate])

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)
    setLoading(true)

    try {
      if (mode === 'signin') {
        await login(username, password)
      } else {
        await register(username, password)
      }
      navigate('/active-round')
    } catch (submitError) {
      setError((submitError as Error).message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-black">
      <main className="max-w-xl mx-auto px-4 py-10">
        <div className="bg-gradient-to-br from-gray-900 to-gray-800 rounded-xl p-8 border-4 border-orange-500 drop-shadow-2xl">
          <h1 className="text-4xl font-black text-orange-400 mb-2 uppercase">{mode === 'signin' ? 'Sign In' : 'Register'}</h1>
          <p className="text-gray-400 mb-6 font-bold">
            Use your account to bet points during live rounds.
          </p>

          <form onSubmit={onSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-black text-orange-300 uppercase mb-1">Username</label>
              <input
                value={username}
                onChange={event => setUsername(event.target.value)}
                className="w-full bg-gray-950 border-2 border-orange-500/40 rounded-lg px-3 py-2 text-white font-bold focus:outline-none focus:border-orange-400"
                autoComplete="username"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-black text-orange-300 uppercase mb-1">Password</label>
              <input
                type="password"
                value={password}
                onChange={event => setPassword(event.target.value)}
                className="w-full bg-gray-950 border-2 border-orange-500/40 rounded-lg px-3 py-2 text-white font-bold focus:outline-none focus:border-orange-400"
                autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                required
              />
            </div>

            {error && (
              <p className="text-red-400 font-bold text-sm">{error}</p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-orange-500 hover:bg-orange-400 disabled:opacity-60 text-white font-black py-3 rounded-lg transition"
            >
              {loading ? 'Please wait...' : mode === 'signin' ? 'Sign In' : 'Create Account'}
            </button>
          </form>

          <button
            type="button"
            onClick={() => {
              setError(null)
              setMode(mode === 'signin' ? 'register' : 'signin')
            }}
            className="mt-4 text-orange-300 hover:text-orange-200 font-black text-sm"
          >
            {mode === 'signin' ? 'Need an account? Register' : 'Already have an account? Sign in'}
          </button>
        </div>
      </main>
    </div>
  )
}
