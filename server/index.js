// server/index.js
// ESM server (requires "type": "module" in package.json)
// Run: node server/index.js

import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import crypto from 'crypto';
import util from 'util';
import http from 'http';
import { Server as IOServer } from 'socket.io';

dotenv.config();

const app = express();

// -------------------- Middleware --------------------
app.use(cors());
app.use(bodyParser.json({ limit: '1mb' }));

app.use((req, res, next) => {
  try {
    console.log('------------------------------------');
    console.log(`[REQ] ${req.method} ${req.originalUrl}`);
    const safeHeaders = {
      host: req.headers.host,
      origin: req.headers.origin,
      'content-type': req.headers['content-type'],
      authorization: req.headers.authorization ? '[REDACTED]' : undefined
    };
    console.log('[REQ] headers:', safeHeaders);
    if (req.body && Object.keys(req.body).length > 0) {
      const bodyPreview = util.inspect(req.body, { depth: 2, maxArrayLength: 20 }).slice(0, 2000);
      console.log('[REQ] body:', bodyPreview);
    }
  } catch (e) {
    console.warn('request-logger error', e);
  }
  next();
});

// -------------------- DB Connect --------------------
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/livecode';
console.log('DEBUG MONGO_URI =', MONGO_URI);

try {
  await mongoose.connect(MONGO_URI);
  console.log('MongoDB connected:', MONGO_URI);
} catch (err) {
  console.error('MongoDB connection error:', err);
  process.exit(1);
}

// -------------------- Schemas & Models --------------------
const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  passwordHash: { type: String, required: true },
  token: { type: String },
  createdAt: { type: Date, default: Date.now }
});
const User = mongoose.model('User', userSchema);

const roomSchema = new mongoose.Schema({
  roomId: { type: String, required: true, unique: true },
  passwordHash: { type: String, required: true },
  owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  meta: { type: Object, default: {} },
  members: [{
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    role: { type: String, enum: ['owner','editor','member','viewer','pending'], default: 'member' },
    addedAt: { type: Date, default: Date.now }
  }],
  files: [{
    fileId: { type: String, required: true },
    name: { type: String, required: true },
    createdAt: { type: Date, default: Date.now }
  }],
  createdAt: { type: Date, default: Date.now }
});
const Room = mongoose.model('Room', roomSchema);

// -------------------- Helpers --------------------
const generateToken = () => crypto.randomBytes(24).toString('hex');
const makeRoomId = () => 'room-' + crypto.randomBytes(4).toString('hex').slice(0,8);
const strongPassword = (len = 20) => crypto.randomBytes(len).toString('base64').replace(/[/+=]/g,'').slice(0, len);
const makeFileId = () => 'file-' + crypto.randomBytes(6).toString('hex').slice(0,12);

// -------------------- Auth endpoints --------------------
app.post('/api/auth/signup', async (req, res, next) => {
  try {
    console.log('[HANDLER] POST /api/auth/signup');
    const { username, password } = req.body || {};
    if (!username || !password) {
      console.log('[SIGNUP] missing username/password');
      return res.status(400).json({ ok:false, error:'username & password required' });
    }
    const exists = await User.findOne({ username });
    if (exists) {
      console.log('[SIGNUP] username exists:', username);
      return res.status(409).json({ ok:false, error:'username exists' });
    }
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);
    const token = generateToken();
    const user = await User.create({ username, passwordHash, token });
    console.log('[SIGNUP] created user', { id: user._id.toString(), username: user.username });
    return res.json({ ok:true, id: user._id.toString(), username: user.username, token });
  } catch (err) {
    console.error('[SIGNUP] error', err);
    next(err);
  }
});

