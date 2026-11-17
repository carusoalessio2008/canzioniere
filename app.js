/**
 * CANZONIERE PARROCCHIALE SANT'OSVALDO E SAN PAOLO - UDINE
 * Logica Principale & Gestione Stato (Solo Lettura Canti + Scalette Cloud)
 */

// --- CONFIGURAZIONE & STATO GLOBALE ---
const STORAGE_KEYS = {
  INDEX: 'canzoniere_index_v1',
  SONG_PREFIX: 'canzoniere_song_',
  SETLISTS: 'canzoniere_setlists_v1',
  DELETED_SETLISTS: 'canzoniere_deleted_setlists_v1',
  PREFS: 'canzoniere_prefs_v1'
};

let state = {
  songsIndex: [],
  filteredSongs: [],
  currentCategory: 'all',
  searchQuery: '',
  currentSong: null,
  transposeSteps: 0,
  fontSize: 16,
  isBookMode: false,
  setlists: [],
  deletedSetlistIds: [],
  activeSetlistId: null,
  activeSetlistIndex: -1,
  isOffline: !navigator.onLine
};

// Tabelle Note per Trasposizione (Italiano <-> Internazionale)
const NOTES_IT = ['Do', 'Do#', 'Re', 'Re#', 'Mi', 'Fa', 'Fa#', 'Sol', 'Sol#', 'La', 'La#', 'Si'];
const NOTES_IT_FLAT = ['Do', 'Reb', 'Re', 'Mib', 'Mi', 'Fa', 'Solb', 'Sol', 'Lab', 'La', 'Sib', 'Si'];
const NOTES_EN = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

// --- INIZIALIZZAZIONE ---
document.addEventListener('DOMContentLoaded', async () => {
  loadPreferences();
  setupEventListeners();
  updateConnectionStatus();

  await loadSongsIndex();
  loadLocalSetlists();
  initCloudSync();

  const urlParams = new URLSearchParams(window.location.search);
  const songParam = urlParams.get('canto');
  const setlistParam = urlParams.get('scaletta');

  if (setlistParam) {
    handleSharedSetlistUrl(setlistParam);
  } else if (songParam) {
    openSong(songParam);
  }
});

// --- GESTIONE DATI & CACHE ---
async function loadSongsIndex() {
  const cachedIndex = localStorage.getItem(STORAGE_KEYS.INDEX);
  if (cachedIndex) {
    try {
      state.songsIndex = JSON.parse(cachedIndex);
      renderSongList();
    } catch (e) {
      console.error("Errore parsing cache indice", e);
    }
  }

  try {
    const response = await fetch('canti/index.json?t=' + Date.now());
    if (!response.ok) throw new Error('Errore rete index.json');
    const data = await response.json();
    
    data.sort((a, b) => a.title.localeCompare(b.title));
    
    state.songsIndex = data;
    localStorage.setItem(STORAGE_KEYS.INDEX, JSON.stringify(data));
    renderSongList();
  } catch (err) {
    console.warn("Impossibile aggiornare indice online, uso cache locale:", err);
    if (state.songsIndex.length === 0) {
      document.getElementById('song-list').innerHTML = 
        `<div class="p-6 text-center text-red-500 text-sm">Impossibile caricare i canti.<br>Verifica la connessione.</div>`;
    }
  }
}

async function fetchSongData(songId) {
  const cacheKey = STORAGE_KEYS.SONG_PREFIX + songId;
  
  if (navigator.onLine) {
    try {
      const res = await fetch(`canti/${songId}.json?t=${Date.now()}`);
      if (res.ok) {
        const data = await res.json();
        localStorage.setItem(cacheKey, JSON.stringify(data));
        return data;
      }
    } catch (e) {
      console.warn("Fetch singolo canto fallito, provo cache:", e);
    }
  }

  const cached = localStorage.getItem(cacheKey);
  if (cached) return JSON.parse(cached);

  throw new Error("Canto non disponibile offline");
}

