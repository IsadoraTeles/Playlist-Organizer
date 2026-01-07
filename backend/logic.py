import asyncio
import aiohttp
import requests
import librosa
import numpy as np
import os
import tempfile
import logging

# --- Configuration ---
# --- Configuration ---
ITUNES_API_URL = "https://itunes.apple.com/search"
# User's Key from playlist_sorter.py
RAPID_API_KEY = "166aa0cdc0msh16dac07e05a17ccp13d234jsnd4058f102018"
RAPID_API_HOST = "track-analysis.p.rapidapi.com"

# --- Utils ---
import re

def clean_str(s):
    """
    Sanitizes string for filename usage.
    """
    return re.sub(r'[^a-zA-Z0-9 ]', '', s)

def normalize_bpm(bpm):
    """
    Normalize BPM to be between 100 and 160 (typical range).
    """
    if not bpm or bpm <= 0: return 0
    while bpm < 90:
        bpm *= 2
    while bpm > 180:
        bpm /= 2
    return round(float(bpm), 1)

async def fetch_soundnet(session, spotify_id):
    """
    Fetch BPM/Key/Energy from SoundNet (RapidAPI).
    """
    url = f"https://{RAPID_API_HOST}/pktx/spotify/{spotify_id}"
    headers = {
        "x-rapidapi-key": RAPID_API_KEY,
        "x-rapidapi-host": RAPID_API_HOST
    }
    try:
        async with session.get(url, headers=headers, timeout=5) as resp:
            if resp.status == 200:
                data = await resp.json()
                if 'tempo' in data:
                    # SoundNet returns basic data. 
                    # Map Energy if it exists, else default 0
                    # SoundNet 'energy' might be absent or different.
                    
                    # Camelot extraction
                    camelot = data.get('camelot')
                    if not camelot and 'key' in data and 'mode' in data:
                         # Basic backup mapping if needed, or just let UI handle "?"
                         pass
                    
                    return {
                        "bpm": normalize_bpm(data.get('tempo')),
                        "key": camelot if camelot else "?",
                        "energy": float(data.get('energy', 50)), # API returns 0-100
                        "source": "soundnet"
                    }
    except Exception as e:
        logging.warning(f"SoundNet Fail for {spotify_id}: {e}")
    return None

async def fetch_preview_url(session, artist, track_name, duration_ms=None):
    # ... (Keep existing implementation) ...
    # But for brevity in this replace block, I am keeping the logic above unchanged in my mental model
    # Wait, replace_file_content replaces the BLOCK. I need to be careful not to delete fetch_preview_url.
    # The start/end lines must capture the CONFIG area and process_track area, but fetch_preview_url is in the middle.
    # I should use multi_replace or just targeted replaces.
    # I will split this into adding constants/funcs and then updating process_track.
    pass 

# ... (I will abort this large block and do smaller ones) ...

async def fetch_preview_url(session, artist, track_name, duration_ms=None):
    """
    Search iTunes for a track and return the preview URL.
    Uses duration matching if provided (tolerance +/- 3s).
    Retries on 429/403 Rate Limits.
    """
    query = f"{artist} {track_name}"
    params = {
        "term": query,
        "media": "music",
        "entity": "song",
        "limit": 5
    }
    
    # Retry Loop
    for attempt in range(3):
        try:
            async with session.get(ITUNES_API_URL, params=params) as resp:
                if resp.status in [403, 429]:
                    logging.warning(f"iTunes Rate Limit ({resp.status}). Retrying in {2**attempt}s...")
                    await asyncio.sleep(2 ** attempt)
                    continue
                
                if resp.status != 200:
                    logging.error(f"iTunes Error {resp.status} for {query}")
                    return None

                data = await resp.json(content_type=None)

            # Fallback: Cleaned Search
            if data["resultCount"] == 0:
                cleaned_name = clean_str(track_name)
                if cleaned_name != track_name:
                    params["term"] = f"{artist} {cleaned_name}"
                    async with session.get(ITUNES_API_URL, params=params) as resp:
                         if resp.status == 200:
                            data = await resp.json(content_type=None)
            
            if data["resultCount"] == 0:
                return None

            # Strategy 1: Strict Duration Match (+/- 4s)
            if duration_ms:
                for result in data["results"]:
                    itunes_dur = result.get('trackTimeMillis', 0)
                    if abs(itunes_dur - duration_ms) < 4000:
                        return result['previewUrl']
                        
            # Strategy 2: Relaxed Duration Match (+/- 10s)
            if duration_ms:
                for result in data["results"]:
                    itunes_dur = result.get('trackTimeMillis', 0)
                    if abs(itunes_dur - duration_ms) < 10000:
                        return result['previewUrl']

            # Strategy 3: Best Name Match
            if data["results"]:
                return data["results"][0]['previewUrl']

            return None

        except Exception as e:
            logging.error(f"iTunes Search Error for {artist} - {track_name}: {e}")
            await asyncio.sleep(1) # Brief pause on error
            continue
            
    return None

