import express from "express";
import fetch from "node-fetch";
import cors from "cors";
import { createClient } from "@supabase/supabase-js";
import querystring from "querystring";
import dotenv from "dotenv";

dotenv.config(); // Load environment variables from .env

const app = express();
app.use(express.json());
app.use(cors());

const clientId = process.env.SPOTIFY_CLIENT_ID;
const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
const redirectUri = process.env.SPOTIFY_REDIRECT_URI;
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
let intervalId;
const supabase = createClient(supabaseUrl, supabaseKey);

// Step 1: Redirect user to Spotify login
app.get("/login", (req, res) => {
  const scopes =
    "user-read-private user-read-email user-top-read user-read-recently-played user-read-currently-playing";
  const queryParams = querystring.stringify({
    client_id: clientId,
    response_type: "code",
    redirect_uri: redirectUri,
    scope: scopes,
  });
  res.redirect(`https://accounts.spotify.com/authorize?${queryParams}`);
});

// Step 2: Handle callback and exchange code for tokens
app.get("/callback", async (req, res) => {
  const code = req.query.code || null;
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: code,
    redirect_uri: redirectUri,
    client_id: clientId,
    client_secret: clientSecret,
  });

  try {
    const tokenResponse = await fetch(
      "https://accounts.spotify.com/api/token",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      }
    );

    if (!tokenResponse.ok) {
      throw new Error("Failed to retrieve access token");
    }

    const tokenData = await tokenResponse.json();
    const { access_token, refresh_token } = tokenData;

    // Save the user info and tokens to your database
    await saveUserInfo(access_token, refresh_token);

    res.send("User information saved successfully!");
  } catch (error) {
    console.error("Error during callback:", error);
    res.status(500).send("An error occurred during authentication.");
  }
});
// Function to save user info and tokens to the database
async function saveUserInfo(access_token, refresh_token) {
  try {
    // Fetch user info from Spotify API
    const userResponse = await fetch("https://api.spotify.com/v1/me", {
      headers: { Authorization: `Bearer ${access_token}` },
    });

    if (!userResponse.ok) {
      console.log(userResponse.status);
      console.log(userResponse.message);
      throw new Error("Failed to fetch user info");
    }

    const userInfo = await userResponse.json();

    // Check if the user already exists in the database
    const { data: existingUser, error: fetchError } = await supabase
      .from("users")
      .select("*")
      .eq("spotify_id", userInfo.id)
      .single();

    if (fetchError && fetchError.code !== "PGRST116") {
      // PGRST116 is 'Row not found'
      console.error("Error checking for existing user:", fetchError);
      return;
    }

    if (existingUser) {
      // User exists, update the tokens and last_refresh timestamp
      await updateUserTokenAndTimestamp(
        existingUser.id,
        access_token,
        refresh_token
      );
      console.log(`Updated tokens for existing user: ${userInfo.display_name}`);
    } else {
      // User doesn't exist, insert new user information
      const { data, error } = await supabase.from("users").insert([
        {
          spotify_id: userInfo.id,
          email: userInfo.email,
          access_token: access_token,
          refresh_token: refresh_token,
          display_name: userInfo.display_name,
          last_refresh: new Date().toISOString(), // Set the initial last_refresh timestamp
        },
      ]);

      if (error) {
        console.error("Error saving new user info:", error);
      } else {
        console.log("New user information saved:", userInfo.display_name);
      }
    }
  } catch (error) {
    console.error("Error saving user info:", error);
  }
}

app.post("/start-background-process", async (req, res) => {
  if (intervalId) {
    clearInterval(intervalId);
  }

  await processUsers();

  intervalId = setInterval(async () => {
    try {
      console.log("processing users");
      await processUsers();
    } catch (error) {
      console.error("Error during background process:", error);
      clearInterval(intervalId);
      intervalId = null;
    }
  }, 10 * 60 * 1000); // Run every 10 minutes

  res.status(200).send("Background process started");
});

async function processUsers() {
  const { data: users, error } = await supabase.from("users").select("*");

  if (error) {
    console.error("Error fetching users from the database:", error);
    return;
  }

  for (const user of users) {
    try {
      console.log("processing user: " + user.display_name);
      // Fetch and save recent plays
      await processUserRecentPlays(user);

      // Check if the token needs to be refreshed
      await checkAndRefreshToken(user);
    } catch (error) {
      console.error(`Error processing user ${user.display_name}:`, error);
    }
  }
}

app.get("/get-top-albums", async (req, res) => {
  try {
    const results = await getTopAlbums(); // Await the promise returned by getTopAlbums()

    if (results && results.length > 0) {
      console.log("Top 3 albums:", results.slice(0, 3)); // Log the top 3 albums
      let top = results.slice(0, 3); // Send the top 3 albums as a response
      let full_top = [];
      for (const album of top) {
        let full_album = await getAlbumArt(accessToken, album.album_id);
        full_album["plays"] = album["count"];
        full_top.push(full_album);
      }
      res.status(200).json(full_top);
    } else {
      console.log("No albums found.");
      res.status(404).json({ message: "No albums found." });
    }
  } catch (e) {
    console.error("Error retrieving top albums:", e);
    res.status(500).json({ error: "Failed to retrieve top albums." });
  }
});

async function processUserRecentPlays(user) {
  try {
    const recentlyPlayed = await getRecentlyPlayed(user.access_token);

    // Add recently played tracks to the database
    for (const track of recentlyPlayed) {
      await addTrackToDB(
        user.spotify_id,
        track.trackId,
        track.trackName,
        track.played_at,
        track.albumName,
        track.albumHref,
        track.albumId
      );
    }

    console.log(`Processed recent plays for user ${user.display_name}`);
  } catch (error) {
    console.error(
      `Error fetching recent plays for user ${user.display_name}:`,
      error
    );
  }
}