app.post('/api/auth/signin', async (req, res, next) => {
  try {
    console.log('[HANDLER] POST /api/auth/signin');
    const { username, password } = req.body || {};
    if (!username || !password) {
      console.log('[SIGNIN] missing username/password');
      return res.status(400).json({ ok:false, error:'username & password required' });
    }
    const user = await User.findOne({ username });
    if (!user) {
      console.log('[SIGNIN] user not found:', username);
      return res.status(404).json({ ok:false, error:'user not found' });
    }
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      console.log('[SIGNIN] invalid credentials for:', username);
      return res.status(401).json({ ok:false, error:'invalid credentials' });
    }
    user.token = generateToken();
    await user.save();
    console.log('[SIGNIN] success for', username);
    return res.json({ ok:true, id: user._id.toString(), username: user.username, token: user.token });
  } catch (err) {
    console.error('[SIGNIN] error', err);
    next(err);
  }
});

// -------------------- Auth middleware --------------------
async function requireAuth(req, res, next) {
  try {
    const auth = req.headers['authorization'];
    if (!auth || !auth.startsWith('Bearer ')) {
      console.log('[AUTH] missing Authorization header');
      return res.status(401).json({ ok:false, error:'missing token' });
    }
    const token = auth.slice(7);
    const user = await User.findOne({ token });
    if (!user) {
      console.log('[AUTH] invalid token:', token ? '[REDACTED]' : 'none');
      return res.status(401).json({ ok:false, error:'invalid token' });
    }
    req.user = user;
    next();
  } catch (err) {
    console.error('[AUTH] middleware error', err);
    next(err);
  }
}

// -------------------- HTTP server + Socket.IO --------------------
const httpServer = http.createServer(app);
const io = new IOServer(httpServer, {
  cors: { origin: true, methods: ['GET','POST'] },
  // consider adding transports: ['websocket','polling'] if you have trouble with transports
});

// Map of userId -> Set of socketIds
const userSocketMap = new Map();

// Helper to attach socket for a user id
function addSocketForUser(userId, socketId) {
  const set = userSocketMap.get(userId) || new Set();
  set.add(socketId);
  userSocketMap.set(userId, set);
}
function removeSocketForUser(userId, socketId) {
  const set = userSocketMap.get(userId);
  if (!set) return;
  set.delete(socketId);
  if (set.size === 0) userSocketMap.delete(userId);
  else userSocketMap.set(userId, set);
}
// Get socket ids for a user
function getSocketsForUser(userId) {
  const set = userSocketMap.get(userId);
  return set ? Array.from(set) : [];
}

// Socket auth (token in query)
io.use(async (socket, next) => {
  try {
    const token = socket.handshake.query?.token;
    if (!token) {
      console.log('[IO] auth missing token');
      return next(new Error('Authentication required'));
    }
    const user = await User.findOne({ token }).select('_id username');
    if (!user) {
      console.log('[IO] invalid socket token');
      return next(new Error('Invalid token'));
    }
    socket.user = { id: user._id.toString(), username: user.username };
    return next();
  } catch (err) {
    console.error('[IO] auth error', err);
    return next(new Error('Internal auth error'));
  }
});

io.on('connection', (socket) => {
  try {
    const uid = socket.user.id;
    console.log(`[IO] connected socket ${socket.id} for user ${uid}`);
    addSocketForUser(uid, socket.id);

    // subscribe/unsubscribe handlers
    socket.on('subscribeRoom', (p) => {
      try {
        if (!p || !p.roomId) return;
        console.log('[IO] subscribeRoom', p.roomId, 'socket', socket.id);
        socket.join(p.roomId);
      } catch (e) { console.warn('subscribeRoom error', e); }
    });

    socket.on('unsubscribeRoom', (p) => {
      try {
        if (!p || !p.roomId) return;
        console.log('[IO] unsubscribeRoom', p.roomId, 'socket', socket.id);
        socket.leave(p.roomId);
      } catch (e) { console.warn('unsubscribeRoom error', e); }
    });

    socket.on('disconnect', (reason) => {
      console.log('[IO] disconnect', socket.id, reason);
      removeSocketForUser(uid, socket.id);
    });
  } catch (err) {
    console.error('[IO] connection handler error', err);
  }
});