// --- RENDERING LISTA CANTI ---
function renderSongList() {
  const container = document.getElementById('song-list');
  const query = state.searchQuery.toLowerCase().trim();

  state.filteredSongs = state.songsIndex.filter(song => {
    const matchesCat = state.currentCategory === 'all' || 
                       (song.categories && song.categories.includes(state.currentCategory));
    const matchesQuery = !query || 
                         song.title.toLowerCase().includes(query) || 
                         (song.author && song.author.toLowerCase().includes(query)) ||
                         (song.firstLine && song.firstLine.toLowerCase().includes(query));
    return matchesCat && matchesQuery;
  });

  if (state.filteredSongs.length === 0) {
    container.innerHTML = `<div class="p-8 text-center text-slate-400 text-sm">Nessun canto trovato.</div>`;
    return;
  }

  container.innerHTML = state.filteredSongs.map(song => {
    const isActive = state.currentSong && state.currentSong.id === song.id;
    const catsHtml = (song.categories || []).slice(0, 2).map(c => 
      `<span class="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 font-medium">${c}</span>`
    ).join('');

    return `
      <div onclick="openSong('${song.id}')" 
           class="p-3.5 hover:bg-slate-50 cursor-pointer transition flex items-center justify-between group ${isActive ? 'bg-blue-50/70 border-l-4 border-blue-600' : ''}">
        <div class="min-w-0 pr-2">
          <div class="font-semibold text-sm text-slate-900 truncate group-hover:text-blue-700 transition">${song.title}</div>
          <div class="text-xs text-slate-500 truncate mt-0.5">${song.author || 'Autore sconosciuto'}</div>
        </div>
        <div class="flex flex-col items-end gap-1 shrink-0">
          <div class="flex gap-1">${catsHtml}</div>
        </div>
      </div>
    `;
  }).join('');
}

function filterCategory(cat) {
  state.currentCategory = cat;
  
  document.querySelectorAll('.cat-pill').forEach(btn => {
    if (btn.dataset.cat === cat) {
      btn.classList.remove('bg-slate-100', 'text-slate-600');
      btn.classList.add('bg-slate-900', 'text-white');
    } else {
      btn.classList.add('bg-slate-100', 'text-slate-600');
      btn.classList.remove('bg-slate-900', 'text-white');
    }
  });

  renderSongList();
}

function clearSearch() {
  state.searchQuery = '';
  document.getElementById('search-input').value = '';
  document.getElementById('clear-search').classList.add('hidden');
  renderSongList();
}

// --- VISUALIZZAZIONE CANTO & PARSER ---
async function openSong(songId, fromSetlistIndex = -1) {
  try {
    const songData = await fetchSongData(songId);
    state.currentSong = songData;
    state.transposeSteps = 0;
    state.activeSetlistIndex = fromSetlistIndex;

    document.getElementById('view-welcome').classList.add('hidden');
    const viewSong = document.getElementById('view-song');
    viewSong.classList.remove('hidden');
    viewSong.classList.add('flex');

    document.getElementById('song-title').textContent = songData.title;
    document.getElementById('mobile-header-title').textContent = songData.title;
    document.getElementById('song-author').textContent = songData.author || '';
    document.getElementById('transpose-display').textContent = '0';

    const badgesContainer = document.getElementById('song-badges');
    badgesContainer.innerHTML = (songData.categories || []).map(cat => 
      `<span class="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-100">${cat}</span>`
    ).join('');

    if (songData.originalKey) {
      badgesContainer.innerHTML += `<span class="px-2.5 py-0.5 rounded-full text-xs font-mono font-semibold bg-slate-100 text-slate-600">Tonalità: ${songData.originalKey}</span>`;
    }

    updateSetlistNavBar();
    renderSongBody();
    renderSongList();

    document.getElementById('song-scroll-container').scrollTop = 0;

    if (window.innerWidth < 768) {
      closeSidebarMobile();
    }

    const url = new URL(window.location);
    url.searchParams.set('canto', songId);
    window.history.replaceState({}, '', url);

  } catch (err) {
    showToast("Errore apertura canto: " + err.message, "error");
  }
}

