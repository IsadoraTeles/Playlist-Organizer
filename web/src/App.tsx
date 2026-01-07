import { useState, useEffect } from 'react'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { SortableItem } from './SortableItem';
import EnergyCanvas from './EnergyCanvas';
import './App.css'

interface Track {
  id: string;
  name: string;
  artist: string;
  image?: string;
  duration_ms: number;
  bpm: number;
  key?: string;
  energy?: number;
  uri: string;
  status?: string;
}

function App() {
  const [token, setToken] = useState<string | null>(null);
  const [playlistLink, setPlaylistLink] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [newName, setNewName] = useState("");
  const [statusMsg, setStatusMsg] = useState("");
  const [progress, setProgress] = useState(0);

  // UI State
  const [viewMode, setViewMode] = useState<'bpm' | 'key' | 'energy'>('bpm');
  const [activeSorts, setActiveSorts] = useState<string[]>([]); // Context for Smart Mix
  const [isDrawing, setIsDrawing] = useState(false);

  // Selection State
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    // Check for token in URL
    const params = new URLSearchParams(window.location.search);
    const t = params.get("token");
    if (t) {
      setToken(t);
      window.history.replaceState({}, document.title, "/");
    }
  }, []);

  const handleLogin = () => {
    window.location.href = "http://localhost:8000/login";
  };

  // --- Analysis Logic ---
  const runAnalysis = async (payload: any) => {
    setAnalyzing(true);
    setStatusMsg("Connecting to Analysis Engine...");

    try {
      const response = await fetch("http://localhost:8000/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          access_token: token,
          ...payload
        })
      });

      if (!response.ok) throw new Error("Connection failed");

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      if (!reader) throw new Error("No reader");

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split("\n").filter(line => line.trim() !== "");

        for (const line of lines) {
          try {
            const data = JSON.parse(line);
            if (data.type === "progress") {
              setStatusMsg(data.msg);
            } else if (data.type === "update" || data.type === "track") { // Handle both 'update' types
              const updatedTrack = data.track;
              // Update state carefully
              setTracks(prev => {
                const idx = prev.findIndex(t => t.id === updatedTrack.id);
                if (idx >= 0) {
                  // Update existing
                  const newTracks = [...prev];
                  newTracks[idx] = updatedTrack;
                  return newTracks;
                } else {
                  // Append new (if fetching full playlist)
                  return [...prev, updatedTrack];
                }
              });

              setProgress(data.percent);
              setStatusMsg(data.msg);
            } else if (data.type === "done") {
              setStatusMsg("Analysis Complete!");
              setAnalyzing(false);
            } else if (data.type === "error") {
              console.error("Stream Error:", data.msg);
              setStatusMsg(`Error: ${data.msg}`);
            }
          } catch (jsonError) {
            console.warn("JSON Parse Error", jsonError);
          }
        }
      }
    } catch (e) {
      console.error(e);
      setStatusMsg("Error during analysis.");
      setAnalyzing(false);
    }
  };

  const handleAnalyze = async () => {
    if (!token || !playlistLink) return;
    setTracks([]);
    setProgress(0);
    await runAnalysis({ playlist_link: playlistLink });
  };

  const handleReanalyzeSelected = async () => {
    if (selectedIds.size === 0) return;
    const selectedTracks = tracks.filter(t => selectedIds.has(t.id));
    await runAnalysis({ tracks: selectedTracks });
    setSelectedIds(new Set()); // Clear selection
  };

  const handleCreate = async () => {
    if (!token || !tracks.length || !newName) return;
    setStatusMsg("Creating playlist...");

    try {
      const res = await fetch("http://localhost:8000/create_playlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tracks: tracks,
          name: newName,
          access_token: token
        })
      });

      if (!res.ok) throw new Error("Creation failed");

      const data = await res.json();
      setStatusMsg("Playlist Created! Check your Spotify.");
      window.open(data.url, "_blank");
    } catch (e) {
      console.error(e);
      setStatusMsg("Error creating playlist.");
    }
  };

  /* --- Sorting Logic --- */

  // Helper to get sortable value for Key
  const getKeyVal = (k?: string) => {
    if (!k || k === '?' || k === 'Unknown') return 999;
    const num = parseInt(k);
    const isB = k.includes('B'); // B is Major in Camelot? Or A? Standard Camelot: B=Major, A=Minor.
    // Let's map 1A..12A then 1B..12B for linear sorting? 
    // Or Circle of Fifths ordering?
    // 1A, 1B, 2A, 2B... (Harmonic matches)
    return num * 10 + (isB ? 5 : 0);
  };

  const applySort = (criteria: string[]) => {
    if (criteria.length === 0) return;

    const newTracks = [...tracks].sort((a, b) => {
      for (const crit of criteria) {
        let diff = 0;
        if (crit === 'bpm') {
          // Fuzzy match for BPM groups if it's primary? No, strictly cumulative.
          // If BPM is first, we might want "BPM Ranges" logic?
          // User said: "cumulative/cascading sort".
          diff = a.bpm - b.bpm;
        } else if (crit === 'energy') {
          diff = (a.energy || 0) - (b.energy || 0);
        } else if (crit === 'key') {
          diff = getKeyVal(a.key) - getKeyVal(b.key);
        }

        // If distinct, return order
        // For BPM, maybe we allow a small window to count as "equal" for secondary sort to matter?
        // "Groups of 5" logic from before was good for smart mix.
        // Let's apply "Fuzzy Equality" for BPM only if there are subsequent criteria.
        if (crit === 'bpm' && criteria.length > 1) {
          const groupA = Math.floor(a.bpm / 4); // 4 BPM buckets
          const groupB = Math.floor(b.bpm / 4);
          if (groupA !== groupB) return groupA - groupB;
          // If equal bucket, continue to next crit
        } else {
          if (diff !== 0) return diff;
        }
      }
      return 0;
    });
    setTracks(newTracks);
  };

  const toggleSort = (crit: string) => {
    setActiveSorts(prev => {
      // If already active, remove it? Or just push to end? 
      // "Mix must follow the cumulative clicked buttons". 
      // Implies order matters.
      // If I click BPM, then Key -> [BPM, Key].
      // If I click Key again? Remove it?
      let newSorts = [...prev];
      if (newSorts.includes(crit)) {
        newSorts = newSorts.filter(s => s !== crit);
      } else {
        newSorts.push(crit);
      }

      applySort(newSorts);
      return newSorts;
    });
  };

  /* --- Drawing Logic --- */

  const handleCurveGenerated = (curve: number[]) => {
    // curve is array of roughly 0-100 values matching track count
    /* 
       BEST FIT SORT (Monge / Transportation Problem)
       We have 'tracks' with values (BPM, Key, or Energy).
       We have 'curve' targets.
       We want to match track[i] to curve[j] to minimize difference.
       
       Simplest robust solution for 1D:
       1. Sort Tracks by the Target Attribute.
       2. Sort Curve Points. (Wait, curve position matters!)
       
       Actually: 
       If we want the track list to LOOK like the curve:
       1. We interpret the curve as "The desired value at index i".
       2. We have a bag of tracks available. 
       3. We must assign tracks to indices i such that Sum|trackVal - curveVal| is minimized.
       4. In 1D, this is solved by sorting both!
          - Sort the *indices* `i` based on `curve[i]` values (from low to high).
          - Sort the `tracks` based on `attribute` values (from low to high).
          - Match smallest track to smallest curve-value-index.
    */

    // 1. Identification Phase
    const trackValues = tracks.map((t) => {
      let val = 0;
      if (viewMode === 'bpm') val = t.bpm;
      else if (viewMode === 'energy') val = (t.energy || 0);
      else if (viewMode === 'key') val = getKeyVal(t.key);
      return { ...t, val }; // Keep track data
    });

    // 2. Sort tracks by value (asc)
    const sortedTracks = [...trackValues].sort((a, b) => a.val - b.val);

    // 3. Prepare Targets: We need to know which Index `i` wants which Value `curve[i]`.
    const targets = curve.map((val, idx) => ({ desiredVal: val, finalIndex: idx }));

    // 4. Sort Targets by desired value (asc)
    targets.sort((a, b) => a.desiredVal - b.desiredVal);

    // 5. Assign
    const finalOrder = new Array(tracks.length);
    for (let i = 0; i < tracks.length; i++) {
      // Smallest track goes to the slot that desired the smallest value
      const targetSlot = targets[i];
      finalOrder[targetSlot.finalIndex] = sortedTracks[i];
    }

    setTracks(finalOrder);

    // Clear "Smart Mix" active sorts because we are now in a "Custom Draw Sort"
    setActiveSorts([]);
  };

  /* Drag & Drop Logic */
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;

    if (active.id !== over?.id) {
      setTracks((items) => {
        const oldIndex = items.findIndex((item) => item.id === active.id);
        const newIndex = items.findIndex((item) => item.id === over?.id);
        return arrayMove(items, oldIndex, newIndex);
      });
    }
  }

  // The old sortTracks function is removed as per instructions.

  if (!token) {
    return (
      <div className="container login-screen">
        <h1>Playlist Organizer :))</h1>
        <p>Login to start analyzing your mixes.</p>
        <button className="btn-primary" onClick={handleLogin}>Login with Spotify</button>
      </div>
    );
  }

  return (
    <div className="container">
      <header>
        <h1>Playlist Sorter</h1>
        <div className="user-status">Logged in</div>
      </header>

      <main>
        <section className="input-section">
          <input
            type="text"
            placeholder="Paste Spotify Playlist Link"
            value={playlistLink}
            onChange={(e) => setPlaylistLink(e.target.value)}
            disabled={analyzing}
          />
          <button onClick={handleAnalyze} disabled={analyzing || !playlistLink}>
            {analyzing ? "Running..." : "Analyze"}
          </button>
        </section>

        {analyzing && (
          <div className="progress-container">
            <div className="progress-bar" style={{ width: `${progress}%` }}></div>
          </div>
        )}

        {statusMsg && <div className="status-msg">{statusMsg}</div>}

        {tracks.length > 0 && (
          <section className="results-section">
            <div className="results-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>

              {/* LEFT: View Context & Drawing */}
              <div className="left-controls">
                <span className="label">VIEW & DRAW:</span>
                <div className="btn-group">
                  {['bpm', 'key', 'energy'].map(mode => (
                    <button
                      key={mode}
                      className={viewMode === mode ? 'active' : ''}
                      onClick={() => setViewMode(mode as any)}
                    >
                      {mode.toUpperCase()}
                    </button>
                  ))}
                </div>

                <button
                  onClick={() => setIsDrawing(!isDrawing)}
                  className={`btn-draw ${isDrawing ? 'active' : ''}`}
                  title={`Draw ${viewMode.toUpperCase()} Curve`}
                >
                  ✏️ DRAW {viewMode.toUpperCase()}
                </button>

                {selectedIds.size > 0 && (
                  <button
                    className="btn-reanalyze"
                    onClick={handleReanalyzeSelected}
                    title="Re-Analyze Selected Tracks"
                  >
                    🔄 Re-Analyze ({selectedIds.size})
                  </button>
                )}
              </div>

              {/* RIGHT: Sort Logic */}
              <div className="right-controls">
                <span className="label">SMART MIX LOGIC:</span>
                <div className="btn-group">
                  {['bpm', 'key', 'energy'].map(crit => (
                    <button
                      key={crit}
                      className={activeSorts.includes(crit) ? 'active' : ''}
                      onClick={() => toggleSort(crit)}
                    >
                      {crit.toUpperCase()}
                      {activeSorts.includes(crit) && <span className="badge">{activeSorts.indexOf(crit) + 1}</span>}
                    </button>
                  ))}
                </div>
                {activeSorts.length > 0 && <button className="btn-clear" onClick={() => { setActiveSorts([]); setTracks([...tracks].sort((a, b) => a.name.localeCompare(b.name))); }}>Reset</button>}
              </div>
            </div>

            <div className="bpm-graph">
              {isDrawing && (
                <EnergyCanvas
                  tracks={tracks}
                  onCurveGenerated={handleCurveGenerated}
                  isDrawing={isDrawing}
                  setIsDrawing={setIsDrawing}
                />
              )}

              {tracks.map((t) => {
                // Calculate height based on View Mode
                let heightPercent = 10;
                let color = '#1db954'; // default green
                let label = '';

                if (viewMode === 'bpm') {
                  // BPM 60-180 range usually
                  heightPercent = Math.max(5, ((t.bpm - 60) / 120) * 100);
                  color = '#1db954';
                  label = `${t.bpm} BPM`;
                } else if (viewMode === 'energy') {
                  heightPercent = t.energy || 0;
                  color = '#bb86fc'; // Purple
                  label = `${(t.energy || 0).toFixed(0)} Energy`;
                } else if (viewMode === 'key') {
                  // Key Visualization
                  // Map 1A-12A to 0-50, 1B-12B to 50-100? or Interleaved?
                  // Let's use the 'getKeyVal' metric for consistency
                  const val = getKeyVal(t.key);
                  // Range approx 10 to 125
                  heightPercent = (val / 130) * 100;
                  color = t.key && t.key.includes('B') ? '#03dac6' : '#cf6679'; // Cyan Major, Red Minor
                  label = `Key: ${t.key}`;
                }

                return (
                  <div
                    key={t.id}
                    className="bpm-bar"
                    style={{
                      height: `${Math.max(5, heightPercent)}%`,
                      background: color
                    }}
                    title={`${t.name} - ${label}`}
                  ></div>
                );
              })}
            </div>

            <div className="track-list">
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
              >
                <SortableContext
                  items={tracks.map(t => t.id)}
                  strategy={verticalListSortingStrategy}
                >
                  {tracks.map((t) => (
                    <SortableItem key={t.id} id={t.id}>
                      <div className={`track-row ${selectedIds.has(t.id) ? 'selected' : ''}`} style={{ cursor: 'grab' }}>
                        <div className="track-select" style={{ marginRight: '10px' }}>
                          <input
                            type="checkbox"
                            checked={selectedIds.has(t.id)}
                            onChange={(e) => {
                              // Toggle selection
                              const newSet = new Set(selectedIds);
                              if (e.target.checked) newSet.add(t.id);
                              else newSet.delete(t.id);
                              setSelectedIds(newSet);
                            }}
                            onPointerDown={e => e.stopPropagation()} // Prevent drag
                          />
                        </div>
                        <span className="idx" style={{ cursor: 'grab' }}>☰</span>
                        <img src={t.image} alt="art" className="art" />
                        <div className="info">
                          <span className="title">{t.name}</span>
                          <span className="artist">{t.artist}</span>
                          {t.status === "no_preview" && <span className="status-tag warn">No Preview</span>}
                        </div>
                        <div className="metrics">
                          {t.energy && <span className="badge energy" title="Energy Score">⚡ {t.energy}</span>}
                          {t.key && <span className="badge key" title="Camelot Key">🎵 {t.key}</span>}
                        </div>
                        <span className={`bpm-badge ${t.bpm === 0 ? 'unknown' : ''}`}>
                          {t.bpm > 0 ? `${t.bpm} BPM` : "???"}
                        </span>
                      </div>
                    </SortableItem>
                  ))}
                </SortableContext>
              </DndContext>
            </div>

            <div className="create-section">
              <input
                type="text"
                placeholder="New Playlist Name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
              />
              <button className="btn-success" onClick={handleCreate} disabled={!newName || analyzing}>
                Save to Spotify
              </button>
            </div>
          </section>
        )}
      </main>
    </div>
  )
}

export default App