// helper to emit to a specific user
async function emitToUser(userId, event, payload = {}) {
  const socketIds = getSocketsForUser(userId);
  socketIds.forEach(sid => {
    const sock = io.sockets.sockets.get(sid);
    if (sock) sock.emit(event, payload);
  });
}

// -------------------- Room endpoints --------------------
// Create room
app.post('/api/rooms', requireAuth, async (req, res, next) => {
  try {
    console.log('[HANDLER] POST /api/rooms by', req.user?.username);
    const roomId = makeRoomId();
    const pass = strongPassword(20);
    const passwordHash = await bcrypt.hash(pass, 10);
    const room = await Room.create({
      roomId,
      passwordHash,
      owner: req.user._id,
      meta: req.body.meta || {},
      members: [{ user: req.user._id, role: 'owner' }],
      files: []
    });
    console.log('[ROOM CREATE] created', roomId, 'owner=', req.user.username);
    return res.json({ ok:true, roomId: room.roomId, password: pass, ownerId: room.owner.toString(), files: room.files });
  } catch (err) {
    console.error('[ROOM CREATE] error', err);
    next(err);
  }
});

// Join room - now creates pending entry for non-owner joiners
app.post('/api/rooms/join', requireAuth, async (req, res, next) => {
  try {
    console.log('[HANDLER] POST /api/rooms/join by', req.user?.username);
    const { roomId, password } = req.body || {};
    if (!roomId || !password) {
      console.log('[ROOM JOIN] missing roomId/password');
      return res.status(400).json({ ok:false, error:'roomId & password required' });
    }
    const room = await Room.findOne({ roomId }).populate('members.user', 'username');
    if (!room) {
      console.log('[ROOM JOIN] room not found', roomId);
      return res.status(404).json({ ok:false, error:'room not found' });
    }
    const ok = await bcrypt.compare(password, room.passwordHash);
    if (!ok) {
      console.log('[ROOM JOIN] invalid room password for', roomId);
      return res.status(401).json({ ok:false, error:'invalid room password' });
    }

    const already = room.members.find(m => m.user && m.user._id.equals(req.user._id));
    if (already) {
      console.log('[ROOM JOIN] user already member', req.user.username, already.role);
      return res.json({
        ok:true,
        role: already.role === 'pending' ? 'pending' : already.role,
        roomId: room.roomId,
        ownerId: room.owner.toString(),
        ownerName: (await User.findById(room.owner).select('username')).username,
        meta: room.meta,
        files: room.files
      });
    }

    const isOwnerJoining = room.owner && room.owner.equals(req.user._id);
    if (isOwnerJoining) {
      room.members.push({ user: req.user._id, role: 'owner' });
      await room.save();
      io.to(room.roomId).emit('members_updated', { roomId: room.roomId });
      return res.json({ ok:true, role: 'owner', roomId: room.roomId, ownerId: room.owner.toString(), ownerName: (await User.findById(room.owner).select('username')).username, meta: room.meta, files: room.files });
    }

    room.members.push({ user: req.user._id, role: 'pending' });
    await room.save();
    console.log('[ROOM JOIN] added pending member', req.user.username, 'to', roomId);

    const ownerId = room.owner ? room.owner.toString() : null;
    if (ownerId) {
      await emitToUser(ownerId, 'members_updated', { roomId: room.roomId });
    }

    return res.json({
      ok:true,
      role: 'pending',
      roomId: room.roomId,
      ownerId: room.owner ? room.owner.toString() : null,
      ownerName: (await User.findById(room.owner).select('username')).username,
      meta: room.meta,
      files: room.files,
      message: 'Request submitted — waiting for owner approval'
    });
  } catch (err) {
    console.error('[ROOM JOIN] error', err);
    next(err);
  }
});

