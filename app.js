const DEMO_EMAIL = 'max@test.com';
const VAULT_PATH = './vaults/max_vault.json';
const THUMB_BASE = 'https://i.ytimg.com/vi';
const EMBED_BASE = 'https://www.youtube-nocookie.com/embed';

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

let unlockedVideos = [];
let activeVideo = null;

const textEncoder = new TextEncoder();

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
    if (!response.ok) {
      throw new Error('Unable to load the encrypted vault shard.');
    }

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

replayButton.addEventListener('click', () => {
  if (activeVideo) {
    loadPlayer(activeVideo);
  }
});

closePlayerButton.addEventListener('click', resetPlayer);

async function decryptVault(payload, password) {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    textEncoder.encode(password),
    'PBKDF2',
    false,
    ['deriveKey']
  );

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

  if (!videos.length) {
    return;
  }

  videos.forEach((video) => {
    const fragment = cardTemplate.content.cloneNode(true);
    const button = fragment.querySelector('.video-thumb');
    const title = fragment.querySelector('h3');
    const note = fragment.querySelector('p');

    button.style.backgroundImage = `url(${THUMB_BASE}/${video.id}/hqdefault.jpg)`;
    button.addEventListener('click', () => loadPlayer(video));
    title.textContent = video.title;
    note.textContent = video.note;

    vaultGrid.append(fragment);
  });
}

function loadPlayer(video) {
  activeVideo = video;
  playerPanel.classList.remove('hidden');
  playerCopy.textContent = `${video.title} is now playing inside the masked prototype frame.`;

  const iframe = document.createElement('iframe');
  iframe.title = `${video.title} private player`;
  iframe.allow = 'autoplay; encrypted-media; picture-in-picture';
  iframe.referrerPolicy = 'strict-origin-when-cross-origin';
  iframe.setAttribute('allowfullscreen', '');
  iframe.src = `${EMBED_BASE}/${video.id}?autoplay=1&controls=0&modestbranding=1&rel=0&playsinline=1&iv_load_policy=3&disablekb=1&fs=0`;

  const topMask = document.createElement('div');
  topMask.className = 'frame-mask top';

  const bottomMask = document.createElement('div');
  bottomMask.className = 'frame-mask bottom';

  const shield = document.createElement('div');
  shield.className = 'frame-shield';
  shield.setAttribute('aria-hidden', 'true');
  shield.addEventListener('contextmenu', (event) => event.preventDefault());

  playerFrame.replaceChildren(iframe, topMask, bottomMask, shield);
  playerFrame.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function resetPlayer() {
  activeVideo = null;
  playerFrame.innerHTML = '<div class="player-placeholder"><p>Select a lesson card to load the private player.</p></div>';
  playerCopy.textContent = 'Choose a decrypted lesson to begin playback.';
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
