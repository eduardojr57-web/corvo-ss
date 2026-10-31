const code = getQueryParam('code').toUpperCase();
const name = getQueryParam('name') || 'Administrador';

if (!code) {
  window.location.href = '/';
}

document.getElementById('codeBadge').textContent = code;
document.getElementById('codeBadge').onclick = () => {
  navigator.clipboard.writeText(code).then(() => showToast('Código copiado!'));
};

const socket = io();
const peers = new Map(); // sharerId -> SimplePeer
const videos = new Map(); // sharerId -> video element
const sharerNames = new Map();

socket.emit('join', { code, role: 'admin', name });

socket.on('error-msg', (msg) => {
  alert(msg);
  window.location.href = '/';
});

socket.on('joined', () => {
  showToast('Sessão criada. Compartilhe o código!');
});

socket.on('room-state', ({ sharers, viewers }) => {
  sharers.forEach(s => {
    sharerNames.set(s.id, s.name);
    addSharerToList(s.id, s.name, s.sharing);
  });
  viewers.forEach(v => addViewerToList(v.id, v.name));
});

socket.on('user-joined', ({ role, id, name }) => {
  if (role === 'sharer') {
    sharerNames.set(id, name);
    addSharerToList(id, name, false);
  } else if (role === 'viewer') {
    addViewerToList(id, name);
  }
});

socket.on('user-left', ({ role, id }) => {
  if (role === 'sharer') {
    removeSharer(id);
  } else {
    const el = document.getElementById(`viewer-${id}`);
    if (el) el.remove();
  }
});

socket.on('name-updated', ({ id, name, role }) => {
  if (role === 'sharer') {
    sharerNames.set(id, name);
    const el = document.querySelector(`#sharer-${id} .name`);
    if (el) el.textContent = name;
    const label = document.querySelector(`#videobox-${id} .video-label span`);
    if (label) label.textContent = name;
  }
});

socket.on('announcement', (ann) => {
  showAnnouncement(ann);
});

socket.on('sharer-started', ({ id, name }) => {
  sharerNames.set(id, name);
  updateSharerStatus(id, true);
  // Initiate connection as the receiver (not initiator, wait for offer from sharer? 
  // Actually we make the admin the polite peer and let sharer be initiator when they start.
  // For simplicity: when sharer starts, they will create offers to admin and viewers.
  // So admin just waits for signal.
});

socket.on('sharer-stopped', ({ id }) => {
  updateSharerStatus(id, false);
  closePeer(id);
});

socket.on('signal', async ({ from, data }) => {
  let peer = peers.get(from);
  if (!peer) {
    // Create peer as non-initiator (receiver)
    peer = new SimplePeer(false);
    peers.set(from, peer);

    peer.onSignal = (sig) => {
      socket.emit('signal', { to: from, data: sig });
    };

    peer.onStream = (stream) => {
      showVideo(from, stream);
    };

    peer.onClose = () => {
      closePeer(from);
    };
  }
  await peer.handleSignal(data);
});

socket.on('recording-ready', ({ filename, url, fromName, duration, size }) => {
  const list = document.getElementById('recordingsList');
  if (list.querySelector('li') && list.querySelector('li').textContent.includes('Nenhuma')) {
    list.innerHTML = '';
  }
  const li = document.createElement('li');
  li.className = 'user-item';
  const sizeMB = (size / (1024 * 1024)).toFixed(1);
  li.innerHTML = `
    <div class="info">
      <span>🎬</span>
      <span>${fromName} — últimos ${duration} min (${sizeMB} MB)</span>
    </div>
    <a class="btn btn-accent btn-sm" href="${url}" download>Baixar</a>
  `;
  list.prepend(li);
  showToast(`Gravação de ${fromName} pronta para download!`);
});

