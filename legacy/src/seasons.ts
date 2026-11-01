// The user-provided countdown placed the summer transition at this UTC instant.
const SUMMER_START_SECONDS = 1793888992
const SEASON_SECONDS = 7 * 24 * 60 * 60
const SEASONS = ['summer', 'autumn', 'winter', 'spring'] as const

export function seasonAt(unixSeconds: number): typeof SEASONS[number] {
  const offset = Math.floor((unixSeconds - SUMMER_START_SECONDS) / SEASON_SECONDS)
  return SEASONS[((offset % 4) + 4) % 4]!
}
