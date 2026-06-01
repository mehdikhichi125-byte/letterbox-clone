DROP DATABASE IF EXISTS netflix_db;

CREATE DATABASE netflix_db;

USE netflix_db;

-- 1. users
--    Stores registered user accounts.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL UNIQUE,
    password VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ------------------------------------------------------------
-- 2. subscriptions
--    Tracks each user's subscription plan and its status.
--    plan_type can be: 'basic', 'standard', 'premium'
--    status can be: 'active', 'expired', 'cancelled'
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS subscriptions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    plan_type VARCHAR(20) NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE DEFAULT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'active',
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);

-- ------------------------------------------------------------
-- 3. movies
--    Central movie catalogue. tmdb_id links to the TMDB API.
--    total_views and average_rating are auto-updated by triggers.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS movies (
    id INT AUTO_INCREMENT PRIMARY KEY,
    tmdb_id INT DEFAULT NULL,
    title VARCHAR(255) NOT NULL,
    genre VARCHAR(100) DEFAULT NULL,
    description TEXT DEFAULT NULL,
    poster_url VARCHAR(500) DEFAULT NULL,
    release_year INT DEFAULT NULL,
    total_views INT DEFAULT 0,
    average_rating DECIMAL(3, 1) DEFAULT 0.0
);

-- ------------------------------------------------------------
-- 4. watch_history
--    Logs every movie a user watches and how far they got.
--    progress_seconds stores playback position for "Continue
--    Watching" feature.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS watch_history (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    movie_id INT NOT NULL,
    title VARCHAR(255) DEFAULT NULL,
    watched_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    progress_seconds INT DEFAULT 0,
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    FOREIGN KEY (movie_id) REFERENCES movies (id) ON DELETE CASCADE
);

-- ------------------------------------------------------------
-- 5. watchlist
--    Movies a user has saved to watch later.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS watchlist (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    movie_id INT NOT NULL,
    title VARCHAR(255) DEFAULT NULL,
    added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    FOREIGN KEY (movie_id) REFERENCES movies (id) ON DELETE CASCADE
);

-- ------------------------------------------------------------
-- 6. ratings
--    User ratings for movies (1-10 scale).
--    reviewed_at records when the rating was submitted.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ratings (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    movie_id INT NOT NULL,
    title VARCHAR(255) DEFAULT NULL,
    rating DECIMAL(3, 1) NOT NULL,
    reviewed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    FOREIGN KEY (movie_id) REFERENCES movies (id) ON DELETE CASCADE
);

-- ============================================================
--  SECTION 2 : INDEXES
--  Speed up the most common queries: search bar, genre filter,
--  and per-user history / watchlist lookups.
-- ============================================================

-- Fast search bar results (LIKE '%keyword%' or FULLTEXT)
CREATE INDEX idx_movies_title ON movies (title);

-- Genre filtering on browse page
CREATE INDEX idx_movies_genre ON movies (genre);

-- Loading a specific user's watch history quickly
CREATE INDEX idx_watch_history_user ON watch_history (user_id);

-- Loading a specific user's watchlist quickly
CREATE INDEX idx_watchlist_user ON watchlist (user_id);

-- ============================================================
--  SECTION 3 : STORED PROCEDURES
-- ============================================================

DELIMITER / /

-- ------------------------------------------------------------
-- PROCEDURE: AddToWatchlist
--   Adds a movie to a user's watchlist.
--   First checks if the movie is already in the watchlist
--   to prevent duplicate entries.
-- ------------------------------------------------------------
CREATE PROCEDURE AddToWatchlist(
  IN p_userId  INT,
  IN p_movieId INT
)
BEGIN
  DECLARE existing_count INT DEFAULT 0;

  -- Error handler: if anything goes wrong, return a message
  DECLARE EXIT HANDLER FOR SQLEXCEPTION
  BEGIN
    SELECT 'Error: Could not add movie to watchlist.' AS error_message;
  END;

  -- Check if this movie is already in the user's watchlist
  SELECT COUNT(*) INTO existing_count
  FROM watchlist
  WHERE user_id = p_userId AND movie_id = p_movieId;

  IF existing_count > 0 THEN
    SELECT 'This movie is already in your watchlist.' AS message;
  ELSE
    INSERT INTO watchlist (user_id, movie_id)
    VALUES (p_userId, p_movieId);
    SELECT 'Movie added to your watchlist successfully.' AS message;
  END IF;
END //

