const express = require("express");
const session = require("express-session");
const nocache = require("nocache");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");
require("dotenv").config();

const app = express();
const axios = require("axios");
// Note: /films and /lists routes are handled directly in this file.
// The route files in routes/navbar/ are legacy and not mounted.
const membersRouter = require("./routes/navbar/members");
const journalRouter = require("./routes/navbar/journal");
const pool = require("./mysql");
const tmdb = require("./tmdb");
const { verifyToken, optionalAuth } = require("./middleware/auth");
// EJS is configured via app.set("view engine", "ejs") below

const API_KEY = process.env.TMDB_API_KEY;
const JWT_SECRET = process.env.JWT_SECRET || "letterboxd-jwt-secret-key-2024";
const PORT = process.env.PORT || 3500;
const BCRYPT_ROUNDS = 10;

app.use(
  session({
    secret: process.env.SECRET || "my-secret",
    resave: false,
    saveUninitialized: false,
  })
);

app.use(cookieParser());
app.use("/public", express.static("public"));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.set("view engine", "ejs");

app.use("/members", membersRouter);
app.use("/journal", journalRouter);

// ==================================================================
//  HELPER: Sign a JWT and set it as an httpOnly cookie
// ==================================================================
function signAndSetToken(res, user) {
  const token = jwt.sign(
    { id: user.id, name: user.name, email: user.email },
    JWT_SECRET,
    { expiresIn: "7d" }
  );
  res.cookie("token", token, {
    httpOnly: true,
    secure: false, // set to true in production with HTTPS
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    sameSite: "lax",
    path: "/",
  });
  return token;
}

// ==================================================================
//  HOME PAGE — Popular + Now Playing + Trending
// ==================================================================
app.get("/", optionalAuth, async (req, res) => {
  try {
    const [movieData, nowPlayingData, trendingData] = await Promise.all([
      tmdb.getPopular(),
      tmdb.getNowPlaying(),
      tmdb.getTrending(),
    ]);

    if (req.user) {
      res.render("homepage/logged-in", {
        movieData,
        nowPlayingData,
        trendingData,
        user: req.user,
      });
    } else {
      res.render("homepage/index", {
        movieData,
        nowPlayingData,
        trendingData,
      });
    }
  } catch (err) {
    console.error("Home route error:", err.message);
    res.redirect("/login");
  }
});

// ==================================================================
//  AUTH: SIGNUP
// ==================================================================
app.get("/signup", (req, res) => {
  res.render("registration/registration", { error: null });
});

app.get("/create-account", (req, res) => {
  res.render("registration/registration", { error: null });
});

app.post("/signup", async (req, res) => {
  const { name, email, password, confirmPassword } = req.body;

  // Validate confirm password
  if (password !== confirmPassword) {
    return res.render("registration/registration", {
      error: "Passwords do not match.",
    });
  }

  if (!name || !email || !password) {
    return res.render("registration/registration", {
      error: "All fields are required.",
    });
  }

  // Validate name: letters only
  if (!/^[a-zA-Z\s]+$/.test(name)) {
    return res.render("registration/registration", {
      error: "Invalid name. Please use letters only.",
    });
  }

  // Validate password length
  if (password.length < 8) {
    return res.render("registration/registration", {
      error: "Password must be at least 8 characters.",
    });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    // Hash the password with bcrypt
    const hashedPassword = await bcrypt.hash(password, BCRYPT_ROUNDS);

    // Insert the user
    const [result] = await connection.execute(
      "INSERT INTO users (name, email, password) VALUES (?, ?, ?)",
      [name, email, hashedPassword]
    );
    const userId = result.insertId;

    // Commit the user creation
    await connection.commit();

    // Sign JWT and set cookie
    signAndSetToken(res, { id: userId, name, email });

    // Also set session for backward compatibility
    req.session.isLoggedIn = true;
    req.session.user = { id: userId, username: name, email };

    // Redirect to subscription page so user picks a plan
    res.redirect("/subscribe");
  } catch (err) {
    await connection.rollback();
    console.error("Signup error:", err.message);

    let errorMsg = "Account creation failed. Please try again.";
    if (err.code === "ER_DUP_ENTRY") {
      errorMsg = "An account with this email already exists.";
    }
    res.render("registration/registration", { error: errorMsg });
  } finally {
    connection.release();
  }
});

