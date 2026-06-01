const mysql = require('mysql2/promise');
require('dotenv').config();

// ──────────────────────────────────────────────────────────────
//  MySQL Connection Pool
//  Uses mysql2/promise for automatic connection management.
//  Reads credentials from .env — falls back to portable MySQL
//  defaults (root user, no password, netflix_db database).
// ──────────────────────────────────────────────────────────────
const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD !== undefined ? process.env.DB_PASSWORD : '',
  database: process.env.DB_NAME || 'netflix_db',
  port: parseInt(process.env.DB_PORT) || 3306,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

// ──────────────────────────────────────────────────────────────
//  testConnection()
//  Checks if the MySQL database is reachable. Called once on
//  server startup. If the connection fails, it logs a helpful
//  error message telling the user how to start MySQL.
// ──────────────────────────────────────────────────────────────
async function testConnection() {
  try {
    const connection = await pool.getConnection();
    console.log('✔  MySQL connected successfully to database:', process.env.DB_NAME || 'netflix_db');
    connection.release();
    return true;
  } catch (err) {
    console.error('');
    console.error('══════════════════════════════════════════════════════');
    console.error('  ✖  MySQL Connection Failed');
    console.error('══════════════════════════════════════════════════════');
    console.error('');
    console.error('  Error:', err.message);
    console.error('');
    console.error('  MySQL is not running. Please start it first with:');
    console.error('');
    console.error('    .\\mysql-9.7.0-winx64\\bin\\mysqld.exe --console');
    console.error('');
    console.error('  Or double-click "run-database.bat" in the project folder.');
    console.error('  MySQL must be running BEFORE starting the website.');
    console.error('');
    console.error('══════════════════════════════════════════════════════');
    console.error('');
    return false;
  }
}

// ──────────────────────────────────────────────────────────────
//  initializeDatabase()
//  Runs once on startup after the connection is verified.
//  Ensures required tables and triggers exist so the app
//  doesn't crash on a freshly imported database.
// ──────────────────────────────────────────────────────────────
async function initializeDatabase() {
  let connection;
  try {
    connection = await pool.getConnection();

    // 1. Ensure likes table exists (not in original database.sql)
    await connection.query(`
      CREATE TABLE IF NOT EXISTS likes (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        movie_id INT NOT NULL,
        liked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (movie_id) REFERENCES movies(id) ON DELETE CASCADE,
        UNIQUE KEY unique_user_movie (user_id, movie_id)
      )
    `);
    console.log('✔  Verified likes table');

    // 2. Ensure watch_history, watchlist, ratings have 'title' column
    const tablesToCheck = ['watch_history', 'watchlist', 'ratings'];
    for (const table of tablesToCheck) {
      try {
        await connection.query(`ALTER TABLE ${table} ADD COLUMN title VARCHAR(255) DEFAULT NULL`);
        console.log(`   Added title column to ${table}`);
      } catch (err) {
        // ER_DUP_FIELDNAME means column already exists — safe to ignore
        if (err.code !== 'ER_DUP_FIELDNAME') {
          console.error(`   Warning: Could not add title to ${table}:`, err.message);
        }
      }
    }

    // 3. Populate existing rows where title is NULL from movies table
    try {
      await connection.query("UPDATE watch_history wh JOIN movies m ON wh.movie_id = m.id SET wh.title = m.title WHERE wh.title IS NULL");
      await connection.query("UPDATE watchlist w JOIN movies m ON w.movie_id = m.id SET w.title = m.title WHERE w.title IS NULL");
      await connection.query("UPDATE ratings r JOIN movies m ON r.movie_id = m.id SET r.title = m.title WHERE r.title IS NULL");
      console.log('✔  Populated empty title fields');
    } catch (err) {
      console.error('   Warning: Could not populate titles:', err.message);
    }

    // 4. Register before-insert triggers for auto-populating titles
    //    (safe to recreate — uses DROP IF EXISTS first)
    try {
      await connection.query("DROP TRIGGER IF EXISTS before_watch_insert_title");
      await connection.query(`
        CREATE TRIGGER before_watch_insert_title
        BEFORE INSERT ON watch_history
        FOR EACH ROW
        BEGIN
          DECLARE m_title VARCHAR(255);
          SELECT title INTO m_title FROM movies WHERE id = NEW.movie_id;
          SET NEW.title = m_title;
        END
      `);

      await connection.query("DROP TRIGGER IF EXISTS before_watchlist_insert_title");
      await connection.query(`
        CREATE TRIGGER before_watchlist_insert_title
        BEFORE INSERT ON watchlist
        FOR EACH ROW
        BEGIN
          DECLARE m_title VARCHAR(255);
          SELECT title INTO m_title FROM movies WHERE id = NEW.movie_id;
          SET NEW.title = m_title;
        END
      `);

      await connection.query("DROP TRIGGER IF EXISTS before_rating_insert_title");
      await connection.query(`
        CREATE TRIGGER before_rating_insert_title
        BEFORE INSERT ON ratings
        FOR EACH ROW
        BEGIN
          DECLARE m_title VARCHAR(255);
          SELECT title INTO m_title FROM movies WHERE id = NEW.movie_id;
          SET NEW.title = m_title;
        END
      `);
      console.log('✔  Title triggers registered');
    } catch (err) {
      console.error('   Warning: Could not register triggers:', err.message);
    }

    console.log('✔  Database initialization complete');
  } catch (err) {
    console.error('✖  Failed to initialize database:', err.message);
  } finally {
    if (connection) connection.release();
  }
}

// ──────────────────────────────────────────────────────────────
//  Run startup checks
// ──────────────────────────────────────────────────────────────
testConnection().then((connected) => {
  if (connected) {
    initializeDatabase();
  }
});

// ──────────────────────────────────────────────────────────────
//  Exports
// ──────────────────────────────────────────────────────────────
module.exports = pool;
module.exports.testConnection = testConnection;