function addSharerToList(id, name, sharing) {
  if (document.getElementById(`sharer-${id}`)) return;
  const ul = document.getElementById('sharerList');
  const li = document.createElement('li');
  li.className = 'user-item';
  li.id = `sharer-${id}`;
  li.innerHTML = `
    <div class="info">
      <span class="status-dot ${sharing ? 'live' : ''}" id="dot-${id}"></span>
      <span class="name">${name}</span>
    </div>
    <div class="recording-btns" id="rec-btns-${id}" style="${sharing ? '' : 'display:none'}">
      <button class="btn btn-sm btn-secondary" onclick="requestRec('${id}', 2)">2 min</button>
      <button class="btn btn-sm btn-secondary" onclick="requestRec('${id}', 5)">5 min</button>
      <button class="btn btn-sm btn-secondary" onclick="requestRec('${id}', 10)">10 min</button>
    </div>
  `;
  ul.appendChild(li);
}

function addViewerToList(id, name) {
  if (document.getElementById(`viewer-${id}`)) return;
  const ul = document.getElementById('viewerList');
  const li = document.createElement('li');
  li.className = 'user-item';
  li.id = `viewer-${id}`;
  li.innerHTML = `<div class="info"><span>👁</span><span>${name}</span></div>`;
  ul.appendChild(li);
}

function updateSharerStatus(id, sharing) {
  const dot = document.getElementById(`dot-${id}`);
  const btns = document.getElementById(`rec-btns-${id}`);
  if (dot) dot.classList.toggle('live', sharing);
  if (btns) btns.style.display = sharing ? 'flex' : 'none';
  if (!sharing) closePeer(id);
}

function removeSharer(id) {
  const el = document.getElementById(`sharer-${id}`);
  if (el) el.remove();
  closePeer(id);
  sharerNames.delete(id);
}

function showVideo(id, stream) {
  document.getElementById('emptyVideos')?.classList.add('hidden');
  let box = document.getElementById(`videobox-${id}`);
  if (!box) {
    box = document.createElement('div');
    box.className = 'video-box live';
    box.id = `videobox-${id}`;
    box.innerHTML = `
      <video autoplay playsinline muted></video>
      <div class="video-label">
        <span>${sharerNames.get(id) || 'Transmissor'}</span>
      </div>
    `;
    document.getElementById('videoGrid').appendChild(box);
  }
  const video = box.querySelector('video');
  video.srcObject = stream;
  videos.set(id, video);
}

function closePeer(id) {
  const peer = peers.get(id);
  if (peer) {
    peer.close();
    peers.delete(id);
  }
  const box = document.getElementById(`videobox-${id}`);
  if (box) box.remove();
  videos.delete(id);
  if (document.getElementById('videoGrid').children.length === 0 ||
      (document.getElementById('videoGrid').children.length === 1 && document.getElementById('emptyVideos'))) {
    const empty = document.getElementById('emptyVideos');
    if (empty) empty.classList.remove('hidden');
  }
}

function sendAnnouncement() {
  const text = document.getElementById('annInput').value.trim();
  if (!text) return;
  socket.emit('announcement', { text });
  document.getElementById('annInput').value = '';
}

function showAnnouncement(ann) {
  const area = document.getElementById('announcementArea');
  const div = document.createElement('div');
  div.className = 'announcement-box';
  div.innerHTML = `<strong>Aviso:</strong> ${escapeHtml(ann.text)}<div class="time">${formatTime(ann.time)}</div>`;
  area.prepend(div);
  // Keep only last 3 visible
  while (area.children.length > 3) area.lastChild.remove();
}

function requestRec(targetId, minutes) {
  socket.emit('request-recording', { targetId, minutes });
  showToast(`Solicitando gravação dos últimos ${minutes} min...`);
}

function escapeHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// Keepalive / reconnect
socket.on('disconnect', () => showToast('Conexão perdida. Tentando reconectar...'));
socket.on('connect', () => {
  if (socket.recovered) return;
  // Re-join if needed
});
