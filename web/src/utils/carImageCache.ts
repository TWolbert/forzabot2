/**
 * Utility for caching car images in localStorage
 * Prevents redundant API calls and improves page load performance
 */

const CACHE_KEY_PREFIX = 'car-image-'
const CACHE_DURATION = 7 * 24 * 60 * 60 * 1000 // 7 days in milliseconds

interface CacheEntry {
  imageUrl: string | null
  timestamp: number
}

/**
 * Get a car image from cache or fetch it from the API
 * @param carName - The name of the car
 * @returns The image URL or null if not found
 */
export async function getCachedCarImage(carName: string, index = 0): Promise<string | null> {
  try {
    const cacheKey = `${CACHE_KEY_PREFIX}${carName}-${index}`
    
    // Check if we have a cached version
    const cached = localStorage.getItem(cacheKey)
    if (cached) {
      try {
        const entry: CacheEntry = JSON.parse(cached)
        const now = Date.now()
        
        // Check if cache is still valid (7 days)
        if (now - entry.timestamp < CACHE_DURATION) {
          return entry.imageUrl
        }
      } catch {
        // If parsing fails, treat as invalid cache
        localStorage.removeItem(cacheKey)
      }
    }
    
    // Fetch from API
    const response = await fetch(`/api/car-image/${encodeURIComponent(carName)}?index=${index}`)
    if (!response.ok) {
      return null
    }
    
    const data = await response.json()
    const imageUrl = data.imageUrl
    
    // Cache the result
    if (imageUrl) {
      const entry: CacheEntry = {
        imageUrl,
        timestamp: Date.now()
      }
      localStorage.setItem(cacheKey, JSON.stringify(entry))
    }
    
    return imageUrl
  } catch (error) {
    console.error(`Failed to fetch image for ${carName}:`, error)
    return null
  }
}

/**
 * Fetch multiple car images with caching
 * @param carNames - Array of car names to fetch
 * @returns Record of car names to image URLs
 */
export async function getCachedCarImages(carNames: string[]): Promise<Record<string, string | null>> {
  const images: Record<string, string | null> = {}
  
  // Fetch all images in parallel
  const promises = carNames.map(async (car) => {
    const imageUrl = await getCachedCarImage(car)
    images[car] = imageUrl
  })
  
  await Promise.all(promises)
  return images
}