// Delete a file (owner or editor) — idempotent (returns ok if file missing)
app.delete('/api/rooms/:roomId/files/:fileId', requireAuth, async (req, res, next) => {
  try {
    console.log('[HANDLER] DELETE /api/rooms/:roomId/files/:fileId', req.params.roomId, req.params.fileId, 'by', req.user?.username);

    const room = await Room.findOne({ roomId: req.params.roomId });
    if (!room) {
      console.log('[DELETE FILE] room not found', req.params.roomId);
      return res.status(404).json({ ok: false, error: 'room not found' });
    }

    try {
      console.log('[DELETE FILE] room.files:', room.files.map(f => ({ fileId: f.fileId, name: f.name })));
    } catch (e) {
      console.warn('[DELETE FILE] failed printing room.files', e);
    }

    // Find the requesting user's membership entry
    const memberEntry = room.members.find(m => m.user && m.user.toString() === req.user._id.toString());
    if (!memberEntry || (memberEntry.role !== 'owner' && memberEntry.role !== 'editor')) {
      console.log('[DELETE FILE] not allowed - user role:', memberEntry ? memberEntry.role : 'none');
      return res.status(403).json({ ok: false, error: 'not allowed' });
    }

    const idx = room.files.findIndex(f => f.fileId === req.params.fileId);
    if (idx === -1) {
      console.log('[DELETE FILE] file not found (idempotent)', req.params.fileId);
      // idempotent success — file already gone
      // broadcast files_updated anyway so clients refresh
      io.to(room.roomId).emit('files_updated', { roomId: room.roomId, fileId: req.params.fileId, action: 'deleted' });
      return res.json({ ok: true, message: 'file not found (idempotent)' });
    }

    const removed = room.files.splice(idx, 1)[0];
    await room.save();

    // broadcast files_updated to the room so clients refresh
    io.to(room.roomId).emit('files_updated', { roomId: room.roomId, fileId: removed.fileId, action: 'deleted' });
    console.log('[DELETE FILE] deleted', removed.fileId, 'from', room.roomId);

    return res.json({ ok: true, fileId: removed.fileId });
  } catch (err) {
    console.error('[DELETE FILE] error', err);
    next(err);
  }
});

// Get room basic info
app.get('/api/rooms/:id', requireAuth, async (req, res, next) => {
  try {
    console.log('[HANDLER] GET /api/rooms/:id', req.params.id);
    const room = await Room.findOne({ roomId: req.params.id }).populate('owner', 'username');
    if (!room) {
      console.log('[GET ROOM] not found', req.params.id);
      return res.status(404).json({ ok:false, error:'not found' });
    }
    return res.json({
      ok:true,
      roomId: room.roomId,
      ownerId: room.owner ? room.owner._id.toString() : null,
      ownerName: room.owner ? room.owner.username : null,
      meta: room.meta,
      files: room.files,
      createdAt: room.createdAt
    });
  } catch (err) {
    console.error('[GET ROOM] error', err);
    next(err);
  }
});

// List files
app.get('/api/rooms/:roomId/files', requireAuth, async (req, res, next) => {
  try {
    console.log('[HANDLER] GET /api/rooms/:roomId/files', req.params.roomId);
    const room = await Room.findOne({ roomId: req.params.roomId });
    if (!room) {
      console.log('[LIST FILES] room not found', req.params.roomId);
      return res.status(404).json({ ok:false, error:'room not found' });
    }
    return res.json({ ok:true, files: room.files });
  } catch (err) {
    console.error('[LIST FILES] error', err);
    next(err);
  }
});

