/**
 * Canzoniere Sant'Osvaldo e San Paolo - Core Logic
 * Supporta sia formato "sections" che formato "lines" (t: h/c/l/s) e accordi minori con "-" (es. LA-, DO#-)
 */

const STORAGE_KEYS = {
  INDEX: 'canzoniere_sosp_index_v2',
  SONG_PREFIX: 'canzoniere_sosp_song_v2_',
  SETLISTS: 'canzoniere_sosp_setlists_v1'
};

let state = {
  songsIndex: [],
  filteredSongs: [],
  currentSong: null,
  currentCategory: 'all',
  searchQuery: '',
  transpose: 0,
  fontSize: 16,
  viewMode: 'chords',
  setlists: {},
  activeSetlistId: null,
  activeSetlistIndex: -1
};

const NOTES_SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const NOTES_FLAT  = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

const IT_TO_ENG = {
  'Do': 'C', 'Do#': 'C#', 'Reb': 'Db', 'DO': 'C', 'DO#': 'C#', 'REb': 'Db',
  'Re': 'D', 'Re#': 'D#', 'Mib': 'Eb', 'RE': 'D', 'RE#': 'D#', 'MIb': 'Eb',
  'Mi': 'E', 'MI': 'E',
  'Fa': 'F', 'Fa#': 'F#', 'Solb': 'Gb', 'FA': 'F', 'FA#': 'F#', 'SOLb': 'Gb',
  'Sol': 'G', 'Sol#': 'G#', 'Lab': 'Ab', 'SOL': 'G', 'SOL#': 'G#', 'LAb': 'Ab',
  'La': 'A', 'La#': 'A#', 'Sib': 'Bb', 'LA': 'A', 'LA#': 'A#', 'SIb': 'Bb',
  'Si': 'B', 'SI': 'B'
};

const ENG_TO_IT_UPPER = {
  'C': 'DO', 'C#': 'DO#', 'Db': 'REb',
  'D': 'RE', 'D#': 'RE#', 'Eb': 'MIb',
  'E': 'MI',
  'F': 'FA', 'F#': 'FA#', 'Gb': 'SOLb',
  'G': 'SOL', 'G#': 'SOL#', 'Ab': 'LAb',
  'A': 'LA', 'A#': 'LA#', 'Bb': 'SIb',
  'B': 'SI'
};

const ENG_TO_IT_TITLE = {
  'C': 'Do', 'C#': 'Do#', 'Db': 'Reb',
  'D': 'Re', 'D#': 'Re#', 'Eb': 'Mib',
  'E': 'Mi',
  'F': 'Fa', 'F#': 'Fa#', 'Gb': 'Solb',
  'G': 'Sol', 'G#': 'Sol#', 'Ab': 'Lab',
  'A': 'La', 'A#': 'La#', 'Bb': 'Sib',
  'B': 'Si'
};

document.addEventListener('DOMContentLoaded', async () => {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(err => console.log('SW:', err));
  }

  loadLocalSetlists();
  await loadSongsIndex();

  const urlParams = new URLSearchParams(window.location.search);
  const sharedSetlistId = urlParams.get('scaletta');
  const songSlug = urlParams.get('canto');

  if (sharedSetlistId) {
    await importSharedSetlist(sharedSetlistId);
  } else if (songSlug) {
    const songMeta = state.songsIndex.find(s => s.slug === songSlug || s.id === songSlug);
    if (songMeta) loadSong(songMeta);
  }

  document.getElementById('search-input').addEventListener('input', (e) => {
    state.searchQuery = e.target.value;
    document.getElementById('clear-search').classList.toggle('hidden', !state.searchQuery);
    filterSongs();
  });

  setTimeout(initFirebaseSync, 800);
});

/* --- GESTIONE INDICE E CANTI --- */

