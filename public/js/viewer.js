const code = getQueryParam('code').toUpperCase();
const name = getQueryParam('name') || 'Convidado';

if (!code) window.location.href = '/';

const socket = io();
const peers = new Map(); // sharerId -> SimplePeer
const names = new Map();

socket.emit('join', { code, role: 'viewer', name });

socket.on('error-msg', (msg) => {
  alert(msg);
  window.location.href = '/';
});

socket.on('joined', ({ announcements }) => {
  announcements.forEach(showAnnouncement);
  showToast('Você entrou como convidado');
});

socket.on('announcement', showAnnouncement);

socket.on('sharer-started', ({ id, name }) => {
  names.set(id, name);
  // The sharer will initiate the connection to us.
  // We just prepare to receive.
});

socket.on('sharer-stopped', ({ id }) => {
  closePeer(id);
});

socket.on('user-left', ({ role, id }) => {
  if (role === 'sharer') closePeer(id);
});

socket.on('signal', async ({ from, data }) => {
  let peer = peers.get(from);
  if (!peer) {
    peer = new SimplePeer(false); // we are receiver
    peers.set(from, peer);

    peer.onSignal = (sig) => {
      socket.emit('signal', { to: from, data: sig });
    };

    peer.onStream = (stream) => {
      showVideo(from, stream);
    };

    peer.onClose = () => closePeer(from);
  }
  await peer.handleSignal(data);
});

function showAnnouncement(ann) {
  const area = document.getElementById('announcementArea');
  const div = document.createElement('div');
  div.className = 'announcement-box';
  div.innerHTML = `<strong>Aviso:</strong> ${escapeHtml(ann.text)}
    <div class="time">${formatTime(ann.time)}</div>`;
  area.prepend(div);
  while (area.children.length > 3) area.lastChild.remove();
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
        <span>${names.get(id) || 'Transmissor'}</span>
      </div>
    `;
    document.getElementById('videoGrid').appendChild(box);
  }
  const video = box.querySelector('video');
  video.srcObject = stream;
  // Try to play (mobile autoplay policies)
  video.play().catch(() => {});
}

function closePeer(id) {
  const peer = peers.get(id);
  if (peer) {
    peer.close();
    peers.delete(id);
  }
  const box = document.getElementById(`videobox-${id}`);
  if (box) box.remove();

  const grid = document.getElementById('videoGrid');
  if (!grid.querySelector('.video-box')) {
    document.getElementById('emptyVideos')?.classList.remove('hidden');
  }
}

function escapeHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
