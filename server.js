const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
  maxHttpBufferSize: 50 * 1024 * 1024
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, `rec-${unique}.webm`);
  }
});
const upload = multer({ storage, limits: { fileSize: 200 * 1024 * 1024 } });

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'corvo2024';

const rooms = new Map();

function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

app.post('/api/create-room', (req, res) => {
  const { password } = req.body || {};
  if (!password || password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Senha incorreta.' });
  }

  let code;
  do { code = generateCode(); } while (rooms.has(code));

  const token = uuidv4();

  rooms.set(code, {
    adminId: null,
    adminToken: token,
    sharers: new Map(),
    viewers: new Map(),
    announcements: [],
    createdAt: Date.now()
  });

  res.json({ code, token });
});

app.post('/api/upload-recording', upload.single('video'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });
  const { roomCode, fromName, duration } = req.body;
  const url = `/recordings/${req.file.filename}`;
  io.to(roomCode).emit('recording-ready', {
    filename: req.file.filename,
    url,
    fromName: fromName || 'Transmissor',
    duration: duration || '?',
    size: req.file.size
  });
  res.json({ success: true, url, filename: req.file.filename });
});

app.get('/recordings/:filename', (req, res) => {
  const file = path.join(uploadsDir, req.params.filename);
  if (fs.existsSync(file)) {
    res.download(file);
  } else {
    res.status(404).send('Arquivo não encontrado');
  }
});

setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (now - room.createdAt > 6 * 60 * 60 * 1000) {
      rooms.delete(code);
    }
  }
  fs.readdir(uploadsDir, (err, files) => {
    if (err) return;
    files.forEach(f => {
      const p = path.join(uploadsDir, f);
      fs.stat(p, (e, stat) => {
        if (!e && now - stat.mtimeMs > 2 * 60 * 60 * 1000) fs.unlink(p, () => {});
      });
    });
  });
}, 30 * 60 * 1000);

io.on('connection', (socket) => {
  let currentRoom = null;
  let role = null;
  let displayName = 'Anônimo';

  socket.on('join', ({ code, role: r, name, token }) => {
    code = (code || '').toUpperCase().trim();
    if (!rooms.has(code)) {
      socket.emit('error-msg', 'Código inválido ou sessão expirada.');
      return;
    }
    const room = rooms.get(code);
    currentRoom = code;
    role = r;
    displayName = name || (r === 'admin' ? 'Administrador' : r === 'sharer' ? 'Transmissor' : 'Convidado');

    socket.join(code);

    if (r === 'admin') {
      if (!token || token !== room.adminToken) {
        socket.emit('error-msg', 'Acesso de administrador negado.');
        socket.leave(code);
        return;
      }
      room.adminId = socket.id;
      socket.emit('joined', { role: 'admin', code, announcements: room.announcements });
      const sharers = [];
      room.sharers.forEach((s, id) => sharers.push({ id, name: s.name, sharing: s.sharing }));
      const viewers = [];
      room.viewers.forEach((v, id) => viewers.push({ id, name: v.name }));
      socket.emit('room-state', { sharers, viewers });
      socket.to(code).emit('user-joined', { role: 'admin', id: socket.id, name: displayName });
    } else if (r === 'sharer') {
      if (room.sharers.size >= 4) {
        socket.emit('error-msg', 'Limite de 4 transmissores atingido.');
        socket.leave(code);
        return;
      }
      room.sharers.set(socket.id, { name: displayName, sharing: false });

      const receivers = [];
      if (room.adminId) receivers.push(room.adminId);
      room.viewers.forEach((_, id) => receivers.push(id));

      socket.emit('joined', {
        role: 'sharer',
        code,
        announcements: room.announcements,
        receivers
      });
      io.to(code).emit('user-joined', { role: 'sharer', id: socket.id, name: displayName });
    } else if (r === 'viewer') {
      room.viewers.set(socket.id, { name: displayName });
      socket.emit('joined', { role: 'viewer', code, announcements: room.announcements });
      io.to(code).emit('user-joined', { role: 'viewer', id: socket.id, name: displayName });
      room.sharers.forEach((s, id) => {
        if (s.sharing) {
          socket.emit('sharer-started', { id, name: s.name });
        }
      });
    }
  });

  socket.on('announcement', ({ text }) => {
    if (!currentRoom || role !== 'admin') return;
    const room = rooms.get(currentRoom);
    if (!room) return;
    const ann = { text, time: Date.now(), id: uuidv4() };
    room.announcements.unshift(ann);
    if (room.announcements.length > 20) room.announcements.pop();
    io.to(currentRoom).emit('announcement', ann);
  });

  socket.on('sharing-started', () => {
    if (!currentRoom || role !== 'sharer') return;
    const room = rooms.get(currentRoom);
    if (!room || !room.sharers.has(socket.id)) return;
    room.sharers.get(socket.id).sharing = true;
    io.to(currentRoom).emit('sharer-started', { id: socket.id, name: displayName });
  });

  socket.on('sharing-stopped', () => {
    if (!currentRoom || role !== 'sharer') return;
    const room = rooms.get(currentRoom);
    if (!room || !room.sharers.has(socket.id)) return;
    room.sharers.get(socket.id).sharing = false;
    io.to(currentRoom).emit('sharer-stopped', { id: socket.id });
  });

  socket.on('signal', ({ to, data }) => {
    io.to(to).emit('signal', { from: socket.id, data });
  });

  socket.on('request-recording', ({ targetId, minutes }) => {
    if (role !== 'admin' || !currentRoom) return;
    io.to(targetId).emit('request-recording', { minutes, adminId: socket.id });
  });

  socket.on('set-name', (name) => {
    displayName = name || displayName;
    if (!currentRoom) return;
    const room = rooms.get(currentRoom);
    if (!room) return;
    if (role === 'sharer' && room.sharers.has(socket.id)) {
      room.sharers.get(socket.id).name = displayName;
    } else if (role === 'viewer' && room.viewers.has(socket.id)) {
      room.viewers.get(socket.id).name = displayName;
    }
    io.to(currentRoom).emit('name-updated', { id: socket.id, name: displayName, role });
  });

  socket.on('disconnect', () => {
    if (!currentRoom) return;
    const room = rooms.get(currentRoom);
    if (!room) return;

    if (role === 'admin') {
      room.adminId = null;
      io.to(currentRoom).emit('admin-left');
    } else if (role === 'sharer') {
      room.sharers.delete(socket.id);
      io.to(currentRoom).emit('user-left', { role: 'sharer', id: socket.id });
    } else if (role === 'viewer') {
      room.viewers.delete(socket.id);
      io.to(currentRoom).emit('user-left', { role: 'viewer', id: socket.id });
    }

    if (!room.adminId && room.sharers.size === 0 && room.viewers.size === 0) {
      rooms.delete(currentRoom);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Corvo SS rodando em http://localhost:${PORT}`);
});
