from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse
import spotipy
from spotipy.oauth2 import SpotifyOAuth
import os
from dotenv import load_dotenv
import logging
from pydantic import BaseModel
from typing import List, Optional
import asyncio
import logic

load_dotenv()

# Logger
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI()

# Configuration
CLIENT_ID = os.getenv("SPOTIPY_CLIENT_ID")
CLIENT_SECRET = os.getenv("SPOTIPY_CLIENT_SECRET")
REDIRECT_URI = os.getenv("SPOTIPY_REDIRECT_URI", "http://127.0.0.1:8000/callback")
SCOPE = "playlist-read-private playlist-modify-public playlist-modify-private user-library-read"

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:5174"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global Auth Manager (for generating URLs, checking tokens)
sp_oauth = SpotifyOAuth(
    client_id=CLIENT_ID,
    client_secret=CLIENT_SECRET,
    redirect_uri=REDIRECT_URI,
    scope=SCOPE,
    open_browser=False
)

# --- Models ---
class AnalyzeRequest(BaseModel):
    playlist_link: Optional[str] = None
    playlist_id: Optional[str] = None
    access_token: str
    tracks: Optional[List[dict]] = None

class CreatePlaylistRequest(BaseModel):
    tracks: List[dict] # Full track objects with IDs
    name: str
    access_token: str

class Track(BaseModel):
    id: str
    name: str
    artist: str
    image: Optional[str]
    duration_ms: int
    bpm: float = 0
    key: str = "?"
    energy: float = 0

# --- Endpoints ---

@app.get("/login")
def login():
    """
    Redirects the user to the Spotify Permission Screen.
    Uses the Authorization Code Flow.
    """
    auth_url = sp_oauth.get_authorize_url()
    return RedirectResponse(auth_url)

@app.get("/callback")
def callback(code: str):
    """
    Handles the callback from Spotify after user login.
    Exchanges the auth code for an access token.
    Redirects back to the frontend with the token in the URL.
    """
    try:
        token_info = sp_oauth.get_access_token(code)
        access_token = token_info['access_token']
        # Redirect back to frontend with token
        return RedirectResponse(f"http://localhost:5173?token={access_token}")
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

from fastapi.responses import StreamingResponse
import json

@app.post("/analyze")
async def analyze_playlist(req: AnalyzeRequest):
    """
    Analyzes playlist and streams results via SSE.
    """
    async def event_generator():
        try:
            sp = spotipy.Spotify(auth=req.access_token)
            
            to_analyze = []
            
            if req.tracks and len(req.tracks) > 0:
                # Mode A: Re-analyze provided tracks
                yield json.dumps({"type": "progress", "msg": f"Re-analyzing {len(req.tracks)} tracks..."}) + "\n"
                to_analyze = req.tracks
            elif req.playlist_link:
                # Mode B: Fetch from Spotify
                playlist_id = req.playlist_link.split("/")[-1].split("?")[0]
                
                # Fetch
                yield json.dumps({"type": "progress", "msg": "Fetching playlist from Spotify..."}) + "\n"
                results = sp.playlist_items(playlist_id)
                tracks = results['items']
                while results['next']:
                    results = sp.next(results)
                    tracks.extend(results['items'])
                
                yield json.dumps({"type": "progress", "msg": f"Found {len(tracks)} tracks. Starting analysis..."}) + "\n"
                    
                # Parse
                for item in tracks:
                    t = item.get('track')
                    if not t or t.get('is_local'): continue
                    to_analyze.append({
                        "id": t['id'], "name": t['name'], "artist": t['artists'][0]['name'],
                        "duration_ms": t['duration_ms'], 
                        "image": t['album']['images'][0]['url'] if t['album']['images'] else None,
                        "uri": t['uri'],
                        "bpm": 0, "key": "?", "energy": 0
                    })
            else:
                 yield json.dumps({"type": "error", "msg": "No playlist link or tracks provided."}) + "\n"
                 return

            import aiohttp # Ensure imported here if not global
            
            # --- Optimized Concurrency ---
            # 1. Single Session 2. Semaphore 3. Async Processing
            BATCH_SIZE = 5
            total = len(to_analyze)
            completed_count = 0
            
            # Create a semaphore to limit concurrency
            # Reduced to 4 to be safer against iTunes limits
            sem = asyncio.Semaphore(4)
            
            async with aiohttp.ClientSession() as session:
                async def bounded_process(track):
                    async with sem:
                        # Stagger slightly to avoid instant burst
                        await asyncio.sleep(0.05)
                        # Pass the shared session
                        return await logic.process_track(track, session=session)
                
                pending = [bounded_process(t) for t in to_analyze]
                
                for future in asyncio.as_completed(pending):
                    result = await future
                    completed_count += 1
                    
                    # Send Progress Update
                    percent = int((completed_count / total) * 100)
                    yield json.dumps({
                        "type": "update", 
                        "track": result, 
                        "percent": percent,
                        "msg": f"Analyzed {completed_count}/{total}: {result['name']}"
                    }) + "\n"
                
            yield json.dumps({"type": "done", "msg": "Analysis Complete"}) + "\n"

        except Exception as e:
            logger.error(f"Stream Error: {e}")
            yield json.dumps({"type": "error", "msg": str(e)}) + "\n"

    return StreamingResponse(event_generator(), media_type="application/x-ndjson")

@app.post("/create_playlist")
def create_playlist(req: CreatePlaylistRequest):
    """
    Creates a new sorted playlist in the user's Spotify account.
    """
    try:
        sp = spotipy.Spotify(auth=req.access_token)
        user_id = sp.current_user()['id']
        
        playlist = sp.user_playlist_create(user_id, req.name, public=False)
        playlist_id = playlist['id']
        
        track_uris = [t['uri'] for t in req.tracks]
        
        # Add in chunks of 100
        for i in range(0, len(track_uris), 100):
            batch = track_uris[i:i+100]
            sp.playlist_add_items(playlist_id, batch)
            
        return {"id": playlist_id, "url": playlist['external_urls']['spotify']}
        
    except Exception as e:
        logger.error(f"Creation Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