// ==================================================================
//  AUTH: LOGIN
// ==================================================================
app.get("/login", (req, res) => {
  res.render("sign-in/login", { error: null });
});

app.get("/sign-in", (req, res) => {
  res.render("sign-in/login", { error: null });
});

app.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.render("sign-in/login", {
        error: "Email and password are required.",
      });
    }

    // Find user by email
    const [rows] = await pool.execute("SELECT * FROM users WHERE email = ?", [
      email,
    ]);
    const user = rows[0];

    if (!user) {
      return res.render("sign-in/login", {
        error: "Invalid email or password.",
      });
    }

    // Compare password with bcrypt hash
    const passwordMatch = await bcrypt.compare(password, user.password);
    if (!passwordMatch) {
      return res.render("sign-in/login", {
        error: "Invalid email or password.",
      });
    }

    // Sign JWT and set httpOnly cookie
    signAndSetToken(res, {
      id: user.id,
      name: user.name,
      email: user.email,
    });

    // Also set session for backward compatibility
    req.session.email = email;
    req.session.isLoggedIn = true;
    req.session.user = {
      id: user.id,
      username: user.name,
      email: user.email,
    };

    res.redirect("/");
  } catch (err) {
    console.error("Login error:", err.message);
    res.render("sign-in/login", {
      error: "Something went wrong. Please try again.",
    });
  }
});

// ==================================================================
//  AUTH: LOGOUT
// ==================================================================
app.get("/logout", (req, res) => {
  res.clearCookie("token");
  req.session.destroy(() => {
    res.redirect("/");
  });
});

// ==================================================================
//  SUBSCRIPTION PAGE — Protected
// ==================================================================
app.get("/subscribe", verifyToken, (req, res) => {
  res.render("subscription/subscribe");
});

app.post("/subscribe", verifyToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { plan } = req.body;

    // Server-side plan validation
    const validPlans = ["basic", "standard", "premium"];
    if (!plan || !validPlans.includes(plan.toLowerCase())) {
      return res.json({ success: false, error: "Invalid subscription plan selected." });
    }

    // Call the ActivateSubscription stored procedure
    const [result] = await pool.execute("CALL ActivateSubscription(?, ?)", [
      userId,
      plan.toLowerCase(),
    ]);

    res.json({ success: true, message: result[0][0].message });
  } catch (err) {
    console.error("Subscribe error:", err.message);
    // The SIGNAL SQLSTATE message is in err.message
    let errorMsg = err.message || "Subscription failed. Please try again.";
    // Clean up MySQL error prefix if present
    if (errorMsg.includes(":")) {
      const parts = errorMsg.split(":");
      errorMsg = parts[parts.length - 1].trim();
    }
    res.json({ success: false, error: errorMsg });
  }
});

// ==================================================================
//  PROFILE PAGE — Protected
// ==================================================================
app.get("/profile", verifyToken, async (req, res) => {
  try {
    const userId = req.user.id;

    // Get subscription info
    const [subRows] = await pool.execute(
      "SELECT * FROM subscriptions WHERE user_id = ? AND status = 'active' ORDER BY start_date DESC LIMIT 1",
      [userId]
    );
    const subscription = subRows[0] || null;

    // Call GetContinueWatching stored procedure
    let continueWatching = [];
    try {
      const [cwRows] = await pool.execute("CALL GetContinueWatching(?)", [
        userId,
      ]);
      continueWatching = cwRows[0] || [];
    } catch (cwErr) {
      console.error("GetContinueWatching error:", cwErr.message);
    }

    // Call GetUserWatchlist stored procedure
    let watchlist = [];
    try {
      const [wlRows] = await pool.execute("CALL GetUserWatchlist(?)", [userId]);
      watchlist = wlRows[0] || [];
    } catch (wlErr) {
      console.error("GetUserWatchlist error:", wlErr.message);
    }

    res.render("profile/profile", {
      user: req.user,
      subscription,
      continueWatching,
      watchlist,
    });
  } catch (err) {
    console.error("Profile route error:", err.message);
    res.redirect("/");
  }
});

// ==================================================================
//  WATCHLIST API — Protected
// ==================================================================

