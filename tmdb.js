const axios = require("axios");
const pool = require("./mysql");
require("dotenv").config();

const API_KEY = process.env.TMDB_API_KEY;
const BASE_URL = "https://api.themoviedb.org/3";

// ------------------------------------------------------------------
//  In-Memory Caching for TMDb API calls (prevents slowness)
// ------------------------------------------------------------------
const cache = {
  popular: { data: null, timestamp: 0 },
  top_rated: { data: null, timestamp: 0 },
  now_playing: { data: null, timestamp: 0 },
  trending: { data: null, timestamp: 0 },
};
const CACHE_DURATION = 60 * 60 * 1000; // 1 hour in milliseconds

// ------------------------------------------------------------------
//  TMDb Genre-ID → Genre-Name map  (used to populate movies.genre)
// ------------------------------------------------------------------
const GENRE_MAP = {
  28: "Action", 12: "Adventure", 16: "Animation", 35: "Comedy",
  80: "Crime", 99: "Documentary", 18: "Drama", 10751: "Family",
  14: "Fantasy", 36: "History", 27: "Horror", 10402: "Music",
  9648: "Mystery", 10749: "Romance", 878: "Science Fiction",
  10770: "TV Movie", 53: "Thriller", 10752: "War", 37: "Western",
};

/**
 * Convert TMDb genre_ids array to a comma-separated string.
 */
function genreIdsToString(genreIds) {
  if (!genreIds || !Array.isArray(genreIds)) return null;
  return genreIds.map((id) => GENRE_MAP[id] || "Unknown").join(", ");
}

// ------------------------------------------------------------------
//  Save an array of TMDb movie objects into MySQL (INSERT IGNORE)
// ------------------------------------------------------------------
async function saveMoviesToDB(movies) {
  if (!movies || movies.length === 0) return;

  try {
    const values = movies.map((m) => [
      m.id,                                                         // tmdb_id
      m.title || "Untitled",                                        // title
      genreIdsToString(m.genre_ids),                                // genre
      m.overview || null,                                           // description
      m.poster_path
        ? `https://image.tmdb.org/t/p/w500${m.poster_path}`
        : null,                                                     // poster_url
      m.release_date ? parseInt(m.release_date.substring(0, 4)) : null, // release_year
      Math.round((m.vote_average || 0) * 10) / 10,                 // average_rating
    ]);

    // Bulk INSERT IGNORE — skips rows that already exist (by tmdb_id UNIQUE key)
    const placeholders = values.map(() => "(?, ?, ?, ?, ?, ?, ?)").join(", ");
    const flat = values.flat();

    await pool.execute(
      `INSERT IGNORE INTO movies
         (tmdb_id, title, genre, description, poster_url, release_year, average_rating)
       VALUES ${placeholders}`,
      flat
    );
  } catch (err) {
    console.error("saveMoviesToDB error:", err.message);
  }
}

// ------------------------------------------------------------------
//  TMDb Fetcher Functions  (each returns TMDb-shaped { results: [] })
// ------------------------------------------------------------------

/**
 * GET /movie/popular
 */
async function getPopular() {
  const now = Date.now();
  if (cache.popular.data && (now - cache.popular.timestamp < CACHE_DURATION)) {
    return cache.popular.data;
  }
  try {
    const response = await axios.get(
      `${BASE_URL}/movie/popular?api_key=${API_KEY}&language=en-US&page=1`
    );
    const data = response.data;
    // Cache to MySQL in background (don't await — fire & forget)
    saveMoviesToDB(data.results);
    
    // Save to memory cache
    cache.popular.data = data;
    cache.popular.timestamp = now;
    return data;
  } catch (err) {
    console.error("TMDb getPopular failed:", err.message);
    return await fallbackFromDB("popular");
  }
}

/**
 * GET /movie/top_rated
 */
async function getTopRated() {
  const now = Date.now();
  if (cache.top_rated.data && (now - cache.top_rated.timestamp < CACHE_DURATION)) {
    return cache.top_rated.data;
  }
  try {
    const response = await axios.get(
      `${BASE_URL}/movie/top_rated?api_key=${API_KEY}&language=en-US&page=1`
    );
    const data = response.data;
    saveMoviesToDB(data.results);
    
    cache.top_rated.data = data;
    cache.top_rated.timestamp = now;
    return data;
  } catch (err) {
    console.error("TMDb getTopRated failed:", err.message);
    return await fallbackFromDB("top_rated");
  }
}

