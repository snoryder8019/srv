import { getDb } from './mongo.js';
import { config } from '../config/config.js';

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const COLLECTION = 'w2_reviews_cache';

/**
 * Fetch reviews via Places API (New).
 * Returns { rating, user_ratings_total, reviews[] } or null if not configured.
 */
export async function getReviews() {
  if (!config.GOOGLE_PLACES_KEY || !config.GOOGLE_PLACE_ID) return null;

  const db = getDb();
  const cached = await db.collection(COLLECTION).findOne({ placeId: config.GOOGLE_PLACE_ID });

  // Return cache if still fresh
  if (cached && (Date.now() - new Date(cached.fetchedAt).getTime()) < CACHE_TTL_MS) {
    return cached.data;
  }

  try {
    const url = `https://places.googleapis.com/v1/places/${config.GOOGLE_PLACE_ID}`;
    const resp = await fetch(url, {
      headers: {
        'X-Goog-Api-Key': config.GOOGLE_PLACES_KEY,
        'X-Goog-FieldMask': 'displayName,rating,userRatingCount,reviews',
      },
    });

    const json = await resp.json();

    if (json.error) {
      console.error('[reviews] Places API (New) error:', json.error.message);
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
      { placeId: config.GOOGLE_PLACE_ID },
      { $set: { placeId: config.GOOGLE_PLACE_ID, data, fetchedAt: new Date() } },
      { upsert: true }
    );

    return data;
  } catch (err) {
    console.error('[reviews] fetch failed:', err.message);
    return cached?.data || null;
  }
}
