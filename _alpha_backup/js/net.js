/* =========================================================
   APEX & PASS — 1v1 Online Lobby (WebRTC PeerJS + BroadcastChannel) & Opponent Bike
   ========================================================= */
'use strict';

class NetLobby {
  constructor() {
    this.peer = null;
    this.conn = null;
    this.bc = null;
    this.role = null; // 'host' | 'guest' | 'bot' | null
    this.code = '';
    this.connected = false;
    this.remoteState = null;
    this.remoteBikeId = 'i4';
    this.onStatusChange = null;
    this.onRemoteStart = null;
    this._sendAcc = 0;
  }

  _status(text, isConnected = false) {
    this.connected = isConnected;
    if (this.onStatusChange) this.onStatusChange(text, isConnected, this.role, this.code);
  }

  disconnect() {
    if (this.conn) { try { this.conn.close(); } catch (e) {} this.conn = null; }
    if (this.peer) { try { this.peer.destroy(); } catch (e) {} this.peer = null; }
    if (this.bc) { try { this.bc.close(); } catch (e) {} this.bc = null; }
    this.role = null;
    this.code = '';
    this.connected = false;
    this.remoteState = null;
    this._status('Keine aktive Lobby', false);
  }

  hostLobby(myBikeId, trackId, themeId) {
    this.disconnect();
    this.role = 'host';
    this.code = String(Math.floor(1000 + Math.random() * 9000));
    this._status(`Lobby offen · Code: ${this.code} (Warte auf Kollegen…)`, false);

    // Local BroadcastChannel for instant same-machine multi-tab testing + WebRTC PeerJS for internet 1v1
    if (window.BroadcastChannel) {
      this.bc = new BroadcastChannel('apex_1v1_' + this.code);
      this.bc.onmessage = (ev) => this._handleMessage(ev.data);
    }

    if (window.Peer) {
      try {
        this.peer = new Peer('apex-pass-1v1-' + this.code);
        this.peer.on('connection', (conn) => {
          this.conn = conn;
          this._bindConn(conn, myBikeId, trackId, themeId);
        });
        this.peer.on('error', (err) => {
          console.warn('PeerJS warn:', err);
        });
      } catch (e) {
        console.warn('Peer init err:', e);
      }
    }
    return this.code;
  }

  joinLobby(code, myBikeId) {
    const clean = String(code || '').replace(/\D/g, '').slice(0, 4);
    if (clean.length !== 4) {
      this._status('Bitte 4-stelligen Raum-Code eingeben', false);
      return false;
    }
    this.disconnect();
    this.role = 'guest';
    this.code = clean;
    this._status(`Verbinde mit Lobby ${clean}…`, false);

    if (window.BroadcastChannel) {
      this.bc = new BroadcastChannel('apex_1v1_' + clean);
      this.bc.onmessage = (ev) => this._handleMessage(ev.data);
      this.bc.postMessage({ type: 'hello', bike: myBikeId });
    }

    if (window.Peer) {
      try {
        this.peer = new Peer();
        this.peer.on('open', () => {
          const conn = this.peer.connect('apex-pass-1v1-' + clean, { reliable: false });
          this.conn = conn;
          this._bindConn(conn, myBikeId);
        });
        this.peer.on('error', () => {
          if (!this.connected) this._status(`Lobby ${clean} nicht gefunden`, false);
        });
      } catch (e) {
        console.warn('Peer join err:', e);
      }
    }
    return true;
  }

  enableBotOpponent(bikeId = 'i4') {
    this.disconnect();
    this.role = 'bot';
    this.code = 'BOT';
    this.remoteBikeId = bikeId;
    this.connected = true;
    this._status('1v1 Rival-Bot bereit (Startaufstellung)', true);
  }

  _bindConn(conn, myBikeId, trackId, themeId) {
    conn.on('open', () => {
      this._status(`1v1 Verbunden! (Code: ${this.code})`, true);
      this.send({ type: 'hello', bike: myBikeId, track: trackId, theme: themeId });
    });
    conn.on('data', (data) => this._handleMessage(data));
    conn.on('close', () => {
      this._status('Kollege hat die Lobby verlassen', false);
    });
  }

  _handleMessage(msg) {
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'hello') {
      if (msg.bike && BIKES[msg.bike]) this.remoteBikeId = msg.bike;
      if (!this.connected) {
        this._status(`1v1 Verbunden mit Kollegen! (${BIKES[this.remoteBikeId].name})`, true);
        if (this.role === 'host') {
          this.send({
            type: 'welcome',
            bike: APP.opts.bike,
            track: APP.opts.track,
            theme: APP.opts.theme
          });
        }
      }
    } else if (msg.type === 'welcome') {
      if (msg.bike && BIKES[msg.bike]) this.remoteBikeId = msg.bike;
      this._status(`1v1 Verbunden mit Host! (${BIKES[this.remoteBikeId].name})`, true);
      if (msg.track && TRACK_DEFS[msg.track] && APP.opts.track !== msg.track) {
        APP.opts.track = msg.track;
        rebuildTrack(true);
        updateMenuSelection();
      }
    } else if (msg.type === 'start') {
      if (msg.bike && BIKES[msg.bike]) this.remoteBikeId = msg.bike;
      if (this.onRemoteStart) this.onRemoteStart(msg);
    } else if (msg.type === 'state') {
      this.remoteState = msg;
    }
  }

  send(payload) {
    if (this.conn && this.conn.open) {
      try { this.conn.send(payload); } catch (e) {}
    }
    if (this.bc) {
      try { this.bc.postMessage(payload); } catch (e) {}
    }
  }

  broadcastMyState(p, lapCount, lapDistance, dt) {
    if (!this.connected || this.role === 'bot') return;
    this._sendAcc += dt;
    if (this._sendAcc < 1 / 30) return;
    this._sendAcc = 0;
    this.send({
      type: 'state',
      bike: APP.opts.bike,
      x: +p.pos.x.toFixed(2),
      y: +p.pos.y.toFixed(2),
      z: +p.pos.z.toFixed(2),
      yaw: +p.yaw.toFixed(3),
      lean: +p.lean.toFixed(3),
      pitch: +p.pitch.toFixed(3),
      steerVis: +p.steerVis.toFixed(3),
      weightX: +p.weightX.toFixed(2),
      weightY: +p.weightY.toFixed(2),
      throttle: +p.throttle.toFixed(2),
      frontBrake: +p.frontBrake.toFixed(2),
      speed: +p.speed.toFixed(2),
      spin: +p.spin.toFixed(2),
      drift: +p.drift.toFixed(2),
      burnout: p.burnout ? 1 : 0,
      crashed: p.crashed ? 1 : 0,
      lap: lapCount,
      dist: +lapDistance.toFixed(1)
    });
  }
}
