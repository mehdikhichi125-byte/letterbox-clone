# Letterboxd Clone: System Architecture & Data Flow Diagrams

This document contains three detailed, high-level diagrams that explain the complete lifecycle, live flows, and storage mechanics of your web application. Together, they explain how every component interacts, where your secrets are loaded, and how your data is saved and viewed.

---

## Diagram 1: The Initialization & Setup Flow
*This diagram explains what happens on "Day 1" (initial setup) versus how the project runs daily using the portable Node and MySQL folders, and how the `.env` file is loaded into the system.*

```mermaid
flowchart TD
    %% Styling (Ensuring black text color:#000 on all boxes)
    classDef config fill:#f9f,stroke:#333,stroke-width:2px,color:#000;
    classDef binary fill:#bbf,stroke:#333,stroke-width:2px,color:#000;
    classDef process fill:#dfd,stroke:#333,stroke-width:2px,color:#000;
    classDef storage fill:#ffd,stroke:#333,stroke-width:2px,color:#000;
    
    subgraph EnvLoad ["1. Environment Configuration"]
        ENV[".env file (Contains API Key, DB User, Pass)"]:::config
    end

    subgraph Portables ["2. Portable Environments (Zero-Install)"]
        BAT["run-everything.bat (Startup Script)"]:::process
        PORT_NODE["node-v24.16.0-win-x64 (Portable Node.js)"]:::binary
        PORT_SQL["mysql-9.7.0-winx64 (Portable MySQL Server)"]:::binary
    end

    subgraph InitialSetup ["3. Database Setup (RUNS ONLY ONCE)"]
        SQL_FILE["database.sql (The Blueprint)"]:::config
        DROP_DB["Drops old database, creates fresh netflix_db, and creates empty tables"]:::process
    end

    subgraph ServerStart ["4. Active Running App (RUNS EVERY TIME)"]
        WEBSITE["Node.js Web App (server.js / tmdb.js)"]:::process
        DB_SERVER["Active MySQL Database Server (mysqld.exe Process)"]:::process
        HDD["Physical Hard Drive (Saves data permanently)"]:::storage
    end

    %% Connections
    BAT -->|1. Starts| PORT_SQL
    BAT -->|2. Launches| PORT_NODE
    
    ENV -->|Loaded on startup via dotenv| PORT_NODE
    ENV -->|Credentials read on startup| PORT_SQL

    SQL_FILE -->|Manually executed ONCE| DB_SERVER
    DB_SERVER -->|Executes structure commands| DROP_DB
    DROP_DB -->|Writes empty tables to disk| HDD

    PORT_NODE -->|Runs| WEBSITE
    PORT_SQL -->|Runs| DB_SERVER
    DB_SERVER <-->|Reads & writes active data| HDD
```

### Key Takeaway for Diagram 1:
*   **`.env`** is loaded at the very beginning of the Node app startup.
*   **`database.sql`** is run **only once** to wipe the old structure and draw empty table "slots" on your **Hard Drive**.
*   **Portable folders** are started by `run-everything.bat` so you don't have to install Node or MySQL on Windows.

---

## Diagram 2: The Live Web Interactions & Movie Fetching Flow
*This diagram explains what happens in real time when a user visits the homepage, searches for a movie, registers an account, or adds a movie to their watchlist.*