function renderSongBody() {
  if (!state.currentSong) return;
  const container = document.getElementById('song-body');
  container.style.fontSize = `${state.fontSize}px`;

  // Estrae il testo supportando diversi nomi di campo o strutture array nei JSON
  let rawContent = state.currentSong.content 
                ?? state.currentSong.lyrics 
                ?? state.currentSong.testo 
                ?? state.currentSong.body 
                ?? '';

  if (Array.isArray(rawContent)) {
    rawContent = rawContent.map(item => {
      if (typeof item === 'string') return item;
      if (item && typeof item === 'object') {
        const header = item.section || item.type || item.label ? `[${item.section || item.type || item.label}]\n` : '';
        const text = Array.isArray(item.lines) ? item.lines.join('\n') : (item.text || item.content || item.lyrics || '');
        return header + text;
      }
      return '';
    }).join('\n\n');
  }

  if (typeof rawContent !== 'string' || !rawContent.trim()) {
    container.innerHTML = `<div class="p-6 text-center text-slate-400 text-sm">Testo non disponibile per questo canto.</div>`;
    return;
  }

  const blocks = rawContent.split(/\n\s*\n/);
  
  const html = blocks.map(block => {
    const lines = block.split('\n');
    let blockHtml = '';

    lines.forEach(line => {
      const trimmed = line.trim();
      
      if (/^\[(Strofa|Ritornello|Bridge|Intro|Finale|Coda|Pre-Ritornello|Strumentale).*\]$/i.test(trimmed)) {
        const label = trimmed.replace(/[\[\]]/g, '');
        blockHtml += `<div class="section-label text-xs font-bold uppercase tracking-wider text-blue-600 mt-2 mb-1 select-none">${label}</div>`;
        return;
      }

      if (line.includes('[')) {
        const parsed = parseChordProLine(line, state.transposeSteps);
        blockHtml += `
          <div class="line-pair">
            <div class="chord-line font-mono-chord text-[0.9em]">${parsed.chords || '&nbsp;'}</div>
            <div class="lyric-line">${parsed.lyrics || '&nbsp;'}</div>
          </div>
        `;
      } else {
        blockHtml += `<div class="lyric-line">${escapeHtml(line) || '&nbsp;'}</div>`;
      }
    });

    return `<div class="song-block">${blockHtml}</div>`;
  }).join('');

  container.innerHTML = html;
}

function parseChordProLine(line, semitones) {
  let chordLine = '';
  let lyricLine = '';
  let i = 0;

  while (i < line.length) {
    if (line[i] === '[') {
      const closeIdx = line.indexOf(']', i);
      if (closeIdx !== -1) {
        const rawChord = line.substring(i + 1, closeIdx);
        const transposedChord = transposeChord(rawChord, semitones);
        
        while (chordLine.length < lyricLine.length) {
          chordLine += ' ';
        }
        
        if (chordLine.length > 0 && chordLine[chordLine.length - 1] !== ' ') {
          chordLine += ' ';
        }
        
        chordLine += transposedChord;
        i = closeIdx + 1;
        continue;
      }
    }
    
    lyricLine += line[i];
    i++;
  }

  return {
    chords: escapeHtml(chordLine),
    lyrics: escapeHtml(lyricLine)
  };
}

// --- MOTORE TRASPOSIZIONE ACCORDI ---
function transpose(delta) {
  state.transposeSteps += delta;
  if (state.transposeSteps > 11) state.transposeSteps -= 12;
  if (state.transposeSteps < -11) state.transposeSteps += 12;

  const sign = state.transposeSteps > 0 ? '+' : '';
  document.getElementById('transpose-display').textContent = `${sign}${state.transposeSteps}`;
  renderSongBody();
}

