# Spotify Stream Collector

This project collects your Spotify listening history and provides an API for accessing streaming data. It includes a simple front-end that allows users to log into Spotify and register, enabling data collection.

## Features
- **Spotify OAuth Login**: Users can authenticate with their Spotify accounts.
- **Data Collection**: The app retrieves and stores users' listening history.
- **REST API**: Provides endpoints to access stored streaming data.
- **Frontend**: A basic UI for logging in and managing data.
- **WebSocket Support**: Live updates for top albums.

## Setup Instructions

### 1. Clone the Repository
```
git clone https://github.com/your-repo/spotify-stream-collector.git
cd spotify-stream-collector
```

### 2. Create a `.env` File
Add the following variables in a `.env` file at the root of the project:

```
SPOTIFY_CLIENT_ID=your_client_id
SPOTIFY_CLIENT_SECRET=your_client_secret
SPOTIFY_REDIRECT_URI=your_redirect_uri
SUPABASE_URL=your_supabase_url
SUPABASE_KEY=your_supabase_key
```

### 3. Install Dependencies
```
npm install
```

### 4. Run the Application
```
npm run start
```

## API Endpoints

### Authentication & User Management
| Method | Endpoint | Description |
|--------|---------|-------------|
| `GET`  | `/login` | Redirects to Spotify for user authentication |
| `GET`  | `/callback` | Handles OAuth callback and exchanges the authorization code for tokens |
| `GET`  | `/personal` | Serves the user's personal dashboard |
| `GET`  | `/global` | Serves the global dashboard |

### User Data & Streaming History
| Method | Endpoint | Description |
|--------|---------|-------------|
| `GET`  | `/get-top-albums/:spotify_id` | Retrieves the top albums for a specific user |
| `GET`  | `/get-top-albums/:spotify_id/:album_number` | Retrieves a specific top album by ranking for a user |
| `GET`  | `/get-recent-plays/:spotify_id` | Retrieves recently played tracks for a user |
| `GET`  | `/get-global-top-albums` | Retrieves globally popular albums |

### WebSockets
- WebSocket connections are used to send live updates on user and global top albums.

## Tech Stack
- **Backend**: Node.js, Express
- **Database**: Supabase
- **Auth**: Spotify OAuth 2.0
- **Frontend**: React (or plain HTML/CSS)
- **WebSockets**: Real-time updates using `socket.io`

## Notes
- Ensure you have a Spotify Developer App set up to get your `clientId`, `clientSecret`, and `redirectUri`.
- Supabase is used for storing user data. Create a project in [Supabase](https://supabase.com/) and obtain the URL and API key.

## License
MIT License
