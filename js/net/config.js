// Network settings shared by every transport. Swap the ICE servers for your own TURN
// (e.g. Twilio Network Traversal) without touching game code.

export const NET = {
  protocol: 1,
  peerPrefix: 'shingekicraft-v1-',
  maxPlayers: 8,
  stateHz: 20,        // own player state, client -> authority
  titansHz: 15,       // titan snapshots, authority -> clients
  boardHz: 2,         // scoreboard / mission status
  interpDelay: 0.12,  // seconds remote entities are rendered behind the newest snapshot
  joinTimeout: 12000,
  respawn: 5,
};

// STUN finds a direct path; TURN relays traffic for players behind strict NATs.
// Open Relay is a free public TURN for testing; use your own for anything serious.
export const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:global.stun.twilio.com:3478' },
  { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
];

// Room codes avoid look-alike characters (0/O, 1/I/L).
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export function makeRoomCode(n = 5) {
  let s = '';
  for (let i = 0; i < n; i++) s += ALPHABET[(Math.random() * ALPHABET.length) | 0];
  return s;
}
export function cleanRoomCode(s) { return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8); }