/**
 * GET /movie/now_playing
 */
async function getNowPlaying() {
  const now = Date.now();
  if (cache.now_playing.data && (now - cache.now_playing.timestamp < CACHE_DURATION)) {
    return cache.now_playing.data;
  }
  try {
    const response = await axios.get(
      `${BASE_URL}/movie/now_playing?api_key=${API_KEY}&language=en-US&page=1`
    );
    const data = response.data;
    saveMoviesToDB(data.results);
    
    cache.now_playing.data = data;
    cache.now_playing.timestamp = now;
    return data;
  } catch (err) {
    console.error("TMDb getNowPlaying failed:", err.message);
    return await fallbackFromDB("now_playing");
  }
}

/**
 * GET /trending/movie/week
 */
async function getTrending() {
  const now = Date.now();
  if (cache.trending.data && (now - cache.trending.timestamp < CACHE_DURATION)) {
    return cache.trending.data;
  }
  try {
    const response = await axios.get(
      `${BASE_URL}/trending/movie/week?api_key=${API_KEY}`
    );
    const data = response.data;
    saveMoviesToDB(data.results);
    
    cache.trending.data = data;
    cache.trending.timestamp = now;
    return data;
  } catch (err) {
    console.error("TMDb getTrending failed:", err.message);
    return await fallbackFromDB("trending");
  }
}

/**
 * GET /search/movie?query=...
 */
async function searchMovies(query) {
  try {
    const response = await axios.get(
      `${BASE_URL}/search/movie?api_key=${API_KEY}&query=${encodeURIComponent(query)}&language=en-US&page=1`
    );
    const data = response.data;
    saveMoviesToDB(data.results);
    return data;
  } catch (err) {
    console.error("TMDb searchMovies failed:", err.message);
    return await fallbackSearchFromDB(query);
  }
}

/**
 * GET /movie/{id}  — single movie details
 */
async function getMovieDetails(movieId) {
  try {
    const response = await axios.get(
      `${BASE_URL}/movie/${movieId}?api_key=${API_KEY}&language=en-US`
    );
    return response.data;
  } catch (err) {
    console.error("TMDb getMovieDetails failed:", err.message);
    // Fallback: try to find the movie in our MySQL cache by tmdb_id
    try {
      const [rows] = await pool.execute(
        "SELECT * FROM movies WHERE tmdb_id = ?",
        [movieId]
      );
      if (rows.length > 0) {
        const m = rows[0];
        return {
          id: m.tmdb_id,
          title: m.title,
          overview: m.description,
          poster_path: m.poster_url
            ? m.poster_url.replace("https://image.tmdb.org/t/p/w500", "")
            : null,
          release_date: m.release_year ? `${m.release_year}-01-01` : null,
          vote_average: parseFloat(m.average_rating) || 0,
        };
      }
    } catch (dbErr) {
      console.error("MySQL fallback getMovieDetails failed:", dbErr.message);
    }
    return null;
  }
}

/**
 * GET /movie/{id}/credits
 */
async function getMovieCredits(movieId) {
  try {
    const response = await axios.get(
      `${BASE_URL}/movie/${movieId}/credits?api_key=${API_KEY}`
    );
    return response.data;
  } catch (err) {
    console.error("TMDb getMovieCredits failed:", err.message);
    return { cast: [], crew: [] };
  }
}

/**
 * GET /movie/{id}/reviews
 */
async function getMovieReviews(movieId) {
  try {
    const response = await axios.get(
      `${BASE_URL}/movie/${movieId}/reviews?api_key=${API_KEY}&language=en-US&page=1`
    );
    return response.data;
  } catch (err) {
    console.error("TMDb getMovieReviews failed:", err.message);
    return { results: [] };
  }
}

/**
 * GET /movie/{id}/videos  — fetch trailers/videos
 * Returns the YouTube key for the first official Trailer, or null.
 */
async function getMovieVideos(movieId) {
  try {
    const response = await axios.get(
      `${BASE_URL}/movie/${movieId}/videos?api_key=${API_KEY}&language=en-US`
    );
    const results = response.data.results || [];
    // Find the first YouTube Trailer
    const trailer = results.find(
      (v) => v.type === "Trailer" && v.site === "YouTube"
    );
    return trailer ? trailer.key : null;
  } catch (err) {
    console.error("TMDb getMovieVideos failed:", err.message);
    return null;
  }
}

