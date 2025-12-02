// src/pages/RoomPage.jsx
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { io } from 'socket.io-client';
import Sidebar from '../components/Sidebar';

// configure this to point to your backend
const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:4000';

function apiFetch(path, token, options = {}) {
  const headers = Object.assign({
    'Content-Type': 'application/json',
    Authorization: token ? `Bearer ${token}` : undefined
  }, options.headers || {});
  const body = options.body ? JSON.stringify(options.body) : undefined;
  return fetch(`${API_BASE}${path}`, Object.assign({}, options, { headers, body }))
    .then(async res => {
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        const err = new Error(json && json.error ? json.error : `HTTP ${res.status}`);
        err.payload = json;
        throw err;
      }
      return json;
    });
}

export default function RoomPage({ initialRoomId = null, onLogout }) {
  // user session
  const [user, setUser] = useState(() => {
    try { return JSON.parse(localStorage.getItem('user')) || null; }
    catch (e) { return null; }
  });
  const token = user?.token;

  const [socket, setSocket] = useState(null);

  // room state
  const [currentRoom, setCurrentRoom] = useState(null);
  const [files, setFiles] = useState([]);
  const [members, setMembers] = useState([]);
  const [users, setUsers] = useState([]);

  const [roomIdInput, setRoomIdInput] = useState(initialRoomId || '');
  const [roomPassInput, setRoomPassInput] = useState('');
  const [isConnecting, setIsConnecting] = useState(false);
  const [connected, setConnected] = useState(false);
  const [showPass, setShowPass] = useState(false);

  // socket setup
  useEffect(() => {
    if (!token) return;
    const s = io(API_BASE, { query: { token } });
    setSocket(s);

    s.on('connect', () => setConnected(true));
    s.on('disconnect', () => setConnected(false));

    s.on('kicked', (payload) => {
      if (payload?.roomId === currentRoom?.id) {
        alert(payload.message || 'You were kicked.');
        leaveRoom(true);
      }
    });

    s.on('room_deleted', (payload) => {
      if (payload?.roomId === currentRoom?.id) {
        alert(payload.message || 'Room deleted.');
        leaveRoom(true);
      }
    });

    s.on('members_updated', (p) => {
      if (p?.roomId === currentRoom?.id) fetchMembers(currentRoom.id);
    });

    s.on('files_updated', (p) => {
      if (p?.roomId === currentRoom?.id) fetchFiles(currentRoom.id);
    });

    return () => {
      try { s.disconnect(); } catch {}
      setSocket(null);
    };
  }, [token, currentRoom]);

  // fetch helpers
  const fetchMembers = useCallback(async (roomId) => {
    if (!token) return;
    try {
      const json = await apiFetch(`/api/rooms/${roomId}/members`, token);
      setMembers(Array.isArray(json.members) ? json.members : []);
    } catch {}
  }, [token]);

  const fetchFiles = useCallback(async (roomId) => {
    if (!token) return;
    try {
      const json = await apiFetch(`/api/rooms/${roomId}/files`, token);
      setFiles(Array.isArray(json.files) ? json.files : []);
    } catch {}
  }, [token]);

  // join room
  const joinRoom = useCallback(async () => {
    if (!token) return alert('Not signed in');
    if (!roomIdInput || !roomPassInput) return alert('Enter room id & password');

    setIsConnecting(true);
    try {
      const body = { roomId: roomIdInput, password: roomPassInput };
      const json = await apiFetch('/api/rooms/join', token, { method: 'POST', body });

      setCurrentRoom({
        id: roomIdInput,
        pass: roomPassInput,
        ownerId: json.ownerId,
        ownerName: json.ownerName,
        meta: json.meta
      });

      await fetchMembers(roomIdInput);
      await fetchFiles(roomIdInput);

      socket?.emit('subscribeRoom', { roomId: roomIdInput });

      if (json.role === 'pending') {
        alert(json.message || 'Waiting for owner approval.');
      }
    } catch (err) {
      alert(err.payload?.error || err.message);
    } finally {
      setIsConnecting(false);
    }
  }, [token, roomIdInput, roomPassInput, socket]);

  const leaveRoom = useCallback((force = false) => {
    if (socket && currentRoom) socket.emit('unsubscribeRoom', { roomId: currentRoom.id });

    setCurrentRoom(null);
    setFiles([]);
    setMembers([]);

    if (force) {
      setRoomIdInput('');
      setRoomPassInput('');
    }
  }, [socket, currentRoom]);

  // CREATE FILE
  const createFile = useCallback(async (name) => {
    if (!token || !currentRoom) return;
    try {
      await apiFetch(`/api/rooms/${currentRoom.id}/files`, token, {
        method: 'POST',
        body: { name }
      });
      await fetchFiles(currentRoom.id);
    } catch {
      alert('Failed to create file');
    }
  }, [token, currentRoom]);

  // 🔥 DELETE FILE (new)
  const deleteFile = useCallback(async (fileId) => {
    if (!token || !currentRoom) return;
    try {
      await apiFetch(
        `/api/rooms/${currentRoom.id}/files/${fileId}`,
        token,
        { method: 'DELETE' }
      );
      await fetchFiles(currentRoom.id);
    } catch (err) {
      alert(err.payload?.error || 'Failed to delete file');
    }
  }, [token, currentRoom]);

  // change member role
  const changeMemberRole = useCallback(async (memberId, role) => {
    if (!token || !currentRoom) return;
    try {
      await apiFetch(`/api/rooms/${currentRoom.id}/members/${memberId}/role`, token, {
        method: 'POST',
        body: { role }
      });
      await fetchMembers(currentRoom.id);
    } catch {
      alert('Failed to change role');
    }
  }, [token, currentRoom]);

  // approvals
  const approveMemberRequest = useCallback(async (id) => {
    await apiFetch(`/api/rooms/${currentRoom.id}/members/${id}/approve`, token, { method: 'POST' });
    await fetchMembers(currentRoom.id);
  }, [token, currentRoom]);

  const rejectMemberRequest = useCallback(async (id) => {
    await apiFetch(`/api/rooms/${currentRoom.id}/members/${id}/reject`, token, { method: 'POST' });
    await fetchMembers(currentRoom.id);
  }, [token, currentRoom]);

  const kickMember = useCallback(async (id) => {
    await apiFetch(`/api/rooms/${currentRoom.id}/members/${id}/kick`, token, { method: 'POST' });
    await fetchMembers(currentRoom.id);
  }, [token, currentRoom]);

  const forceDeleteRoom = useCallback(async (roomId) => {
    await apiFetch(`/api/rooms/${roomId}/force-delete`, token, { method: 'POST' });
    if (currentRoom?.id === roomId) leaveRoom(true);
  }, [token, currentRoom]);

  // merge helpers
  const mergeServerMembersIntoY = useCallback(async (roomId) => fetchMembers(roomId), [fetchMembers]);
  const mergeServerFilesIntoY = useCallback(async (roomId) => fetchFiles(roomId), [fetchFiles]);

  // open file
  const openFile = useCallback((file) => {
    console.log('[OPEN FILE]', file);
  }, []);

  // auto subscribe after joining
  useEffect(() => {
    if (!socket || !currentRoom) return;
    socket.emit('subscribeRoom', { roomId: currentRoom.id });
    fetchMembers(currentRoom.id);
    fetchFiles(currentRoom.id);
  }, [socket, currentRoom]);

  // sidebar props
  const sidebarProps = useMemo(() => ({
    currentUser: user ? { id: user.id, username: user.username } : null,
    isOwner: currentRoom && user && currentRoom.ownerId === user.id,
    roomIdInput,
    setRoomIdInput,
    roomPassInput,
    setRoomPassInput,
    currentRoom,

    createRoom: async () => {
      try {
        const json = await apiFetch('/api/rooms', token, { method: 'POST', body: {} });
        setCurrentRoom({ id: json.roomId, pass: json.password, ownerId: json.ownerId });
        setRoomIdInput(json.roomId);
        setRoomPassInput(json.password);
        await fetchMembers(json.roomId);
        await fetchFiles(json.roomId);
        socket?.emit('subscribeRoom', { roomId: json.roomId });
        alert(`Room created: ${json.roomId}`);
      } catch {
        alert('Failed to create room');
      }
    },

    joinRoom,
    leaveRoom,
    showPass,
    setShowPass,

    files,
    createFile,
    deleteFile,   // 🔥 added
    openFile,

    users,
    members,
    changeMemberRole,
    connected,
    isConnecting,
    mergeServerMembersIntoY,
    mergeServerFilesIntoY,
    approveMemberRequest,
    rejectMemberRequest,
    kickMember,
    forceDeleteRoom,

    pendingMembers: null,
    socket
  }), [
    user, roomIdInput, roomPassInput, currentRoom, files, members, users,
    joinRoom, leaveRoom, createFile, deleteFile, openFile,
    changeMemberRole, approveMemberRequest, rejectMemberRequest, kickMember,
    forceDeleteRoom, mergeServerMembersIntoY, mergeServerFilesIntoY,
    connected, isConnecting, showPass, setShowPass, socket, token
  ]);

  return (
    <div style={{ display: 'flex', height: '100vh' }}>
      <Sidebar {...sidebarProps} />

      <main style={{ flex: 1, padding: 16 }}>
        <h2 style={{ color: '#9fb0d6' }}>
          {currentRoom ? `room-${currentRoom.id}` : 'No room selected'}
        </h2>
        <p style={{ color: '#9fb0d6' }}>Files: {files.length}</p>
        <p style={{ color: '#9fb0d6' }}>Members: {members.length}</p>

        <div style={{ position: 'absolute', top: 10, right: 10 }}>
          <button onClick={() => {
            localStorage.removeItem('user');
            setUser(null);
            onLogout?.();
          }}>Logout</button>
        </div>
      </main>
    </div>
  );
}
