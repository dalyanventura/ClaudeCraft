// Signaux sonores synthétisés (aucun fichier audio nécessaire).
// "done"      : Claude a fini et attend votre message (arpège montant).
// "attention" : Claude demande une permission / une décision (double appel).
(function () {
  let ctx = null;

  function note(freq, start, duration, volume) {
    const osc = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc2.type = 'triangle';
    osc.frequency.value = freq;
    osc2.frequency.value = freq * 2;
    const g2 = ctx.createGain();
    g2.gain.value = 0.15;
    osc.connect(gain);
    osc2.connect(g2).connect(gain);
    gain.connect(ctx.destination);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(volume, start + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    osc.start(start); osc2.start(start);
    osc.stop(start + duration + 0.05); osc2.stop(start + duration + 0.05);
  }

  const PATTERNS = {
    done: [[523.25, 0], [659.25, 0.11], [783.99, 0.22], [1046.5, 0.33]],
    attention: [[880, 0], [698.46, 0.16], [880, 0.42], [698.46, 0.58]],
  };

  window.playSignal = function (kind, volume) {
    try {
      ctx = ctx || new AudioContext();
      if (ctx.state === 'suspended') ctx.resume();
      const t = ctx.currentTime + 0.02;
      const v = Math.max(0.001, Math.min(1, volume)) * 0.5;
      for (const [f, offset] of PATTERNS[kind] || PATTERNS.done) note(f, t + offset, 0.7, v);
    } catch (e) {
      console.error('Lecture du son impossible', e);
    }
  };
})();