async function loadSongsIndex() {
  const cached = localStorage.getItem(STORAGE_KEYS.INDEX);
  if (cached) {
    state.songsIndex = JSON.parse(cached);
    filterSongs();
  }

  try {
    const res = await fetch('canti/index.json?t=' + Date.now());
    if (!res.ok) throw new Error("Errore fetch index");
    let freshData = await res.json();

    freshData = freshData.map(item => {
      const slug = item.slug || item.id || item.file.replace('.json', '');
      return {
        ...item,
        slug,
        author: item.author || item.sub || '',
        file: item.file || `${slug}.json`,
        categories: item.categories || (item.category ? [item.category] : [])
      };
    });

    freshData.sort((a, b) => a.title.localeCompare(b.title));

    if (JSON.stringify(freshData) !== cached) {
      state.songsIndex = freshData;
      localStorage.setItem(STORAGE_KEYS.INDEX, JSON.stringify(freshData));
      filterSongs();
      if (cached) showToast("Elenco canti aggiornato");
    }
  } catch (err) {
    console.warn("Modalità offline per indice:", err);
    if (!cached) {
      document.getElementById('song-list').innerHTML = `<div class="p-4 text-center text-red-500 text-xs">Impossibile caricare canti/index.json. Verifica che il file esista.</div>`;
    }
  }
}

function filterCategory(cat) {
  state.currentCategory = cat;
  document.querySelectorAll('.cat-pill').forEach(btn => {
    const isActive = btn.dataset.cat === cat;
    btn.className = isActive 
      ? 'cat-pill active px-2.5 py-1 rounded-full text-xs font-medium bg-slate-900 text-white whitespace-nowrap transition'
      : 'cat-pill px-2.5 py-1 rounded-full text-xs font-medium bg-slate-100 text-slate-600 hover:bg-slate-200 whitespace-nowrap transition';
  });
  filterSongs();
}

function clearSearch() {
  state.searchQuery = '';
  document.getElementById('search-input').value = '';
  document.getElementById('clear-search').classList.add('hidden');
  filterSongs();
}

function filterSongs() {
  const q = state.searchQuery.toLowerCase().trim();
  
  state.filteredSongs = state.songsIndex.filter(song => {
    const matchesCat = state.currentCategory === 'all' || 
                       (song.categories && song.categories.includes(state.currentCategory));
    const matchesText = !q || 
                        song.title.toLowerCase().includes(q) || 
                        (song.author && song.author.toLowerCase().includes(q)) ||
                        (song.incipit && song.incipit.toLowerCase().includes(q)) ||
                        (song.search && song.search.toLowerCase().includes(q));
    return matchesCat && matchesText;
  });

  renderSongList();
}

function renderSongList() {
  const container = document.getElementById('song-list');
  if (state.filteredSongs.length === 0) {
    container.innerHTML = `<div class="p-8 text-center text-slate-400 text-sm">Nessun canto trovato.</div>`;
    return;
  }

  container.innerHTML = state.filteredSongs.map(song => `
    <div onclick='selectSongFromList("${song.slug}")' 
         class="p-3.5 hover:bg-slate-50 cursor-pointer transition flex items-center justify-between group ${state.currentSong?.slug === song.slug ? 'bg-blue-50/60 border-l-4 border-blue-600' : ''}">
      <div class="min-w-0 pr-2">
        <h4 class="font-semibold text-sm text-slate-800 group-hover:text-blue-700 truncate">${song.title}</h4>
        <div class="flex items-center gap-2 mt-0.5">
          <span class="text-xs text-slate-400 truncate">${song.author || 'Tradizionale'}</span>
          ${song.categories && song.categories[0] ? `<span class="text-[10px] px-1.5 py-0.2 bg-slate-100 text-slate-500 rounded">${song.categories[0]}</span>` : ''}
        </div>
      </div>
      <svg class="w-4 h-4 text-slate-300 group-hover:text-slate-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/></svg>
    </div>
  `).join('');
}

async function selectSongFromList(slug) {
  state.activeSetlistIndex = -1;
  updateSetlistNavBar();

  const meta = state.songsIndex.find(s => s.slug === slug);
  if (meta) {
    await loadSong(meta);
    if (window.innerWidth < 768) toggleSidebar();
  }
}