// Create file
app.post('/api/rooms/:roomId/files', requireAuth, async (req, res, next) => {
  try {
    console.log('[HANDLER] POST /api/rooms/:roomId/files', req.params.roomId, 'by', req.user?.username);
    const { name } = req.body || {};
    const room = await Room.findOne({ roomId: req.params.roomId }).populate('members.user', '_id username');
    if (!room) {
      console.log('[CREATE FILE] room not found', req.params.roomId);
      return res.status(404).json({ ok:false, error:'room not found' });
    }
    const mem = room.members.find(m => m.user && m.user._id.equals(req.user._id));
    if (!mem || mem.role === 'pending') {
      console.log('[CREATE FILE] not allowed - not a member or pending', req.user.username);
      return res.status(403).json({ ok:false, error:'not allowed' });
    }
    const fileId = makeFileId();
    const file = { fileId, name: name || `untitled-${Date.now()}` };
    room.files.push(file);
    await room.save();

    // broadcast files_updated to the room
    io.to(room.roomId).emit('files_updated', { roomId: room.roomId, fileId: file.fileId, action: 'created' });
    console.log('[CREATE FILE] created', fileId, 'in', req.params.roomId);
    return res.json({ ok:true, file });
  } catch (err) {
    console.error('[CREATE FILE] error', err);
    next(err);
  }
});

// List members
app.get('/api/rooms/:roomId/members', requireAuth, async (req, res, next) => {
  try {
    console.log('[HANDLER] GET /api/rooms/:roomId/members', req.params.roomId);
    const room = await Room.findOne({ roomId: req.params.roomId }).populate('members.user', 'username');
    if (!room) {
      console.log('[LIST MEMBERS] room not found', req.params.roomId);
      return res.status(404).json({ ok:false, error:'room not found' });
    }
    const members = room.members.map(m => ({
      id: m.user ? m.user._id.toString() : null,
      username: m.user ? m.user.username : '(deleted)',
      role: m.role
    }));
    return res.json({ ok:true, members });
  } catch (err) {
    console.error('[LIST MEMBERS] error', err);
    next(err);
  }
});

// Approve pending member (owner-only)
app.post('/api/rooms/:roomId/members/:memberId/approve', requireAuth, async (req, res, next) => {
  try {
    console.log('[HANDLER] APPROVE member', req.params.roomId, req.params.memberId, 'by', req.user?.username);
    const room = await Room.findOne({ roomId: req.params.roomId });
    if (!room) return res.status(404).json({ ok:false, error:'room not found' });

    const requestingIsOwner = room.owner && room.owner.equals(req.user._id);
    if (!requestingIsOwner) return res.status(403).json({ ok:false, error:'only owner can approve' });

    const entry = room.members.find(m => m.user && m.user.toString() === req.params.memberId);
    if (!entry) return res.status(404).json({ ok:false, error:'member not found' });

    if (entry.role !== 'pending') {
      return res.status(400).json({ ok:false, error:'member is not pending' });
    }

    entry.role = 'member';
    await room.save();

    // notify the approved user
    await emitToUser(req.params.memberId, 'approved', { roomId: room.roomId, message: 'Your access has been approved.' });

    // broadcast members update to room and owner (owner will already see via members endpoint)
    io.to(room.roomId).emit('members_updated', { roomId: room.roomId });
    return res.json({ ok:true, memberId: req.params.memberId, role: 'member' });
  } catch (err) {
    console.error('[APPROVE] error', err);
    next(err);
  }
});