// Add movie to watchlist
app.post("/api/watchlist/add", verifyToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { tmdbId, title, genre, overview, posterPath, releaseDate, voteAverage } = req.body;

    if (!tmdbId) {
      return res.status(400).json({ success: false, error: "tmdbId is required" });
    }

    // Ensure movie exists in MySQL (insert if not)
    const posterUrl = posterPath
      ? `https://image.tmdb.org/t/p/w500${posterPath}`
      : null;
    const releaseYear = releaseDate
      ? parseInt(releaseDate.substring(0, 4))
      : null;
    const rating = voteAverage
      ? Math.round(parseFloat(voteAverage) * 10) / 10
      : 0;

    await pool.execute(
      `INSERT IGNORE INTO movies (tmdb_id, title, genre, description, poster_url, release_year, average_rating)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [tmdbId, title || "Untitled", genre || null, overview || null, posterUrl, releaseYear, rating]
    );

    // Get the MySQL movie ID
    const [movieRows] = await pool.execute(
      "SELECT id FROM movies WHERE tmdb_id = ?",
      [tmdbId]
    );

    if (movieRows.length === 0) {
      return res.status(500).json({ success: false, error: "Failed to save movie" });
    }

    const movieId = movieRows[0].id;

    // Call AddToWatchlist stored procedure
    const [result] = await pool.execute("CALL AddToWatchlist(?, ?)", [
      userId,
      movieId,
    ]);

    res.json({ success: true, message: result[0][0].message });
  } catch (err) {
    console.error("Add to watchlist error:", err.message);
    res.status(500).json({ success: false, error: "Failed to add to watchlist" });
  }
});

// Remove movie from watchlist
app.post("/api/watchlist/remove", verifyToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { tmdbId } = req.body;

    if (!tmdbId) {
      return res.status(400).json({ success: false, error: "tmdbId is required" });
    }

    // Get MySQL movie ID from tmdb_id
    const [movieRows] = await pool.execute(
      "SELECT id FROM movies WHERE tmdb_id = ?",
      [tmdbId]
    );

    if (movieRows.length === 0) {
      return res.status(404).json({ success: false, error: "Movie not found" });
    }

    const movieId = movieRows[0].id;

    await pool.execute(
      "DELETE FROM watchlist WHERE user_id = ? AND movie_id = ?",
      [userId, movieId]
    );

    res.json({ success: true, message: "Removed from watchlist" });
  } catch (err) {
    console.error("Remove from watchlist error:", err.message);
    res.status(500).json({ success: false, error: "Failed to remove from watchlist" });
  }
});

// Check if movie is in watchlist
app.get("/api/watchlist/check/:tmdbId", verifyToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const tmdbId = parseInt(req.params.tmdbId);

    const [movieRows] = await pool.execute(
      "SELECT id FROM movies WHERE tmdb_id = ?",
      [tmdbId]
    );

    if (movieRows.length === 0) {
      return res.json({ inWatchlist: false });
    }

    const movieId = movieRows[0].id;

    const [rows] = await pool.execute(
      "SELECT COUNT(*) AS count FROM watchlist WHERE user_id = ? AND movie_id = ?",
      [userId, movieId]
    );

    res.json({ inWatchlist: rows[0].count > 0 });
  } catch (err) {
    console.error("Check watchlist error:", err.message);
    res.json({ inWatchlist: false });
  }
});

// ==================================================================
//  WATCH HISTORY API — Protected
// ==================================================================
app.post("/api/watch-history", verifyToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { tmdbId, title, genre, overview, posterPath, releaseDate, voteAverage, progressSeconds } = req.body;

    if (!tmdbId) {
      return res.status(400).json({ success: false, error: "tmdbId is required" });
    }

    // Ensure movie exists in MySQL (insert if not)
    const posterUrl = posterPath
      ? `https://image.tmdb.org/t/p/w500${posterPath}`
      : null;
    const releaseYear = releaseDate
      ? parseInt(releaseDate.substring(0, 4))
      : null;
    const rating = voteAverage
      ? Math.round(parseFloat(voteAverage) * 10) / 10
      : 0;

    await pool.execute(
      `INSERT IGNORE INTO movies (tmdb_id, title, genre, description, poster_url, release_year, average_rating)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [tmdbId, title || "Untitled", genre || null, overview || null, posterUrl, releaseYear, rating]
    );

    // Get the MySQL movie ID
    const [movieRows] = await pool.execute(
      "SELECT id FROM movies WHERE tmdb_id = ?",
      [tmdbId]
    );

    if (movieRows.length === 0) {
      return res.status(500).json({ success: false, error: "Failed to save movie" });
    }

    const movieId = movieRows[0].id;
    const progress = progressSeconds || 0;

    // Call RecordWatchHistory stored procedure
    // This also triggers after_watch_insert which increments total_views
    const [result] = await pool.execute("CALL RecordWatchHistory(?, ?, ?)", [
      userId,
      movieId,
      progress,
    ]);

    res.json({ success: true, message: result[0][0].message });
  } catch (err) {
    console.error("Record watch history error:", err.message);
    res.status(500).json({ success: false, error: "Failed to record watch history" });
  }
});

// Get consolidated film interaction status (Watchlist, History, Likes, Rating)
app.get("/api/film-status/:tmdbId", verifyToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const tmdbId = parseInt(req.params.tmdbId);

    const [movieRows] = await pool.execute(
      "SELECT id FROM movies WHERE tmdb_id = ?",
      [tmdbId]
    );

    if (movieRows.length === 0) {
      return res.json({
        inWatchlist: false,
        watched: false,
        liked: false,
        rating: 0
      });
    }

    const movieId = movieRows[0].id;

    const [
      [watchlistRows],
      [historyRows],
      [likeRows],
      [ratingRows]
    ] = await Promise.all([
      pool.execute("SELECT COUNT(*) AS count FROM watchlist WHERE user_id = ? AND movie_id = ?", [userId, movieId]),
      pool.execute("SELECT COUNT(*) AS count FROM watch_history WHERE user_id = ? AND movie_id = ?", [userId, movieId]),
      pool.execute("SELECT COUNT(*) AS count FROM likes WHERE user_id = ? AND movie_id = ?", [userId, movieId]),
      pool.execute("SELECT rating FROM ratings WHERE user_id = ? AND movie_id = ? LIMIT 1", [userId, movieId])
    ]);

    res.json({
      inWatchlist: watchlistRows[0].count > 0,
      watched: historyRows[0].count > 0,
      liked: likeRows[0].count > 0,
      rating: ratingRows.length > 0 ? ratingRows[0].rating : 0
    });
  } catch (err) {
    console.error("Get film status error:", err.message);
    res.status(500).json({ success: false, error: "Failed to get film status" });
  }
});

// Toggle watched status (Watch History)
app.post("/api/watched/toggle", verifyToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { tmdbId, title, genre, overview, posterPath, releaseDate, voteAverage } = req.body;

    if (!tmdbId) {
      return res.status(400).json({ success: false, error: "tmdbId is required" });
    }

    const posterUrl = posterPath
      ? (posterPath.startsWith('http') ? posterPath : `https://image.tmdb.org/t/p/w500${posterPath}`)
      : null;
    const releaseYear = releaseDate
      ? parseInt(releaseDate.substring(0, 4))
      : null;
    const rating = voteAverage
      ? Math.round(parseFloat(voteAverage) * 10) / 10
      : 0;

    await pool.execute(
      `INSERT IGNORE INTO movies (tmdb_id, title, genre, description, poster_url, release_year, average_rating)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [tmdbId, title || "Untitled", genre || null, overview || null, posterUrl, releaseYear, rating]
    );

    const [movieRows] = await pool.execute(
      "SELECT id FROM movies WHERE tmdb_id = ?",
      [tmdbId]
    );

    if (movieRows.length === 0) {
      return res.status(500).json({ success: false, error: "Failed to save movie" });
    }

    const movieId = movieRows[0].id;

    const [historyRows] = await pool.execute(
      "SELECT id FROM watch_history WHERE user_id = ? AND movie_id = ? LIMIT 1",
      [userId, movieId]
    );

    if (historyRows.length > 0) {
      await pool.execute(
        "DELETE FROM watch_history WHERE user_id = ? AND movie_id = ?",
        [userId, movieId]
      );
      res.json({ success: true, watched: false, message: "Removed from watch history" });
    } else {
      await pool.execute("CALL RecordWatchHistory(?, ?, 0)", [userId, movieId]);
      res.json({ success: true, watched: true, message: "Added to watch history" });
    }
  } catch (err) {
    console.error("Toggle watched error:", err.message);
    res.status(500).json({ success: false, error: "Failed to toggle watched status" });
  }
});

// Toggle liked status
app.post("/api/liked/toggle", verifyToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { tmdbId, title, genre, overview, posterPath, releaseDate, voteAverage } = req.body;

    if (!tmdbId) {
      return res.status(400).json({ success: false, error: "tmdbId is required" });
    }

    const posterUrl = posterPath
      ? (posterPath.startsWith('http') ? posterPath : `https://image.tmdb.org/t/p/w500${posterPath}`)
      : null;
    const releaseYear = releaseDate
      ? parseInt(releaseDate.substring(0, 4))
      : null;
    const rating = voteAverage
      ? Math.round(parseFloat(voteAverage) * 10) / 10
      : 0;

    await pool.execute(
      `INSERT IGNORE INTO movies (tmdb_id, title, genre, description, poster_url, release_year, average_rating)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [tmdbId, title || "Untitled", genre || null, overview || null, posterUrl, releaseYear, rating]
    );

    const [movieRows] = await pool.execute(
      "SELECT id FROM movies WHERE tmdb_id = ?",
      [tmdbId]
    );

    if (movieRows.length === 0) {
      return res.status(500).json({ success: false, error: "Failed to save movie" });
    }

    const movieId = movieRows[0].id;

    const [likeRows] = await pool.execute(
      "SELECT id FROM likes WHERE user_id = ? AND movie_id = ? LIMIT 1",
      [userId, movieId]
    );

    if (likeRows.length > 0) {
      await pool.execute(
        "DELETE FROM likes WHERE user_id = ? AND movie_id = ?",
        [userId, movieId]
      );
      res.json({ success: true, liked: false, message: "Removed from liked films" });
    } else {
      await pool.execute(
        "INSERT INTO likes (user_id, movie_id) VALUES (?, ?)",
        [userId, movieId]
      );
      res.json({ success: true, liked: true, message: "Added to liked films" });
    }
  } catch (err) {
    console.error("Toggle liked error:", err.message);
    res.status(500).json({ success: false, error: "Failed to toggle liked status" });
  }
});

// Update star rating
app.post("/api/rating", verifyToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { tmdbId, rating, title, genre, overview, posterPath, releaseDate, voteAverage } = req.body;

    if (!tmdbId) {
      return res.status(400).json({ success: false, error: "tmdbId is required" });
    }

    const posterUrl = posterPath
      ? (posterPath.startsWith('http') ? posterPath : `https://image.tmdb.org/t/p/w500${posterPath}`)
      : null;
    const releaseYear = releaseDate
      ? parseInt(releaseDate.substring(0, 4))
      : null;
    const movieRating = voteAverage
      ? Math.round(parseFloat(voteAverage) * 10) / 10
      : 0;

    await pool.execute(
      `INSERT IGNORE INTO movies (tmdb_id, title, genre, description, poster_url, release_year, average_rating)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [tmdbId, title || "Untitled", genre || null, overview || null, posterUrl, releaseYear, movieRating]
    );

    const [movieRows] = await pool.execute(
      "SELECT id FROM movies WHERE tmdb_id = ?",
      [tmdbId]
    );

    if (movieRows.length === 0) {
      return res.status(500).json({ success: false, error: "Failed to save movie" });
    }

    const movieId = movieRows[0].id;

    await pool.execute(
      "DELETE FROM ratings WHERE user_id = ? AND movie_id = ?",
      [userId, movieId]
    );

    const numericRating = parseFloat(rating);
    if (numericRating > 0) {
      await pool.execute(
        "INSERT INTO ratings (user_id, movie_id, rating) VALUES (?, ?, ?)",
        [userId, movieId, numericRating]
      );
      res.json({ success: true, rating: numericRating, message: "Movie rated successfully" });
    } else {
      res.json({ success: true, rating: 0, message: "Rating cleared successfully" });
    }
  } catch (err) {
    console.error("Update rating error:", err.message);
    res.status(500).json({ success: false, error: "Failed to update rating" });
  }
});

// ==================================================================
//  LISTS PAGE — Popular + Top Rated
// ==================================================================
app.get("/lists", optionalAuth, async (req, res) => {
  try {
    const [movieData, topRatedMovieData] = await Promise.all([
      tmdb.getPopular(),
      tmdb.getTopRated(),
    ]);

    if (req.user) {
      res.render("lists/lists-member", {
        movieData,
        topRatedMovieData,
        user: req.user,
      });
    } else {
      res.render("lists/lists", { movieData, topRatedMovieData });
    }
  } catch (err) {
    console.error("Lists route error:", err.message);
    res.redirect("/");
  }
});

// ==================================================================
//  FILM DETAIL PAGE — Search TMDb + Credits + Reviews
// ==================================================================
app.get("/film/:title-:year", optionalAuth, async (req, res) => {
  try {
    const titleClean = req.params.title.replace(/\/+$/, "");
    const yearClean = req.params.year.replace(/\/+$/, "");
    const url = titleClean + "-" + yearClean;
    const parts = url.match(/(.*)-(\d{4})/);
    if (!parts) {
      return res.redirect(`/film/${titleClean}`);
    }
    const movieTitle = parts[1].replace(/-/g, " ");
    const movieYear = parts[2];

    const searchResponse = await axios.get(
      `https://api.themoviedb.org/3/search/movie?api_key=${API_KEY}&query=${encodeURIComponent(movieTitle)}&year=${movieYear}`
    );

    const movieData = searchResponse.data.results.find((result) =>
      result.release_date.startsWith(movieYear)
    );
    if (!movieData) {
      console.log("No movie found");
      return res.status(404).render("error/404");
    } else {
      // Save the found movie to MySQL cache
      tmdb.saveMoviesToDB([movieData]);

      const movieId = movieData.id;
      const [movieReviews, movieCredits, trailerKey, watchProviders] = await Promise.all([
        tmdb.getMovieReviews(movieId),
        tmdb.getMovieCredits(movieId),
        tmdb.getMovieVideos(movieId),
        tmdb.getWatchProviders(movieId),
      ]);
      const directors = movieCredits.crew.filter(
        (member) => member.job === "Director"
      );
      const cast = movieCredits.cast;

      const directorNames = directors
        .map((director) => director.name)
        .join(", ");

      res.render("film/film", { movieData, directorNames, movieReviews: { data: movieReviews }, cast, user: req.user || null, trailerKey, watchProviders });
    }
  } catch (err) {
    console.error("Film detail error:", err.message);
    res.status(404).render("error/404");
  }
});

// ==================================================================
//  FILM DETAIL PAGE (FALLBACK FOR SLUGS AND MOCK USER ACTIVITY)
// ==================================================================
app.get("/:username/film/:title", optionalAuth, async (req, res) => {
  const movieTitle = req.params.title.replace(/\/+$/, "").replace(/-/g, " ");
  try {
    const searchResponse = await axios.get(
      `https://api.themoviedb.org/3/search/movie?api_key=${API_KEY}&query=${encodeURIComponent(movieTitle)}`
    );
    const movieData = searchResponse.data.results[0];
    if (!movieData) {
      return res.status(404).render("error/404");
    }

    // Save the movie to cache database
    tmdb.saveMoviesToDB([movieData]);

    const movieId = movieData.id;
    const [movieReviews, movieCredits, trailerKey, watchProviders] = await Promise.all([
      tmdb.getMovieReviews(movieId),
      tmdb.getMovieCredits(movieId),
      tmdb.getMovieVideos(movieId),
      tmdb.getWatchProviders(movieId),
    ]);
    const directors = movieCredits.crew.filter(
      (member) => member.job === "Director"
    );
    const cast = movieCredits.cast;
    const directorNames = directors.map((director) => director.name).join(", ");

    res.render("film/film", { movieData, directorNames, movieReviews: { data: movieReviews }, cast, user: req.user || null, trailerKey, watchProviders });
  } catch (err) {
    console.error("Mock activity film detail error:", err.message);
    res.status(404).render("error/404");
  }
});

app.get("/film/:title", optionalAuth, async (req, res) => {
  const movieTitle = req.params.title.replace(/\/+$/, "").replace(/-/g, " ");
  try {
    const searchResponse = await axios.get(
      `https://api.themoviedb.org/3/search/movie?api_key=${API_KEY}&query=${encodeURIComponent(movieTitle)}`
    );
    const movieData = searchResponse.data.results[0];
    if (!movieData) {
      return res.status(404).render("error/404");
    }

    tmdb.saveMoviesToDB([movieData]);

    const movieId = movieData.id;
    const [movieReviews, movieCredits, trailerKey, watchProviders] = await Promise.all([
      tmdb.getMovieReviews(movieId),
      tmdb.getMovieCredits(movieId),
      tmdb.getMovieVideos(movieId),
      tmdb.getWatchProviders(movieId),
    ]);
    const directors = movieCredits.crew.filter(
      (member) => member.job === "Director"
    );
    const cast = movieCredits.cast;
    const directorNames = directors.map((director) => director.name).join(", ");

    res.render("film/film", { movieData, directorNames, movieReviews: { data: movieReviews }, cast, user: req.user || null, trailerKey, watchProviders });
  } catch (err) {
    console.error("Slug film detail error:", err.message);
    res.status(404).render("error/404");
  }
});

// ==================================================================
//  SHOWDOWN AND JOURNAL ARTICLE FALLBACK ROUTING
// ==================================================================
app.get("/showdown*", (req, res) => {
  res.redirect("/lists");
});

app.get("/journal/*", (req, res) => {
  res.redirect("/journal");
});

// ==================================================================
//  NEW LIST PAGE — Popular + Top Rated
// ==================================================================
app.get("/list/new", optionalAuth, async (req, res) => {
  try {
    const [movieData, topRatedMovieData] = await Promise.all([
      tmdb.getPopular(),
      tmdb.getTopRated(),
    ]);

    if (req.user) {
      res.render("lists/list-new", {
        movieData,
        topRatedMovieData,
        user: req.user,
      });
    } else {
      res.render("lists/lists", { movieData, topRatedMovieData });
    }
  } catch (err) {
    console.error("List new route error:", err.message);
    res.redirect("/");
  }
});

// ==================================================================
//  FILMS PAGE — Popular + Top Rated
// ==================================================================
app.get("/films", optionalAuth, async (req, res) => {
  try {
    const [movieData, topRatedMovieData] = await Promise.all([
      tmdb.getPopular(),
      tmdb.getTopRated(),
    ]);

    res.render("films/films", { movieData, topRatedMovieData, user: req.user || null });
  } catch (err) {
    console.error("Films route error:", err.message);
    res.redirect("/");
  }
});

// ==================================================================
//  SEARCH — TMDb search with MySQL fallback
// ==================================================================
app.get("/search", optionalAuth, async (req, res) => {
  try {
    const searchQuery = req.query.q;
    const movieData = await tmdb.searchMovies(searchQuery);

    res.render("search/results", { movieData, user: req.user || null });
  } catch (err) {
    console.error("Search route error:", err.message);
    res.redirect("/");
  }
});

// ==================================================================
//  AUTOCOMPLETE — TMDb search with MySQL fallback
// ==================================================================
app.get("/s/autocompletefilm", async (req, res) => {
  try {
    const query = req.query.term;
    const data = await tmdb.searchMovies(query);
    const titles = data.results.map((result) => ({
      id: result.id,
      label: `${result.title} (${
        result.release_date ? new Date(result.release_date).getFullYear() : "N/A"
      })`,
    }));
    res.send(titles);
  } catch (err) {
    console.error("Autocomplete error:", err.message);
    res.send([]);
  }
});

// ==================================================================
//  GET MOVIE DETAILS — TMDb movie details with MySQL fallback
// ==================================================================
app.post("/s/getmoviedetails", async (req, res) => {
  try {
    const movieId = req.body.movieId;
    const movieDetails = await tmdb.getMovieDetails(movieId);

    if (movieDetails) {
      res.send({
        title: movieDetails.title,
        release_date: movieDetails.release_date,
        poster_path: movieDetails.poster_path,
      });
    } else {
      res.status(404).send({ error: "Movie not found" });
    }
  } catch (err) {
    console.error("Get movie details error:", err.message);
    res.status(500).send({ error: "Failed to fetch movie details" });
  }
});

// ==================================================================
//  ADD TO LIST
// ==================================================================
app.post("/add-to-list", async (req, res) => {
  const { user, listName, films } = req.body;
  console.log("listname: ", listName);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    // Check if the list already exists for this user
    const [existingLists] = await connection.execute(
      "SELECT id FROM lists WHERE user_id = ? AND name = ?",
      [user, listName]
    );

    let listId;
    if (existingLists.length > 0) {
      // List already exists, use its id
      listId = existingLists[0].id;
    } else {
      // Create a new list
      const [result] = await connection.execute(
        "INSERT INTO lists (user_id, name) VALUES (?, ?)",
        [user, listName]
      );
      listId = result.insertId;
    }

    // Insert all films into the list
    for (const film of films) {
      await connection.execute(
        "INSERT INTO list_films (list_id, film_id, title, year, poster_url) VALUES (?, ?, ?, ?, ?)",
        [listId, film.id, film.title, film.year || null, film.posterUrl || null]
      );
    }

    await connection.commit();
    res.json({ success: true });
  } catch (error) {
    await connection.rollback();
    console.error(error);
    res.json({ success: false, error });
  } finally {
    connection.release();
  }
});



app.get("/:username/lists", nocache(), optionalAuth, async (req, res) => {
  try {
    if (req.user) {
      const [userRows] = await pool.execute(
        "SELECT * FROM users WHERE email = ?",
        [req.user.email]
      );
      const user = userRows[0];

      // Fetch all lists and their films for this user
      const [listRows] = await pool.execute(
        "SELECT l.id AS list_id, l.name, lf.film_id, lf.title, lf.year, lf.poster_url AS posterUrl FROM lists l LEFT JOIN list_films lf ON l.id = lf.list_id WHERE l.user_id = ?",
        [user.id]
      );

      // Reshape flat rows into nested structure to match the old Mongoose format
      const listsMap = {};
      for (const row of listRows) {
        if (!listsMap[row.list_id]) {
          listsMap[row.list_id] = { name: row.name, films: [] };
        }
        if (row.film_id) {
          listsMap[row.list_id].films.push({
            id: row.film_id,
            title: row.title,
            year: row.year,
            posterUrl: row.posterUrl,
          });
        }
      }
      user.lists = Object.values(listsMap);

      // Safe access — only log if lists exist and have films
      if (user.lists.length > 0 && user.lists[0].films.length > 0) {
        console.log('First list film:', user.lists[0].films[0].title);
      }
      res.render("lists/movie-lists", { user });
    } else {
      res.render("sign-in/login", { error: null });
    }
  } catch (err) {
    console.error("User lists error:", err.message);
    res.redirect("/");
  }
});


app.get("/:username/list/:listname", nocache(), optionalAuth, async (req, res) => {
  const listname = req.params.listname;
  console.log(listname);
  try {
    if (req.user) {
      const [userRows] = await pool.execute(
        "SELECT * FROM users WHERE email = ?",
        [req.user.email]
      );
      const user = userRows[0];

      // Fetch all lists and their films for this user (to populate user.lists)
      const [allListRows] = await pool.execute(
        "SELECT l.id AS list_id, l.name, lf.film_id, lf.title, lf.year, lf.poster_url AS posterUrl FROM lists l LEFT JOIN list_films lf ON l.id = lf.list_id WHERE l.user_id = ?",
        [user.id]
      );

      const listsMap = {};
      for (const row of allListRows) {
        if (!listsMap[row.list_id]) {
          listsMap[row.list_id] = { name: row.name, films: [] };
        }
        if (row.film_id) {
          listsMap[row.list_id].films.push({
            id: row.film_id,
            title: row.title,
            year: row.year,
            posterUrl: row.posterUrl,
          });
        }
      }
      user.lists = Object.values(listsMap);

      let list = user.lists.find(lists => lists.name === listname);
      if (!list) {
        // Fallback: Populate mock popular list details with top rated cached films from our database rather than crashing on undefined
        const [movies] = await pool.execute(
          "SELECT tmdb_id AS id, title, release_year AS year, poster_url AS posterUrl FROM movies ORDER BY average_rating DESC LIMIT 12"
        );
        list = {
          name: listname.replace(/-/g, " "),
          films: movies.length > 0 ? movies : [
            { id: 299534, title: "Avengers: Endgame", year: 2019, posterUrl: "https://image.tmdb.org/t/p/w500/or06450A0efTMj6Zw6LcljPdFTq.jpg" }
          ]
        };
      }

      console.log(list);
      res.render("lists/list-detail", { user, list });
    } else {
      res.render("sign-in/login", { error: null });
    }
  } catch (err) {
    console.error("List detail error:", err.message);
    res.redirect("/");
  }
});

// ==================================================================
//  MOCK SOCIAL STORIES FALLBACK REDIRECTS
// ==================================================================
app.get("/:username/story/:storyname", (req, res) => {
  res.redirect("/journal");
});

app.get("/story*", (req, res) => {
  res.redirect("/journal");
});

app.use((req, res, next) => {
  res.status(404).render("error/404");
});

app.listen(PORT, () => {
  console.log(`Letterboxd server running on http://localhost:${PORT}`);
});