/**
 * GET /movie/{id}/watch/providers — streaming availability
 * Returns providers for PK region first, falls back to US, then null.
 */
async function getWatchProviders(movieId) {
  try {
    const response = await axios.get(
      `${BASE_URL}/movie/${movieId}/watch/providers?api_key=${API_KEY}`
    );
    const results = response.data.results || {};
    // Prefer Pakistan (PK), fall back to United States (US)
    const regionData = results["PK"] || results["US"] || null;
    if (!regionData) return null;

    const providers = [];
    const tmdbLink = `https://www.themoviedb.org/movie/${movieId}/watch`;

    if (regionData.flatrate) {
      regionData.flatrate.forEach((p) => {
        providers.push({
          name: p.provider_name,
          logo: `https://image.tmdb.org/t/p/original${p.logo_path}`,
          type: "STREAM",
          link: tmdbLink,
        });
      });
    }
    if (regionData.rent) {
      regionData.rent.forEach((p) => {
        providers.push({
          name: p.provider_name,
          logo: `https://image.tmdb.org/t/p/original${p.logo_path}`,
          type: "RENT",
          link: tmdbLink,
        });
      });
    }
    if (regionData.buy) {
      regionData.buy.forEach((p) => {
        providers.push({
          name: p.provider_name,
          logo: `https://image.tmdb.org/t/p/original${p.logo_path}`,
          type: "BUY",
          link: tmdbLink,
        });
      });
    }

    return providers.length > 0 ? providers : null;
  } catch (err) {
    console.error("TMDb getWatchProviders failed:", err.message);
    return null;
  }
}

// ------------------------------------------------------------------
//  MySQL Fallback Helpers
// ------------------------------------------------------------------

/**
 * When TMDb is down, pull movies from our local MySQL cache.
 * Returns data in the same shape as TMDb: { results: [...] }
 */
async function fallbackFromDB(category) {
  try {
    let query = "SELECT * FROM movies";
    let params = [];

    switch (category) {
      case "popular":
        query += " ORDER BY total_views DESC LIMIT 20";
        break;
      case "top_rated":
        query += " ORDER BY average_rating DESC LIMIT 20";
        break;
      case "now_playing":
        query += " ORDER BY release_year DESC LIMIT 20";
        break;
      case "trending":
        query += " ORDER BY total_views DESC, average_rating DESC LIMIT 20";
        break;
      default:
        query += " LIMIT 20";
    }

    const [rows] = await pool.execute(query, params);
    const results = rows.map(dbRowToTmdbShape);
    console.log(`Fallback: serving ${results.length} cached movies for "${category}"`);
    return { results, total_results: results.length, page: 1 };
  } catch (dbErr) {
    console.error("MySQL fallback failed:", dbErr.message);
    return { results: [], total_results: 0, page: 1 };
  }
}

/**
 * Search fallback: use MySQL LIKE query on the title column.
 */
async function fallbackSearchFromDB(query) {
  try {
    const [rows] = await pool.execute(
      "SELECT * FROM movies WHERE title LIKE ? LIMIT 20",
      [`%${query}%`]
    );
    const results = rows.map(dbRowToTmdbShape);
    console.log(`Fallback search: found ${results.length} cached movies for "${query}"`);
    return { results, total_results: results.length, page: 1 };
  } catch (dbErr) {
    console.error("MySQL fallback search failed:", dbErr.message);
    return { results: [], total_results: 0, page: 1 };
  }
}

/**
 * Convert a MySQL movies row into TMDb-compatible shape so EJS templates
 * can render it without changes.
 */
function dbRowToTmdbShape(row) {
  return {
    id: row.tmdb_id || row.id,
    title: row.title,
    overview: row.description,
    poster_path: row.poster_url
      ? row.poster_url.replace("https://image.tmdb.org/t/p/w500", "")
      : null,
    release_date: row.release_year ? `${row.release_year}-01-01` : "",
    vote_average: parseFloat(row.average_rating) || 0,
    genre_ids: [],
  };
}

// ------------------------------------------------------------------
//  Exports
// ------------------------------------------------------------------
module.exports = {
  getPopular,
  getTopRated,
  getNowPlaying,
  getTrending,
  searchMovies,
  getMovieDetails,
  getMovieCredits,
  getMovieReviews,
  getMovieVideos,
  getWatchProviders,
  saveMoviesToDB,
};
