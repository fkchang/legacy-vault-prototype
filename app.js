const DEMO_EMAIL = 'max@test.com';
const VAULT_PATH = './vaults/max_vault.json';
const THUMB_BASE = 'https://i.ytimg.com/vi';
const YOUTUBE_HOST_PARTS = ['youtube', 'com'];
const YOUTUBE_NOCOOKIE_PARTS = ['youtube-nocookie', 'com'];
const YOUTUBE_API_SRC = `https://www.${YOUTUBE_HOST_PARTS.join('.')}/iframe_api`;
const YOUTUBE_HOST = `https://www.${YOUTUBE_NOCOOKIE_PARTS.join('.')}`;

const loginForm = document.querySelector('#login-form');
const emailInput = document.querySelector('#email');
const passwordInput = document.querySelector('#password');
const authStatus = document.querySelector('#auth-status');
const vaultPanel = document.querySelector('#vault-panel');
const vaultGrid = document.querySelector('#vault-grid');
const playerPanel = document.querySelector('#player-panel');
const playerFrame = document.querySelector('#player-frame');
const playerCopy = document.querySelector('#player-copy');
const replayButton = document.querySelector('#replay-button');
const closePlayerButton = document.querySelector('#close-player-button');
const lockButton = document.querySelector('#lock-button');
const cardTemplate = document.querySelector('#video-card-template');
const playerControls = document.querySelector('#player-controls');
const playPauseButton = document.querySelector('#play-pause-button');
const backButton = document.querySelector('#back-button');
const forwardButton = document.querySelector('#forward-button');
const muteButton = document.querySelector('#mute-button');
const volumeSlider = document.querySelector('#volume-slider');
const seekSlider = document.querySelector('#seek-slider');
const timeDisplay = document.querySelector('#time-display');

const textEncoder = new TextEncoder();

let unlockedVideos = [];
let activeVideo = null;
let player = null;
let playerApiPromise = null;
let progressTimer = null;
let isScrubbing = false;

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearStatus();

  const email = emailInput.value.trim().toLowerCase();
  const password = passwordInput.value;

  if (email !== DEMO_EMAIL) {
    setStatus('This prototype only unlocks the legacy Max test account.', 'error');
    return;
  }

  if (!password) {
    setStatus('Enter the vault password to decrypt the private shard.', 'error');
    return;
  }

  setStatus('Decrypting private shard…');

  try {
    const response = await fetch(VAULT_PATH, { cache: 'no-store' });
    if (!response.ok) throw new Error('Unable to load the encrypted vault shard.');

    const payload = await response.json();
    const videos = await decryptVault(payload, password);

    unlockedVideos = videos;
    renderVault(videos);
    vaultPanel.classList.remove('hidden');
    playerPanel.classList.remove('hidden');
    setStatus('Vault unlocked. Private entries decrypted locally in memory only.', 'success');
    passwordInput.value = '';
  } catch (error) {
    console.error(error);
    unlockedVideos = [];
    renderVault([]);
    resetPlayer();
    playerPanel.classList.add('hidden');
    vaultPanel.classList.add('hidden');
    setStatus('Unlock failed. Double-check the password and try again.', 'error');
  }
});

lockButton.addEventListener('click', () => {
  unlockedVideos = [];
  activeVideo = null;
  renderVault([]);
  resetPlayer();
  vaultPanel.classList.add('hidden');
  playerPanel.classList.add('hidden');
  passwordInput.value = '';
  setStatus('Vault locked. The decrypted list was cleared from the page.', 'success');
});

replayButton.addEventListener('click', async () => {
  if (!activeVideo) return;
  if (!player) {
    await loadPlayer(activeVideo);
    return;
  }
  player.seekTo(0, true);
  player.playVideo();
});

closePlayerButton.addEventListener('click', resetPlayer);
playPauseButton.addEventListener('click', togglePlayback);
backButton.addEventListener('click', () => seekBy(-10));
forwardButton.addEventListener('click', () => seekBy(10));
muteButton.addEventListener('click', toggleMute);
volumeSlider.addEventListener('input', () => {
  if (!player) return;
  player.setVolume(Number(volumeSlider.value));
  if (Number(volumeSlider.value) === 0) player.mute();
  else player.unMute();
  syncMuteButton();
});

