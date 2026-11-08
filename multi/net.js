// Partidas multijugador sin servidor propio: el navegador de quien crea la sala hace de anfitrión
// y los demás se conectan directamente a él (WebRTC con PeerJS). Solo el primer contacto pasa por
// el servidor público de PeerJS; después los datos van de navegador a navegador, también en la
// misma red local. El anfitrión manda: reparte semillas, guarda la lista y calcula la carrera.
const PREFIX = 'ruleta-motors-v1-';
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sin 0/O ni 1/I
export const MAX_PLAYERS = 6;
const randomCode = () => Array.from({ length: 4 }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join('');
export const cleanCode = (s) => (s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);

const PeerLib = () => {
  if (!window.Peer) throw new Error('No se pudo cargar la librería de red (¿sin conexión a internet?).');
  return window.Peer;
};

// Espera a que el «peer» tenga identificador o falle
function open(peer) {
  return new Promise((resolve, reject) => {
    peer.once('open', resolve);
    peer.once('error', reject);
  });
}

// Sala del anfitrión: lleva la lista de jugadores y reenvía a todos lo que haga falta.
export class HostRoom {
  constructor(name) {
    this.isHost = true;
    this.myId = 'host';
    this.conns = new Map(); // id -> DataConnection
    this.players = [{ id: 'host', name, bot: false, state: 'lobby' }];
    this.handlers = {};
  }
  on(type, fn) { this.handlers[type] = fn; return this; }
  emit(type, ...a) { const f = this.handlers[type]; if (f) f(...a); }

  async create() {
    const Peer = PeerLib();
    for (let tries = 0; tries < 5; tries++) {
      const code = randomCode();
      const peer = new Peer(PREFIX + code, { debug: 0 });
      try {
        await open(peer);
        this.code = code;
        this.peer = peer;
        peer.on('connection', (c) => this.accept(c));
        peer.on('disconnected', () => peer.reconnect());
        return code;
      } catch (err) {
        peer.destroy();
        if (err.type !== 'unavailable-id') throw err;
      }
    }
    throw new Error('No se pudo crear la sala. Inténtalo otra vez.');
  }

  accept(conn) {
    conn.on('open', () => {
      if (this.players.length >= MAX_PLAYERS || this.locked) {
        conn.send({ t: 'refused', why: this.locked ? 'La partida ya ha empezado.' : 'La sala está llena.' });
        setTimeout(() => conn.close(), 300);
        return;
      }
      this.conns.set(conn.peer, conn);
    });
    conn.on('data', (m) => this.receive(conn.peer, m));
    conn.on('close', () => this.drop(conn.peer));
    conn.on('error', () => this.drop(conn.peer));
  }
  drop(id) {
    if (!this.conns.has(id)) return;
    this.conns.delete(id);
    this.players = this.players.filter((p) => p.id !== id);
    this.broadcastLobby();
    this.emit('players', this.players);
  }
  receive(id, m) {
    if (m.t === 'hello') {
      if (!this.conns.has(id)) return; // conexión rechazada (sala llena o ya empezada)
      if (!this.players.some((p) => p.id === id)) this.players.push({ id, name: (m.name || 'Jugador').slice(0, 16), bot: false, state: 'lobby' });
      this.broadcastLobby();
      this.emit('players', this.players);
      return;
    }
    const p = this.players.find((x) => x.id === id);
    if (!p) return;
    if (m.t === 'progress') { p.state = 'building'; p.step = m.step; }
    if (m.t === 'ready') { p.state = 'ready'; p.car = m.car; }
    this.broadcastLobby();
    this.emit('players', this.players);
  }

  send(id, m) { const c = this.conns.get(id); if (c && c.open) c.send(m); }
  broadcast(m) { for (const c of this.conns.values()) if (c.open) c.send(m); }
  broadcastLobby() { this.broadcast({ t: 'lobby', players: this.players.map(({ id, name, bot, state, step }) => ({ id, name, bot, state, step })) }); }

  // El anfitrión es un jugador más: sus avisos pasan por el mismo sitio
  progress(step) { const me = this.players[0]; me.state = 'building'; me.step = step; this.broadcastLobby(); this.emit('players', this.players); }
  ready(car) { const me = this.players[0]; me.state = 'ready'; me.car = car; this.broadcastLobby(); this.emit('players', this.players); }

  addBot(name, car) {
    if (this.players.length >= MAX_PLAYERS) return false;
    this.players.push({ id: 'bot-' + Math.random().toString(36).slice(2, 8), name, bot: true, state: 'ready', car });
    this.broadcastLobby();
    this.emit('players', this.players);
    return true;
  }
  removeBots() { this.players = this.players.filter((p) => !p.bot); this.broadcastLobby(); this.emit('players', this.players); }

  // Ronda nueva: cada jugador recibe su semilla (los bots ya traen el coche hecho)
  startRound(seedFor) {
    this.locked = true;
    const seeds = {};
    for (const p of this.players) if (!p.bot) { seeds[p.id] = seedFor(p); p.state = 'building'; p.step = 1; p.car = null; }
    this.broadcast({ t: 'start', seeds });
    this.broadcastLobby();
    this.emit('players', this.players);
    return seeds.host;
  }
  startRace(race) { this.broadcast({ t: 'race', race }); }
  backToLobby() { this.locked = false; for (const p of this.players) if (!p.bot) { p.state = 'lobby'; p.car = null; } this.broadcast({ t: 'lobbyBack' }); this.broadcastLobby(); this.emit('players', this.players); }
  close() { this.broadcast({ t: 'closed' }); setTimeout(() => this.peer && this.peer.destroy(), 200); }
}

// Sala de un invitado: se conecta al anfitrión y obedece lo que le manda.
export class GuestRoom {
  constructor(name) {
    this.isHost = false;
    this.name = name;
    this.players = [];
    this.handlers = {};
  }
  on(type, fn) { this.handlers[type] = fn; return this; }
  emit(type, ...a) { const f = this.handlers[type]; if (f) f(...a); }

  async join(code) {
    const Peer = PeerLib();
    this.code = cleanCode(code);
    const peer = this.peer = new Peer(undefined, { debug: 0 });
    this.myId = await open(peer);
    const conn = this.conn = peer.connect(PREFIX + this.code, { reliable: true });
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('No se encuentra la sala. Revisa el código.')), 9000);
      conn.on('open', () => { clearTimeout(t); resolve(); });
      peer.on('error', (err) => { clearTimeout(t); reject(err.type === 'peer-unavailable' ? new Error('No existe ninguna sala con ese código.') : err); });
    });
    conn.on('data', (m) => this.receive(m));
    conn.on('close', () => this.emit('closed', 'Se ha perdido la conexión con el anfitrión.'));
    conn.send({ t: 'hello', name: this.name });
  }
  receive(m) {
    if (m.t === 'lobby') { this.players = m.players; this.emit('players', this.players); }
    else if (m.t === 'start') this.emit('start', m.seeds[this.myId]);
    else if (m.t === 'race') this.emit('race', m.race);
    else if (m.t === 'lobbyBack') this.emit('lobbyBack');
    else if (m.t === 'refused') this.emit('closed', m.why);
    else if (m.t === 'closed') this.emit('closed', 'El anfitrión ha cerrado la partida.');
  }
  progress(step) { if (this.conn && this.conn.open) this.conn.send({ t: 'progress', step }); }
  ready(car) { if (this.conn && this.conn.open) this.conn.send({ t: 'ready', car }); }
  close() { if (this.peer) this.peer.destroy(); }
}