-- ------------------------------------------------------------
-- PROCEDURE: ActivateSubscription
--   Uses a TRANSACTION to safely insert a new subscription.
--   If the user already has an active plan of the same type,
--   it raises an error and rolls back.
--
--   MySQL equivalent of TRY/CATCH + THROW/RAISE:
--     - DECLARE EXIT HANDLER FOR SQLEXCEPTION  = CATCH
--     - SIGNAL SQLSTATE '45000'                 = THROW / RAISERROR
-- ------------------------------------------------------------
CREATE PROCEDURE ActivateSubscription(
  IN p_userId   INT,
  IN p_planType VARCHAR(20)
)
BEGIN
  DECLARE active_count INT DEFAULT 0;

  DECLARE EXIT HANDLER FOR SQLEXCEPTION
  BEGIN
    ROLLBACK;
    RESIGNAL;
  END;

  -- Validate plan type
  IF LOWER(p_planType) NOT IN ('basic', 'standard', 'premium') THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Invalid subscription plan selected.';
  END IF;

  START TRANSACTION;

    -- Check if user already has any active subscription
    SELECT COUNT(*) INTO active_count
    FROM subscriptions
    WHERE user_id = p_userId
      AND status = 'active';

    IF active_count > 0 THEN
      SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'You already have an active subscription on this account.';
    END IF;

    -- Insert the new subscription
    INSERT INTO subscriptions (user_id, plan_type, start_date, end_date, status)
    VALUES (p_userId, LOWER(p_planType), CURDATE(), DATE_ADD(CURDATE(), INTERVAL 30 DAY), 'active');

  COMMIT;

  SELECT 'Subscription activated successfully.' AS message;
END //

-- ------------------------------------------------------------
-- PROCEDURE: RecordWatchHistory
--   Inserts a new watch history record, or updates the
--   progress_seconds if the user already has a record for
--   that movie (upsert pattern).
-- ------------------------------------------------------------
CREATE PROCEDURE RecordWatchHistory(
  IN p_userId          INT,
  IN p_movieId         INT,
  IN p_progressSeconds INT
)
BEGIN
  DECLARE existing_id INT DEFAULT NULL;

  -- Error handler
  DECLARE EXIT HANDLER FOR SQLEXCEPTION
  BEGIN
    SELECT 'Error: Could not record watch history.' AS error_message;
  END;

  -- Check if a watch history record already exists
  SELECT id INTO existing_id
  FROM watch_history
  WHERE user_id = p_userId AND movie_id = p_movieId
  ORDER BY watched_at DESC
  LIMIT 1;

  IF existing_id IS NOT NULL THEN
    -- Update existing record with new progress
    UPDATE watch_history
    SET progress_seconds = p_progressSeconds,
        watched_at = CURRENT_TIMESTAMP
    WHERE id = existing_id;
    SELECT 'Watch history updated.' AS message;
  ELSE
    -- Insert new record
    INSERT INTO watch_history (user_id, movie_id, progress_seconds)
    VALUES (p_userId, p_movieId, p_progressSeconds);
    SELECT 'Watch history recorded.' AS message;
  END IF;
END //

-- ============================================================
--  SECTION 4 : TRIGGERS
-- ============================================================

-- ------------------------------------------------------------
-- TRIGGER: after_watch_insert
--   Fires AFTER INSERT on watch_history.
--   Automatically increments the total_views counter on the
--   movies table so we always have an up-to-date view count
--   without running a separate COUNT query.
-- ------------------------------------------------------------
CREATE TRIGGER after_watch_insert
AFTER INSERT ON watch_history
FOR EACH ROW
BEGIN
  UPDATE movies
  SET total_views = total_views + 1
  WHERE id = NEW.movie_id;
END //

-- ------------------------------------------------------------
-- TRIGGER: after_rating_insert
--   Fires AFTER INSERT on ratings.
--   Recalculates and updates the average_rating on the movies
--   table using all existing ratings for that movie.
-- ------------------------------------------------------------
CREATE TRIGGER after_rating_insert
AFTER INSERT ON ratings
FOR EACH ROW
BEGIN
  DECLARE new_avg DECIMAL(3,1);

  -- Calculate the new average from all ratings for this movie
  SELECT AVG(rating) INTO new_avg
  FROM ratings
  WHERE movie_id = NEW.movie_id;

  UPDATE movies
  SET average_rating = new_avg
  WHERE id = NEW.movie_id;
END //

