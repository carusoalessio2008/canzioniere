/**
 * Canzoniere Sant'Osvaldo e San Paolo - Core Logic
 * Supporta formato "sections", formato "lines" (t: h/c/l/s), [ACCORDO], accordi minori con "-" e Editor Inline diretto
 */

const STORAGE_KEYS = {
  INDEX: 'canzoniere_sosp_index_v2',
  SONG_PREFIX: 'canzoniere_sosp_song_v2_',
  SETLISTS: 'canzoniere_sosp_setlists_v1',
  DELETED_SETLISTS: 'canzoniere_sosp_deleted_setlists_v1'
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
  deletedSetlistIds: [],
  activeSetlistId: null,
  activeSetlistIndex: -1,
  firebaseInitialized: false
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

  if (window.fb) {
    initFirebaseSync();
  }
  window.addEventListener('firebase-ready', initFirebaseSync);

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
  if (editorState.isOpen) exitInlineEditor();
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

  if (editorState.cloudSongsOverrides[meta.slug]) {
    songData = editorState.cloudSongsOverrides[meta.slug];
  } else if (window.fb && window.fb.getDoc) {
    try {
      const cloudSnap = await window.fb.getDoc(window.fb.doc(window.fb.db, "songs", meta.slug));
      if (cloudSnap.exists()) {
        songData = cloudSnap.data();
        editorState.cloudSongsOverrides[meta.slug] = songData;
        localStorage.setItem(cacheKey, JSON.stringify(songData));
      }
    } catch (e) {
      console.log("Nessuna override cloud per", meta.slug);
    }
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

function parseInlineBrackets(existingChords, rawLyrics) {
  if (!rawLyrics || !rawLyrics.includes('[')) {
    return { chords: existingChords || '', lyrics: rawLyrics || '' };
  }

  let cleanLyrics = '';
  let chordChars = (existingChords || '').split('');
  let i = 0;

  while (i < rawLyrics.length) {
    if (rawLyrics[i] === '[') {
      const closeIdx = rawLyrics.indexOf(']', i);
      if (closeIdx !== -1) {
        const chord = rawLyrics.slice(i + 1, closeIdx).trim();
        const pos = cleanLyrics.length;
        while (chordChars.length < pos) chordChars.push(' ');
        for (let k = 0; k < chord.length; k++) {
          chordChars[pos + k] = chord[k];
        }
        i = closeIdx + 1;
        continue;
      }
    }
    cleanLyrics += rawLyrics[i];
    i++;
  }

  return {
    chords: chordChars.join('').replace(/\s+$/, ''),
    lyrics: cleanLyrics
  };
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
      const parsed = parseInlineBrackets(pendingChords, item.v || '');
      currentSec.lines.push({
        chords: parsed.chords,
        lyrics: parsed.lyrics
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

  ensureEditButton();

  if (editorState.isOpen) {
    renderInlineEditorView();
  } else {
    renderSongBody();
  }
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
      const monoStyle = hasChords ? 'font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; letter-spacing: 0;' : '';
      
      return `
        <div class="song-line">
          ${hasChords ? `<div class="chord-line text-blue-700 font-bold text-[0.95em] leading-none mb-0.5 select-none whitespace-pre" style="${monoStyle}">${transposedChords}</div>` : ''}
          ${line.lyrics !== undefined && line.lyrics !== '' ? `<div class="lyric-line text-slate-800 leading-snug whitespace-pre-wrap ${isChorus ? 'font-semibold' : ''}" style="${monoStyle}">${line.lyrics}</div>` : ''}
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
  if (!editorState.isOpen) renderSongBody();
}

function transposeLine(line, semitones) {
  if (semitones === 0) return line;
  const useFlats = [-1, -2, -3, -5, -7, 4, 5, 10].includes(semitones);

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

/* --- GESTIONE SCALETTE E CLOUD SYNC --- */

function loadLocalSetlists() {
  const saved = localStorage.getItem(STORAGE_KEYS.SETLISTS);
  if (saved) state.setlists = JSON.parse(saved);
  const deleted = localStorage.getItem(STORAGE_KEYS.DELETED_SETLISTS);
  if (deleted) state.deletedSetlistIds = JSON.parse(deleted);
  updateSetlistBadge();
}

function saveLocalSetlists() {
  localStorage.setItem(STORAGE_KEYS.SETLISTS, JSON.stringify(state.setlists));
  localStorage.setItem(STORAGE_KEYS.DELETED_SETLISTS, JSON.stringify(state.deletedSetlistIds));
  updateSetlistBadge();
}

function markSetlistDeleted(id) {
  if (!state.deletedSetlistIds.includes(id)) {
    state.deletedSetlistIds.push(id);
    if (state.deletedSetlistIds.length > 200) {
      state.deletedSetlistIds = state.deletedSetlistIds.slice(-200);
    }
  }
}

function updateSetlistBadge() {
  const count = Object.keys(state.setlists).length;
  const badge = document.getElementById('setlist-badge');
  if (badge) {
    badge.innerText = count;
    badge.classList.toggle('hidden', count === 0);
  }
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
  showToast("Scaletta creata e salvata nel Cloud");
}

function renderSetlistsIndex() {
  const container = document.getElementById('setlists-index');
  if (!container) return;
  const list = Object.values(state.setlists).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

  if (list.length === 0) {
    container.innerHTML = `<div class="text-center p-6 text-slate-400 text-xs">Nessuna scaletta salvata.<br>Creane una qui sopra!</div>`;
    return;
  }

  container.innerHTML = list.map(sl => `
    <div onclick="openSetlistDetail('${sl.id}')" class="p-3 bg-white border border-slate-200 rounded-xl hover:border-blue-400 cursor-pointer shadow-2xs transition flex justify-between items-center">
      <div>
        <h4 class="font-bold text-sm text-slate-800">${sl.name}</h4>
        <p class="text-xs text-slate-500">${(sl.songs || []).length} canti</p>
      </div>
      <svg class="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/></svg>
    </div>
  `).join('');
}

function openSetlistDetail(id) {
  state.activeSetlistId = id;
  const sl = state.setlists[id];
  if (!sl) {
    closeSetlistDetail();
    return;
  }

  document.getElementById('setlists-index').classList.add('hidden');
  document.getElementById('active-setlist-view').classList.remove('hidden');
  document.getElementById('current-setlist-title').innerText = sl.name;
  document.getElementById('current-setlist-meta').innerText = `${(sl.songs || []).length} canti • Sincronizzato Cloud`;

  const container = document.getElementById('setlist-songs-container');
  if (!sl.songs || sl.songs.length === 0) {
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
  if (!sl.songs) sl.songs = [];
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
  if (!confirm("Eliminare questa scaletta per tutti?")) return;

  const id = state.activeSetlistId;
  delete state.setlists[id];
  markSetlistDeleted(id);
  if (state.activeSetlistIndex >= 0) {
    state.activeSetlistIndex = -1;
    updateSetlistNavBar();
  }
  saveLocalSetlists();
  
  if (window.fb && window.fb.deleteDoc) {
    window.fb.deleteDoc(window.fb.doc(window.fb.db, "setlists", id))
      .catch(err => {
        console.error("Errore eliminazione Cloud:", err);
        showToast("Errore eliminazione dal Cloud", "error");
      });
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
    if (!sl) return;
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

/* --- CLOUD SYNC GLOBALE (FIREBASE FIRESTORE) --- */

function initFirebaseSync() {
  if (!window.fb || state.firebaseInitialized) return;
  state.firebaseInitialized = true;

  const statusEl = document.getElementById('connection-status');
  statusEl.innerHTML = `<span class="w-2 h-2 rounded-full bg-emerald-500"></span> Cloud Attivo`;

  window.fb.onSnapshot(
    window.fb.collection(window.fb.db, "songs"),
    (snap) => {
      snap.docChanges().forEach((change) => {
        if (change.type === "added" || change.type === "modified") {
          const songDoc = change.doc.data();
          const slug = songDoc.slug || change.doc.id;
          editorState.cloudSongsOverrides[slug] = songDoc;
          localStorage.setItem(STORAGE_KEYS.SONG_PREFIX + slug, JSON.stringify(songDoc));
          if (state.currentSong && state.currentSong.slug === slug && !editorState.isOpen) {
            state.currentSong = { ...state.currentSong, ...normalizeSongFormat(songDoc) };
            renderSongView();
          }
        }
      });
    },
    (err) => console.log("Sync canti cloud:", err)
  );

  let isFirstSnapshot = true;

  window.fb.onSnapshot(
    window.fb.collection(window.fb.db, "setlists"),
    (querySnapshot) => {
      let changed = false;

      if (isFirstSnapshot) {
        const remoteIds = new Set(querySnapshot.docs.map(d => d.id));
        const hasSyncedBefore = localStorage.getItem('canzoniere_sosp_cloud_synced') === '1';

        Object.values(state.setlists).forEach(localSl => {
          if (!remoteIds.has(localSl.id)) {
            if (hasSyncedBefore || state.deletedSetlistIds.includes(localSl.id)) {
              delete state.setlists[localSl.id];
              markSetlistDeleted(localSl.id);
              changed = true;
            } else {
              syncSetlistToCloud(localSl);
            }
          }
        });

        localStorage.setItem('canzoniere_sosp_cloud_synced', '1');
        isFirstSnapshot = false;
      }

      querySnapshot.docChanges().forEach((change) => {
        const remoteData = change.doc.data();
        const id = remoteData.id || change.doc.id;

        if (change.type === "removed") {
          markSetlistDeleted(id);
          if (state.setlists[id]) {
            delete state.setlists[id];
            changed = true;
            if (state.activeSetlistId === id) {
              state.activeSetlistIndex = -1;
              updateSetlistNavBar();
              closeSetlistDetail();
              showToast("Scaletta eliminata");
            }
          }
        } else if (change.type === "added" || change.type === "modified") {
          if (state.deletedSetlistIds.includes(id)) {
            if (window.fb && window.fb.deleteDoc) {
              window.fb.deleteDoc(window.fb.doc(window.fb.db, "setlists", id)).catch(() => {});
            }
            return;
          }
          const localData = state.setlists[id];
          if (!localData || (remoteData.updatedAt || 0) >= (localData.updatedAt || 0)) {
            state.setlists[id] = { ...remoteData, id };
            changed = true;
          }
        }
      });

      if (changed) {
        saveLocalSetlists();
        renderSetlistsIndex();
        if (state.activeSetlistId && state.setlists[state.activeSetlistId]) {
          openSetlistDetail(state.activeSetlistId);
        }
      }
    },
    (error) => {
      console.error("Errore permessi/rete Firestore:", error);
      statusEl.innerHTML = `<span class="w-2 h-2 rounded-full bg-amber-500"></span> Errore Cloud`;
      showToast("Controlla le regole di sicurezza su Firebase Firestore", "error");
    }
  );
}

function syncSetlistToCloud(setlist) {
  if (!window.fb) return;
  window.fb.setDoc(window.fb.doc(window.fb.db, "setlists", setlist.id), setlist)
    .catch(err => {
      console.error("Errore salvataggio Cloud:", err);
      showToast("Errore salvataggio Cloud (controlla permessi Firebase)", "error");
    });
}

function shareSetlist() {
  if (!state.activeSetlistId) return;
  const sl = state.setlists[state.activeSetlistId];
  if (sl) syncSetlistToCloud(sl);

  const url = `${window.location.origin}${window.location.pathname}?scaletta=${state.activeSetlistId}`;
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(url).then(() => {
      showToast("Link scaletta copiato!");
    }).catch(() => {
      prompt("Copia questo link per condividere:", url);
    });
  } else {
    prompt("Copia questo link per condividere:", url);
  }
}

async function importSharedSetlist(id) {
  switchSidebarTab('setlists');
  if (state.setlists[id]) {
    openSetlistDetail(id);
    return;
  }

  let attempts = 0;
  while (!window.fb && attempts < 20) {
    await new Promise(r => setTimeout(r, 200));
    attempts++;
  }

  if (window.fb) {
    try {
      const snap = await window.fb.getDoc(window.fb.doc(window.fb.db, "setlists", id));
      if (snap.exists()) {
        const data = snap.data();
        state.setlists[id] = { ...data, id };
        saveLocalSetlists();
        openSetlistDetail(id);
        showToast(`Scaletta "${data.name}" importata!`);
      } else {
        showToast("Scaletta non trovata sul Cloud", "error");
      }
    } catch (e) {
      console.error("Errore importazione scaletta:", e);
      showToast("Errore caricamento scaletta", "error");
    }
  }
}

/* --- UI UTILS --- */

function toggleSidebar() {
  const sb = document.getElementById('sidebar');
  const bd = document.getElementById('sidebar-backdrop');
  const main = document.getElementById('main-content');
  const openBtn = document.getElementById('desktop-open-sidebar-btn');

  if (window.innerWidth >= 768) {
    const isClosed = sb.classList.toggle('md:-translate-x-full');
    sb.classList.toggle('md:translate-x-0', !isClosed);
    if (main) main.classList.toggle('md:pl-80', !isClosed);
    if (openBtn) openBtn.classList.toggle('hidden', !isClosed);
  } else {
    const isClosed = sb.classList.contains('-translate-x-full');
    if (isClosed) {
      sb.classList.remove('-translate-x-full');
      if (bd) bd.classList.remove('hidden');
    } else {
      sb.classList.add('-translate-x-full');
      if (bd) bd.classList.add('hidden');
    }
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
  if (editorState.isOpen) exitInlineEditor();
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

/* --- EDITOR INLINE CON ANTEPRIMA REALE E TAG [ACCORDO] --- */

const EDITOR_PASSWORD = "SerAle2026.";

let editorState = {
  unlocked: sessionStorage.getItem('canzoniere_editor_unlocked') === '1',
  isOpen: false,
  draftSong: null,
  selectedSecIdx: 0,
  selectedLineIdx: 0,
  cloudSongsOverrides: {}
};

// Converte la coppia (chords, lyrics) in una singola riga con [ACCORDO] nel punto esatto
function mergeChordsIntoLyrics(chordsStr, lyricsStr) {
  const lyrics = lyricsStr || '';
  if (!chordsStr || !chordsStr.trim()) return lyrics;

  const chords = [];
  const regex = /\S+/g;
  let match;
  while ((match = regex.exec(chordsStr)) !== null) {
    chords.push({ pos: match.index, chord: match[0] });
  }

  let result = '';
  let lastIdx = 0;

  for (const item of chords) {
    const targetPos = Math.min(item.pos, lyrics.length);
    if (targetPos > lastIdx) {
      result += lyrics.slice(lastIdx, targetPos);
      lastIdx = targetPos;
    }
    if (item.pos > lyrics.length) {
      result += ' '.repeat(item.pos - lyrics.length);
    }
    result += `[${item.chord}]`;
  }

  if (lastIdx < lyrics.length) {
    result += lyrics.slice(lastIdx);
  }

  return result;
}

function ensureEditButton() {
  let editBtn = document.getElementById('btn-open-song-editor');
  if (!editBtn) {
    editBtn = document.createElement('button');
    editBtn.id = 'btn-open-song-editor';
    editBtn.type = 'button';

    const addBtn = document.querySelector('[onclick="toggleAddToSetlistMenu()"]');
    const fontPlusBtn = document.querySelector('[onclick="changeFontSize(2)"]');
    const target = addBtn || fontPlusBtn;

    if (target && target.parentElement) {
      target.parentElement.appendChild(editBtn);
    } else {
      editBtn.style.position = 'fixed';
      editBtn.style.bottom = '20px';
      editBtn.style.right = '20px';
      editBtn.style.zIndex = '40';
      document.body.appendChild(editBtn);
    }
  }

  if (editorState.isOpen) {
    editBtn.onclick = exitInlineEditor;
    editBtn.className = 'px-2.5 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-800 text-white text-xs font-semibold shadow-sm transition flex items-center gap-1 shrink-0';
    editBtn.innerHTML = '<span>✕</span><span>Esci Modifica</span>';
  } else {
    editBtn.onclick = openSongEditor;
    editBtn.className = 'px-2.5 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-xs font-semibold shadow-sm transition flex items-center gap-1 shrink-0';
    editBtn.innerHTML = '<span>✎</span><span>Modifica</span>';
  }
}

function openSongEditor() {
  if (!state.currentSong) return;

  if (!editorState.unlocked) {
    const pwd = prompt("Inserisci la password per modificare il canto:");
    if (pwd === null) return;
    if (pwd !== EDITOR_PASSWORD) {
      showToast("Password errata", "error");
      return;
    }
    editorState.unlocked = true;
    sessionStorage.setItem('canzoniere_editor_unlocked', '1');
  }

  const s = state.currentSong;
  const draftSections = (s.sections || []).map(sec => ({
    type: sec.type || 'strofa',
    label: sec.label || '',
    lines: (sec.lines || []).map(line => ({
      inlineText: mergeChordsIntoLyrics(line.chords || '', line.lyrics || '')
    }))
  }));

  if (draftSections.length === 0) {
    draftSections.push({
      type: 'strofa',
      label: 'STROFA 1',
      lines: [{ inlineText: '' }]
    });
  }

  editorState.draftSong = {
    slug: s.slug,
    title: s.title || '',
    author: s.author || '',
    categories: [...(s.categories || [])],
    sections: draftSections
  };
  editorState.selectedSecIdx = 0;
  editorState.selectedLineIdx = 0;
  editorState.isOpen = true;

  ensureEditButton();
  renderInlineEditorView();
}

function exitInlineEditor() {
  editorState.isOpen = false;
  ensureEditButton();
  renderSongBody();
}

function getActiveEditorInput() {
  return document.getElementById(`inline-line-input-${editorState.selectedSecIdx}-${editorState.selectedLineIdx}`);
}

// Inserisce un accordo [NOTA] esattamente dove si trova il cursore nel testo
function insertChordAtInputCursor(chord) {
  const input = getActiveEditorInput();
  const line = editorState.draftSong?.sections?.[editorState.selectedSecIdx]?.lines?.[editorState.selectedLineIdx];
  if (!input || !line) return;

  const start = input.selectionStart ?? line.inlineText.length;
  const end = input.selectionEnd ?? start;
  const tag = `[${chord}]`;

  line.inlineText = line.inlineText.slice(0, start) + tag + line.inlineText.slice(end);
  input.value = line.inlineText;
  input.focus();
  const newPos = start + tag.length;
  input.setSelectionRange(newPos, newPos);

  updateLineLivePreview(editorState.selectedSecIdx, editorState.selectedLineIdx);
}

// Aggiunge alterazione (-, #, 7, /SOL...) all'accordo immediatamente prima o intorno al cursore
function appendModifierToNearestChord(mod) {
  const input = getActiveEditorInput();
  const line = editorState.draftSong?.sections?.[editorState.selectedSecIdx]?.lines?.[editorState.selectedLineIdx];
  if (!input || !line) return;

  const pos = input.selectionStart ?? line.inlineText.length;
  const text = line.inlineText;
  const before = text.slice(0, pos);
  const closeBracketIdx = before.lastIndexOf(']');
  const openBracketIdx = before.lastIndexOf('[');

  if (closeBracketIdx !== -1 && closeBracketIdx > openBracketIdx) {
    line.inlineText = text.slice(0, closeBracketIdx) + mod + text.slice(closeBracketIdx);
    input.value = line.inlineText;
    input.focus();
    const newPos = pos + mod.length;
    input.setSelectionRange(newPos, newPos);
    updateLineLivePreview(editorState.selectedSecIdx, editorState.selectedLineIdx);
  } else {
    showToast("Posiziona il cursore subito dopo un accordo (es. [DO]|)", "error");
  }
}

// Sposta l'accordo vicino al cursore di 1 carattere a sinistra (-1) o destra (+1)
function shiftNearestChord(delta) {
  const input = getActiveEditorInput();
  const line = editorState.draftSong?.sections?.[editorState.selectedSecIdx]?.lines?.[editorState.selectedLineIdx];
  if (!input || !line) return;

  const pos = input.selectionStart ?? 0;
  const text = line.inlineText;

  // Trova il tag [ACCORDO] più vicino al cursore
  const tagRegex = /\[([^\]]+)\]/g;
  let match;
  let targetMatch = null;
  while ((match = tagRegex.exec(text)) !== null) {
    const start = match.index;
    const end = start + match[0].length;
    if (pos >= start && pos <= end + 1) {
      targetMatch = { start, end, tag: match[0] };
      break;
    }
  }

  if (!targetMatch) {
    showToast("Metti il cursore accanto all'accordo da spostare", "error");
    return;
  }

  const withoutTag = text.slice(0, targetMatch.start) + text.slice(targetMatch.end);
  const newStart = Math.max(0, Math.min(withoutTag.length, targetMatch.start + delta));
  line.inlineText = withoutTag.slice(0, newStart) + targetMatch.tag + withoutTag.slice(newStart);

  input.value = line.inlineText;
  input.focus();
  const newCursor = newStart + targetMatch.tag.length;
  input.setSelectionRange(newCursor, newCursor);
  updateLineLivePreview(editorState.selectedSecIdx, editorState.selectedLineIdx);
}

function updateLineLivePreview(secIdx, lineIdx) {
  const line = editorState.draftSong?.sections?.[secIdx]?.lines?.[lineIdx];
  const previewEl = document.getElementById(`inline-live-preview-${secIdx}-${lineIdx}`);
  if (!line || !previewEl) return;

  const parsed = parseInlineBrackets('', line.inlineText);
  const hasChords = parsed.chords && parsed.chords.trim().length > 0;
  const monoStyle = 'font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; letter-spacing: 0;';

  previewEl.innerHTML = `
    ${hasChords ? `<div class="text-blue-700 font-bold text-[0.95em] leading-none mb-0.5 whitespace-pre" style="${monoStyle}">${escapeHtml(parsed.chords)}</div>` : ''}
    <div class="text-slate-800 leading-snug whitespace-pre-wrap" style="${monoStyle}">${escapeHtml(parsed.lyrics || ' ')}</div>
  `;
}

function handleInlineLineKeydown(e, secIdx, lineIdx) {
  if (e.key === 'Enter') {
    e.preventDefault();
    const sec = editorState.draftSong?.sections?.[secIdx];
    if (!sec) return;
    sec.lines.splice(lineIdx + 1, 0, { inlineText: '' });
    editorState.selectedSecIdx = secIdx;
    editorState.selectedLineIdx = lineIdx + 1;
    renderInlineSections();
    setTimeout(() => {
      const next = document.getElementById(`inline-line-input-${secIdx}-${lineIdx + 1}`);
      if (next) next.focus();
    }, 0);
  } else if (e.key === 'Backspace' && e.target.value === '') {
    const sec = editorState.draftSong?.sections?.[secIdx];
    if (!sec || sec.lines.length <= 1) return;
    e.preventDefault();
    sec.lines.splice(lineIdx, 1);
    const prevIdx = Math.max(0, lineIdx - 1);
    editorState.selectedSecIdx = secIdx;
    editorState.selectedLineIdx = prevIdx;
    renderInlineSections();
    setTimeout(() => {
      const prev = document.getElementById(`inline-line-input-${secIdx}-${prevIdx}`);
      if (prev) prev.focus();
    }, 0);
  }
}

function addInlineLine(secIdx) {
  const sec = editorState.draftSong?.sections?.[secIdx];
  if (!sec) return;
  sec.lines.push({ inlineText: '' });
  editorState.selectedSecIdx = secIdx;
  editorState.selectedLineIdx = sec.lines.length - 1;
  renderInlineSections();
}

function removeInlineLine(secIdx, lineIdx) {
  const sec = editorState.draftSong?.sections?.[secIdx];
  if (!sec) return;
  sec.lines.splice(lineIdx, 1);
  if (sec.lines.length === 0) sec.lines.push({ inlineText: '' });
  renderInlineSections();
}

function addInlineSection(isChorus) {
  if (!editorState.draftSong) return;
  editorState.draftSong.sections.push({
    type: isChorus ? 'ritornello' : 'strofa',
    label: isChorus ? 'RITORNELLO' : `STROFA ${editorState.draftSong.sections.length + 1}`,
    lines: [{ inlineText: '' }]
  });
  renderInlineSections();
}

function removeInlineSection(secIdx) {
  if (!editorState.draftSong || editorState.draftSong.sections.length <= 1) return;
  editorState.draftSong.sections.splice(secIdx, 1);
  renderInlineSections();
}

function buildFinalSongPayload() {
  const d = editorState.draftSong;
  const sections = d.sections.map(sec => ({
    type: sec.type,
    label: sec.label.trim(),
    lines: sec.lines.map(l => {
      const parsed = parseInlineBrackets('', l.inlineText);
      return {
        chords: parsed.chords,
        lyrics: parsed.lyrics
      };
    })
  }));

  return {
    slug: d.slug,
    title: d.title.trim(),
    author: d.author.trim(),
    categories: d.categories,
    sections,
    updatedAt: Date.now()
  };
}

async function saveEditedSongToCloud() {
  if (!editorState.draftSong) return;
  const payload = buildFinalSongPayload();

  const cacheKey = STORAGE_KEYS.SONG_PREFIX + payload.slug;
  localStorage.setItem(cacheKey, JSON.stringify(payload));
  editorState.cloudSongsOverrides[payload.slug] = payload;

  const idxEntry = state.songsIndex.find(item => item.slug === payload.slug);
  if (idxEntry) {
    idxEntry.title = payload.title;
    idxEntry.author = payload.author;
    localStorage.setItem(STORAGE_KEYS.INDEX, JSON.stringify(state.songsIndex));
    filterSongs();
  }

  state.currentSong = {
    ...state.currentSong,
    ...payload
  };

  if (window.fb && window.fb.setDoc) {
    try {
      await window.fb.setDoc(window.fb.doc(window.fb.db, "songs", payload.slug), payload);
      showToast("Canto salvato nel Cloud!");
      exitInlineEditor();
      renderSongView();
    } catch (err) {
      console.error("Errore salvataggio canto su Firestore:", err);
      showToast("Salvato in locale (verifica regole Firestore per 'songs')", "error");
      exitInlineEditor();
      renderSongView();
    }
  } else {
    showToast("Canto salvato in locale!");
    exitInlineEditor();
    renderSongView();
  }
}

function copyEditedSongJson() {
  const payload = buildFinalSongPayload();
  const { updatedAt, ...cleanJson } = payload;
  const text = JSON.stringify(cleanJson, null, 2);
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(text).then(() => showToast("JSON copiato negli appunti!"));
  } else {
    prompt("Copia il JSON del canto:", text);
  }
}

function downloadEditedSongJson() {
  const payload = buildFinalSongPayload();
  const { updatedAt, ...cleanJson } = payload;
  const blob = new Blob([JSON.stringify(cleanJson, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${payload.slug}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function renderInlineEditorView() {
  const container = document.getElementById('song-body');
  const notes = ['DO', 'RE', 'MI', 'FA', 'SOL', 'LA', 'SI'];
  const modifiers = ['-', '#', 'b', '7', '4', 'sus4', 'add9', 'maj7', '/SOL', '/LA-', '/SI', '/DO', '/RE', '/MI', '/FA#'];

  container.innerHTML = `
    <div id="inline-chord-toolbar" class="sticky top-0 z-30 mb-5 p-3 rounded-xl bg-amber-50 border border-amber-300 shadow-sm space-y-2">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div class="flex items-center gap-1.5 flex-wrap">
          <span class="text-xs font-bold text-amber-900">Sposta accordo al cursore:</span>
          <button type="button" onclick="shiftNearestChord(-1)"
            class="px-2.5 py-1 rounded-lg bg-white border border-slate-300 hover:bg-slate-100 text-xs font-bold" title="Sposta accordo a sinistra">←</button>
          <button type="button" onclick="shiftNearestChord(1)"
            class="px-2.5 py-1 rounded-lg bg-white border border-slate-300 hover:bg-slate-100 text-xs font-bold" title="Sposta accordo a destra">→</button>
        </div>
        <div class="flex items-center gap-1.5">
          <button type="button" onclick="copyEditedSongJson()" class="px-2.5 py-1 rounded-lg bg-white border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-50">Copia JSON</button>
          <button type="button" onclick="downloadEditedSongJson()" class="px-2.5 py-1 rounded-lg bg-white border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-50">Scarica</button>
          <button type="button" onclick="saveEditedSongToCloud()" class="px-3 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-xs">✓ Salva</button>
        </div>
      </div>
      <div class="flex items-center gap-1 overflow-x-auto pb-0.5">
        ${notes.map(n => `
          <button type="button" onmousedown="event.preventDefault()" onclick="insertChordAtInputCursor('${n}')"
            class="px-2.5 py-1 rounded-lg text-xs font-bold shrink-0 bg-white border border-slate-300 text-slate-800 hover:border-blue-500">${n}</button>
        `).join('')}
        <span class="mx-1 text-slate-300">|</span>
        ${modifiers.map(m => `
          <button type="button" onmousedown="event.preventDefault()" onclick="appendModifierToNearestChord('${m}')"
            class="px-2 py-1 rounded-lg text-xs font-semibold bg-white border border-slate-200 hover:bg-slate-100 text-slate-800 shrink-0">${m}</button>
        `).join('')}
      </div>
    </div>
    <div id="inline-sections-container" class="space-y-6"></div>
  `;
  renderInlineSections();
}

function renderInlineSections() {
  const container = document.getElementById('inline-sections-container');
  if (!container || !editorState.draftSong) return;

  const d = editorState.draftSong;
  const monoStyle = 'font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; letter-spacing: 0;';

  const sectionsHtml = d.sections.map((sec, sIdx) => {
    const isChorus = sec.type === 'ritornello' || sec.label?.toLowerCase().includes('rit');

    const linesHtml = sec.lines.map((line, lIdx) => {
      const parsed = parseInlineBrackets('', line.inlineText);
      const hasChords = parsed.chords && parsed.chords.trim().length > 0;

      return `
        <div class="rounded-lg p-2 bg-slate-50/70 border border-slate-200/80 space-y-1.5">
          <div id="inline-live-preview-${sIdx}-${lIdx}" class="px-1 overflow-x-auto">
            ${hasChords ? `<div class="text-blue-700 font-bold text-[0.95em] leading-none mb-0.5 whitespace-pre" style="${monoStyle}">${escapeHtml(parsed.chords)}</div>` : ''}
            <div class="text-slate-800 leading-snug whitespace-pre-wrap" style="${monoStyle}">${escapeHtml(parsed.lyrics || ' ')}</div>
          </div>
          <div class="flex items-center gap-1.5">
            <input id="inline-line-input-${sIdx}-${lIdx}"
              type="text"
              value="${escapeHtml(line.inlineText)}"
              onfocus="editorState.selectedSecIdx=${sIdx}; editorState.selectedLineIdx=${lIdx};"
              oninput="editorState.draftSong.sections[${sIdx}].lines[${lIdx}].inlineText = this.value; updateLineLivePreview(${sIdx}, ${lIdx});"
              onkeydown="handleInlineLineKeydown(event, ${sIdx}, ${lIdx})"
              placeholder="Scrivi testo e metti gli accordi tra [quadre]..."
              style="${monoStyle}"
              class="w-full text-sm px-2.5 py-1.5 rounded border border-slate-300 focus:border-amber-500 focus:outline-none bg-white text-slate-900" />
            <button type="button" onclick="removeInlineLine(${sIdx}, ${lIdx})" title="Rimuovi riga"
              class="px-2 py-1 text-xs text-slate-400 hover:text-red-600 rounded">✕</button>
          </div>
        </div>
      `;
    }).join('');

    return `
      <div class="song-block ${isChorus ? 'pl-3 border-l-2 border-blue-400' : 'pl-3 border-l-2 border-slate-200'} space-y-2">
        <div class="flex items-center justify-between gap-2">
          <input type="text"
            value="${escapeHtml(sec.label)}"
            onchange="editorState.draftSong.sections[${sIdx}].label = this.value; editorState.draftSong.sections[${sIdx}].type = (this.value.toLowerCase().includes('rit') ? 'ritornello' : 'strofa');"
            placeholder="ETICHETTA (es. RITORNELLO)"
            class="text-xs font-bold uppercase tracking-wider px-2 py-1 rounded border border-slate-200 bg-slate-50 text-slate-600 w-48" />
          <div class="flex items-center gap-1">
            <button type="button" onclick="addInlineLine(${sIdx})"
              class="px-2 py-1 rounded bg-slate-100 hover:bg-slate-200 text-xs font-semibold text-slate-700">+ Riga</button>
            ${d.sections.length > 1 ? `<button type="button" onclick="removeInlineSection(${sIdx})" class="px-2 py-1 rounded text-xs text-red-500 hover:bg-red-50">Elimina</button>` : ''}
          </div>
        </div>
        <div class="space-y-2">${linesHtml}</div>
      </div>
    `;
  }).join('');

  container.innerHTML = `
    ${sectionsHtml}
    <div class="flex flex-wrap gap-2 pt-2">
      <button type="button" onclick="addInlineSection(false)"
        class="px-3 py-1.5 rounded-lg border border-dashed border-slate-300 hover:border-blue-500 text-xs font-semibold text-slate-600">+ Strofa</button>
      <button type="button" onclick="addInlineSection(true)"
        class="px-3 py-1.5 rounded-lg border border-dashed border-blue-300 hover:border-blue-500 text-xs font-semibold text-blue-600">+ Ritornello</button>
    </div>
  `;
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}