# WebRTC Signaling over WebSocket

```typescript
interface SignalingMessage {
  type: "signal";
  target: string; // Peer ID
  sender: string; // Peer ID
  signal: any; // WebRTC offer/answer/candidate
}

// Inside Durable Object webSocketMessage:
const data = JSON.parse(message as string);

if (data.type === "signal") {
  // Forward signal to target peer
  const targetWs = this.peers.get(data.target);
  if (targetWs) {
    targetWs.send(JSON.stringify({
      type: "signal",
      sender: data.sender,
      signal: data.signal
    }));
  }
}

if (data.type === "announce") {
  // Peer announces presence for WebRTC
  this.broadcast({
    type: "new-peer",
    peerId: data.sender
  }, ws);
}
```

## Notes
- The Durable Object acts as the signaling server
- Peers exchange offers/answers/ICE candidates through the DO
- Actual data flows P2P via WebRTC after handshake