-- ------------------------------------------------------------
-- TRIGGER: before_watch_insert_title
--   Fires BEFORE INSERT on watch_history.
--   Automatically fetches and records the movie title.
-- ------------------------------------------------------------
CREATE TRIGGER before_watch_insert_title
BEFORE INSERT ON watch_history
FOR EACH ROW
BEGIN
  DECLARE m_title VARCHAR(255);
  SELECT title INTO m_title FROM movies WHERE id = NEW.movie_id;
  SET NEW.title = m_title;
END //

-- ------------------------------------------------------------
-- TRIGGER: before_watchlist_insert_title
--   Fires BEFORE INSERT on watchlist.
--   Automatically fetches and records the movie title.
-- ------------------------------------------------------------
CREATE TRIGGER before_watchlist_insert_title
BEFORE INSERT ON watchlist
FOR EACH ROW
BEGIN
  DECLARE m_title VARCHAR(255);
  SELECT title INTO m_title FROM movies WHERE id = NEW.movie_id;
  SET NEW.title = m_title;
END //

-- ------------------------------------------------------------
-- TRIGGER: before_rating_insert_title
--   Fires BEFORE INSERT on ratings.
--   Automatically fetches and records the movie title.
-- ------------------------------------------------------------
CREATE TRIGGER before_rating_insert_title
BEFORE INSERT ON ratings
FOR EACH ROW
BEGIN
  DECLARE m_title VARCHAR(255);
  SELECT title INTO m_title FROM movies WHERE id = NEW.movie_id;
  SET NEW.title = m_title;
END //

-- ============================================================
--  SECTION 5 : USER DEFINED FUNCTIONS (UDFs)
-- ============================================================

