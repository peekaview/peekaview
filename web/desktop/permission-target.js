const { listen, emitTo } = window.__TAURI__.event
await listen('permission-guide', ({ payload }) => {
  document.body.dataset.phase = payload.phase
  document.getElementById('target-number').textContent = payload.phase === 'enable' ? '3' : '2'
  document.getElementById('target-text').textContent = payload.phase === 'enable'
    ? 'Schalter neben PeekaView einschalten'
    : payload.phase === 'dragging' ? 'In die App-Liste ziehen – dann loslassen' : 'Hier: PeekaView in die App-Liste ziehen'
})
await emitTo('permission', 'permission-guide-ready')
