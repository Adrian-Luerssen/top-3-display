// Spotify credentials
const clientId = "6854283135d647659295e5d773bf05d6"; // Replace with your client id
const params = new URLSearchParams(window.location.search);
const code = params.get("code");

if (code) {
  const { access_token, refresh_token } = await getAccessToken(clientId, code);
  if (access_token) {
    console.log("Access Token obtained:", access_token);

    // Send the access token to the server for background processing
    await fetch("http://localhost:3000/start-background-process", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ access_token, refresh_token }),
    });

    // Start rechecking the access token every 10 minutes
    setInterval(async () => {
      const tokenCheck = await getAccessToken(clientId, code);
      if (!tokenCheck) {
        redirectToMainPage();
      }
    }, 10 * 60 * 1000); // 10 minutes in milliseconds
  } else {
    redirectToMainPage();
  }
} else {
  redirectToAuthCodeFlow(clientId);
}

async function getAccessToken(clientId, code) {
  const verifier = localStorage.getItem("verifier");

  const params = new URLSearchParams();
  params.append("client_id", clientId);
  params.append("grant_type", "authorization_code");
  params.append("code", code);
  params.append("redirect_uri", "http://localhost:5173/callback");
  params.append("code_verifier", verifier);

  try {
    const result = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params,
    });

    if (!result.ok) {
      throw new Error("Failed to retrieve access token");
    }

    const content = await result.json();
    console.log("Content: ", content);
    return {
      access_token: content.access_token,
      refresh_token: content.refresh_token,
    };
  } catch (error) {
    console.error("Error retrieving access token:", error);
    return null;
  }
}

async function redirectToAuthCodeFlow(clientId) {
  const verifier = generateCodeVerifier(128);
  const challenge = await generateCodeChallenge(verifier);

  localStorage.setItem("verifier", verifier);

  const params = new URLSearchParams();
  params.append("client_id", clientId);
  params.append("response_type", "code");
  params.append("redirect_uri", "http://localhost:5173/callback");
  params.append(
    "scope",
    "user-read-private user-read-email user-top-read user-read-recently-played user-read-currently-playing"
  );
  params.append("code_challenge_method", "S256");
  params.append("code_challenge", challenge);

  document.location = `https://accounts.spotify.com/authorize?${params.toString()}`;
}

function redirectToMainPage() {
  window.location.href = "http://localhost:5173"; // Redirect to the main page
}

function generateCodeVerifier(length) {
  let text = "";
  let possible =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

  for (let i = 0; i < length; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

async function generateCodeChallenge(codeVerifier) {
  const data = new TextEncoder().encode(codeVerifier);
  const digest = await window.crypto.subtle.digest("SHA-256", data);
  return btoa(String.fromCharCode.apply(null, [...new Uint8Array(digest)]))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
