import express from "express";
import fetch from "node-fetch";
import cors from "cors";

import { createClient } from "@supabase/supabase-js";

const app = express();

app.use(express.json());
app.use(cors());
const clientId = "6854283135d647659295e5d773bf05d6"; // Replace with your client id
const clientSecret = "e37af17d66cc41238ecd4a9b82596f8e";
const supabaseUrl = "https://nxlwnxbyzkqjhxnjwuvt.supabase.co";
const supabaseKey =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im54bHdueGJ5emtxamh4bmp3dXZ0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3MjUzMTU0MjYsImV4cCI6MjA0MDg5MTQyNn0.qVH4JS-qzQr8x1iXA5bZRaY1-nWPUu5T3Zay9-dypks";
const supabase = createClient(supabaseUrl, supabaseKey);

let accessToken = null;
let refreshToken = null;
let intervalId = null;
let fetchesSinceRefresh = 0;

app.post("/start-background-process", async (req, res) => {
  accessToken = req.body.access_token;
  refreshToken = req.body.refresh_token;

  if (intervalId) {
    clearInterval(intervalId);
  }
  const recentlyPlayed = await getRecentlyPlayed(accessToken);
  //console.log("Recently played tracks:", recentlyPlayed);
  intervalId = setInterval(async () => {
    try {
      fetchesSinceRefresh++;
      const recentlyPlayed = await getRecentlyPlayed(accessToken);
      console.log("Fetches since last token refresh: ", fetchesSinceRefresh);
      if (fetchesSinceRefresh > 4) {
        fetchesSinceRefresh = 0;
        //console.log("token before: ", accessToken);
        await refreshSpotifyToken(refreshToken, clientId, clientSecret);
        //console.log("token after:  ", accessToken);
      }
      //console.log("Recently played tracks:", recentlyPlayed);
    } catch (error) {
      console.error("Error fetching recently played tracks:", error);

      // Stop the background process if there's an error
      clearInterval(intervalId);
      intervalId = null;
    }
  }, 10 * 60 * 1000); // 10 minutes

  res.status(200).send("Background process started");
});

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

async function getRecentlyPlayed(token) {
  // Set the timeout duration in milliseconds
  const TIMEOUT_DURATION = 5000; // 5 seconds
  console.log("Getting Recent Tracks");
  // Function to handle the timeout
  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("Request timed out")), TIMEOUT_DURATION)
  );

  try {
    // Race between the fetch request and the timeout
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

    for (const album of albums) {
      if (album.albumType != "album") continue;
      await addTrackToDB(
        album.trackId,
        album.trackName,
        album.played_at,
        album.albumName,
        album.albumHref,
        album.albumId
      );
    }
    return albums;
  } catch (error) {
    console.error("Error fetching recently played tracks:", error.message);
    // Handle the error (e.g., retry, notify the user, etc.)
    await refreshSpotifyToken(refreshToken, clientId, clientSecret);

    throw error;
  }
}

async function addTrackToDB(
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