async function loadSong(meta) {
  const cacheKey = STORAGE_KEYS.SONG_PREFIX + meta.slug;
  let songData = null;

  const cached = localStorage.getItem(cacheKey);
  if (cached) songData = JSON.parse(cached);

  try {
    const res = await fetch(`canti/${meta.file}?t=${Date.now()}`);
    if (res.ok) {
      songData = await res.json();
      localStorage.setItem(cacheKey, JSON.stringify(songData));
    }
  } catch (e) {
    console.log("Uso versione offline per", meta.slug);
  }

  if (!songData) {
    showToast("Errore: canto non trovato in canti/" + meta.file, "error");
    return;
  }

  const normalizedData = normalizeSongFormat(songData);

  state.currentSong = {
    ...meta,
    ...normalizedData,
    author: normalizedData.author || normalizedData.sub || meta.author || ''
  };
  state.transpose = 0;
  
  const url = new URL(window.location);
  url.searchParams.set('canto', meta.slug);
  window.history.pushState({}, '', url);

  renderSongView();
  renderSongList();
}

function normalizeSongFormat(data) {
  if (data.sections && Array.isArray(data.sections)) {
    return data;
  }

  if (!data.lines || !Array.isArray(data.lines)) {
    return { ...data, sections: [] };
  }

  const sections = [];
  let currentSec = { type: 'strofa', label: '', lines: [] };
  let pendingChords = null;

  for (const item of data.lines) {
    if (item.t === 's') {
      if (pendingChords !== null) {
        currentSec.lines.push({ chords: pendingChords, lyrics: '' });
        pendingChords = null;
      }
      if (currentSec.label || currentSec.lines.length > 0) {
        sections.push(currentSec);
      }
      currentSec = { type: 'strofa', label: '', lines: [] };
    } else if (item.t === 'h') {
      if (pendingChords !== null) {
        currentSec.lines.push({ chords: pendingChords, lyrics: '' });
        pendingChords = null;
      }
      if (currentSec.label || currentSec.lines.length > 0) {
        sections.push(currentSec);
      }
      const lbl = item.v || '';
      const isRit = lbl.toLowerCase().includes('ritornello') || lbl.toLowerCase().startsWith('rit');
      currentSec = { type: isRit ? 'ritornello' : 'strofa', label: lbl, lines: [] };
    } else if (item.t === 'c') {
      if (pendingChords !== null) {
        currentSec.lines.push({ chords: pendingChords, lyrics: '' });
      }
      pendingChords = item.v || '';
    } else if (item.t === 'l') {
      currentSec.lines.push({
        chords: pendingChords || '',
        lyrics: item.v || ''
      });
      pendingChords = null;
    }
  }

  if (pendingChords !== null) {
    currentSec.lines.push({ chords: pendingChords, lyrics: '' });
  }
  if (currentSec.label || currentSec.lines.length > 0) {
    sections.push(currentSec);
  }

  return { ...data, sections };
}

/* --- VISUALIZZAZIONE E TRASPOSIZIONE --- */

function renderSongView() {
  document.getElementById('view-welcome').classList.add('hidden');
  const viewSong = document.getElementById('view-song');
  viewSong.classList.remove('hidden');

  const s = state.currentSong;
  document.getElementById('mobile-header-title').innerText = s.title;
  document.getElementById('song-title').innerText = s.title;
  document.getElementById('song-author').innerText = s.author || '';
  document.getElementById('transpose-display').innerText = state.transpose > 0 ? `+${state.transpose}` : state.transpose;

  const badgesContainer = document.getElementById('song-badges');
  badgesContainer.innerHTML = (s.categories || []).map(c => 
    `<span class="px-2 py-0.5 rounded-md bg-slate-100 text-slate-600 text-[11px] font-semibold uppercase tracking-wide">${c}</span>`
  ).join('');

  renderSongBody();
}