```mermaid
flowchart TD
    %% Styling (Ensuring black text color:#000 on all boxes)
    classDef client fill:#bbf,stroke:#333,stroke-width:2px,color:#000;
    classDef server fill:#dfd,stroke:#333,stroke-width:2px,color:#000;
    classDef external fill:#ffd,stroke:#333,stroke-width:2px,color:#000;
    classDef db fill:#f9f,stroke:#333,stroke-width:2px,color:#000;

    USER["User Browser (Client)"]:::client

    subgraph WebServer ["Node.js Application Server"]
        SRV["server.js (Handles HTTP requests)"]:::server
        TMDB_JS["tmdb.js (Handles TMDb movie logic)"]:::server
        MYSQL_JS["mysql.js (Messenger/Connection Pool)"]:::server
    end

    subgraph ExternalAPI ["External Movie API"]
        TMDB["TMDb API Servers (The Movie Database)"]:::external
    end

    subgraph DBSpace ["Active Database Storage"]
        MYSQL_SRV["MySQL Server Process (mysqld.exe)"]:::db
        HDD["Physical Hard Drive Files (netflix_db)"]:::db
    end

    %% Flows
    %% Flow A: Browsing / Fetching
    USER -->|1. Visits Homepage /| SRV
    SRV -->|2. Asks for popular movies| TMDB_JS
    TMDB_JS -->|3. Makes request with API Key| TMDB
    TMDB -->|4. Sends back raw movie JSON| TMDB_JS
    TMDB_JS -->|5. Caches movies using pool| MYSQL_JS
    MYSQL_JS -->|6. Sends INSERT IGNORE| MYSQL_SRV
    MYSQL_SRV -->|7. Saves movies permanently| HDD
    TMDB_JS -->|8. Returns movies| SRV
    SRV -->|9. Renders home page HTML| USER

    %% Flow B: Interactive User Actions
    USER -.->|A. Clicks Register or Add to Watchlist| SRV
    SRV -.->|B. Calls SQL execution| MYSQL_JS
    MYSQL_JS -.->|C. Sends INSERT INTO users or watchlist| MYSQL_SRV
    MYSQL_SRV -.->|D. Writes records to disk| HDD
    MYSQL_SRV -.->|E. Confirms success| MYSQL_JS
    SRV -.->|F. Sends Success Response| USER
```

### Key Takeaway for Diagram 2:
*   **`tmdb.js`** contacts the external TMDb server using your secret API key, fetches movie data, and caches it in your local database using `mysql.js`.
*   **`mysql.js`** acts as the delivery driver. When the user performs an action (like registering or adding a watchlist item), it carries the data to the MySQL Server database.

---

## Diagram 3: Database Administration, Viewer & Update Patch Flow
*This diagram explains how the Database Viewer connects to your system, how it reads from the disk, and how running a separate script like `update-procedure.sql` upgrades your rules without deleting user data.*

```mermaid
flowchart TD
    %% Styling (Ensuring black text color:#000 on all boxes)
    classDef app fill:#dfd,stroke:#333,stroke-width:2px,color:#000;
    classDef viewer fill:#bbf,stroke:#333,stroke-width:2px,color:#000;
    classDef server fill:#f9f,stroke:#333,stroke-width:2px,color:#000;
    classDef patch fill:#ffd,stroke:#333,stroke-width:2px,color:#000;

    WEBSITE["Website (server.js / mysql.js)"]:::app

    subgraph ViewerPanel ["Visual Administration Tools"]
        VIEWER["Database Viewer (VS Code Database Client)"]:::viewer
    end

    subgraph DatabaseEngine ["MySQL Database Server Engine"]
        MYSQL_SRV["Active MySQL Server (Listening on Port 3306)"]:::server
        HDD["Physical Hard Drive (Contains netflix_db files)"]:::server
    end

    subgraph SafePatching ["Safe Stored Procedure Patching"]
        PATCH_FILE["update-procedure.sql (The wallpaper change)"]:::patch
    end

    subgraph DatabaseNotes ["Important System Notes"]
        NOTE_BOX["Data tables (users, watchlist) are NOT touched! Only the rule logic is updated."]:::patch
    end

    %% Flows
    %% Viewer Connection
    VIEWER -->|1. Requests connection via Port 3306| MYSQL_SRV
    MYSQL_SRV -->|2. Authorizes user| HDD
    MYSQL_SRV -->|3. Reads raw table rows| HDD
    MYSQL_SRV -->|4. Hands rows to Viewer| VIEWER
    VIEWER -->|5. Displays data grids on screen| VIEWER

    %% Website Live Queries
    WEBSITE -->|Executes user commands| MYSQL_SRV

    %% Stored Procedure Update
    PATCH_FILE -->|Executed by developer| MYSQL_SRV
    MYSQL_SRV -->|Drops old and recreates new logic safely| HDD
```

### Key Takeaway for Diagram 3:
*   The **Database Viewer** connects directly to the **MySQL Server** on Port 3306 (completely independent of your website).
*   **`update-procedure.sql`** is loaded directly into the server to update the stored procedure rules (like changing the subscription logic) without running any destructive commands on the actual tables where your users' active accounts are stored.
