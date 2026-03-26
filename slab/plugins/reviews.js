const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const COLLECTION = 'reviews_cache';

/**
 * Fetch reviews via Places API (New).
 * Returns { rating, user_ratings_total, reviews[] } or null if not configured.
 * Reads API key + place ID from tenant config.
 */
export async function getReviews(db, tenant) {
  const apiKey = tenant?.public?.googlePlacesKey;
  const placeId = tenant?.public?.googlePlaceId;
  if (!apiKey || !placeId) return null;

  const cached = await db.collection(COLLECTION).findOne({ placeId });

  // Return cache if still fresh
  if (cached && (Date.now() - new Date(cached.fetchedAt).getTime()) < CACHE_TTL_MS) {
    return cached.data;
  }

  try {
    const url = `https://places.googleapis.com/v1/places/${placeId}`;
    const resp = await fetch(url, {
      headers: {
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': 'displayName,rating,userRatingCount,reviews',
      },
    });

    const json = await resp.json();

    if (json.error) {
      console.error('[reviews] Places API error:', json.error.message);
      return cached?.data || null;
    }

    const data = {
      rating: json.rating,
      user_ratings_total: json.userRatingCount,
      reviews: (json.reviews || []).map(r => ({
        author_name: r.authorAttribution?.displayName || 'Anonymous',
        author_url: r.authorAttribution?.uri || '',
        profile_photo_url: r.authorAttribution?.photoUri || '',
        rating: r.rating,
        text: r.text?.text || r.originalText?.text || '',
        relative_time_description: r.relativePublishTimeDescription || '',
        time: r.publishTime,
      })),
    };

    await db.collection(COLLECTION).updateOne(
      { placeId },
      { $set: { placeId, data, fetchedAt: new Date() } },
      { upsert: true }
    );

    return data;
  } catch (err) {
    console.error('[reviews] fetch failed:', err.message);
    return cached?.data || null;
  }
}