// Reject pending member (owner-only) - remove from members
app.post('/api/rooms/:roomId/members/:memberId/reject', requireAuth, async (req, res, next) => {
  try {
    console.log('[HANDLER] REJECT member', req.params.roomId, req.params.memberId, 'by', req.user?.username);
    const room = await Room.findOne({ roomId: req.params.roomId });
    if (!room) return res.status(404).json({ ok:false, error:'room not found' });

    const requestingIsOwner = room.owner && room.owner.equals(req.user._id);
    if (!requestingIsOwner) return res.status(403).json({ ok:false, error:'only owner can reject' });

    const idx = room.members.findIndex(m => m.user && m.user.toString() === req.params.memberId);
    if (idx === -1) return res.status(404).json({ ok:false, error:'member not found' });

    const entry = room.members[idx];
    if (entry.role !== 'pending') {
      return res.status(400).json({ ok:false, error:'member is not pending' });
    }

    // remove the pending entry
    room.members.splice(idx, 1);
    await room.save();

    // notify target user they were rejected
    await emitToUser(req.params.memberId, 'rejected', { roomId: room.roomId, message: 'Your request was rejected by the owner.' });

    // notify owner/room
    io.to(room.roomId).emit('members_updated', { roomId: room.roomId });
    return res.json({ ok:true });
  } catch (err) {
    console.error('[REJECT] error', err);
    next(err);
  }
});

// Kick a member (owner-only) - remove member entry and notify them
app.post('/api/rooms/:roomId/members/:memberId/kick', requireAuth, async (req, res, next) => {
  try {
    console.log('[HANDLER] KICK member', req.params.roomId, req.params.memberId, 'by', req.user?.username);
    const room = await Room.findOne({ roomId: req.params.roomId });
    if (!room) return res.status(404).json({ ok:false, error:'room not found' });

    const requestingIsOwner = room.owner && room.owner.equals(req.user._id);
    if (!requestingIsOwner) return res.status(403).json({ ok:false, error:'only owner can kick' });

    const idx = room.members.findIndex(m => m.user && m.user.toString() === req.params.memberId);
    if (idx === -1) return res.status(404).json({ ok:false, error:'member not found' });

    // Do not allow owner to kick themselves via this endpoint
    const entry = room.members[idx];
    if (entry.role === 'owner') return res.status(400).json({ ok:false, error:'cannot kick owner' });

    room.members.splice(idx, 1);
    await room.save();

    // send kicked event to the target user so their client will leave
    await emitToUser(req.params.memberId, 'kicked', { roomId: room.roomId, message: 'You have been kicked by the owner.' });

    // broadcast members update to room
    io.to(room.roomId).emit('members_updated', { roomId: room.roomId });
    return res.json({ ok:true });
  } catch (err) {
    console.error('[KICK] error', err);
    next(err);
  }
});

// Change member role (owner-only)
app.post('/api/rooms/:roomId/members/:memberId/role', requireAuth, async (req, res, next) => {
  try {
    console.log('[HANDLER] POST /api/rooms/:roomId/members/:memberId/role', req.params.roomId, req.params.memberId);
    const { role } = req.body || {};
    if (!['owner','editor','member','viewer'].includes(role)) {
      console.log('[CHANGE ROLE] invalid role', role);
      return res.status(400).json({ ok:false, error:'invalid role' });
    }
    const room = await Room.findOne({ roomId: req.params.roomId });
    if (!room) {
      console.log('[CHANGE ROLE] room not found', req.params.roomId);
      return res.status(404).json({ ok:false, error:'room not found' });
    }
    const requestingIsOwner = room.owner && room.owner.equals(req.user._id);
    if (!requestingIsOwner) {
      console.log('[CHANGE ROLE] requesting user not owner', req.user.username);
      return res.status(403).json({ ok:false, error:'only owner can change roles' });
    }
    const memberEntry = room.members.find(m => m.user && m.user.toString() === req.params.memberId);
    if (!memberEntry) {
      console.log('[CHANGE ROLE] member not found', req.params.memberId);
      return res.status(404).json({ ok:false, error:'member not found' });
    }
    if (role === 'owner') {
      // demote previous owner to member
      room.members = room.members.map(m => {
        if (m.user.equals(req.user._id)) return { user: m.user, role: 'member', addedAt: m.addedAt };
        return m;
      });
      room.owner = memberEntry.user;
      memberEntry.role = 'owner';
    } else {
      memberEntry.role = role;
    }
    await room.save();

    // broadcast members update
    io.to(room.roomId).emit('members_updated', { roomId: room.roomId });
    console.log('[CHANGE ROLE] done', req.params.memberId, '->', memberEntry.role);
    return res.json({ ok:true, memberId: memberEntry.user.toString(), role: memberEntry.role });
  } catch (err) {
    console.error('[CHANGE ROLE] error', err);
    next(err);
  }
});