-- ------------------------------------------------------------
-- FUNCTION: GetMatchScore
--   Compares a movie's genre with the user's most-watched genre.
--   Returns a match percentage between 60 and 99.
--   - If the genre matches exactly → returns 99  (best match)
--   - If no match                  → returns 60  (base score)
--   This is used for the "% Match" badge on movie cards
--   (similar to Netflix's match percentage).
-- ------------------------------------------------------------
CREATE FUNCTION GetMatchScore(
  p_userId  INT,
  p_movieId INT
)
RETURNS INT
DETERMINISTIC
READS SQL DATA
BEGIN
  DECLARE user_top_genre VARCHAR(100);
  DECLARE movie_genre    VARCHAR(100);
  DECLARE match_score    INT;

  -- Find the user's most-watched genre
  SELECT m.genre INTO user_top_genre
  FROM watch_history wh
  JOIN movies m ON wh.movie_id = m.id
  WHERE wh.user_id = p_userId
    AND m.genre IS NOT NULL
  GROUP BY m.genre
  ORDER BY COUNT(*) DESC
  LIMIT 1;

  -- Get the genre of the target movie
  SELECT genre INTO movie_genre
  FROM movies
  WHERE id = p_movieId;

  -- Compare: exact match = 99, no match = random between 60-85
  IF user_top_genre IS NOT NULL AND movie_genre IS NOT NULL
     AND user_top_genre = movie_genre THEN
    SET match_score = 99;
  ELSE
    -- Base score between 60-85 for non-matching genres
    -- Uses a deterministic formula based on movie id
    SET match_score = 60 + (p_movieId % 26);
    -- Clamp to max 99
    IF match_score > 99 THEN
      SET match_score = 99;
    END IF;
  END IF;

  RETURN match_score;
END //

-- ------------------------------------------------------------
-- FUNCTION: GetAverageRating
--   Returns the average rating for any given movie.
--   If no ratings exist, returns 0.0.
-- ------------------------------------------------------------
CREATE FUNCTION GetAverageRating(
  p_movieId INT
)
RETURNS DECIMAL(3,1)
DETERMINISTIC
READS SQL DATA
BEGIN
  DECLARE avg_rating DECIMAL(3,1);

  SELECT AVG(rating) INTO avg_rating
  FROM ratings
  WHERE movie_id = p_movieId;

  -- If no ratings exist, return 0.0
  IF avg_rating IS NULL THEN
    SET avg_rating = 0.0;
  END IF;

  RETURN avg_rating;
END //

-- ============================================================
--  SECTION 6 : JOIN-BASED STORED PROCEDURES
-- ============================================================

-- ------------------------------------------------------------
-- PROCEDURE: GetContinueWatching
--   JOIN: watch_history + movies
--   Returns the last 10 movies the user was watching,
--   ordered by most recently watched. This powers the
--   "Continue Watching" row on the homepage.
-- ------------------------------------------------------------
CREATE PROCEDURE GetContinueWatching(
  IN p_userId INT
)
BEGIN
  -- Error handler
  DECLARE EXIT HANDLER FOR SQLEXCEPTION
  BEGIN
    SELECT 'Error: Could not load continue watching list.' AS error_message;
  END;

  SELECT
    m.id            AS movie_id,
    m.title         AS title,
    m.genre         AS genre,
    m.poster_url    AS poster_url,
    m.release_year  AS release_year,
    wh.progress_seconds AS progress_seconds,
    wh.watched_at       AS last_watched
  FROM watch_history wh
  JOIN movies m ON wh.movie_id = m.id
  WHERE wh.user_id = p_userId
  ORDER BY wh.watched_at DESC
  LIMIT 10;
END //

-- ------------------------------------------------------------
-- PROCEDURE: GetUserWatchlist
--   JOIN: watchlist + movies
--   Returns all movies in the user's watchlist with full
--   movie details (title, genre, poster, rating, etc.)
-- ------------------------------------------------------------
CREATE PROCEDURE GetUserWatchlist(
  IN p_userId INT
)
BEGIN
  -- Error handler
  DECLARE EXIT HANDLER FOR SQLEXCEPTION
  BEGIN
    SELECT 'Error: Could not load watchlist.' AS error_message;
  END;

  SELECT
    m.id              AS movie_id,
    m.tmdb_id         AS tmdb_id,
    m.title           AS title,
    m.genre           AS genre,
    m.description     AS description,
    m.poster_url      AS poster_url,
    m.release_year    AS release_year,
    m.total_views     AS total_views,
    m.average_rating  AS average_rating,
    w.added_at        AS added_at
  FROM watchlist w
  JOIN movies m ON w.movie_id = m.id
  WHERE w.user_id = p_userId
  ORDER BY w.added_at DESC;
END //

-- ------------------------------------------------------------
-- PROCEDURE: GetUserDashboard
--   JOIN: users + subscriptions + watch_history + movies
--   Returns the user's name, their current plan type, and
--   their last 5 watched movies. This powers the user's
--   profile / dashboard page.
-- ------------------------------------------------------------
CREATE PROCEDURE GetUserDashboard(
  IN p_userId INT
)
BEGIN
  -- Error handler
  DECLARE EXIT HANDLER FOR SQLEXCEPTION
  BEGIN
    SELECT 'Error: Could not load user dashboard.' AS error_message;
  END;

  -- Return user info with subscription and recent watch history
  SELECT
    u.id              AS user_id,
    u.name            AS user_name,
    u.email           AS user_email,
    s.plan_type       AS plan_type,
    s.status          AS subscription_status,
    s.start_date      AS subscription_start,
    s.end_date        AS subscription_end,
    m.id              AS movie_id,
    m.title           AS movie_title,
    m.genre           AS movie_genre,
    m.poster_url      AS movie_poster,
    wh.watched_at     AS watched_at,
    wh.progress_seconds AS progress_seconds
  FROM users u
  LEFT JOIN subscriptions s
    ON u.id = s.user_id AND s.status = 'active'
  LEFT JOIN watch_history wh
    ON u.id = wh.user_id
  LEFT JOIN movies m
    ON wh.movie_id = m.id
  WHERE u.id = p_userId
  ORDER BY wh.watched_at DESC
  LIMIT 5;
END //

DELIMITER;

-- ============================================================
--  SECTION 7 : LISTS TABLES (for the Letterboxd list feature)
--  These tables support the existing list functionality
--  from the original app (server.js routes).
-- ============================================================

-- User-created lists (e.g. "My Favourites", "Watch Later")
CREATE TABLE IF NOT EXISTS lists (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    name VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);

-- Films within each list
CREATE TABLE IF NOT EXISTS list_films (
    id INT AUTO_INCREMENT PRIMARY KEY,
    list_id INT NOT NULL,
    film_id INT NOT NULL,
    title VARCHAR(255) NOT NULL,
    year VARCHAR(10) DEFAULT NULL,
    poster_url VARCHAR(500) DEFAULT NULL,
    FOREIGN KEY (list_id) REFERENCES lists (id) ON DELETE CASCADE
);

-- ============================================================
--  TMDB INTEGRATION: Unique index on tmdb_id for INSERT IGNORE
-- so we don't duplicate movies
-- ============================================================
CREATE UNIQUE INDEX idx_tmdb_id ON movies (tmdb_id);

-- ============================================================
--  DONE — Schema is ready.
--  To verify, run:  SHOW TABLES;
--  Expected: 8 tables (users, subscriptions, movies,
--            watch_history, watchlist, ratings, lists, list_films)
-- ============================================================