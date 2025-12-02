// src/components/EditorPanel.jsx
import React from 'react';
import Editor from '@monaco-editor/react';

export default function EditorPanel(props) {
  const { handleEditorMount, language, setLanguage, activeFile, currentRoom, status, users, connected, API_BASE } = props;

  return (
    <main className="editor-area">
      <div className="editor-toolbar" style={{ padding: 8, borderBottom: '1px solid #111', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
        <div style={{ display:'flex', gap:12, alignItems:'center' }}>
          <div style={{ fontWeight:700 }}>{currentRoom ? currentRoom.id : 'Not connected'}</div>
          <div className="muted small">{activeFile ? activeFile.name : 'No file opened'}</div>
        </div>
        <div style={{ display:'flex', gap:8, alignItems:'center' }}>
          <select value={language} onChange={e => { setLanguage(e.target.value); localStorage.setItem('lc_language', e.target.value); }}>
            <option value="javascript">JavaScript</option>
            <option value="typescript">TypeScript</option>
            <option value="python">Python</option>
            <option value="java">Java</option>
            <option value="go">Go</option>
          </select>
          <button className="btn" onClick={() => { if (activeFile) navigator.clipboard.writeText(`${API_BASE} / Y doc: ${currentRoom.id}:${activeFile.fileId}`); }}>Copy doc id</button>
        </div>
      </div>

      <div className="editor-wrapper">
        <Editor
          height="100%"
          defaultLanguage={language}
          defaultValue={`// Welcome to LiveCode\n// Room: ${currentRoom ? currentRoom.id : 'not connected'}\n// File: ${activeFile ? activeFile.name : 'none'}`}
          onMount={handleEditorMount}
          options={{ fontSize: 14, minimap: { enabled: false }, theme: 'vs-black' }}
        />
      </div>
    </main>
  );
}
