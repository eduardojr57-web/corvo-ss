const code = getQueryParam('code').toUpperCase();
const name = getQueryParam('name') || 'Transmissor';

if (!code) window.location.href = '/';

const socket = io();
let localStream = null;
let recorder = null;
const peers = new Map(); // remoteId -> SimplePeer
let isSharing = false;

// Who should receive my stream: admin + all current viewers
let knownReceivers = new Set();

socket.emit('join', { code, role: 'sharer', name });

socket.on('error-msg', (msg) => {
  alert(msg);
  window.location.href = '/';
});

socket.on('joined', ({ announcements, receivers }) => {
  announcements.forEach(showAnnouncement);
  if (receivers && Array.isArray(receivers)) {
    receivers.forEach(id => knownReceivers.add(id));
  }
  showToast('Conectado à sessão ' + code);
});

socket.on('announcement', showAnnouncement);

socket.on('user-joined', ({ role, id }) => {
  if (role === 'viewer' || role === 'admin') {
    knownReceivers.add(id);
    if (isSharing && localStream) {
      connectTo(id);
    }
  }
});

socket.on('user-left', ({ id }) => {
  knownReceivers.delete(id);
  closePeer(id);
});

socket.on('signal', async ({ from, data }) => {
  let peer = peers.get(from);
  if (!peer && isSharing) {
    // Late joiner asking for stream – we are initiator
    peer = createPeer(from, true);
  }
  if (peer) await peer.handleSignal(data);
});

socket.on('request-recording', async ({ minutes }) => {
  if (!recorder) {
    showToast('Nenhuma gravação disponível ainda.');
    return;
  }
  const blob = recorder.getLastMinutes(minutes);
  if (!blob || blob.size < 1000) {
    showToast('Ainda não há material suficiente dos últimos ' + minutes + ' min.');
    return;
  }

  document.getElementById('recStatus').textContent = `Enviando gravação de ${minutes} min...`;

  const form = new FormData();
  form.append('video', blob, `corvo-${minutes}min.webm`);
  form.append('roomCode', code);
  form.append('fromName', name);
  form.append('duration', String(minutes));

  try {
    const res = await fetch('/api/upload-recording', {
      method: 'POST',
      body: form
    });
    const data = await res.json();
    if (data.success) {
      showToast('Gravação enviada com sucesso!');
      document.getElementById('recStatus').textContent = `Última gravação (${minutes} min) enviada.`;
    } else {
      throw new Error('Upload failed');
    }
  } catch (e) {
    console.error(e);
    // Fallback: download locally
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `corvo-ss-${minutes}min-${Date.now()}.webm`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Não foi possível enviar. Arquivo baixado no seu dispositivo – envie manualmente ao admin.');
    document.getElementById('recStatus').textContent = 'Arquivo baixado localmente.';
  }
});

function showAnnouncement(ann) {
  const area = document.getElementById('announcementArea');
  const div = document.createElement('div');
  div.className = 'announcement-box';
  div.innerHTML = `<strong>Aviso do Admin:</strong> ${escapeHtml(ann.text)}
    <div class="time">${formatTime(ann.time)}</div>`;
  area.prepend(div);
  while (area.children.length > 4) area.lastChild.remove();
}

async function toggleShare() {
  if (isSharing) return;
  try {
    localStream = await navigator.mediaDevices.getDisplayMedia({
      video: {
        cursor: 'always',
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 15, max: 20 }
      },
      audio: false
    });

    // If user stops sharing via browser UI
    localStream.getVideoTracks()[0].onended = () => stopShare();

    isSharing = true;
    document.getElementById('shareBtn').classList.add('hidden');
    document.getElementById('stopBtn').classList.remove('hidden');
    document.getElementById('localPreview').classList.remove('hidden');
    document.getElementById('localVideo').srcObject = localStream;
    document.getElementById('statusDot').classList.add('live');
    document.getElementById('statusText').textContent = 'Transmitindo tela...';

    // Start rolling recorder
    recorder = new RollingRecorder(localStream, 10);
    recorder.start();
    document.getElementById('recStatus').textContent = 'Gravando buffer dos últimos 10 min...';

    socket.emit('sharing-started');

    // Connect to all known receivers (admin + viewers)
    knownReceivers.forEach(id => connectTo(id));

    // Also try to discover current admin/viewers by asking? 
    // For prototype the server already sent user-joined for those present before us.
    // If admin joined after, they will appear via user-joined.

  } catch (err) {
    console.error(err);
    if (err.name === 'NotAllowedError') {
      showToast('Permissão de tela negada.');
    } else {
      showToast('Erro ao capturar tela: ' + err.message);
    }
  }
}

function stopShare() {
  if (localStream) {
    localStream.getTracks().forEach(t => t.stop());
    localStream = null;
  }
  if (recorder) {
    recorder.stop();
    recorder = null;
  }
  isSharing = false;

  peers.forEach(p => p.close());
  peers.clear();

  document.getElementById('shareBtn').classList.remove('hidden');
  document.getElementById('stopBtn').classList.add('hidden');
  document.getElementById('localPreview').classList.add('hidden');
  document.getElementById('localVideo').srcObject = null;
  document.getElementById('statusDot').classList.remove('live');
  document.getElementById('statusText').textContent = 'Transmissão parada.';
  document.getElementById('recStatus').textContent = '';

  socket.emit('sharing-stopped');
}

function connectTo(remoteId) {
  if (peers.has(remoteId) || !localStream) return;
  createPeer(remoteId, true);
}

function createPeer(remoteId, isInitiator) {
  const peer = new SimplePeer(isInitiator, localStream);
  peers.set(remoteId, peer);

  peer.onSignal = (sig) => {
    socket.emit('signal', { to: remoteId, data: sig });
  };

  peer.onClose = () => {
    peers.delete(remoteId);
  };

  return peer;
}

function closePeer(id) {
  const p = peers.get(id);
  if (p) {
    p.close();
    peers.delete(id);
  }
}

function escapeHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// When page unloads, stop
window.addEventListener('beforeunload', () => {
  if (isSharing) stopShare();
});