# --- Music Theory Utils ---
def chroma_to_key(chroma):
    """
    Estimate key from chromagram.
    Returns Camelot Key (e.g., '10A', '5B')
    """
    # Sum chromagram to get overall pitch class distribution
    chroma_sum = np.sum(chroma, axis=1)
    
    # Templates for Major and Minor keys
    # C C# D D# E F F# G G# A A# B
    major_template = [1, 0, 1, 0, 1, 1, 0, 1, 0, 1, 0, 1]
    minor_template = [1, 0, 1, 1, 0, 1, 0, 1, 1, 0, 1, 0]
    
    # Circle of Fifths map to Camelot
    # Major (A)
    # 0(C)=8B, 1(C#)=3B, 2(D)=10B, 3(D#)=5B, 4(E)=12B, 5(F)=7B, 6(F#)=2B, 7(G)=9B, 8(G#)=4B, 9(A)=11B, 10(A#)=6B, 11(B)=1B
    major_camelot = {0: '8B', 1: '3B', 2: '10B', 3: '5B', 4: '12B', 5: '7B', 6: '2B', 7: '9B', 8: '4B', 9: '11B', 10: '6B', 11: '1B'}
    
    # Minor (B) -> Actually standard notation uses A for Minor in Camelot? No, A is Minor, B is Major in Mixed In Key 
    # WAIT: Standard Camelot: B = Major, A = Minor. 
    # Circle of Fifths: 
    # 0(C)=5A, 1(C#)=12A, 2(D)=7A, 3(D#)=2A, 4(E)=9A, 5(F)=4A, 6(F#)=11A, 7(G)=6A, 8(G#)=1A, 9(A)=8A, 10(A#)=3A, 11(B)=10A
    minor_camelot = {0: '5A', 1: '12A', 2: '7A', 3: '2A', 4: '9A', 5: '4A', 6: '11A', 7: '6A', 8: '1A', 9: '8A', 10: '3A', 11: '10A'}

    # Calculate correlation
    max_corr = -1
    best_key = "Unknown"
    
    # Check Major Keys
    for root in range(12):
        # Rotate template to root
        rotated = np.roll(major_template, root)
        corr = np.corrcoef(chroma_sum, rotated)[0, 1]
        if corr > max_corr:
            max_corr = corr
            best_key = major_camelot[root]
            
    # Check Minor Keys
    for root in range(12):
        rotated = np.roll(minor_template, root)
        corr = np.corrcoef(chroma_sum, rotated)[0, 1]
        if corr > max_corr:
            max_corr = corr
            best_key = minor_camelot[root]
            
    return best_key

def analyze_audio_file(file_path):
    """
    Analyze audio file to get BPM, Key (Camelot), and Energy.
    """
    try:
        y, sr = librosa.load(file_path, duration=30)
        
        # 1. BPM
        tempo, _ = librosa.beat.beat_track(y=y, sr=sr)
        bpm = float(tempo)
        
        # 2. Key (Camelot)
        # CQT for pitch content
        chroma = librosa.feature.chroma_cqt(y=y, sr=sr)
        key = chroma_to_key(chroma)
        
        # 3. Energy
        # RMS (Root Mean Square) is a standard measure of loudness/energy
        rms = librosa.feature.rms(y=y)
        energy_score = float(np.mean(rms)) * 100 # Scale 0-100 approx
        
        return {
            "bpm": normalize_bpm(bpm),
            "key": key,
            "energy": round(energy_score, 1)
        }
    except Exception as e:
        logging.error(f"Librosa Error: {e}")
        return {"bpm": 0, "key": "???", "energy": 0}

async def process_track(track_metadata, session=None):
    """
    Full pipeline for a single track.
    Uses provided aiohttp session for connection reuse.
    """
    artist = track_metadata['artist']
    name = track_metadata['name']
    duration_ms = track_metadata.get('duration_ms')
    
    local_session = False
    if session is None:
        session = aiohttp.ClientSession()
        local_session = True

    try:
        # STRATEGY 1: SoundNet API (Fast, Reliable)
        soundnet_data = await fetch_soundnet(session, track_metadata.get('id'))
        if soundnet_data:
            return {**track_metadata, **soundnet_data}

        # STRATEGY 2: Audio Analysis (Backup)
        # Slower, requires download, better for custom energy curves if API fails
        preview_url = await fetch_preview_url(session, artist, name, duration_ms)
        
        if not preview_url:
             return {**track_metadata, "bpm": 0, "status": "no_preview"}

        # Download and Analyze
        try:
            async with session.get(preview_url) as resp:
                if resp.status == 200:
                    with tempfile.NamedTemporaryFile(delete=False, suffix=".m4a") as tmp:
                        tmp.write(await resp.read())
                        tmp_path = tmp.name
                    
                    # Analyze (Blocking)
                    loop = asyncio.get_event_loop()
                    analysis = await loop.run_in_executor(None, analyze_audio_file, tmp_path)
                    
                    os.unlink(tmp_path) # Clean up
                    
                    return {
                        **track_metadata, 
                        "bpm": analysis["bpm"], 
                        "key": analysis["key"],
                        "energy": analysis["energy"],
                        "status": "analyzed_audio"
                    }
        except Exception as e:
            logging.error(f"Analysis Failed for {name}: {e}")
            return {**track_metadata, "bpm": 0, "key": "?", "energy": 0, "status": "error"}

    finally:
        if local_session:
            await session.close()
    
    return {**track_metadata, "bpm": 0, "key": "?", "energy": 0, "status": "failed_download"}
