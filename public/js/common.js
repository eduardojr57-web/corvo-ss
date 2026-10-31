// Shared utilities for Corvo SS

const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    // Public TURN (limited, for prototype - replace with your own for production)
    {
      urls: 'turn:openrelay.metered.ca:80',
      username: 'openrelayproject',
      credential: 'openrelayproject'
    },
    {
      urls: 'turn:openrelay.metered.ca:443',
      username: 'openrelayproject',
      credential: 'openrelayproject'
    }
  ]
};

function getQueryParam(name) {
  const params = new URLSearchParams(window.location.search);
  return params.get(name) || '';
}

function showToast(msg, duration = 3500) {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), duration);
}

function formatTime(ts) {
  const d = new Date(ts);
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

// Simple PeerConnection helper
class SimplePeer {
  constructor(isInitiator, stream = null) {
    this.pc = new RTCPeerConnection(ICE_SERVERS);
    this.isInitiator = isInitiator;
    this.stream = stream;
    this.onSignal = null;
    this.onStream = null;
    this.onClose = null;
    this._makingOffer = false;
    this._ignoreOffer = false;
    this._polite = !isInitiator;

    if (stream) {
      stream.getTracks().forEach(track => this.pc.addTrack(track, stream));
    }

    this.pc.onicecandidate = (e) => {
      if (e.candidate && this.onSignal) {
        this.onSignal({ type: 'candidate', candidate: e.candidate });
      }
    };

    this.pc.ontrack = (e) => {
      if (this.onStream && e.streams[0]) {
        this.onStream(e.streams[0]);
      }
    };

    this.pc.onconnectionstatechange = () => {
      if (['failed', 'closed', 'disconnected'].includes(this.pc.connectionState)) {
        if (this.onClose) this.onClose();
      }
    };

    if (isInitiator) {
      this._makeOffer();
    }
  }

  async _makeOffer() {
    try {
      this._makingOffer = true;
      const offer = await this.pc.createOffer();
      await this.pc.setLocalDescription(offer);
      if (this.onSignal) {
        this.onSignal({ type: 'offer', sdp: this.pc.localDescription });
      }
    } catch (e) {
      console.error('Offer error', e);
    } finally {
      this._makingOffer = false;
    }
  }

  async handleSignal(data) {
    try {
      if (data.type === 'offer') {
        const offerCollision = this._makingOffer || this.pc.signalingState !== 'stable';
        this._ignoreOffer = !this._polite && offerCollision;
        if (this._ignoreOffer) return;

        await this.pc.setRemoteDescription(data.sdp);
        const answer = await this.pc.createAnswer();
        await this.pc.setLocalDescription(answer);
        if (this.onSignal) {
          this.onSignal({ type: 'answer', sdp: this.pc.localDescription });
        }
      } else if (data.type === 'answer') {
        await this.pc.setRemoteDescription(data.sdp);
      } else if (data.type === 'candidate' && data.candidate) {
        try {
          await this.pc.addIceCandidate(data.candidate);
        } catch (e) {
          if (!this._ignoreOffer) console.warn('ICE error', e);
        }
      }
    } catch (e) {
      console.error('Signal handle error', e);
    }
  }

  close() {
    this.pc.close();
  }
}

// Rolling buffer recorder for last N minutes
class RollingRecorder {
  constructor(stream, maxMinutes = 10) {
    this.stream = stream;
    this.maxMs = maxMinutes * 60 * 1000;
    this.chunks = [];
    this.timestamps = [];
    this.recorder = null;
    this.mimeType = this._getMime();
  }

  _getMime() {
    const types = [
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm;codecs=vp9',
      'video/webm;codecs=vp8',
      'video/webm'
    ];
    for (const t of types) {
      if (MediaRecorder.isTypeSupported(t)) return t;
    }
    return 'video/webm';
  }

  start() {
    if (this.recorder) return;
    try {
      this.recorder = new MediaRecorder(this.stream, {
        mimeType: this.mimeType,
        videoBitsPerSecond: 1500000
      });
      this.recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          this.chunks.push(e.data);
          this.timestamps.push(Date.now());
          this._trim();
        }
      };
      this.recorder.start(2000); // chunk every 2s
    } catch (e) {
      console.error('MediaRecorder start failed', e);
    }
  }

  _trim() {
    const cutoff = Date.now() - this.maxMs;
    while (this.timestamps.length && this.timestamps[0] < cutoff) {
      this.timestamps.shift();
      this.chunks.shift();
    }
  }

  stop() {
    if (this.recorder && this.recorder.state !== 'inactive') {
      this.recorder.stop();
    }
    this.recorder = null;
    this.chunks = [];
    this.timestamps = [];
  }

  /**
   * Returns a Blob of the last `minutes` of recording, or null
   */
  getLastMinutes(minutes) {
    if (!this.chunks.length) return null;
    const cutoff = Date.now() - (minutes * 60 * 1000);
    const selected = [];
    for (let i = 0; i < this.timestamps.length; i++) {
      if (this.timestamps[i] >= cutoff) {
        selected.push(this.chunks[i]);
      }
    }
    if (!selected.length) return null;
    return new Blob(selected, { type: this.mimeType });
  }
}