// Check current user's role
app.get('/api/rooms/:roomId/check', requireAuth, async (req, res, next) => {
  try {
    console.log('[HANDLER] GET /api/rooms/:roomId/check', req.params.roomId, 'user=', req.user?.username);
    const room = await Room.findOne({ roomId: req.params.roomId });
    if (!room) {
      console.log('[CHECK ROLE] room not found', req.params.roomId);
      return res.status(404).json({ ok:false, error:'room not found' });
    }
    const memberEntry = room.members.find(m => m.user && m.user.equals(req.user._id));
    if (!memberEntry) return res.json({ ok:true, role: 'none' });
    return res.json({ ok:true, role: memberEntry.role });
  } catch (err) {
    console.error('[CHECK ROLE] error', err);
    next(err);
  }
});

// Force-delete a room (owner-only) - removes room doc and notifies members
app.post('/api/rooms/:roomId/force-delete', requireAuth, async (req, res, next) => {
  try {
    console.log('[HANDLER] FORCE DELETE room', req.params.roomId, 'by', req.user?.username);
    const room = await Room.findOne({ roomId: req.params.roomId });
    if (!room) return res.status(404).json({ ok:false, error:'room not found' });

    const requestingIsOwner = room.owner && room.owner.equals(req.user._id);
    if (!requestingIsOwner) return res.status(403).json({ ok:false, error:'only owner can delete room' });

    // gather member user ids to notify
    const memberUserIds = room.members.map(m => m.user && m.user.toString()).filter(Boolean);

    // delete room
    await Room.deleteOne({ roomId: req.params.roomId });

    // notify all members (including owner) - await each emit
    for (const uid of memberUserIds) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await emitToUser(uid, 'room_deleted', { roomId: req.params.roomId, message: 'Room deleted by owner.' });
      } catch (e) {
        console.warn('emitToUser failed for', uid, e);
      }
    }

    // broadcast on room channel just in case
    io.to(req.params.roomId).emit('room_deleted', { roomId: req.params.roomId, message: 'Room deleted by owner.' });

    return res.json({ ok:true });
  } catch (err) {
    console.error('[FORCE DELETE] error', err);
    next(err);
  }
});

// DEBUG only: inspect room (temporary; remove in production)
app.get('/api/debug/rooms/:roomId', requireAuth, async (req, res, next) => {
  try {
    const room = await Room.findOne({ roomId: req.params.roomId }).populate('members.user', 'username');
    if (!room) return res.status(404).json({ ok:false, error:'not found' });
    return res.json({ ok:true, room });
  } catch (err) { next(err); }
});

// Basic root for quick testing
app.get('/', (req, res) => {
  res.json({ ok: true, msg: 'Auth, rooms & socket API running' });
});

// -------------------- Error handler --------------------
app.use((err, req, res, next) => {
  console.error('=== Uncaught error ===');
  console.error(err && err.stack ? err.stack : err);
  res.status(500).json({ ok:false, error: 'server error', detail: String(err && err.message ? err.message : err) });
});

// -------------------- Start --------------------
const PORT = process.env.PORT;
httpServer.listen(PORT, () => {
  console.log(`Auth & rooms server (with Socket.IO) listening on http://localhost:${PORT}`);
  console.log('Run y-websocket separately for Yjs on port 1234 if you use Yjs for doc sync: npx y-websocket --port 1234');
  console.log('If you see "WebSocket is already in CLOSING or CLOSED state" from y-websocket, check that the Yjs websocket server is running and that your client YWS_URL matches it.');
});
