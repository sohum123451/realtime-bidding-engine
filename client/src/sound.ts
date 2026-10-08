// Procedural Web Audio API Sound Effects for Auction Saleroom
// Zero external asset downloads, zero network latency, 100% offline capable

class AuctionSoundEffects {
  private ctx: AudioContext | null = null;
  private muted: boolean = false;
  private hasUnlocked: boolean = false;

  constructor() {
    // Restore mute preference
    const saved = localStorage.getItem('auction_audio_muted');
    if (saved === 'true') {
      this.muted = true;
    }

    // Auto-unlock on first user interaction per browser autoplay policy
    const unlock = () => {
      this.ensureContext();
      if (this.ctx && this.ctx.state === 'suspended') {
        this.ctx.resume();
      }
      this.hasUnlocked = true;
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };

    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
  }

  private ensureContext(): AudioContext | null {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    return this.ctx;
  }

  public isMuted(): boolean {
    return this.muted;
  }

  public isUnlocked(): boolean {
    return this.hasUnlocked;
  }

  public toggleMute(): boolean {
    this.muted = !this.muted;
    localStorage.setItem('auction_audio_muted', this.muted ? 'true' : 'false');
    if (!this.muted) {
      this.ensureContext()?.resume();
      this.playBidChime();
    }
    return this.muted;
  }

  // 1. Crystal/Brass Chime for Accepted Bids
  public playBidChime(): void {
    if (this.muted) return;
    const ctx = this.ensureContext();
    if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume();

    const now = ctx.currentTime;

    // Harmonic bell tones
    const freqs = [1046.5, 1318.51, 2093.0]; // C6, E6, C7
    freqs.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + idx * 0.02);

      const peakGain = 0.14 / (idx + 1);
      gain.gain.setValueAtTime(0.0001, now + idx * 0.02);
      gain.gain.exponentialRampToValueAtTime(peakGain, now + idx * 0.02 + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + idx * 0.02 + 0.65);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now + idx * 0.02);
      osc.stop(now + idx * 0.02 + 0.7);
    });
  }

  // 2. Crisp Wooden Paddle Raise Click
  public playPaddleRaise(): void {
    if (this.muted) return;
    const ctx = this.ensureContext();
    if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume();

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(440, now);
    osc.frequency.exponentialRampToValueAtTime(140, now + 0.04);

    gain.gain.setValueAtTime(0.2, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.06);
  }

  // 3. Wooden Gavel Strike on Sounding Block
  public playGavelStrike(volumeMultiplier = 1.0): void {
    if (this.muted) return;
    const ctx = this.ensureContext();
    if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume();

    const now = ctx.currentTime;

    // A. Transient woody crack (Noise buffer)
    const bufferSize = ctx.sampleRate * 0.05; // 50ms
    const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuffer;

    const noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = 'bandpass';
    noiseFilter.frequency.setValueAtTime(1200, now);
    noiseFilter.Q.setValueAtTime(2.5, now);

    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.4 * volumeMultiplier, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.04);

    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(ctx.destination);

    noise.start(now);

    // B. Resonant wooden sounding block thump
    const bodyOsc = ctx.createOscillator();
    bodyOsc.type = 'sine';
    bodyOsc.frequency.setValueAtTime(320, now);
    bodyOsc.frequency.exponentialRampToValueAtTime(110, now + 0.18);

    const bodyGain = ctx.createGain();
    bodyGain.gain.setValueAtTime(0.6 * volumeMultiplier, now);
    bodyGain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);

    bodyOsc.connect(bodyGain);
    bodyGain.connect(ctx.destination);

    bodyOsc.start(now);
    bodyOsc.stop(now + 0.25);
  }

  // 4. Triple Gavel Strike: "Going Once... Going Twice... SOLD!"
  public playGavelTriple(): void {
    if (this.muted) return;
    // Strike 1
    this.playGavelStrike(0.65);
    // Strike 2
    setTimeout(() => this.playGavelStrike(0.85), 360);
    // Strike 3 (Final authoritative hammer drop!)
    setTimeout(() => {
      this.playGavelStrike(1.3);
      this.playSoldFanfare();
    }, 760);
  }

  // 5. Grand Victorian Fanfare for Lot Sold
  public playSoldFanfare(): void {
    if (this.muted) return;
    const ctx = this.ensureContext();
    if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume();

    const now = ctx.currentTime;
    const chords = [
      [523.25, 659.25, 783.99], // C5 major
      [587.33, 698.46, 880.0],  // D5 minor
      [659.25, 783.99, 1046.5], // E5 / C6
    ];

    chords.forEach((chord, cIdx) => {
      const chordTime = now + 0.15 + cIdx * 0.18;
      chord.forEach((freq) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, chordTime);

        gain.gain.setValueAtTime(0.001, chordTime);
        gain.gain.exponentialRampToValueAtTime(0.08, chordTime + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, chordTime + (cIdx === 2 ? 0.9 : 0.22));

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(chordTime);
        osc.stop(chordTime + (cIdx === 2 ? 1.0 : 0.25));
      });
    });
  }

  // 6. Rejected Bid / Self-Overbid Dull Wood Thud
  public playRejected(): void {
    if (this.muted) return;
    const ctx = this.ensureContext();
    if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume();

    const now = ctx.currentTime;

    // Double dull thud
    [0, 0.08].forEach((offset) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(130, now + offset);
      osc.frequency.exponentialRampToValueAtTime(70, now + offset + 0.06);

      gain.gain.setValueAtTime(0.12, now + offset);
      gain.gain.exponentialRampToValueAtTime(0.001, now + offset + 0.07);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now + offset);
      osc.stop(now + offset + 0.08);
    });
  }

  // 7. Anti-Sniping Alert (+30s added!)
  public playAntiSnipingAlert(): void {
    if (this.muted) return;
    const ctx = this.ensureContext();
    if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume();

    const now = ctx.currentTime;
    [587.33, 880.0, 1174.66].forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + idx * 0.06);

      gain.gain.setValueAtTime(0.001, now + idx * 0.06);
      gain.gain.exponentialRampToValueAtTime(0.12, now + idx * 0.06 + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.06 + 0.25);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now + idx * 0.06);
      osc.stop(now + idx * 0.06 + 0.3);
    });
  }

  // 8. Ticking Clock in Final Seconds
  public playTensionTick(): void {
    if (this.muted) return;
    const ctx = this.ensureContext();
    if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume();

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(2200, now);
    osc.frequency.exponentialRampToValueAtTime(1400, now + 0.015);

    gain.gain.setValueAtTime(0.06, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.02);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.025);
  }
}

export const sounds = new AuctionSoundEffects();
