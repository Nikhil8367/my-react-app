// src/components/LiveCodeApp.jsx
import React, { useEffect, useRef, useState } from 'react';
import Editor, { loader } from '@monaco-editor/react';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { MonacoBinding } from 'y-monaco';
import { io } from 'socket.io-client';
import '../App.css';

import Sidebar from './Sidebar';
import EditorPanel from './EditorPanel';
import ChatWidget from './ChatWidget';
import Login from './Login'; // new

// Monaco worker blob config
loader.config({
  getWorkerUrl: function () {
    return URL.createObjectURL(new Blob([
      'self.MonacoEnvironment = { baseUrl: "./" }; onmessage = function(){};'
    ], { type: 'text/javascript' }));
  }
});

export default function LiveCodeApp() {
  // Auth & basic state (signin UI moved to Login.jsx)
  const [authenticated, setAuthenticated] = useState(false);
  const [currentUser, setCurrentUser] = useState(() => {
    const s = localStorage.getItem('lc_current_user');
    return s ? JSON.parse(s) : null;
  });

  const [roomIdInput, setRoomIdInput] = useState('');
  const [roomPassInput, setRoomPassInput] = useState('');
  const [currentRoom, setCurrentRoom] = useState(() => {
    const s = localStorage.getItem('lc_room');
    return s ? JSON.parse(s) : null;
  });
  const [language, setLanguage] = useState(localStorage.getItem('lc_language') || 'javascript');

  const [status, setStatus] = useState('idle');
  const [users, setUsers] = useState([]);
  const [connected, setConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);

  const [showPass, setShowPass] = useState(false);

  const [files, setFiles] = useState([]);
  const [activeFile, setActiveFile] = useState(() => {
    const s = localStorage.getItem('lc_active_file');
    return s ? JSON.parse(s) : null;
  });
  const [members, setMembers] = useState([]);
  const [role, setRole] = useState('none');

  // Chat & Y refs
  const chatArrayRef = useRef(null);
  const chatObserverRef = useRef(null);

  // Keep two Yjs stacks:
  // - roomMetaYdoc + roomMetaProvider (persistent while in room)
  // - fileYdoc + fileProvider (created/destroyed when opening/closing a file)
  const roomMetaYdocRef = useRef(null);
  const roomMetaProviderRef = useRef(null);

  const fileYdocRef = useRef(null);
  const fileProviderRef = useRef(null);
  const bindingRef = useRef(null);
  const editorRef = useRef(null);
  const awarenessRef = useRef(null);

  const API_BASE = import.meta.env.VITE_BACKEND_URL;
  const YWS_URL = import.meta.env.VITE_YWS_URL;

  // Socket.io
  const socketRef = useRef(null);
  const subscribedRoomsRef = useRef(new Set());

  // Chat state (missing previously)
  const [chatMessages, setChatMessages] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [showChatPanel, setShowChatPanel] = useState(false);

  // debug
  console.log('DEBUG: API_BASE =', API_BASE, 'YWS_URL =', YWS_URL);

  // on mount: silent rejoin if stored
  useEffect(() => {
    if (currentUser) setAuthenticated(true);
    if (currentUser && currentRoom) {
      silentRejoin(currentRoom.id, currentRoom.pass).catch(err => {
        console.warn('silentRejoin failed', err);
        setStatus('reconnect failed');
      });
    }
    // cleanup: destroy docs/providers and socket
    return () => {
      try {
        destroyFileProvider();
        destroyRoomMetaProvider();
        if (socketRef.current) try { socketRef.current.disconnect(); } catch (e) {}
      } catch (e) { console.warn('cleanup err', e); }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Create socket when signed in (but do NOT attach duplicate handlers handled in Sidebar)
  useEffect(() => {
    if (!currentUser) return;
    const s = io(API_BASE, { query: { token: currentUser.token } });
    socketRef.current = s;

    s.on('connect', () => console.log('[SOCKET] connected', s.id));
    s.on('disconnect', (r) => console.log('[SOCKET] disconnected', r));

    // Keep lightweight handlers (files_updated/members_updated) to trigger refresh,
    // but do NOT show UI alerts here — Sidebar will handle user-facing alerts.
    s.on('members_updated', (p) => {
      try {
        if (p && p.roomId && currentRoom && p.roomId === currentRoom.id) {
          mergeServerMembersIntoY(currentRoom.id).catch(() => {});
          refreshMembers(currentRoom.id).catch(() => {});
        }
      } catch (e) { console.error('members_updated handler', e); }
    });
    s.on('files_updated', (p) => {
      try {
        if (p && p.roomId && currentRoom && p.roomId === currentRoom.id) {
          mergeServerFilesIntoY(currentRoom.id).catch(() => {});
          refreshFiles(currentRoom.id).catch(() => {});
        }
      } catch (e) { console.error('files_updated handler', e); }
    });

    return () => {
      try { s.disconnect(); } catch (e) {}
      socketRef.current = null;
      subscribedRoomsRef.current.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser, currentRoom]);

  // small helpers
  function uidShort() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID().slice(0, 8);
    return Math.random().toString(36).slice(2, 9);
  }
  function colorForName(name) {
    let h = 0;
    for (let i = 0; i < name.length; i++) h = (h << 5) - h + name.charCodeAt(i);
    const hue = Math.abs(h) % 360;
    return `hsl(${hue} 70% 60%)`;
  }
  function isOwner() {
    const ownerId = currentRoom && currentRoom.ownerId;
    return ownerId && currentUser && ownerId === currentUser.id;
  }

  // ROOM create/join/leave — mostly same, but ensures roomMeta provider is used
  async function createRoom() {
    if (!currentUser) return setStatus('Sign in first');
    try {
      setStatus('creating room…');
      const res = await fetch(`${API_BASE}/api/rooms`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${currentUser.token}`
        },
        body: JSON.stringify({ meta: { language } })
      });
      const text = await res.text().catch(() => '');
      if (!res.ok) {
        setStatus('create failed: ' + (text || res.status));
        return;
      }
      const json = JSON.parse(text);
      const roomObj = { id: json.roomId, pass: json.password || '', ownerId: json.ownerId };
      localStorage.setItem('lc_room', JSON.stringify(roomObj));
      setRoomIdInput(json.roomId);
      setRoomPassInput(json.password || '');
      setCurrentRoom(roomObj);
      setFiles(json.files || []);
      setShowPass(true);
      setStatus('room created — joining…');

      setTimeout(() => joinRoom(json.roomId, json.password || ''), 120);
    } catch (err) {
      console.error(err);
      setStatus('create error');
    }
  }

  async function joinRoom(roomId, pass) {
    return joinRoomImpl(roomId, pass, false);
  }

  async function silentRejoin(roomId, pass) {
    return joinRoomImpl(roomId, pass, true);
  }

  async function joinRoomImpl(roomId, pass, silent = false) {
    if (!currentUser) {
      if (!silent) alert('Sign in first');
      return;
    }
    if (!roomId || !pass) {
      if (!silent) alert('Room id & password required');
      return;
    }
    try {
      setStatus('verifying room…');
      setIsConnecting(true);
      const res = await fetch(`${API_BASE}/api/rooms/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${currentUser.token}` },
        body: JSON.stringify({ roomId, password: pass })
      });
      const text = await res.text().catch(()=>'');
      if (!res.ok) {
        if (!silent) alert('Join failed: ' + (text || res.status));
        setStatus('join failed');
        setIsConnecting(false);
        return;
      }
      const json = JSON.parse(text);

      const roomObj = { id: roomId, pass: pass || '', ownerId: json.ownerId };
      localStorage.setItem('lc_room', JSON.stringify(roomObj));
      setCurrentRoom(roomObj);
      setFiles(json.files || []);
      setStatus('connected to room — connecting realtime…');

      // IMPORTANT: connect to persistent room-meta provider (chat, members, files)
      await ensureRoomMetaProvider(roomId);

      // refresh role
      const myRole = await refreshRole(roomId);
      setRole(myRole);

      // write self into room-meta Y map (non-authoritative)
      try {
        const roomMap = roomMetaYdocRef.current.getMap('room_meta');
        const curMembers = roomMap.get('members') || {};
        curMembers[currentUser.id] = { username: currentUser.username, role: myRole || 'member' };
        roomMap.set('members', curMembers);
      } catch (e) { console.warn('write member to roomMap failed', e); }

      // fetch/merge authoritative server lists
      await mergeServerMembersIntoY(roomId);
      await mergeServerFilesIntoY(roomId);

      await refreshMembers(roomId);
      await refreshFiles(roomId);

      setStatus('connected');
      setIsConnecting(false);

      // subscribe socket.io room
      if (socketRef.current && !subscribedRoomsRef.current.has(roomId)) {
        socketRef.current.emit('subscribeRoom', { roomId });
        subscribedRoomsRef.current.add(roomId);
      }

      // re-open active file if allowed
      const savedActive = localStorage.getItem('lc_active_file');
      if (savedActive) {
        try {
          const a = JSON.parse(savedActive);
          if (a && a.roomId === roomId) {
            if (userCanAccessFile(a.fileId) || role === 'owner' || role === 'editor') {
              openFile({ fileId: a.fileId, name: a.name, createdAt: a.createdAt });
            } else {
              localStorage.removeItem('lc_active_file');
            }
          }
        } catch (e) {}
      }
    } catch (err) {
      console.error(err);
      if (!silent) setStatus('join error');
      setIsConnecting(false);
    }
  }

  // Ensure that a persistent room-meta Y.Doc + provider exist for this room.
  async function ensureRoomMetaProvider(roomId) {
    // if already created for same room, return
    const existing = roomMetaProviderRef.current;
    const expectedDocName = `${encodeURIComponent(roomId)}__roommeta`;
    if (existing && roomMetaYdocRef.current && existing.docName === expectedDocName) return;

    // destroy any previous room-meta provider (if switching rooms)
    await destroyRoomMetaProvider();

    const safeRoom = encodeURIComponent(roomId);
    const docName = `${safeRoom}__roommeta`;
    const ydoc = new Y.Doc();
    const provider = new WebsocketProvider(YWS_URL, docName, ydoc, { connect: true });

    // store references
    roomMetaYdocRef.current = ydoc;
    roomMetaProviderRef.current = provider;

    // set up map, chat and observers (same logic as before, but now persistent)
    const roomMap = ydoc.getMap('room_meta');
    if (!roomMap.has('members')) roomMap.set('members', {});
    if (!roomMap.has('files')) roomMap.set('files', {});

    // initialize state
    const curMembers = roomMap.get('members') || {};
    const curFiles = roomMap.get('files') || {};
    setMembers(Object.keys(curMembers).map(k => ({ id: k, username: curMembers[k].username, role: curMembers[k].role })));
    setFiles(Object.keys(curFiles).map(fid => ({ fileId: fid, name: curFiles[fid].name, createdAt: curFiles[fid].createdAt, allowed: curFiles[fid].allowed || {} })));

    // observe changes
    roomMap.observe(() => {
      try {
        const membersObj = roomMap.get('members') || {};
        const filesObj = roomMap.get('files') || {};
        setMembers(Object.keys(membersObj).map(k => ({ id: k, username: membersObj[k].username, role: membersObj[k].role })));
        setFiles(Object.keys(filesObj).map(fid => ({ fileId: fid, name: filesObj[fid].name, createdAt: filesObj[fid].createdAt, allowed: filesObj[fid].allowed || {} })));
      } catch (e) { console.error('roomMap.observe err', e); }
    });

    // chat: keep chatArrayRef connected to roomMeta ydoc ALWAYS
    try {
      const chatArr = ydoc.getArray ? ydoc.getArray('chat') : (ydoc.get ? ydoc.get('chat') : null);
      chatArrayRef.current = chatArr;
      if (chatArrayRef.current && typeof chatArrayRef.current.toArray === 'function') {
        setChatMessages(chatArrayRef.current.toArray());
      } else {
        setChatMessages([]);
      }

      const chatObserver = () => {
        try {
          const arr = (chatArrayRef.current && typeof chatArrayRef.current.toArray === 'function') ? chatArrayRef.current.toArray() : [];
          setChatMessages(arr);
          const last = arr[arr.length - 1];
          if (last && currentUser && last.senderId !== currentUser.id && !showChatPanel) {
            setUnreadCount(c => c + 1);
          }
        } catch (e) { console.error('chat observe err', e); }
      };

      if (chatArrayRef.current && typeof chatArrayRef.current.observe === 'function') {
        try { if (chatObserverRef.current) chatArrayRef.current.unobserve(chatObserverRef.current); } catch (e) {}
        chatArrayRef.current.observe(chatObserver);
        chatObserverRef.current = chatObserver;
      } else {
        chatObserverRef.current = null;
      }
    } catch (e) {
      console.warn('chat init failed', e);
      chatArrayRef.current = null;
      chatObserverRef.current = null;
    }

    // provider events
    provider.on('status', (evt) => {
      setStatus('realtime: ' + evt.status + ' (room-meta)');
      setConnected(evt.status === 'connected');
    });

    // awareness for room-meta (we'll reuse awareness for file provider too if needed)
    awarenessRef.current = provider.awareness;
    awarenessRef.current.setLocalStateField('user', {
      id: currentUser.id,
      name: currentUser.username,
      color: colorForName(currentUser.username),
      short: uidShort()
    });

    // store docName for quick equality check (some provider impls expose it, but we set it explicitly)
    try { provider.docName = docName; } catch (e) {}
  }

  // destroy room-meta provider and ydoc
  async function destroyRoomMetaProvider() {
    try {
      if (roomMetaProviderRef.current) {
        try { roomMetaProviderRef.current.disconnect(); } catch (e) {}
        try { roomMetaProviderRef.current.destroy(); } catch (e) {}
        roomMetaProviderRef.current = null;
      }
      if (roomMetaYdocRef.current) {
        try { roomMetaYdocRef.current.destroy(); } catch (e) {}
        roomMetaYdocRef.current = null;
      }
      // cleanup chat refs
      try {
        if (chatArrayRef.current && chatObserverRef.current && typeof chatArrayRef.current.unobserve === 'function') {
          chatArrayRef.current.unobserve(chatObserverRef.current);
        }
      } catch (e) {}
      chatArrayRef.current = null;
      chatObserverRef.current = null;
      setChatMessages([]);
      setUnreadCount(0);
    } catch (e) { console.warn('destroyRoomMetaProvider err', e); }
  }

  // create file provider for an individual file doc (separate from room-meta)
  async function createFileProvider(roomId, fileId, editable = true) {
    // destroy existing file provider first
    await destroyFileProvider();

    const safeRoom = encodeURIComponent(roomId);
    const safeFile = encodeURIComponent(fileId);
    const docName = `${safeRoom}__file__${safeFile}`;

    const ydoc = new Y.Doc();
    const provider = new WebsocketProvider(YWS_URL, docName, ydoc, { connect: true });

    fileYdocRef.current = ydoc;
    fileProviderRef.current = provider;

    // bind monaco text if editor exists
    const ytext = ydoc.getText('codetext');
    if (editorRef.current) bindMonacoWithY(ytext, editorRef.current, editable);

    // use awareness from room-meta provider if available so presence remains consistent
    if (roomMetaProviderRef.current && roomMetaProviderRef.current.awareness) {
      try {
        // sync awareness states across providers by reusing the same local state
        provider.awareness.setLocalState(roomMetaProviderRef.current.awareness.getLocalState());
      } catch (e) {}
    } else {
      // set local awareness on file provider
      provider.awareness.setLocalStateField('user', {
        id: currentUser.id,
        name: currentUser.username,
        color: colorForName(currentUser.username),
        short: uidShort()
      });
    }

    provider.on('status', (evt) => {
      setStatus('realtime: ' + evt.status + ` • file ${fileId}`);
      setConnected(evt.status === 'connected');
    });

    // store docName for potential checks
    try { provider.docName = docName; } catch (e) {}
  }

  async function destroyFileProvider() {
    try {
      if (bindingRef.current) { try { bindingRef.current.destroy(); } catch (e) {} bindingRef.current = null; }
      if (fileProviderRef.current) {
        try { fileProviderRef.current.disconnect(); } catch (e) {}
        try { fileProviderRef.current.destroy(); } catch (e) {}
        fileProviderRef.current = null;
      }
      if (fileYdocRef.current) {
        try { fileYdocRef.current.destroy(); } catch (e) {}
        fileYdocRef.current = null;
      }
      // clear awareness users list
      setUsers([]);
    } catch (e) { console.warn('destroyFileProvider err', e); }
  }

  function bindMonacoWithY(yText, monacoEditorInstance, editable = true) {
    if (!monacoEditorInstance) return;
    try {
      const model = monacoEditorInstance.getModel();
      if (!model) return;
      if (bindingRef.current) {
        try { bindingRef.current.destroy(); } catch (e) {}
        bindingRef.current = null;
      }
      const binding = new MonacoBinding(yText, model, new Set([monacoEditorInstance]), (fileProviderRef.current || roomMetaProviderRef.current).awareness);
      bindingRef.current = binding;
      monacoEditorInstance.updateOptions({ readOnly: !editable });
    } catch (e) { console.error('bind error', e); }
  }

  function handleEditorMount(editor, monaco) {
    try {
      monaco.editor.defineTheme('vs-black', {
        base: 'vs-dark',
        inherit: true,
        rules: [],
        colors: { 'editor.background': '#000000', 'editor.lineHighlightBackground': '#111111' }
      });
      monaco.editor.setTheme('vs-black');
    } catch (e) {}
    editorRef.current = editor;
    // if a file provider exists, bind to it; otherwise we will bind when file provider is created
    if (fileYdocRef.current) {
      try {
        const yText = fileYdocRef.current.getText('codetext');
        bindMonacoWithY(yText, editor, role === 'owner' || role === 'editor');
      } catch (e) { console.warn('handleEditorMount bind failed', e); }
    }
    editor.updateOptions({ minimap: { enabled: false }, fontSize: 14 });
  }

  // refresh role, members, files same as before (use server fallbacks)
  async function refreshRole(roomId) {
    try {
      const res = await fetch(`${API_BASE}/api/rooms/${roomId}/check`, {
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${currentUser.token}` }
      });
      const text = await res.text().catch(()=>'');
      if (!res.ok) {
        setRole('none');
        return 'none';
      }
      const j = JSON.parse(text);
      if (j && j.ok) {
        setRole(j.role || 'none');
        return j.role || 'none';
      }
    } catch (e) { console.error(e); }
    setRole('none');
    return 'none';
  }

  async function refreshMembers(roomId) {
    try {
      const roomMap = roomMetaYdocRef.current ? roomMetaYdocRef.current.getMap('room_meta') : null;
      if (roomMap && roomMap.get('members')) {
        const raw = roomMap.get('members') || {};
        const arr = Object.keys(raw).map(id => ({ id, username: raw[id].username, role: raw[id].role }));
        setMembers(arr);
        return;
      }
      const res = await fetch(`${API_BASE}/api/rooms/${roomId}/members`, {
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${currentUser.token}` }
      });
      const text = await res.text().catch(()=>'');
      if (!res.ok) { console.warn('refreshMembers failed', res.status, text); setMembers([]); return; }
      const j = JSON.parse(text);
      if (j && j.ok) {
        setMembers(j.members || []);
        if (roomMetaYdocRef.current) {
          const mapObj = {};
          (j.members || []).forEach(m => { mapObj[m.id] = { username: m.username, role: m.role }; });
          roomMetaYdocRef.current.getMap('room_meta').set('members', mapObj);
        }
      } else setMembers([]);
    } catch (e) { console.error(e); setMembers([]); }
  }

  async function refreshFiles(roomId) {
    try {
      const roomMap = roomMetaYdocRef.current ? roomMetaYdocRef.current.getMap('room_meta') : null;
      if (roomMap && roomMap.get('files')) {
        const raw = roomMap.get('files') || {};
        const arr = Object.keys(raw).map(fid => ({
          fileId: fid,
          name: raw[fid].name,
          createdAt: raw[fid].createdAt,
          allowed: raw[fid].allowed || {}
        }));
        setFiles(arr);
        return;
      }
      const res = await fetch(`${API_BASE}/api/rooms/${roomId}/files`, {
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${currentUser.token}` }
      });
      const text = await res.text().catch(()=>'');
      if (!res.ok) { console.warn('refreshFiles failed', res.status, text); setFiles([]); return; }
      const j = JSON.parse(text);
      if (j && j.ok) {
        setFiles(j.files || []);
        if (roomMetaYdocRef.current) {
          const mapObj = {};
          (j.files || []).forEach(f => { mapObj[f.fileId] = { name: f.name, createdAt: f.createdAt || new Date().toISOString(), allowed: f.allowed || {} }; });
          roomMetaYdocRef.current.getMap('room_meta').set('files', mapObj);
        }
      } else setFiles([]);
    } catch (e) { console.error(e); setFiles([]); }
  }

  async function mergeServerMembersIntoY(roomId) {
    try {
      const res = await fetch(`${API_BASE}/api/rooms/${roomId}/members`, {
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${currentUser.token}` }
      });
      const text = await res.text().catch(()=>'');
      if (!res.ok) return;
      const j = JSON.parse(text);
      if (!(j && j.ok)) return;
      const serverMembers = j.members || [];
      const roomMap = roomMetaYdocRef.current ? roomMetaYdocRef.current.getMap('room_meta') : null;
      if (!roomMap) return;
      const current = roomMap.get('members') || {};
      let changed = false;
      (serverMembers || []).forEach(m => {
        if (!current[m.id] || current[m.id].role !== m.role || current[m.id].username !== m.username) {
          current[m.id] = { username: m.username, role: m.role };
          changed = true;
        }
      });
      if (changed) roomMap.set('members', current);
    } catch (e) { console.error('mergeServerMembersIntoY', e); }
  }

  async function mergeServerFilesIntoY(roomId) {
    try {
      const res = await fetch(`${API_BASE}/api/rooms/${roomId}/files`, {
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${currentUser.token}` }
      });
      const text = await res.text().catch(()=>'');
      if (!res.ok) return;
      const j = JSON.parse(text);
      if (!(j && j.ok)) return;
      const serverFiles = j.files || [];
      const roomMap = roomMetaYdocRef.current ? roomMetaYdocRef.current.getMap('room_meta') : null;
      if (!roomMap) return;
      const current = roomMap.get('files') || {};
      let changed = false;
      (serverFiles || []).forEach(f => {
        const existing = current[f.fileId] || {};
        const existingAllowed = existing.allowed || {};
        const serverAllowed = f.allowed || {};
        if (!current[f.fileId] || current[f.fileId].name !== f.name || JSON.stringify(existingAllowed) !== JSON.stringify(serverAllowed)) {
          current[f.fileId] = {
            name: f.name,
            createdAt: f.createdAt || new Date().toISOString(),
            allowed: Object.keys(serverAllowed).length ? serverAllowed : existingAllowed
          };
          changed = true;
        }
      });
      if (changed) roomMap.set('files', current);
    } catch (e) { console.error('mergeServerFilesIntoY', e); }
  }

  // create file server + update room-meta
  async function createFile(name) {
    if (!currentRoom) return alert('Join a room first');
    try {
      const res = await fetch(`${API_BASE}/api/rooms/${currentRoom.id}/files`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${currentUser.token}` },
        body: JSON.stringify({ name })
      });
      const text = await res.text().catch(()=>'');
      if (!res.ok) {
        alert('create file failed: ' + (text || res.status));
        return;
      }
      const json = JSON.parse(text);
      if (json && json.ok) {
        const roomMap = roomMetaYdocRef.current ? roomMetaYdocRef.current.getMap('room_meta') : null;
        if (roomMap) {
          const cur = roomMap.get('files') || {};
          cur[json.file.fileId] = {
            name: json.file.name,
            createdAt: json.file.createdAt || new Date().toISOString(),
            allowed: { [currentUser.id]: true }
          };
          roomMap.set('files', cur);
        } else {
          setFiles(prev => [...prev, json.file]);
        }
        openFile(json.file);
      } else {
        alert('create file failed: ' + (json?.error || 'unknown'));
      }
    } catch (e) { console.error(e); alert('create file error'); }
  }

  // delete file (new) — only owner/editor allowed on server; client-side updates Y map + local state
  async function deleteFile(fileId) {
    if (!currentRoom) return alert('Join a room first');
    if (!fileId) return;
    // quick confirmation
    if (!confirm('Delete this file? This action cannot be undone.')) return;

    try {
      setStatus('deleting file…');
      const res = await fetch(`${API_BASE}/api/rooms/${encodeURIComponent(currentRoom.id)}/files/${encodeURIComponent(fileId)}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${currentUser.token}` }
      });
      const text = await res.text().catch(()=>'');
      if (!res.ok) {
        setStatus('delete failed');
        alert('delete failed: ' + (text || res.status));
        return;
      }

      const j = JSON.parse(text || '{}');
      // server responded OK — now remove from room-meta Y map so all clients update
      try {
        const roomMap = roomMetaYdocRef.current ? roomMetaYdocRef.current.getMap('room_meta') : null;
        if (roomMap) {
          const filesObj = roomMap.get('files') || {};
          if (filesObj[fileId]) delete filesObj[fileId];
          roomMap.set('files', filesObj);
        }
      } catch (e) { console.warn('remove file from ymap failed', e); }

      // if this file is currently open, close it
      if (activeFile && activeFile.fileId === fileId) {
        await destroyFileProvider();
        setActiveFile(null);
        localStorage.removeItem('lc_active_file');
      }

      setStatus('file deleted');

      // ask server to broadcast files_updated (if server doesn't already)
      try {
        if (socketRef.current) socketRef.current.emit('files_changed', { roomId: currentRoom.id });
      } catch (e) {}

      // refresh local copy
      await refreshFiles(currentRoom.id).catch(()=>{});
    } catch (e) {
      console.error('deleteFile err', e);
      setStatus('delete error');
      alert('delete error');
    }
  }

  // grant/revoke file access same as before but update room-meta Y map
  async function grantFileAccess(fileId, userId) {
    if (!currentRoom) return alert('Join a room first');
    if (!isOwner()) return alert('Only owner can grant access');
    try {
      const res = await fetch(`${API_BASE}/api/rooms/${currentRoom.id}/files/${fileId}/grant`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${currentUser.token}` },
        body: JSON.stringify({ userId })
      });
      const text = await res.text().catch(()=>'');
      if (!res.ok) { alert('grant failed: ' + (text || res.status)); return; }
      const roomMap = roomMetaYdocRef.current ? roomMetaYdocRef.current.getMap('room_meta') : null;
      if (!roomMap) return;
      const cur = roomMap.get('files') || {};
      const meta = cur[fileId] || {};
      meta.allowed = meta.allowed || {};
      meta.allowed[userId] = true;
      cur[fileId] = meta;
      roomMap.set('files', cur);
      setStatus('Granted access');
    } catch (e) { console.error(e); alert('grant error'); }
  }

  async function revokeFileAccess(fileId, userId) {
    if (!currentRoom) return alert('Join a room first');
    if (!isOwner()) return alert('Only owner can revoke access');
    try {
      const res = await fetch(`${API_BASE}/api/rooms/${currentRoom.id}/files/${fileId}/revoke`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${currentUser.token}` },
        body: JSON.stringify({ userId })
      });
      const text = await res.text().catch(()=>'');
      if (!res.ok) { alert('revoke failed: ' + (text || res.status)); return; }
      const roomMap = roomMetaYdocRef.current ? roomMetaYdocRef.current.getMap('room_meta') : null;
      if (!roomMap) return;
      const cur = roomMap.get('files') || {};
      const meta = cur[fileId] || {};
      if (meta.allowed && typeof meta.allowed === 'object') delete meta.allowed[userId];
      else if (Array.isArray(meta.allowed)) meta.allowed = meta.allowed.filter(u => u !== userId);
      cur[fileId] = meta;
      roomMap.set('files', cur);
      setStatus('Revoked access');
    } catch (e) { console.error(e); alert('revoke error'); }
  }

  // openFile: create file provider, but keep room-meta alive (chat not lost)
  async function openFile(file) {
    if (!currentRoom) return alert('no room');
    const userRole = await refreshRole(currentRoom.id);
    if (!(userRole === 'owner' || userRole === 'editor')) {
      const allowed = userCanAccessFile(file.fileId);
      if (!allowed) {
        alert('You do not have access to this file. Ask the owner to grant you permission.');
        return;
      }
    }
    setActiveFile(file);
    localStorage.setItem('lc_active_file', JSON.stringify({ roomId: currentRoom.id, fileId: file.fileId, name: file.name, createdAt: file.createdAt }));

    // create a separate file provider/doc and bind Monaco to it
    await createFileProvider(currentRoom.id, file.fileId, userRole === 'owner' || userRole === 'editor');
  }

  // close file (destroy file provider but keep room-meta)
  async function closeFile() {
    await destroyFileProvider();
    setActiveFile(null);
    localStorage.removeItem('lc_active_file');
  }

  // changeMemberRole same as before
  async function changeMemberRole(memberId, newRole) {
    if (!currentRoom) return;
    try {
      const res = await fetch(`${API_BASE}/api/rooms/${currentRoom.id}/members/${memberId}/role`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${currentUser.token}` },
        body: JSON.stringify({ role: newRole })
      });
      const text = await res.text().catch(()=>'');
      if (!res.ok) {
        alert('role update failed: ' + (text || res.status));
        return;
      }
      const j = JSON.parse(text);
      if (j && j.ok) {
        setStatus(`Role updated: ${j.role}`);
        try {
          const roomMap = roomMetaYdocRef.current ? roomMetaYdocRef.current.getMap('room_meta') : null;
          if (roomMap) {
            const cur = roomMap.get('members') || {};
            if (cur[memberId]) cur[memberId].role = j.role;
            else cur[memberId] = { username: (members.find(m => m.id === memberId) || {}).username || '(user)', role: j.role };
            roomMap.set('members', cur);
          } else {
            await refreshMembers(currentRoom.id);
          }
        } catch (e) { console.error('changeMemberRole ymap update failed', e); }
        await refreshRole(currentRoom.id);
      } else {
        alert('role update failed: ' + (j?.error || 'unknown'));
      }
    } catch (e) { console.error(e); alert('role update error'); }
  }

  // Approve / Reject / Kick / Force-delete: keep same server calls and refresh joiners etc.
  async function approveMemberRequest(memberId) {
    if (!currentRoom) throw new Error('not ready');
    const res = await fetch(`${API_BASE}/api/rooms/${encodeURIComponent(currentRoom.id)}/members/${memberId}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${currentUser.token}` }
    });
    const text = await res.text().catch(()=>'');
    if (!res.ok) throw new Error(text || `HTTP ${res.status}`);
    await mergeServerMembersIntoY(currentRoom.id);
    await refreshMembers(currentRoom.id);
  }

  async function rejectMemberRequest(memberId) {
    if (!currentRoom) throw new Error('not ready');
    const res = await fetch(`${API_BASE}/api/rooms/${encodeURIComponent(currentRoom.id)}/members/${memberId}/reject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${currentUser.token}` }
    });
    const text = await res.text().catch(()=>'');
    if (!res.ok) throw new Error(text || `HTTP ${res.status}`);
    await mergeServerMembersIntoY(currentRoom.id);
    await refreshMembers(currentRoom.id);
  }

  async function kickMember(memberId) {
    if (!currentRoom) throw new Error('not ready');
    const res = await fetch(`${API_BASE}/api/rooms/${encodeURIComponent(currentRoom.id)}/members/${memberId}/kick`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${currentUser.token}` }
    });
    const text = await res.text().catch(()=>'');
    if (!res.ok) throw new Error(text || `HTTP ${res.status}`);
    await mergeServerMembersIntoY(currentRoom.id);
    await refreshMembers(currentRoom.id);
  }

  async function forceDeleteRoom(roomId) {
    if (!roomId) throw new Error('roomId required');
    const res = await fetch(`${API_BASE}/api/rooms/${encodeURIComponent(roomId)}/force-delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${currentUser.token}` }
    });
    const text = await res.text().catch(()=>'');
    if (!res.ok) throw new Error(text || `HTTP ${res.status}`);
    if (currentRoom && currentRoom.id === roomId) await leaveRoom(true);
  }

  // leaveRoom: destroy file provider, but keep room-meta if soft leave; if force clear, destroy room-meta
  async function leaveRoom(clearStored = false) {
    try {
      await destroyFileProvider();
      if (clearStored) {
        // when forgetting fully, remove room-meta provider too
        await destroyRoomMetaProvider();
      }
    } catch (e) { console.warn('leaveRoom cleanup error', e); }
    finally {
      setConnected(false);
      setUsers([]);
      setStatus('left room');

      // clear chat state if full clear
      if (clearStored) {
        chatArrayRef.current = null;
        chatObserverRef.current = null;
        setChatMessages([]);
        setUnreadCount(0);
        setShowChatPanel(false);
        localStorage.removeItem('lc_room');
        localStorage.removeItem('lc_active_file');
        setCurrentRoom(null);
        setActiveFile(null);
        setFiles([]);
        setMembers([]);
        setRole('none');
        setShowPass(false);
      } else {
        setActiveFile(null);
        setFiles([]);
        setMembers([]);
        setRole('none');
      }

      // unsubscribe socket room
      try {
        if (socketRef.current && currentRoom && currentRoom.id && subscribedRoomsRef.current.has(currentRoom.id)) {
          socketRef.current.emit('unsubscribeRoom', { roomId: currentRoom.id });
          subscribedRoomsRef.current.delete(currentRoom.id);
        }
      } catch (e) {}
    }
  }

  // Chat send: push to room-meta chat array (guaranteed to be persistent)
  async function sendChatMessage(text) {
    if (!currentRoom) { setStatus('Join a room to chat'); return; }
    if (!chatArrayRef.current || typeof chatArrayRef.current.push !== 'function') { setStatus('chat not ready'); return; }
    const msg = {
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2,6)}`,
      senderId: currentUser.id,
      senderName: currentUser.username,
      text,
      ts: new Date().toISOString()
    };
    try {
      chatArrayRef.current.push([msg]);
    } catch (e) {
      console.error('sendChatMessage err', e);
    }
  }

  function toggleChat(open) {
    const to = (typeof open === 'boolean') ? open : !showChatPanel;
    setShowChatPanel(to);
    if (to) setUnreadCount(0);
  }

  function userCanAccessFile(fileId) {
    if (!currentUser) return false;
    if (role === 'owner' || role === 'editor') return true;
    try {
      const roomMap = roomMetaYdocRef.current ? roomMetaYdocRef.current.getMap('room_meta') : null;
      if (!roomMap) return false;
      const filesObj = roomMap.get('files') || {};
      const meta = filesObj[fileId];
      if (!meta) return false;
      if (meta.allowed && typeof meta.allowed === 'object' && !Array.isArray(meta.allowed)) {
        return !!meta.allowed[currentUser.id];
      } else if (Array.isArray(meta.allowed)) {
        return meta.allowed.includes(currentUser.id);
      }
      return false;
    } catch (e) {
      console.warn('userCanAccessFile err', e);
      return false;
    }
  }

  // UI render
  const ownerId = currentRoom && currentRoom.ownerId;
  const isOwnerFlag = ownerId && currentUser && ownerId === currentUser.id;

  if (!authenticated || !currentUser) {
    return (
      <div className="app-root">
        <Login API_BASE={API_BASE} onAuthSuccess={(user) => { setCurrentUser(user); setAuthenticated(true); }} setStatus={setStatus} />
      </div>
    );
  }

  return (
    <div className="app-root">
      <header className="app-header">
        <div>
          <div className="brand">LiveCode</div>
          <div className="muted small">{status}</div>
        </div>

        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <div className="user-chip">
            <div className="avatar" style={{ background: colorForName(currentUser.username) }}>{(currentUser.username || 'U')[0].toUpperCase()}</div>
            <div style={{ marginLeft: 8 }}>
              <div style={{ fontSize: 14 }}>{currentUser.username}</div>
              <div className="muted small">signed-in • role: {role}</div>
            </div>
          </div>
          <button className="btn outline" onClick={() => { localStorage.removeItem('lc_current_user'); setCurrentUser(null); setAuthenticated(false); if (socketRef.current) socketRef.current.disconnect(); }}>Logout</button>
        </div>
      </header>

      <div className="main-content">
        <Sidebar
          // auth & user
          currentUser={currentUser}
          isOwner={isOwnerFlag}
          role={role}

          // room inputs & actions
          roomIdInput={roomIdInput}
          setRoomIdInput={setRoomIdInput}
          roomPassInput={roomPassInput}
          setRoomPassInput={setRoomPassInput}
          currentRoom={currentRoom}
          createRoom={createRoom}
          joinRoom={() => joinRoom(roomIdInput, roomPassInput)}
          leaveRoom={leaveRoom}
          showPass={showPass}
          setShowPass={setShowPass}

          // files & members
          files={files}
          createFile={createFile}
          openFile={openFile}
          deleteFile={deleteFile} // NEW: pass delete handler to Sidebar
          users={users}
          members={members}
          changeMemberRole={changeMemberRole}
          grantFileAccess={grantFileAccess}
          revokeFileAccess={revokeFileAccess}

          // session
          connected={connected}
          isConnecting={isConnecting}
          status={status}
          mergeServerMembersIntoY={mergeServerMembersIntoY}
          mergeServerFilesIntoY={mergeServerFilesIntoY}

          // server-side member management (implemented here)
          approveMemberRequest={approveMemberRequest}
          rejectMemberRequest={rejectMemberRequest}
          kickMember={kickMember}
          forceDeleteRoom={forceDeleteRoom}

          // socket: pass the socket so Sidebar may choose to add handlers (it already does)
          socket={socketRef.current}
        />

        <EditorPanel
          handleEditorMount={handleEditorMount}
          language={language}
          setLanguage={setLanguage}
          activeFile={activeFile}
          currentRoom={currentRoom}
          status={status}
          users={users}
          connected={connected}
          API_BASE={API_BASE}
          Editor={Editor}
        />
      </div>

      <ChatWidget
        currentUser={currentUser}
        members={members}
        messages={chatMessages}
        unreadCount={unreadCount}
        showPanel={showChatPanel}
        onToggle={toggleChat}
        onSend={sendChatMessage}
      />
    </div>
  );
}