function transposeChord(chordStr, semitones) {
  if (semitones === 0) return chordStr;

  return chordStr.split('/').map(part => {
    const match = part.match(/^(Do#|Re#|Fa#|Sol#|La#|Reb|Mib|Solb|Lab|Sib|Do|Re|Mi|Fa|Sol|La|Si|[A-G][#b]?)(.*)$/i);
    if (!match) return part;

    let root = match[1];
    const suffix = match[2];

    const isItalian = root.length > 1 && !root.endsWith('#') && !root.endsWith('b') || 
                      ['Do','Re','Mi','Fa','Sol','La','Si'].some(n => root.toLowerCase().startsWith(n.toLowerCase()));

    let noteIndex = -1;

    if (isItalian) {
      const capRoot = root.charAt(0).toUpperCase() + root.slice(1).toLowerCase();
      noteIndex = NOTES_IT.indexOf(capRoot);
      if (noteIndex === -1) noteIndex = NOTES_IT_FLAT.indexOf(capRoot);
    } else {
      const capRoot = root.charAt(0).toUpperCase() + root.slice(1);
      noteIndex = NOTES_EN.indexOf(capRoot);
      const flatMap = {'Db':1, 'Eb':3, 'Gb':6, 'Ab':8, 'Bb':10};
      if (noteIndex === -1 && flatMap[capRoot] !== undefined) noteIndex = flatMap[capRoot];
    }

    if (noteIndex === -1) return part;

    let newIndex = (noteIndex + semitones) % 12;
    if (newIndex < 0) newIndex += 12;

    const newRoot = isItalian ? NOTES_IT[newIndex] : NOTES_EN[newIndex];
    return newRoot + suffix;
  }).join('/');
}

// --- MODALITÀ VISUALIZZAZIONE & FONT ---
function toggleViewMode() {
  state.isBookMode = !state.isBookMode;
  const viewSong = document.getElementById('view-song');
  const btn = document.getElementById('btn-view-mode');
  const label = document.getElementById('label-view-mode');
  const iconChords = document.getElementById('icon-chords');
  const iconBook = document.getElementById('icon-book');

  if (state.isBookMode) {
    viewSong.classList.add('mode-book');
    btn.classList.add('bg-slate-900', 'text-white', 'border-slate-900');
    btn.classList.remove('text-slate-700', 'border-slate-300');
    label.textContent = 'Solo Testo (2 Col)';
    iconChords.classList.add('hidden');
    iconBook.classList.remove('hidden');
  } else {
    viewSong.classList.remove('mode-book');
    btn.classList.remove('bg-slate-900', 'text-white', 'border-slate-900');
    btn.classList.add('text-slate-700', 'border-slate-300');
    label.textContent = 'Accordi';
    iconChords.classList.remove('hidden');
    iconBook.classList.add('hidden');
  }
}

function changeFontSize(delta) {
  state.fontSize = Math.max(12, Math.min(28, state.fontSize + delta));
  savePreferences();
  renderSongBody();
}

// --- GESTIONE SCALETTE (LOCALE + FIREBASE CLOUD) ---
function loadLocalSetlists() {
  try {
    const saved = localStorage.getItem(STORAGE_KEYS.SETLISTS);
    state.setlists = saved ? JSON.parse(saved) : [];
  } catch (e) {
    state.setlists = [];
  }

  try {
    const deleted = localStorage.getItem(STORAGE_KEYS.DELETED_SETLISTS);
    state.deletedSetlistIds = deleted ? JSON.parse(deleted) : [];
  } catch (e) {
    state.deletedSetlistIds = [];
  }

  renderSetlistsIndex();
  updateSetlistBadge();
}

function saveLocalSetlists() {
  localStorage.setItem(STORAGE_KEYS.SETLISTS, JSON.stringify(state.setlists));
  localStorage.setItem(STORAGE_KEYS.DELETED_SETLISTS, JSON.stringify(state.deletedSetlistIds));
  updateSetlistBadge();
}

function initCloudSync() {
  const setupListener = () => {
    if (!window.fb) return;
    const { db, collection, onSnapshot } = window.fb;
    
    onSnapshot(collection(db, "scalette"), (snapshot) => {
      const cloudSetlists = [];
      snapshot.forEach(docSnap => {
        const data = docSnap.data();
        if (!state.deletedSetlistIds.includes(data.id)) {
          cloudSetlists.push(data);
        }
      });

      const mergedMap = new Map();
      state.setlists.forEach(s => {
        if (!state.deletedSetlistIds.includes(s.id)) {
          mergedMap.set(s.id, s);
        }
      });
      cloudSetlists.forEach(cs => {
        const existing = mergedMap.get(cs.id);
        if (!existing || (cs.updatedAt || 0) >= (existing.updatedAt || 0)) {
          mergedMap.set(cs.id, cs);
        }
      });

      state.setlists = Array.from(mergedMap.values()).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      saveLocalSetlists();
      renderSetlistsIndex();
      
      if (state.activeSetlistId) {
        if (state.deletedSetlistIds.includes(state.activeSetlistId) || !mergedMap.has(state.activeSetlistId)) {
          closeSetlistDetail();
        } else {
          renderActiveSetlistDetail();
        }
      }
    }, (err) => {
      console.warn("Sync Cloud in pausa:", err);
    });
  };

  if (window.fb) {
    setupListener();
  } else {
    window.addEventListener('firebase-ready', setupListener);
  }
}

async function syncSetlistToCloud(setlist) {
  if (!window.fb || !navigator.onLine) return;
  try {
    const { db, doc, setDoc } = window.fb;
    await setDoc(doc(db, "scalette", setlist.id), setlist);
  } catch (e) {
    console.warn("Errore salvataggio cloud:", e);
  }
}

function createNewSetlist() {
  const input = document.getElementById('new-setlist-name');
  const name = input.value.trim();
  if (!name) {
    showToast("Inserisci un nome per la scaletta", "error");
    return;
  }

  const newSetlist = {
    id: 'sl_' + Date.now().toString(36) + Math.random().toString(36).substring(2, 6),
    name: name,
    songs: [],
    updatedAt: Date.now()
  };

  state.setlists.unshift(newSetlist);
  saveLocalSetlists();
  syncSetlistToCloud(newSetlist);
  
  input.value = '';
  renderSetlistsIndex();
  openSetlistDetail(newSetlist.id);
  showToast(`Scaletta "${name}" creata!`);
}

function renderSetlistsIndex() {
  const container = document.getElementById('setlists-index');
  if (state.setlists.length === 0) {
    container.innerHTML = `<div class="p-6 text-center text-slate-400 text-xs">Nessuna scaletta salvata.<br>Creane una qui sopra per iniziare!</div>`;
    return;
  }

  container.innerHTML = state.setlists.map(sl => `
    <div onclick="openSetlistDetail('${sl.id}')" class="p-3 bg-white rounded-xl border border-slate-200 hover:border-blue-400 cursor-pointer transition shadow-2xs flex justify-between items-center">
      <div>
        <div class="font-bold text-sm text-slate-900">${escapeHtml(sl.name)}</div>
        <div class="text-xs text-slate-500 mt-0.5">${sl.songs.length} canti</div>
      </div>
      <span class="text-slate-400 text-sm">→</span>
    </div>
  `).join('');
}

function openSetlistDetail(setlistId) {
  state.activeSetlistId = setlistId;
  document.getElementById('setlists-index').classList.add('hidden');
  const detailView = document.getElementById('active-setlist-view');
  detailView.classList.remove('hidden');
  detailView.classList.add('flex');
  renderActiveSetlistDetail();
}

function closeSetlistDetail() {
  state.activeSetlistId = null;
  state.activeSetlistIndex = -1;
  document.getElementById('active-setlist-view').classList.add('hidden');
  document.getElementById('active-setlist-view').classList.remove('flex');
  document.getElementById('setlists-index').classList.remove('hidden');
  updateSetlistNavBar();
}

function renderActiveSetlistDetail() {
  const setlist = state.setlists.find(s => s.id === state.activeSetlistId);
  if (!setlist) return closeSetlistDetail();

  document.getElementById('current-setlist-title').textContent = setlist.name;
  document.getElementById('current-setlist-meta').textContent = `${setlist.songs.length} canti • Sincronizzato`;

  const container = document.getElementById('setlist-songs-container');
  if (setlist.songs.length === 0) {
    container.innerHTML = `<div class="p-6 text-center text-slate-400 text-xs">Scaletta vuota.<br>Apri un canto e clicca "+ Scaletta".</div>`;
    return;
  }

  container.innerHTML = setlist.songs.map((songId, idx) => {
    const songMeta = state.songsIndex.find(s => s.id === songId) || { title: songId, author: '' };
    const isCurrent = state.currentSong && state.currentSong.id === songId && state.activeSetlistIndex === idx;

    return `
      <div class="p-2.5 bg-white rounded-lg border ${isCurrent ? 'border-blue-600 bg-blue-50/40' : 'border-slate-200'} flex items-center justify-between gap-2 shadow-2xs">
        <div onclick="openSong('${songId}', ${idx})" class="flex items-center gap-2.5 flex-1 min-w-0 cursor-pointer">
          <span class="w-5 h-5 rounded-full bg-slate-100 text-slate-600 font-bold text-[11px] flex items-center justify-center shrink-0">${idx + 1}</span>
          <div class="truncate">
            <div class="text-xs font-bold text-slate-900 truncate">${escapeHtml(songMeta.title)}</div>
          </div>
        </div>
        <div class="flex items-center gap-1 shrink-0">
          <button onclick="moveSongInSetlist(${idx}, -1)" ${idx === 0 ? 'disabled' : ''} class="p-1 text-slate-400 hover:text-slate-800 disabled:opacity-20 text-xs">↑</button>
          <button onclick="moveSongInSetlist(${idx}, 1)" ${idx === setlist.songs.length - 1 ? 'disabled' : ''} class="p-1 text-slate-400 hover:text-slate-800 disabled:opacity-20 text-xs">↓</button>
          <button onclick="removeSongFromSetlist(${idx})" class="p-1 text-red-400 hover:text-red-600 text-xs ml-1">✕</button>
        </div>
      </div>
    `;
  }).join('');
}

function toggleAddToSetlistMenu() {
  const dropdown = document.getElementById('add-setlist-dropdown');
  dropdown.classList.toggle('hidden');
  
  if (!dropdown.classList.contains('hidden')) {
    const listContainer = document.getElementById('dropdown-setlist-items');
    if (state.setlists.length === 0) {
      listContainer.innerHTML = `<div class="p-3 text-xs text-slate-500 text-center">Nessuna scaletta.<br><button onclick="switchSidebarTab('setlists'); toggleAddToSetlistMenu();" class="text-blue-600 font-bold underline mt-1">Creane una</button></div>`;
    } else {
      listContainer.innerHTML = state.setlists.map(sl => `
        <button onclick="addCurrentSongToSetlist('${sl.id}')" class="w-full text-left px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100 flex justify-between items-center">
          <span class="truncate">${escapeHtml(sl.name)}</span>
          <span class="text-[10px] text-slate-400 ml-2">${sl.songs.length}</span>
        </button>
      `).join('');
    }
  }
}

function addCurrentSongToSetlist(setlistId) {
  if (!state.currentSong) return;
  const setlist = state.setlists.find(s => s.id === setlistId);
  if (!setlist) return;

  setlist.songs.push(state.currentSong.id);
  setlist.updatedAt = Date.now();
  
  saveLocalSetlists();
  syncSetlistToCloud(setlist);
  
  document.getElementById('add-setlist-dropdown').classList.add('hidden');
  if (state.activeSetlistId === setlistId) renderActiveSetlistDetail();
  showToast(`Aggiunto a "${setlist.name}"`);
}

function moveSongInSetlist(index, direction) {
  const setlist = state.setlists.find(s => s.id === state.activeSetlistId);
  if (!setlist) return;

  const newIndex = index + direction;
  if (newIndex < 0 || newIndex >= setlist.songs.length) return;

  const temp = setlist.songs[index];
  setlist.songs[index] = setlist.songs[newIndex];
  setlist.songs[newIndex] = temp;
  setlist.updatedAt = Date.now();

  if (state.activeSetlistIndex === index) state.activeSetlistIndex = newIndex;
  else if (state.activeSetlistIndex === newIndex) state.activeSetlistIndex = index;

  saveLocalSetlists();
  syncSetlistToCloud(setlist);
  renderActiveSetlistDetail();
  updateSetlistNavBar();
}

function removeSongFromSetlist(index) {
  const setlist = state.setlists.find(s => s.id === state.activeSetlistId);
  if (!setlist) return;

  setlist.songs.splice(index, 1);
  setlist.updatedAt = Date.now();
  
  saveLocalSetlists();
  syncSetlistToCloud(setlist);
  renderActiveSetlistDetail();
  updateSetlistNavBar();
}

async function deleteCurrentSetlist() {
  if (!state.activeSetlistId) return;
  if (!confirm("Vuoi davvero eliminare questa scaletta?")) return;

  const idToDelete = state.activeSetlistId;
  
  if (!state.deletedSetlistIds.includes(idToDelete)) {
    state.deletedSetlistIds.push(idToDelete);
  }

  state.setlists = state.setlists.filter(s => s.id !== idToDelete);
  saveLocalSetlists();
  closeSetlistDetail();
  renderSetlistsIndex();

  if (window.fb && navigator.onLine) {
    try {
      const { db, doc, deleteDoc } = window.fb;
      await deleteDoc(doc(db, "scalette", idToDelete));
    } catch (e) {
      console.warn("Errore eliminazione cloud:", e);
    }
  }
  showToast("Scaletta eliminata");
}

function updateSetlistNavBar() {
  const navBar = document.getElementById('setlist-nav-bar');
  const setlist = state.setlists.find(s => s.id === state.activeSetlistId);

  if (!setlist || state.activeSetlistIndex === -1 || !setlist.songs[state.activeSetlistIndex]) {
    navBar.classList.add('hidden');
    return;
  }

  navBar.classList.remove('hidden');
  document.getElementById('setlist-progress').textContent = `${setlist.name} • ${state.activeSetlistIndex + 1} / ${setlist.songs.length}`;
  document.getElementById('btn-prev-song').disabled = state.activeSetlistIndex <= 0;
  document.getElementById('btn-next-song').disabled = state.activeSetlistIndex >= setlist.songs.length - 1;
}

function prevSongInSetlist() {
  const setlist = state.setlists.find(s => s.id === state.activeSetlistId);
  if (setlist && state.activeSetlistIndex > 0) {
    const prevIdx = state.activeSetlistIndex - 1;
    openSong(setlist.songs[prevIdx], prevIdx);
  }
}

function nextSongInSetlist() {
  const setlist = state.setlists.find(s => s.id === state.activeSetlistId);
  if (setlist && state.activeSetlistIndex < setlist.songs.length - 1) {
    const nextIdx = state.activeSetlistIndex + 1;
    openSong(setlist.songs[nextIdx], nextIdx);
  }
}

function shareSetlist() {
  const setlist = state.setlists.find(s => s.id === state.activeSetlistId);
  if (!setlist) return;

  const url = new URL(window.location.origin + window.location.pathname);
  url.searchParams.set('scaletta', setlist.id);

  navigator.clipboard.writeText(url.toString()).then(() => {
    showToast("Link scaletta copiato negli appunti!");
  }).catch(() => {
    prompt("Copia questo link per condividere la scaletta:", url.toString());
  });
}

async function handleSharedSetlistUrl(setlistId) {
  switchSidebarTab('setlists');
  
  let found = state.setlists.find(s => s.id === setlistId);
  if (found) {
    openSetlistDetail(setlistId);
    if (found.songs.length > 0) openSong(found.songs[0], 0);
    return;
  }

  const checkCloud = async () => {
    if (!window.fb) return;
    try {
      const { db, doc, getDoc } = window.fb;
      const snap = await getDoc(doc(db, "scalette", setlistId));
      if (snap.exists()) {
        const data = snap.data();
        state.deletedSetlistIds = state.deletedSetlistIds.filter(id => id !== data.id);
        state.setlists.unshift(data);
        saveLocalSetlists();
        renderSetlistsIndex();
        openSetlistDetail(setlistId);
        if (data.songs.length > 0) openSong(data.songs[0], 0);
        showToast(`Scaletta "${data.name}" caricata dal Cloud!`);
      }
    } catch (e) {
      console.error(e);
    }
  };

  if (window.fb) checkCloud();
  else window.addEventListener('firebase-ready', checkCloud);
}

// --- UI & NAVIGAZIONE ---
function switchSidebarTab(tab) {
  const tabSongs = document.getElementById('tab-songs');
  const tabSetlists = document.getElementById('tab-setlists');
  const panelSongs = document.getElementById('panel-songs');
  const panelSetlists = document.getElementById('panel-setlists');

  if (tab === 'songs') {
    tabSongs.classList.add('bg-white', 'text-slate-900', 'shadow-sm');
    tabSongs.classList.remove('text-slate-600');
    tabSetlists.classList.remove('bg-white', 'text-slate-900', 'shadow-sm');
    tabSetlists.classList.add('text-slate-600');
    panelSongs.classList.remove('hidden');
    panelSetlists.classList.add('hidden');
    panelSetlists.classList.remove('flex');
  } else {
    tabSetlists.classList.add('bg-white', 'text-slate-900', 'shadow-sm');
    tabSetlists.classList.remove('text-slate-600');
    tabSongs.classList.remove('bg-white', 'text-slate-900', 'shadow-sm');
    tabSongs.classList.add('text-slate-600');
    panelSetlists.classList.remove('hidden');
    panelSetlists.classList.add('flex');
    panelSongs.classList.add('hidden');
  }
}

function toggleSidebar() {
  const sidebar = document.getElementById('sidebar');
  const backdrop = document.getElementById('sidebar-backdrop');
  const main = document.getElementById('main-content');
  const openBtn = document.getElementById('desktop-open-sidebar-btn');

  if (window.innerWidth < 768) {
    const isClosed = sidebar.classList.contains('-translate-x-full');
    if (isClosed) {
      sidebar.classList.remove('-translate-x-full');
      backdrop.classList.remove('hidden');
    } else {
      closeSidebarMobile();
    }
  } else {
    const isDesktopHidden = sidebar.classList.contains('md:-translate-x-full');
    if (isDesktopHidden) {
      sidebar.classList.remove('md:-translate-x-full');
      main.classList.add('md:pl-80');
      if (openBtn) openBtn.classList.add('hidden');
    } else {
      sidebar.classList.add('md:-translate-x-full');
      main.classList.remove('md:pl-80');
      if (openBtn) openBtn.classList.remove('hidden');
    }
  }
}

function closeSidebarMobile() {
  document.getElementById('sidebar').classList.add('-translate-x-full');
  document.getElementById('sidebar-backdrop').classList.add('hidden');
}

function goHome() {
  state.currentSong = null;
  document.getElementById('view-song').classList.add('hidden');
  document.getElementById('view-song').classList.remove('flex');
  document.getElementById('view-welcome').classList.remove('hidden');
  document.getElementById('mobile-header-title').textContent = "Canzoniere Osvaldo-Paolo";
  const url = new URL(window.location);
  url.searchParams.delete('canto');
  window.history.replaceState({}, '', url);
  renderSongList();
}

function updateSetlistBadge() {
  const badge = document.getElementById('setlist-badge');
  if (state.setlists.length > 0) {
    badge.textContent = state.setlists.length;
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }
}

function setupEventListeners() {
  const searchInput = document.getElementById('search-input');
  searchInput.addEventListener('input', (e) => {
    state.searchQuery = e.target.value;
    document.getElementById('clear-search').classList.toggle('hidden', !state.searchQuery);
    renderSongList();
  });

  document.addEventListener('click', (e) => {
    const dropdown = document.getElementById('add-setlist-dropdown');
    if (dropdown && !dropdown.contains(e.target) && !e.target.closest('button[onclick="toggleAddToSetlistMenu()"]')) {
      dropdown.classList.add('hidden');
    }
  });

  window.addEventListener('online', updateConnectionStatus);
  window.addEventListener('offline', updateConnectionStatus);
}

function updateConnectionStatus() {
  const el = document.getElementById('connection-status');
  if (navigator.onLine) {
    el.innerHTML = `<span class="w-2 h-2 rounded-full bg-emerald-500"></span> Online`;
  } else {
    el.innerHTML = `<span class="w-2 h-2 rounded-full bg-amber-500"></span> Offline`;
  }
}

function loadPreferences() {
  try {
    const prefs = JSON.parse(localStorage.getItem(STORAGE_KEYS.PREFS));
    if (prefs && prefs.fontSize) state.fontSize = prefs.fontSize;
  } catch (e) {}
}

function savePreferences() {
  localStorage.setItem(STORAGE_KEYS.PREFS, JSON.stringify({ fontSize: state.fontSize }));
}

async function forceUpdateCache() {
  localStorage.removeItem(STORAGE_KEYS.INDEX);
  Object.keys(localStorage).forEach(k => {
    if (k.startsWith(STORAGE_KEYS.SONG_PREFIX)) localStorage.removeItem(k);
  });
  if ('caches' in window) {
    const names = await caches.keys();
    await Promise.all(names.map(name => caches.delete(name)));
  }
  if ('serviceWorker' in navigator) {
    const regs = await navigator.serviceWorker.getRegistrations();
    await Promise.all(regs.map(r => r.update()));
  }
  showToast("Cache svuotata, ricarico...");
  setTimeout(() => window.location.reload(true), 800);
}

function showToast(message, type = "info") {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  const bg = type === 'error' ? 'bg-red-600' : 'bg-slate-900';
  toast.className = `${bg} text-white text-xs font-medium px-4 py-3 rounded-xl shadow-lg text-center transition-all duration-300 transform translate-y-2 opacity-0`;
  toast.textContent = message;
  
  container.appendChild(toast);
  requestAnimationFrame(() => {
    toast.classList.remove('translate-y-2', 'opacity-0');
  });

  setTimeout(() => {
    toast.classList.add('opacity-0', 'translate-y-2');
    setTimeout(() => toast.remove(), 300);
  }, 2800);
}

function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}