async function checkAndRefreshToken(user) {
  const lastRefresh = new Date(user.last_refresh);
  const currentTime = new Date();

  // Check if more than 40 minutes have passed since the last refresh
  if (currentTime - lastRefresh > 40 * 60 * 1000) {
    const { accessToken, refreshToken } = await refreshSpotifyToken(
      user.refresh_token,
      clientId,
      clientSecret
    );

    // Update the user record in the database
    await updateUserTokenAndTimestamp(
      user.spotify_id,
      accessToken,
      refreshToken
    );
  }
}

async function getRecentlyPlayed(token) {
  const TIMEOUT_DURATION = 5000; // 5 seconds

  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("Request timed out")), TIMEOUT_DURATION)
  );

  try {
    const result = await Promise.race([
      fetch("https://api.spotify.com/v1/me/player/recently-played", {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
      }),
      timeoutPromise,
    ]);

    if (!result.ok) {
      throw new Error("Failed to fetch recently played tracks");
    }

    const res = await result.json();
    const albums = res.items.map((item) => {
      return {
        played_at: item.played_at,
        albumType: item.track.album.album_type,
        albumName: item.track.album.name,
        albumHref: item.track.album.href,
        albumId: item.track.album.id,
        trackId: item.track.id,
        trackName: item.track.name,
        trackHref: item.track.href,
      };
    });

    return albums;
  } catch (error) {
    console.error("Error fetching recently played tracks:", error.message);
    throw error;
  }
}

async function addTrackToDB(
  spotify_id,
  trackId,
  trackName,
  playedAt,
  albumName,
  albumHref,
  albumID
) {
  // Check if the track already exists
  if (await trackExists(trackId, playedAt)) {
    //console.log("Track already exists. Not adding.");
    return;
  }

  try {
    const { data, error } = await supabase.from("recent_tracks").insert([
      {
        spotify_id: spotify_id,
        track_id: trackId,
        track_name: trackName,
        played_at: playedAt,
        album_name: albumName,
        album_href: albumHref,
        album_id: albumID,
      },
    ]);

    if (error) {
      console.error("Error writing to the database:", error);
    } else {
      console.log("Track added to the database:", trackName);
    }
  } catch (e) {
    console.log("Error:", e);
  }
}

async function trackExists(trackId, playedAt) {
  const { data, error } = await supabase
    .from("recent_tracks")
    .select("track_id")
    .eq("track_id", trackId)
    .eq("played_at", playedAt);

  if (error) {
    console.error("Error checking if track exists:", error);
    return false;
  }

  return data.length > 0;
}

async function refreshSpotifyToken(oldRefreshToken, clientId, clientSecret) {
  const url = "https://accounts.spotify.com/api/token";
  console.log("Refreshing token...");

  const payload = {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization:
        "Basic " +
        new Buffer.from(clientId + ":" + clientSecret).toString("base64"),
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: oldRefreshToken,
    }),
  };

  try {
    const response = await fetch(url, payload);
    const data = await response.json();

    if (!response.ok) {
      console.error("Failed to refresh token:", data);
      return;
    }
    //console.log(data);
    accessToken = data.access_token;
    if (data.refresh_token) {
      refreshToken = data.refresh_token;
    }

    console.log("Token refreshed successfully");
    return { accessToken, refreshToken };
  } catch (error) {
    console.error("Error refreshing token:", error);
  }
}

async function updateUserTokenAndTimestamp(userId, accessToken, refreshToken) {
  const { error } = await supabase
    .from("users")
    .update({
      access_token: accessToken,
      refresh_token: refreshToken,
      last_refresh: new Date().toISOString(),
    })
    .eq("spotify_id", userId);

  if (error) {
    console.error("Error updating user token and timestamp:", error);
  } else {
    console.log(`User ${userId} token and timestamp updated successfully`);
  }
}

async function getTopAlbums() {
  try {
    const { data, error } = await supabase
      .from("recent_tracks")
      .select("album_id, album_name");

    if (error) {
      console.error("Error selecting from the database:", error);
      return [];
    }

    // Count the occurrences of each album_id
    const albumCounts = data.reduce((acc, track) => {
      const key = `${track.album_id}:${track.album_name}`;
      if (!acc[key]) {
        acc[key] = {
          album_id: track.album_id,
          album_name: track.album_name,
          count: 0,
        };
      }
      acc[key].count += 1;
      return acc;
    }, {});

    // Convert the counts object to an array and sort it
    const sortedAlbums = Object.values(albumCounts).sort(
      (a, b) => b.count - a.count
    );

    return sortedAlbums; // Return the sorted array of albums
  } catch (e) {
    console.log("Error:", e);
    return [];
  }
}

async function getAlbumArt(token, album_id) {
  const url = `https://api.spotify.com/v1/albums/${album_id}`;

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`Error fetching album data: ${response.statusText}`);
    }

    const albumData = await response.json();

    // Assuming you want the album art URL and some basic album info
    const albumInfo = {
      name: albumData.name,
      artist: albumData.artists.map((artist) => artist.name).join(", "),
      release_date: albumData.release_date,
      album_art: albumData.images[0]?.url, // This usually gives the largest image
    };

    return albumInfo;
  } catch (error) {
    console.error("Error fetching album info:", error);
    return null; // Return null or handle the error as needed
  }
}

app.listen(3000, () => {
  console.log("Server running on port 3000");
});