seekSlider.addEventListener('pointerdown', () => {
  isScrubbing = true;
});
seekSlider.addEventListener('pointerup', commitSeek);
seekSlider.addEventListener('change', commitSeek);
seekSlider.addEventListener('input', () => {
  if (!player) return;
  const duration = getDuration();
  const previewTime = duration * (Number(seekSlider.value) / 1000);
  timeDisplay.textContent = `${formatTime(previewTime)} / ${formatTime(duration)}`;
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) stopProgressLoop();
  else startProgressLoop();
});

async function decryptVault(payload, password) {
  const keyMaterial = await crypto.subtle.importKey('raw', textEncoder.encode(password), 'PBKDF2', false, ['deriveKey']);

  const key = await crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: decodeBase64(payload.salt),
      iterations: payload.iterations,
      hash: payload.digest
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt']
  );

  const ciphertext = decodeBase64(payload.ciphertext);
  const tag = decodeBase64(payload.tag);
  const combined = new Uint8Array(ciphertext.byteLength + tag.byteLength);
  combined.set(new Uint8Array(ciphertext), 0);
  combined.set(new Uint8Array(tag), ciphertext.byteLength);

  const plaintext = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: decodeBase64(payload.iv),
      tagLength: 128
    },
    key,
    combined
  );

  const decoded = new TextDecoder().decode(plaintext);
  const parsed = JSON.parse(decoded);

  if (!Array.isArray(parsed) || parsed.some((entry) => typeof entry.id !== 'string')) {
    throw new Error('Decrypted payload shape is invalid.');
  }

  return parsed;
}

function renderVault(videos) {
  vaultGrid.replaceChildren();
  if (!videos.length) return;

  videos.forEach((video) => {
    const fragment = cardTemplate.content.cloneNode(true);
    const button = fragment.querySelector('.video-thumb');
    const title = fragment.querySelector('h3');
    const note = fragment.querySelector('p');

    button.style.backgroundImage = `url(${THUMB_BASE}/${video.id}/hqdefault.jpg)`;
    button.addEventListener('click', () => void loadPlayer(video));
    title.textContent = video.title;
    note.textContent = video.note;

    vaultGrid.append(fragment);
  });
}

