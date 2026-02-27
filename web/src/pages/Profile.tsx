import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ChevronLeft, User, Link as LinkIcon, Loader, Edit2, Check, X } from 'lucide-react'
import { getMe, readAuthToken, linkDiscord, getDiscordLink, updateUsername } from '../api'

interface AuthUser {
  id: string
  username: string
  points: number
}

export function Profile() {
  const navigate = useNavigate()
  const [authUser, setAuthUser] = useState<AuthUser | null>(null)
  const [loading, setLoading] = useState(true)
  const [isEditingUsername, setIsEditingUsername] = useState(false)
  const [newUsername, setNewUsername] = useState('')
  const [usernameError, setUsernameError] = useState<string | null>(null)
  const [usernameSaving, setUsernameSaving] = useState(false)
  const [discordUsername, setDiscordUsername] = useState('')
  const [inputValue, setInputValue] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [linking, setLinking] = useState(false)
  const [loadingDiscordLink, setLoadingDiscordLink] = useState(true)

  useEffect(() => {
    const token = readAuthToken()
    if (!token) {
      navigate('/signin')
      return
    }

    const fetchAuth = async () => {
      try {
        const result = await getMe()
        setAuthUser(result.user)
      } catch {
        navigate('/signin')
      }
    }

    fetchAuth()
  }, [navigate])

  useEffect(() => {
    const fetchDiscordLink = async () => {
      try {
        const link = await getDiscordLink()
        if (link?.discord_username) {
          setDiscordUsername(link.discord_username)
        }
      } catch (err) {
        console.error('Failed to fetch Discord link:', err)
      } finally {
        setLoadingDiscordLink(false)
      }
    }

    fetchDiscordLink()
    setLoading(false)
  }, [authUser])

  const handleLinkDiscord = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setMessage(null)

    if (!inputValue.trim()) {
      setError('Please enter your Discord username')
      return
    }

    setLinking(true)
    try {
      await linkDiscord(inputValue)
      setDiscordUsername(inputValue)
      setInputValue('')
      setMessage(`Successfully linked Discord account: ${inputValue}`)
      setTimeout(() => setMessage(null), 3000)
    } catch (err) {
      setError((err as Error).message || 'Failed to link Discord account')
    } finally {
      setLinking(false)
    }
  }

  const handleStartEditUsername = () => {
    setNewUsername(authUser?.username || '')
    setIsEditingUsername(true)
    setUsernameError(null)
  }

  const handleCancelEditUsername = () => {
    setIsEditingUsername(false)
    setNewUsername('')
    setUsernameError(null)
  }

  const handleSaveUsername = async () => {
    setUsernameError(null)

    const trimmed = newUsername.trim()
    if (!trimmed) {
      setUsernameError('Username cannot be empty')
      return
    }

    if (trimmed === authUser?.username) {
      setIsEditingUsername(false)
      return
    }

    if (trimmed.length < 3) {
      setUsernameError('Username must be at least 3 characters')
      return
    }

    if (trimmed.length > 32) {
      setUsernameError('Username must be 32 characters or less')
      return
    }

    setUsernameSaving(true)
    try {
      const result = await updateUsername(trimmed)
      setAuthUser(result.user)
      setIsEditingUsername(false)
      setNewUsername('')
    } catch (err) {
      setUsernameError((err as Error).message || 'Failed to update username')
    } finally {
      setUsernameSaving(false)
    }
  }

  if (loading || !authUser) {
    return (
      <div className="flex justify-center items-center h-96">
        <Loader className="animate-spin text-orange-400" size={40} />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-black">
      <div className="max-w-2xl mx-auto px-4 py-8">
        <Link
          to="/"
          className="flex items-center gap-2 text-orange-400 hover:text-orange-300 mb-8 font-black transition"
        >
          <ChevronLeft size={20} />
          Back
        </Link>

        <div className="bg-gradient-to-br from-gray-800 to-gray-900 rounded-xl border-4 border-orange-500 p-8 drop-shadow-2xl">
          <div className="flex items-center gap-3 mb-8">
            <User className="text-orange-400 drop-shadow-lg" size={40} />
            <h1 className="text-4xl font-black text-orange-400 drop-shadow-lg">PROFILE</h1>
          </div>

          {/* User Stats */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
            <div className="bg-gray-900 border-2 border-orange-500 rounded-lg p-4">
              <p className="text-xs font-black text-orange-400 uppercase mb-2">Username</p>
              {isEditingUsername ? (
                <div className="space-y-2">
                  <input
                    type="text"
                    value={newUsername}
                    onChange={e => setNewUsername(e.target.value)}
                    maxLength={32}
                    className="w-full bg-gray-800 border border-orange-500/50 rounded px-3 py-2 text-white font-bold focus:outline-none focus:border-orange-400"
                    placeholder="Enter new username"
                    disabled={usernameSaving}
                  />
                  {usernameError && <p className="text-red-400 font-bold text-xs">{usernameError}</p>}
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={handleSaveUsername}
                      disabled={usernameSaving}
                      className="flex-1 bg-green-500 hover:bg-green-400 disabled:opacity-60 text-white font-black rounded px-3 py-1 text-sm transition flex items-center justify-center gap-1"
                    >
                      <Check size={16} />
                      Save
                    </button>
                    <button
                      type="button"
                      onClick={handleCancelEditUsername}
                      disabled={usernameSaving}
                      className="flex-1 bg-gray-600 hover:bg-gray-500 disabled:opacity-60 text-white font-black rounded px-3 py-1 text-sm transition flex items-center justify-center gap-1"
                    >
                      <X size={16} />
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between">
                  <p className="text-2xl font-black text-white drop-shadow-lg">{authUser.username}</p>
                  <button
                    type="button"
                    onClick={handleStartEditUsername}
                    className="bg-orange-500 hover:bg-orange-400 text-white font-black p-2 rounded transition"
                    title="Edit username"
                  >
                    <Edit2 size={18} />
                  </button>
                </div>
              )}
            </div>
            <div className="bg-gray-900 border-2 border-orange-500 rounded-lg p-4">
              <p className="text-xs font-black text-orange-400 uppercase mb-2">Points</p>
              <p className="text-2xl font-black text-white drop-shadow-lg">{authUser.points}</p>
            </div>
          </div>

          {/* Discord Linking Section */}
          <div className="bg-gray-900 border-2 border-orange-500 rounded-lg p-6">
            <div className="flex items-center gap-2 mb-4">
              <LinkIcon className="text-orange-400" size={24} />
              <h2 className="text-2xl font-black text-orange-400 uppercase drop-shadow-lg">
                Discord Account
              </h2>
            </div>

            {loadingDiscordLink ? (
              <div className="flex justify-center items-center py-8">
                <Loader className="animate-spin text-orange-400" size={32} />
              </div>
            ) : discordUsername ? (
              <div>
                <p className="text-gray-300 font-bold mb-4">
                  Linked Discord: <span className="text-orange-300 font-black">{discordUsername}</span>
                </p>
                <p className="text-gray-400 text-sm mb-4">
                  Your Discord account is linked. You'll receive placement-based point rewards when you finish races!
                </p>
              </div>
            ) : (
              <div>
                <p className="text-gray-300 font-bold mb-4">
                  Link your Discord account to earn placement-based points:
                </p>
                <ul className="list-disc list-inside text-gray-400 text-sm mb-4 space-y-1">
                  <li>1st place: +50 points</li>
                  <li>2nd place (in "all" races): +25 points</li>
                </ul>
              </div>
            )}

            {!discordUsername && (
              <form onSubmit={handleLinkDiscord} className="space-y-3">
                <div>
                  <label className="block text-gray-300 font-bold mb-2">Enter your Discord username:</label>
                  <input
                    type="text"
                    value={inputValue}
                    onChange={e => setInputValue(e.target.value)}
                    placeholder="username#0000"
                    className="w-full bg-gray-800 border border-orange-500/50 rounded-lg px-4 py-2 text-white font-bold placeholder-gray-500 focus:outline-none focus:border-orange-400"
                    disabled={linking}
                  />
                </div>
                <button
                  type="submit"
                  disabled={linking}
                  className="w-full bg-orange-500 hover:bg-orange-400 disabled:opacity-60 text-white font-black rounded-lg px-4 py-2 transition"
                >
                  {linking ? 'Linking...' : 'Link Discord Account'}
                </button>
              </form>
            )}

            {error && <p className="text-red-400 font-bold text-sm mt-3">{error}</p>}
            {message && <p className="text-green-400 font-bold text-sm mt-3">{message}</p>}
          </div>

          <div className="mt-8 pt-6 border-t border-orange-500/30">
            <p className="text-gray-400 text-sm">
              Your Discord account helps us track your race results and award points automatically.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
