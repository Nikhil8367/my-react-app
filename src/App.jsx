// src/App.jsx
import React from 'react';
import LiveCodeApp from './components/LiveCodeApp';
import './App.css';

export default function App(){
  const params = new URLSearchParams(window.location.search);
  const roomFromUrl = params.get('room') || null;

  return (
    <div className="app-root" style={{height: '100vh'}}>
      {/* Pass initialRoom as prop in case LiveCodeApp wants to auto-join or prefill */}
      <LiveCodeApp initialRoom={roomFromUrl} />
    </div>
  );
}