function renderSongBody() {
  const container = document.getElementById('song-body');
  container.style.fontSize = `${state.fontSize}px`;

  if (!state.currentSong || !state.currentSong.sections) {
    container.innerHTML = '';
    return;
  }

  const html = state.currentSong.sections.map(sec => {
    const isChorus = sec.type === 'ritornello' || sec.label?.toLowerCase().includes('rit');
    const labelHtml = sec.label 
      ? `<div class="section-label text-xs font-bold uppercase tracking-wider mb-1 ${isChorus ? 'text-blue-600' : 'text-slate-400'}">${sec.label}</div>` 
      : '';

    const linesHtml = sec.lines.map(line => {
      const hasChords = line.chords && line.chords.trim().length > 0;
      const transposedChords = hasChords ? transposeLine(line.chords, state.transpose) : '';
      
      return `
        <div class="song-line">
          ${hasChords ? `<div class="chord-line font-mono-chord text-blue-700 font-bold text-[0.9em] leading-none mb-0.5 select-none whitespace-pre">${transposedChords}</div>` : ''}
          ${line.lyrics !== undefined && line.lyrics !== '' ? `<div class="lyric-line text-slate-800 leading-snug whitespace-pre-wrap ${isChorus ? 'font-semibold' : ''}">${line.lyrics}</div>` : ''}
        </div>
      `;
    }).join('');

    return `
      <div class="song-block mb-6 ${isChorus ? 'pl-3 border-l-2 border-blue-200' : ''}">
        ${labelHtml}
        ${linesHtml}
      </div>
    `;
  }).join('');

  container.innerHTML = html;
}

function transpose(delta) {
  state.transpose += delta;
  if (state.transpose > 11) state.transpose -= 12;
  if (state.transpose < -11) state.transpose += 12;
  document.getElementById('transpose-display').innerText = state.transpose > 0 ? `+${state.transpose}` : state.transpose;
  renderSongBody();
}