async function loadPlayer(video) {
  activeVideo = video;
  playerPanel.classList.remove('hidden');
  playerControls.classList.remove('hidden');
  playerCopy.textContent = `${video.title} is loaded inside the masked player. Use the external controls below.`;

  await ensureYouTubeApi();
  destroyPlayer();

  const mount = document.createElement('div');
  mount.id = 'youtube-player-mount';
  mount.className = 'player-mount';

  const topMask = document.createElement('div');
  topMask.className = 'frame-mask top';

  const bottomMask = document.createElement('div');
  bottomMask.className = 'frame-mask bottom';

  const shield = document.createElement('div');
  shield.className = 'frame-shield';
  shield.setAttribute('aria-hidden', 'true');
  shield.addEventListener('contextmenu', (event) => event.preventDefault());

  playerFrame.replaceChildren(mount, topMask, bottomMask, shield);

  player = new YT.Player(mount, {
    width: '100%',
    height: '100%',
    host: YOUTUBE_HOST,
    videoId: video.id,
    playerVars: {
      autoplay: 1,
      controls: 0,
      rel: 0,
      playsinline: 1,
      disablekb: 1,
      fs: 0,
      origin: window.location.origin
    },
    events: {
      onReady: (event) => {
        event.target.setVolume(Number(volumeSlider.value));
        event.target.playVideo();
        syncControls();
        startProgressLoop();
      },
      onStateChange: () => {
        syncControls();
        startProgressLoop();
      },
      onError: () => {
        setStatus('The player failed to load this lesson.', 'error');
      }
    }
  });

  playerFrame.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function togglePlayback() {
  if (!player) return;
  const state = player.getPlayerState();
  if (state === YT.PlayerState.PLAYING) player.pauseVideo();
  else player.playVideo();
  syncControls();
}

function seekBy(seconds) {
  if (!player) return;
  const nextTime = Math.max(0, getCurrentTime() + seconds);
  player.seekTo(nextTime, true);
  syncControls();
}

function toggleMute() {
  if (!player) return;
  if (player.isMuted()) {
    player.unMute();
    if (Number(volumeSlider.value) === 0) {
      volumeSlider.value = '100';
      player.setVolume(100);
    }
  } else {
    player.mute();
  }
  syncMuteButton();
}

function commitSeek() {
  if (!player) return;
  const duration = getDuration();
  const nextTime = duration * (Number(seekSlider.value) / 1000);
  player.seekTo(nextTime, true);
  isScrubbing = false;
  syncControls();
}

function syncControls() {
  const hasPlayer = Boolean(player);
  const state = hasPlayer ? player.getPlayerState() : -1;
  playPauseButton.textContent = state === YT.PlayerState.PLAYING ? 'Pause' : 'Play';
  playPauseButton.disabled = !hasPlayer;
  backButton.disabled = !hasPlayer;
  forwardButton.disabled = !hasPlayer;
  muteButton.disabled = !hasPlayer;
  volumeSlider.disabled = !hasPlayer;
  seekSlider.disabled = !hasPlayer;
  syncMuteButton();
  syncProgress();
}

function syncMuteButton() {
  if (!player) {
    muteButton.textContent = 'Mute';
    return;
  }
  muteButton.textContent = player.isMuted() ? 'Unmute' : 'Mute';
}

function syncProgress() {
  if (!player) {
    seekSlider.value = '0';
    timeDisplay.textContent = '0:00 / 0:00';
    return;
  }

  const duration = getDuration();
  const currentTime = getCurrentTime();

  if (!isScrubbing && duration > 0) {
    seekSlider.value = String(Math.round((currentTime / duration) * 1000));
  }

  timeDisplay.textContent = `${formatTime(currentTime)} / ${formatTime(duration)}`;
}

function startProgressLoop() {
  if (!player || progressTimer || document.hidden) return;
  progressTimer = window.setInterval(syncProgress, 250);
}

function stopProgressLoop() {
  if (!progressTimer) return;
  window.clearInterval(progressTimer);
  progressTimer = null;
}

function destroyPlayer() {
  stopProgressLoop();
  if (player) {
    player.destroy();
    player = null;
  }
}

function resetPlayer() {
  destroyPlayer();
  activeVideo = null;
  playerControls.classList.add('hidden');
  playerFrame.innerHTML = '<div class="player-placeholder"><p>Select a lesson card to load the private player.</p></div>';
  playerCopy.textContent = 'Choose a decrypted lesson to begin playback.';
  syncControls();
}

function getCurrentTime() {
  if (!player || typeof player.getCurrentTime !== 'function') return 0;
  return Number(player.getCurrentTime()) || 0;
}

function getDuration() {
  if (!player || typeof player.getDuration !== 'function') return 0;
  return Number(player.getDuration()) || 0;
}

function formatTime(totalSeconds) {
  const rounded = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(rounded / 60);
  const seconds = String(rounded % 60).padStart(2, '0');
  return `${minutes}:${seconds}`;
}

function ensureYouTubeApi() {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (playerApiPromise) return playerApiPromise;

  playerApiPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector('#youtube-iframe-api');
    const previousReady = window.onYouTubeIframeAPIReady;

    window.onYouTubeIframeAPIReady = () => {
      previousReady?.();
      resolve(window.YT);
    };

    if (existing) return;

    const script = document.createElement('script');
    script.id = 'youtube-iframe-api';
    script.async = true;
    script.src = YOUTUBE_API_SRC;
    script.onerror = () => reject(new Error('Unable to load the YouTube player API.'));
    document.head.append(script);
  });

  return playerApiPromise;
}

function setStatus(message, tone) {
  authStatus.textContent = message;
  authStatus.className = 'status';
  if (tone) authStatus.classList.add(tone);
}

function clearStatus() {
  setStatus('');
}

function decodeBase64(value) {
  const bytes = Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
  return bytes.buffer;
}
