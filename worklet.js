class RatioPolyrhythmProcessor extends AudioWorkletProcessor {
  constructor() {
    super();

    // Params (defaults)
    this.ratios = [2, 3, 4, 5, 6];
    this.mode = "click"; // "click" or "sine"
    this.rootHz = 440;

    // T smoothing
    this.TTarget = 0.4;
    this.TSmooth = 0.4;
    this.TSmoothingSeconds = 0.05; // 0.02–0.1 is typical

    // State
    this.nextHit = [];
    this.phase = [];
    this.y1 = [];
    this.y2 = [];
    this._resetSchedules();

    this.port.onmessage = (e) => {
      const msg = e.data;
      if (!msg || msg.type !== "params") return;

      const newRatios =
        Array.isArray(msg.ratios) && msg.ratios.length
          ? [...msg.ratios].sort((a, b) => a - b)
          : this.ratios;

      const ratiosChanged =
        newRatios.length !== this.ratios.length ||
        newRatios.some((v, i) => v !== this.ratios[i]);

      const newMode = msg.mode === "sine" ? "sine" : "click";
      const modeChanged = newMode !== this.mode;

      // Smooth continuously
      this.TTarget = Math.max(1e-6, Number(msg.T) || this.TTarget);
      this.rootHz = Math.max(1, Number(msg.rootHz) || this.rootHz);

      if (ratiosChanged || modeChanged) {
        this.ratios = newRatios;
        this.mode = newMode;
        this._resetSchedules(); // safe reset for structural changes
      } else {
        this.mode = newMode;
      }
    };
  }

  _resetSchedules() {
    const now = currentTime;
    this.hitPhase = this.ratios.map(() => 0);
    this.phase = this.ratios.map(() => 0);
    this.y1 = this.ratios.map(() => 0);
    this.y2 = this.ratios.map(() => 0);
  }


  _smoothstep(edge0, edge1, x) {
    const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
    return t * t * (3 - 2 * t);
  }

  process(inputs, outputs) {
    const out = outputs[0];
    const ch0 = out[0];
    const ch1 = out[1] || null;

    const sr = sampleRate;
    const dt = 1 / sr;

    // smoothing coefficient
    const alpha = Math.exp(-dt / this.TSmoothingSeconds);

    if (this.mode === "sine") {
      // Pure tones: rootHz * ratio (good for clearly hearing chord quality)
      const gain = 0.2;

      for (let i = 0; i < ch0.length; i++) {
        let s = 0;

        for (let j = 0; j < this.ratios.length; j++) {
          const f = this.rootHz * this.ratios[j];
          this.phase[j] += 2 * Math.PI * f * dt;
          if (this.phase[j] > 1e9) this.phase[j] %= (2 * Math.PI);
          s += Math.sin(this.phase[j]);
        }

        s = (s / Math.max(1, this.ratios.length)) * gain;

        ch0[i] = s;
        if (ch1) ch1[i] = s;
      }
      return true;
    }

    // CLICK/RESONATOR MODE
    const now0 = currentTime;

    const hitAmp = 0.15;    // base excitation
    const outGain = 0.25;   // overall trim

    // loudness compensation
    const fRef = 80;
    const fMin = 1;
    const maxBoost = 3.0;
    const minBoost = 0.05;

    const fLimit = 4000; // Hz, pick what you like

    // optional dry click (keeps slow taps audible)
    const dryAmp = 0.03;

    for (let i = 0; i < ch0.length; i++) {
      // Smooth T per sample
      this.TSmooth = alpha * this.TSmooth + (1 - alpha) * this.TTarget;
      const TS = this.TSmooth;

      const rMax = this.ratios[this.ratios.length - 1] || 1;
      const fMaxUnclamped = rMax / TS;
      const scale = fMaxUnclamped > fLimit ? (fLimit / fMaxUnclamped) : 1.0;

      // Estimate max frequency among ratios for this sample
      //const rMax = this.ratios[this.ratios.length - 1] || 1; // assumes ratios sorted; if not, compute max once on update
      const fMax = Math.max(1, Math.min(4000, rMax / TS));

      // Trim starts around 200 Hz and reaches stronger cut by 2000 Hz
      const hiTrim = 1 / Math.sqrt(1 + (fMax / 400)); // tweak 400 -> lower means more cut sooner`

      const t = now0 + i * dt;
      let s = 0;

      for (let j = 0; j < this.ratios.length; j++) {
        const r = this.ratios[j];

        // Hit scheduling
        const period = TS / r;

        // phase-accumulator hit generation (sample-accurate, no drift)
        let hit = 0;
        const inc = (r / TS) * dt;     // cycles per sample
        this.hitPhase[j] += inc;

        if (this.hitPhase[j] >= 1) {
          // If inc is big, you might cross more than once in a sample:
          hit = Math.floor(this.hitPhase[j]);
          this.hitPhase[j] -= hit;
          if (hit > 4) hit = 4; // keep your safety cap
        }

        // Frequency: repetition rate -> pitch
        let f = (r / TS) * scale;
        f = Math.max(1, f); // keep a floor if you want

        const qMix = this._smoothstep(25, 120, f);
        const damp = 0.995 + qMix * (0.99995 - 0.995);

        const w = 2 * Math.PI * f / sr;
        const a = 2 * Math.cos(w) * damp;

        // Energy compensation ~ 1/sqrt(f)
        const fSafe = Math.max(fMin, f);
        let comp = Math.sqrt(fRef / fSafe);
        comp = Math.min(maxBoost, Math.max(minBoost, comp));

        const excitation = hitAmp * hit * comp;

        // Resonator difference equation
        const y = a * this.y1[j] - (damp * damp) * this.y2[j] + excitation;
        this.y2[j] = this.y1[j];
        this.y1[j] = y;

        s += y;

        if (hit > 0) s += dryAmp * hit;
      }

      s = (s / Math.max(1, this.ratios.length)) * outGain;
      s = Math.tanh(s); // safety
      s = s * hiTrim;

      ch0[i] = s;
      if (ch1) ch1[i] = s;
    }

    return true;
  }
}

registerProcessor("ratio-polyrhythm", RatioPolyrhythmProcessor);