function transposeLine(line, semitones) {
  if (semitones === 0) return line;
  const useFlats = [-1, -2, -3, -5, -7, 4, 5, 10].includes(semitones);

  // Cattura accordi italiani (DO, RE, LA-, DO#-, SIb7) e inglesi (C, Am, F#m7) delimitati da spazi/inizio/fine/slash/parentesi
  const chordTokenRegex = /(^|[\s(\[|])((?:SOL#?|SOLb|DO#?|RE[b#]?|MI|FA#?|LA[b#]?|SI[b]?|Sol#?|Solb|Do#?|Re[b#]?|Mi|Fa#?|La[b#]?|Si[b]?|[A-G][#b]?)(?:[-m]|maj|min|dim|aug|sus|add|7|9|11|13|6|5|4|2)*)(\/(?:SOL#?|SOLb|DO#?|RE[b#]?|MI|FA#?|LA[b#]?|SI[b]?|Sol#?|Solb|Do#?|Re[b#]?|Mi|Fa#?|La[b#]?|Si[b]?|[A-G][#b]?))?(?=$|[\s)\].,;|])(\s*)/g;

  return line.replace(chordTokenRegex, (match, prefix, chordPart, bassPart, trailingSpaces) => {
    const rootMatch = chordPart.match(/^(SOL#?|SOLb|DO#?|RE[b#]?|MI|FA#?|LA[b#]?|SI[b]?|Sol#?|Solb|Do#?|Re[b#]?|Mi|Fa#?|La[b#]?|Si[b]?|[A-G][#b]?)(.*)$/);
    if (!rootMatch) return match;

    const root = rootMatch[1];
    const suffix = rootMatch[2] || '';
    const newRoot = transposeNote(root, semitones, useFlats);

    let newBass = '';
    if (bassPart) {
      newBass = '/' + transposeNote(bassPart.substring(1), semitones, useFlats);
    }

    const oldChordFull = chordPart + (bassPart || '');
    const newChordFull = newRoot + suffix + newBass;

    // Compensa gli spazi successivi per mantenere l'allineamento verticale col testo
    let adjustedSpaces = trailingSpaces;
    const lenDiff = newChordFull.length - oldChordFull.length;
    if (lenDiff > 0 && trailingSpaces.length > 1) {
      adjustedSpaces = ' '.repeat(Math.max(1, trailingSpaces.length - lenDiff));
    } else if (lenDiff < 0 && trailingSpaces.length > 0) {
      adjustedSpaces = trailingSpaces + ' '.repeat(-lenDiff);
    }

    return prefix + newChordFull + adjustedSpaces;
  });
}

function transposeNote(note, semitones, useFlats = false) {
  const isEnglish = /^[A-G][#b]?$/.test(note);
  const isUpperItalian = !isEnglish && note === note.toUpperCase();

  const engNote = isEnglish ? note : (IT_TO_ENG[note] || note);

  let idx = NOTES_SHARP.indexOf(engNote);
  if (idx === -1) idx = NOTES_FLAT.indexOf(engNote);
  if (idx === -1) return note;

  const newIdx = ((idx + semitones) % 12 + 12) % 12;
  const newEng = useFlats ? NOTES_FLAT[newIdx] : NOTES_SHARP[newIdx];

  if (isEnglish) return newEng;
  return isUpperItalian ? (ENG_TO_IT_UPPER[newEng] || newEng) : (ENG_TO_IT_TITLE[newEng] || newEng);
}

function changeFontSize(delta) {
  state.fontSize = Math.max(12, Math.min(28, state.fontSize + delta));
  document.getElementById('song-body').style.fontSize = `${state.fontSize}px`;
}

function toggleViewMode() {
  const container = document.getElementById('view-song');
  const btnLabel = document.getElementById('label-view-mode');
  const iconChords = document.getElementById('icon-chords');
  const iconBook = document.getElementById('icon-book');

  if (state.viewMode === 'chords') {
    state.viewMode = 'book';
    container.classList.add('mode-book');
    btnLabel.innerText = 'Libro';
    iconChords.classList.add('hidden');
    iconBook.classList.remove('hidden');
    showToast("Modalità Libro (senza accordi)");
  } else {
    state.viewMode = 'chords';
    container.classList.remove('mode-book');
    btnLabel.innerText = 'Accordi';
    iconChords.classList.remove('hidden');
    iconBook.classList.add('hidden');
  }
}

/* --- GESTIONE SCALETTE --- */

function loadLocalSetlists() {
  const saved = localStorage.getItem(STORAGE_KEYS.SETLISTS);
  if (saved) state.setlists = JSON.parse(saved);
  updateSetlistBadge();
}

function saveLocalSetlists() {
  localStorage.setItem(STORAGE_KEYS.SETLISTS, JSON.stringify(state.setlists));
  updateSetlistBadge();
}

function updateSetlistBadge() {
  const count = Object.keys(state.setlists).length;
  const badge = document.getElementById('setlist-badge');
  badge.innerText = count;
  badge.classList.toggle('hidden', count === 0);
}

function createNewSetlist() {
  const input = document.getElementById('new-setlist-name');
  const name = input.value.trim();
  if (!name) return;

  const id = 'sl_' + Date.now().toString(36);
  const newSetlist = {
    id,
    name,
    songs: [],
    updatedAt: Date.now()
  };

  state.setlists[id] = newSetlist;
  saveLocalSetlists();
  syncSetlistToCloud(newSetlist);

  input.value = '';
  renderSetlistsIndex();
  openSetlistDetail(id);
  showToast("Scaletta creata");
}

function renderSetlistsIndex() {
  const container = document.getElementById('setlists-index');
  const list = Object.values(state.setlists).sort((a, b) => b.updatedAt - a.updatedAt);

  if (list.length === 0) {
    container.innerHTML = `<div class="text-center p-6 text-slate-400 text-xs">Nessuna scaletta salvata.<br>Creane una qui sopra!</div>`;
    return;
  }

  container.innerHTML = list.map(sl => `
    <div onclick="openSetlistDetail('${sl.id}')" class="p-3 bg-white border border-slate-200 rounded-xl hover:border-blue-400 cursor-pointer shadow-2xs transition flex justify-between items-center">
      <div>
        <h4 class="font-bold text-sm text-slate-800">${sl.name}</h4>
        <p class="text-xs text-slate-500">${sl.songs.length} canti</p>
      </div>
      <svg class="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/></svg>
    </div>
  `).join('');
}

function openSetlistDetail(id) {
  state.activeSetlistId = id;
  const sl = state.setlists[id];
  if (!sl) return;

  document.getElementById('setlists-index').classList.add('hidden');
  document.getElementById('active-setlist-view').classList.remove('hidden');
  document.getElementById('current-setlist-title').innerText = sl.name;
  document.getElementById('current-setlist-meta').innerText = `${sl.songs.length} canti • ID: ${id}`;

  const container = document.getElementById('setlist-songs-container');
  if (sl.songs.length === 0) {
    container.innerHTML = `<div class="p-6 text-center text-slate-400 text-xs">Scaletta vuota.<br>Apri un canto e clicca "+ Scaletta".</div>`;
    return;
  }

  container.innerHTML = sl.songs.map((slug, idx) => {
    const songMeta = state.songsIndex.find(s => s.slug === slug) || { title: slug, author: '' };
    return `
      <div class="p-2.5 bg-white border border-slate-200 rounded-lg flex items-center justify-between gap-2 shadow-2xs">
        <div onclick="playSetlistSong('${id}', ${idx})" class="flex-1 cursor-pointer min-w-0">
          <div class="flex items-center gap-2">
            <span class="w-5 h-5 rounded-full bg-slate-100 text-slate-600 text-[10px] font-bold flex items-center justify-center shrink-0">${idx + 1}</span>
            <span class="font-semibold text-sm text-slate-800 truncate hover:text-blue-600">${songMeta.title}</span>
          </div>
        </div>
        <div class="flex items-center gap-1 shrink-0">
          <button onclick="moveSongInSetlist('${id}', ${idx}, -1)" class="p-1 text-slate-400 hover:text-slate-700 disabled:opacity-20" ${idx === 0 ? 'disabled' : ''}>↑</button>
          <button onclick="moveSongInSetlist('${id}', ${idx}, 1)" class="p-1 text-slate-400 hover:text-slate-700 disabled:opacity-20" ${idx === sl.songs.length - 1 ? 'disabled' : ''}>↓</button>
          <button onclick="removeSongFromSetlist('${id}', ${idx})" class="p-1 text-red-400 hover:text-red-600 ml-1">✕</button>
        </div>
      </div>
    `;
  }).join('');
}

function closeSetlistDetail() {
  state.activeSetlistId = null;
  document.getElementById('active-setlist-view').classList.add('hidden');
  document.getElementById('setlists-index').classList.remove('hidden');
  renderSetlistsIndex();
}

function toggleAddToSetlistMenu() {
  const menu = document.getElementById('add-setlist-dropdown');
  const isHidden = menu.classList.contains('hidden');
  if (isHidden) {
    const listContainer = document.getElementById('dropdown-setlist-items');
    const setlists = Object.values(state.setlists);
    if (setlists.length === 0) {
      listContainer.innerHTML = `<div class="p-3 text-xs text-slate-500 text-center">Crea prima una scaletta nel menu!</div>`;
    } else {
      listContainer.innerHTML = setlists.map(sl => `
        <button onclick="addCurrentSongToSetlist('${sl.id}')" class="w-full text-left px-3 py-2 text-xs font-medium text-slate-700 hover:bg-blue-50 hover:text-blue-700 truncate block">
          + ${sl.name}
        </button>
      `).join('');
    }
    menu.classList.remove('hidden');
  } else {
    menu.classList.add('hidden');
  }
}

function addCurrentSongToSetlist(setlistId) {
  document.getElementById('add-setlist-dropdown').classList.add('hidden');
  if (!state.currentSong || !state.setlists[setlistId]) return;

  const sl = state.setlists[setlistId];
  sl.songs.push(state.currentSong.slug);
  sl.updatedAt = Date.now();
  
  saveLocalSetlists();
  syncSetlistToCloud(sl);
  if (state.activeSetlistId === setlistId) openSetlistDetail(setlistId);
  showToast(`Aggiunto a "${sl.name}"`);
}

function removeSongFromSetlist(setlistId, index) {
  const sl = state.setlists[setlistId];
  sl.songs.splice(index, 1);
  sl.updatedAt = Date.now();
  saveLocalSetlists();
  syncSetlistToCloud(sl);
  openSetlistDetail(setlistId);
}

function moveSongInSetlist(setlistId, index, direction) {
  const sl = state.setlists[setlistId];
  const newIndex = index + direction;
  if (newIndex < 0 || newIndex >= sl.songs.length) return;
  
  const temp = sl.songs[index];
  sl.songs[index] = sl.songs[newIndex];
  sl.songs[newIndex] = temp;
  sl.updatedAt = Date.now();
  
  saveLocalSetlists();
  syncSetlistToCloud(sl);
  openSetlistDetail(setlistId);
}

function deleteCurrentSetlist() {
  if (!state.activeSetlistId) return;
  if (!confirm("Eliminare questa scaletta?")) return;

  const id = state.activeSetlistId;
  delete state.setlists[id];
  saveLocalSetlists();
  
  if (window.fb) {
    window.fb.deleteDoc(window.fb.doc(window.fb.db, "setlists", id)).catch(console.error);
  }
  closeSetlistDetail();
  showToast("Scaletta eliminata");
}

function playSetlistSong(setlistId, index) {
  const sl = state.setlists[setlistId];
  if (!sl || !sl.songs[index]) return;

  state.activeSetlistId = setlistId;
  state.activeSetlistIndex = index;

  const slug = sl.songs[index];
  const meta = state.songsIndex.find(s => s.slug === slug);
  if (meta) {
    loadSong(meta);
    updateSetlistNavBar();
    if (window.innerWidth < 768) toggleSidebar();
  }
}

function updateSetlistNavBar() {
  const bar = document.getElementById('setlist-nav-bar');
  if (state.activeSetlistId && state.activeSetlistIndex >= 0) {
    const sl = state.setlists[state.activeSetlistId];
    bar.classList.remove('hidden');
    document.getElementById('setlist-progress').innerText = `${sl.name} (${state.activeSetlistIndex + 1}/${sl.songs.length})`;
    document.getElementById('btn-prev-song').disabled = state.activeSetlistIndex === 0;
    document.getElementById('btn-next-song').disabled = state.activeSetlistIndex >= sl.songs.length - 1;
  } else {
    bar.classList.add('hidden');
  }
}

function prevSongInSetlist() {
  if (state.activeSetlistIndex > 0) playSetlistSong(state.activeSetlistId, state.activeSetlistIndex - 1);
}

function nextSongInSetlist() {
  const sl = state.setlists[state.activeSetlistId];
  if (sl && state.activeSetlistIndex < sl.songs.length - 1) playSetlistSong(state.activeSetlistId, state.activeSetlistIndex + 1);
}

/* --- CLOUD SYNC (FIREBASE) --- */

function initFirebaseSync() {
  if (!window.fb) return;
  const statusEl = document.getElementById('connection-status');
  statusEl.innerHTML = `<span class="w-2 h-2 rounded-full bg-emerald-500"></span> Cloud Attivo`;

  Object.keys(state.setlists).forEach(id => {
    listenToSetlist(id);
  });
}

function syncSetlistToCloud(setlist) {
  if (!window.fb) return;
  window.fb.setDoc(window.fb.doc(window.fb.db, "setlists", setlist.id), setlist)
    .then(() => listenToSetlist(setlist.id))
    .catch(err => console.warn("Sync offline:", err));
}

function listenToSetlist(id) {
  if (!window.fb) return;
  window.fb.onSnapshot(window.fb.doc(window.fb.db, "setlists", id), (docSnap) => {
    if (docSnap.exists()) {
      const remoteData = docSnap.data();
      const localData = state.setlists[id];
      if (!localData || remoteData.updatedAt > localData.updatedAt) {
        state.setlists[id] = remoteData;
        saveLocalSetlists();
        if (state.activeSetlistId === id) openSetlistDetail(id);
        renderSetlistsIndex();
      }
    }
  });
}

function shareSetlist() {
  if (!state.activeSetlistId) return;
  const url = `${window.location.origin}${window.location.pathname}?scaletta=${state.activeSetlistId}`;
  navigator.clipboard.writeText(url).then(() => {
    showToast("Link scaletta copiato!");
  }).catch(() => {
    prompt("Copia questo link per condividere:", url);
  });
}

async function importSharedSetlist(id) {
  switchSidebarTab('setlists');
  if (state.setlists[id]) {
    openSetlistDetail(id);
    return;
  }

  let attempts = 0;
  while (!window.fb && attempts < 10) {
    await new Promise(r => setTimeout(r, 200));
    attempts++;
  }

  if (window.fb) {
    try {
      const snap = await window.fb.getDoc(window.fb.doc(window.fb.db, "setlists", id));
      if (snap.exists()) {
        const data = snap.data();
        state.setlists[id] = data;
        saveLocalSetlists();
        listenToSetlist(id);
        openSetlistDetail(id);
        showToast(`Scaletta "${data.name}" importata!`);
      } else {
        showToast("Scaletta non trovata", "error");
      }
    } catch (e) {
      showToast("Errore caricamento scaletta", "error");
    }
  }
}

/* --- UI UTILS --- */

function toggleSidebar() {
  const sb = document.getElementById('sidebar');
  const bd = document.getElementById('sidebar-backdrop');
  const isClosed = sb.classList.contains('-translate-x-full');
  
  if (isClosed) {
    sb.classList.remove('-translate-x-full');
    bd.classList.remove('hidden');
  } else {
    sb.classList.add('-translate-x-full');
    bd.classList.add('hidden');
  }
}

function switchSidebarTab(tab) {
  const isSongs = tab === 'songs';
  document.getElementById('tab-songs').className = isSongs 
    ? 'flex-1 py-2 text-xs font-semibold rounded-md bg-white text-slate-900 shadow-sm transition'
    : 'flex-1 py-2 text-xs font-semibold rounded-md text-slate-600 hover:text-slate-900 transition';
  
  document.getElementById('tab-setlists').className = !isSongs 
    ? 'flex-1 py-2 text-xs font-semibold rounded-md bg-white text-slate-900 shadow-sm transition flex items-center justify-center gap-1'
    : 'flex-1 py-2 text-xs font-semibold rounded-md text-slate-600 hover:text-slate-900 transition flex items-center justify-center gap-1';

  document.getElementById('panel-songs').classList.toggle('hidden', !isSongs);
  document.getElementById('panel-setlists').classList.toggle('hidden', isSongs);

  if (!isSongs) renderSetlistsIndex();
}

function goHome() {
  document.getElementById('view-song').classList.add('hidden');
  document.getElementById('view-welcome').classList.remove('hidden');
  state.currentSong = null;
  renderSongList();
}

function showToast(msg, type = 'info') {
  const container = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className = `px-4 py-2.5 rounded-xl shadow-lg text-xs font-semibold text-white text-center transition-all transform translate-y-2 opacity-0 ${type === 'error' ? 'bg-red-600' : 'bg-slate-800'}`;
  el.innerText = msg;
  container.appendChild(el);

  requestAnimationFrame(() => el.classList.remove('translate-y-2', 'opacity-0'));
  setTimeout(() => {
    el.classList.add('opacity-0');
    setTimeout(() => el.remove(), 300);
  }, 2500);
}

function forceUpdateCache() {
  localStorage.removeItem(STORAGE_KEYS.INDEX);
  Object.keys(localStorage).forEach(k => {
    if (k.startsWith(STORAGE_KEYS.SONG_PREFIX)) localStorage.removeItem(k);
  });
  showToast("Cache svuotata, ricarico...");
  setTimeout(() => window.location.reload(), 800);
}
