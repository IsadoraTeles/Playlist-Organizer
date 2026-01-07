# 🎵 Playlist BPM Sorter

**Sort Spotify playlists by tempo, key, and energy for smoother flow — built for house parties, workouts, and DJ prep.**

![Screenshot](/0001.png)

---

## The Idea

I kept running into the same problem at house parties: playlists that killed the vibe. 
A high-energy track would randomly follow a chill one. The BPM would jump awkwardly. 
People would reach for their phones to skip tracks.

**Hypothesis:** If I sort tracks by BPM → Key → Energy, the playlist will flow naturally 
and build energy over time — like a DJ set, but automated.

**Who this is for:**
- House party hosts who want a "set it and forget it" vibe
- DJs preparing sets and wanting quick harmonic sorting
- Workout playlists where energy progression matters

---

## Key Decisions

| Decision | Why | Tradeoff |
|----------|-----|----------|
| **Hybrid Analysis** (SoundNet + iTunes) | Spotify removed free access to audio features. SoundNet provides fast, accurate data. iTunes/Librosa acts as a robust fallback. | Complexity: requires managing two data sources and API keys. |
| **Analyze audio locally (Librosa)** | No paid API costs, full control over BPM/key detection when APIs fail. | Slower than cloud APIs; requires Python backend and `ffmpeg`. |
| **Sort by BPM → Key → Energy** | BPM jumps are the most jarring; key clashes sound "wrong"; energy builds the vibe. | Rigid hierarchy — doesn't account for mood or genre shifts. |
| **"Paint" the Curve** | Users often want non-linear energy (peaks and valleys). Drawing gives creative control. | Requires a more complex UI and "Best Fit" algorithm. |

---

## What Works

✓ **Workout playlists**: The rising energy curve works perfectly. You naturally build intensity.

✓ **Pre-party prep**: Great for organizing a messy playlist before an event.

✓ **Visual Control**: The **Energy Canvas** allows you to "draw" the vibe you want, solving the linear-only limitation.

✓ **DJ prep**: Camelot key notation makes harmonic mixing planning much faster.

✓ **Selective Re-analysis**: Fix specific tracks that were missed or analyzed incorrectly without restarting.

---

## What Doesn't Work (Yet)

✗ **Live party use**: Real parties have organic peaks and valleys. While you can *draw* curves now, doing it live during a party is still a bit manual.

✗ **Genre blindness**: The algorithm doesn't know that jumping from house to hip-hop feels jarring even if BPM and key match. Context matters.

✗ **iTunes matching failures**: ~5% of tracks (especially remixes, obscure artists) can't be matched if SoundNet also fails, leaving gaps.

---

## What I Learned

**Technical:** Building a hybrid analysis pipeline (API + Local Audio) is complex but necessary in a post-Spotify-Audio-Features world. Librosa is powerful but slow; caching and API-first strategies are essential for UX.

**Design:** I initially over-indexed on "optimal" sorting. Real use cases need flexibility — that's why I added the **Drawing Canvas** and **Manual Reordering**. Users want to collaborate with the algorithm, not obey it.

**Problem space:** Playlist curation isn't just about audio features. It's about narrative, context, and social dynamics. A good DJ reads the room; an algorithm can't.

---

## If I Had More Time

- **Genre awareness**: Cluster tracks by genre/mood before sorting within clusters.
- **"Party mode" vs "Workout mode"**: Presets for different curve shapes (Hill, Interval, Ramp).
- **Mobile Optimization**: The current UI is desktop-first.
- **Smart Transitions**: Suggest transition tracks to bridge gaps between disparate BPMs.

---

## Technical Details

<details>
<summary>How It Works (click to expand)</summary>

### 1. Data Source (Hybrid Strategy)
1.  **SoundNet API (Primary)**: Fetches BPM/Key/Energy instantly from a database.
2.  **iTunes + Librosa (Fallback)**: If SoundNet misses, we search iTunes for a 30-second preview, download it, and analyze it locally using Python.

### 2. Audio Analysis (Librosa)
Local Python analysis on the preview MP3:
- **BPM**: Beat tracking algorithm
- **Key**: Chromagram → correlate against 24 major/minor templates → convert to Camelot notation (e.g., 8A, 12B)
- **Energy**: RMS (Root Mean Square) of audio signal, normalized 0-100

### 3. Smart Mix Algorithm
Three-step cascade:
1. **BPM Grouping**: Bucket tracks into ranges.
2. **Harmonic Sort**: Sort within buckets by Camelot key compatibility.
3. **Energy Flow**: Sort by energy (low → high) or match the user's **drawn curve**.

</details>

<details>
<summary>Installation & Setup (click to expand)</summary>

### Prerequisites
- Node.js (v18+)
- Python (v3.9+)
- Spotify Developer Account (Client ID + Secret)
- **ffmpeg** (Required for audio fallback)
    - Windows: `winget install ffmpeg`

### 1. Install
```bash
git clone https://github.com/yourusername/playlist-sorter.git
cd playlist-sorter

# Backend
cd sorting-app/backend
python -m venv venv
# Windows: .\venv\Scripts\activate
# Mac/Linux: source venv/bin/activate
pip install -r requirements.txt

# Frontend
cd ../web
npm install
```

### 2. API Configuration (.env)
Create `sorting-app/backend/.env`:
```env
SPOTIPY_CLIENT_ID="your_spotify_client_id"
SPOTIPY_CLIENT_SECRET="your_spotify_client_secret"
SPOTIPY_REDIRECT_URI="http://localhost:8000/callback"
# Optional (but recommended)
RAPID_API_KEY="your_soundnet_key"
```

### 3. Run
**Option 1:** Double-click `start_app.bat` (Windows)

**Option 2:** Manual
```bash
# Terminal 1
cd sorting-app/backend && uvicorn main:app --reload

# Terminal 2
cd sorting-app/web && npm run dev
```

Open `http://localhost:5173`

</details>

---

## Built With

Python · FastAPI · Librosa · React · Vite · iTunes Search API · Spotify Web API · SoundNet API

---

## Status

🧪 **Experiment** — Built for personal use and learning. Not strictly production-ready.

Part of my [design/tech portfolio](https://isadoraa.com) exploring tools for creative workflows.
