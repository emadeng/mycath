const express = require('express');
const fs = require('fs');
const path = require('path');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, { cors: { origin: "*" } });

app.use(express.json());
app.use(express.static(__dirname));
app.use('/', express.static(path.join(__dirname, 'client')));

const ROOMS_FILE = path.join(__dirname, 'rooms.json');
let rooms = { lobby: { members: [], owner: null, locked: false, password: null } };

if (fs.existsSync(ROOMS_FILE)) {
  try {
    const data = fs.readFileSync(ROOMS_FILE, 'utf-8');
    const savedRooms = JSON.parse(data);
    for (const r in savedRooms) {
      rooms[r] = {
        members: savedRooms[r].members || [],
        owner: savedRooms[r].owner || null,
        locked: savedRooms[r].locked || false,
        password: savedRooms[r].password || null
      };
    }
  } catch (err) { console.error('Error loading rooms.json:', err); }
}
const USERS_FILE = path.join(__dirname, 'users.json');

/*
app.post('/create-user', (req, res) => {
  const { username, email, password, gender, avatar } = req.body;
  if (users.find(u => u.username === username || u.email === email)) return res.json({ success: false });
  users.push({ username, email, password, gender, avatar });
  res.json({ success: true });
});*/
// --- تحميل المستخدمين ---
function loadUsers() {
  if (!fs.existsSync(USERS_FILE)) return [];
  try {
    const data = fs.readFileSync(USERS_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (err) {
    console.error('Error reading users.json:', err);
    return [];
  }
}

// --- حفظ المستخدمين ---
function saveUsers(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

// --- إنشاء مستخدم جديد ---
app.post('/create-user', (req, res) => {
  const { username, password, email, gender, avatar } = req.body;

  if (!username || !password) return res.json({ success: false, msg: 'اسم المستخدم وكلمة المرور مطلوبة' });

  let users = loadUsers();

  // التحقق من وجود المستخدم مسبقاً
  if (users.find(u => u.username === username || u.email === email)) {
    return res.json({ success: false, msg: 'اسم المستخدم أو البريد موجود مسبقاً' });
  }

  // إضافة المستخدم الجديد
  users.push({
    username,
    password,   // ⚠️ لاحقاً يمكن تشفيرها قبل الحفظ
    email: email || '',
    gender: gender || '',
    avatar: avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(username)}&background=random&color=FFFFFF&rounded=true`
  });

  saveUsers(users);

  res.json({ success: true, msg: 'تم إنشاء المستخدم بنجاح' });
});
/*
app.post('/login', (req, res) => {
  const { username, password } = req.body;
  const user = users.find(u => u.username === username && u.password === password);
  if (!user) return res.json({ success: false });
  res.json({ success: true, user: { username: user.username } });
});*/
// --- تسجيل الدخول ---
app.post('/login', (req, res) => {
  const { username, password } = req.body;
  const users = loadUsers();

  const user = users.find(u => u.username === username && u.password === password);
  if (!user) return res.json({ success: false, msg: 'اسم المستخدم أو كلمة المرور غير صحيحة' });

  res.json({ success: true, user });
});

function saveRooms() {
  const copy = { ...rooms };
  delete copy.lobby;
  fs.writeFileSync(ROOMS_FILE, JSON.stringify(copy, null, 2));
}

function buildRoomsList() {
  return Object.keys(rooms)
    .filter(r => r !== 'lobby')
    .map(r => ({
      name: r,
      count: Array.isArray(rooms[r].members) ? rooms[r].members.length : 0,
      owner: rooms[r].owner,
      locked: rooms[r].locked
    }));
}

io.on('connection', socket => {
  const username = socket.handshake.auth.username;
  if (!username) return socket.disconnect();
  socket.username = username;
  console.log(`${username} متصل (id=${socket.id})`);

  // --- انضمام تلقائي للـ lobby ---
  if(!rooms.lobby.members.some(u => u.username === username)) {
    rooms.lobby.members.push({ username, socketId: socket.id });
    socket.join('lobby');
  }

  // ----- إنشاء غرفة -----
  socket.on('create_room', ({ roomId, password }) => {
    if (!roomId || rooms[roomId]) {
      socket.emit('error_msg', '❌ اسم الغرفة موجود');
      return;
    }
    rooms[roomId] = { members: [], owner: username, locked: !!password, password: password || null };
    saveRooms();
    io.emit('rooms_list', buildRoomsList());
  });
 socket.on('send_message', ({ roomId, text })=>{
    io.to(roomId).emit('new_message', { senderId: socket.id, senderName: socket.username, text });
  });

  socket.on('get_rooms', () => socket.emit('rooms_list', buildRoomsList()));

  // ----- انضمام لغرفة -----
/*
  socket.on('join_room', ({ roomId, password }) => {
    if (!rooms[roomId]) return socket.emit('error_msg', '❌ الغرفة غير موجود');

    const roomData = rooms[roomId];

    if (roomData.locked && password !== roomData.password) {
      return socket.emit('error_msg', '❌ كلمة المرور خاطئة');
    }

    // إزالة أي نسخة قديمة لنفس المستخدم
    roomData.members = roomData.members.filter(u => u.username !== username);

    // إضافة المستخدم الجديد
    roomData.members.push({ socketId: socket.id, username, roomId });
    socket.join(roomId);

    // إرسال بيانات الغرفة للمستخدم الجديد
    socket.emit('room_joined', {
      roomId,
      owner: roomData.owner,
      members: roomData.members,
      locked: roomData.locked
    });

    // إعلام باقي الأعضاء
    socket.to(roomId).emit('user_joined', { userId: socket.id, username, owner: roomData.owner ,roomId});
  });*/
// عند الانضمام للغرفة
socket.on('join_room', ({ roomId, password }) => {
  if (!rooms[roomId]) return socket.emit('error_msg', '❌ الغرفة غير موجود');
  const roomData = rooms[roomId];

  // تحقق من كلمة المرور
  if (roomData.locked && password !== roomData.password)
    return socket.emit('error_msg', '❌ كلمة المرور خاطئة');

  // أضف المستخدم للغرفة
  roomData.members.push({ socketId: socket.id, username });

  socket.join(roomId);

  // أرسل بيانات الغرفة مع دور كل مستخدم
  socket.emit('room_joined', {
    roomId,
    owner: roomData.owner,
    members: roomData.members.map(u => ({
      socketId: u.socketId,
      username: u.username,
      isOwner: u.username === roomData.owner
    })),
    locked: roomData.locked
  });

  // إعلام باقي الأعضاء
  socket.to(roomId).emit('user_joined', {
    userId: socket.id,
    username,
    isOwner: username === roomData.owner,
    roomId
  });
});


  // ===== مغادرة الغرفة =====
socket.on('leave_room', ({ roomId }) => {
  if (!rooms[roomId]) return; // الغرفة غير موجودة

  // تأكد من وجود المصفوفة
  if (!Array.isArray(rooms[roomId].members)) rooms[roomId].members = [];
  const members = rooms[roomId].members;

  // البحث عن المستخدم في الغرفة
  const index = members.findIndex(u => u.socketId === socket.id);

  if (index !== -1) {
    // إزالة المستخدم فعليًا من المصفوفة
    const [removedUser] = members.splice(index, 1);
    rooms[roomId].members = members;

    // مغادرة الغرفة فعليًا
    socket.leave(roomId);

    // إعلام باقي الأعضاء في الغرفة فقط
    io.to(roomId).emit('user_left', {
      username: removedUser.username,
      userId: removedUser.socketId,
      roomId // مهم لتحديد الغرفة في العميل
    });

    console.log(`${removedUser.username} خرج من الغرفة: ${roomId}`);
  }
});


  // ----- رسائل خاصة -----
  socket.on('private_message', ({ toSocketId, text }) => {
    io.to(toSocketId).emit('private_message', { fromId: socket.id, fromName: username, text });
  });

  // ----- طرد مستخدم -----
  socket.on('kick_user', ({ roomId, targetId }) => {
    if (!rooms[roomId] || rooms[roomId].owner !== username) return;
    const members = rooms[roomId].members || [];
    rooms[roomId].members = members.filter(u => u.socketId !== targetId);
    io.to(targetId).emit('kicked');
    io.sockets.sockets.get(targetId)?.leave(roomId);
    io.to(roomId).emit('user_left', { userId: targetId, username: '(تم الطرد)' });
  });

  // ----- قفل/فتح الغرفة -----
  socket.on('lock_room', ({ roomId, password }) => {
    if (!rooms[roomId] || rooms[roomId].owner !== username) return;
    rooms[roomId].locked = true;
    rooms[roomId].password = password;
    io.to(roomId).emit('room_locked');
    saveRooms();
  });

  socket.on('unlock_room', ({ roomId }) => {
    if (!rooms[roomId] || rooms[roomId].owner !== username) return;
    rooms[roomId].locked = false;
    rooms[roomId].password = null;
    io.to(roomId).emit('room_unlocked');
    saveRooms();
  });

   // قطع الاتصال
  socket.on('disconnect', () => {
    console.log(`${username} فصل (id=${socket.id})`);

    for (const r in rooms) {
      const members = rooms[r].members || [];
      const index = members.findIndex(u => u.socketId === socket.id);
      if (index !== -1) {
        const [removedUser] = members.splice(index, 1);
        rooms[r].members = members;
        io.to(r).emit('user_left', { username: removedUser.username, userId: removedUser.socketId });
      }
    }
  });
});

http.listen(3000, () => console.log('Server running on http://localhost:3000'));
