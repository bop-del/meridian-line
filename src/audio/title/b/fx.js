// Effects graph for title variant B: tape saturation and flutter, dark convolution reverb (procedural impulse response),
// hard-gated snare reverb, dark ping-pong delay, pad chorus and sidechain-style duck gains.
import { BEAT, mulberry32 } from './score.js';

// Noise impulse response, exponential decay (-60 dB at `seconds`), progressively darker tail via a one-pole lowpass.
function makeIR(ac, seconds, { bright = 0.5, dark = 0.42, seed = 1 } = {}) {
  const sr = ac.sampleRate;
  const len = Math.floor(sr * seconds);
  const buf = ac.createBuffer(2, len, sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    const rnd = mulberry32(seed * 977 + ch * 131);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const x = i / len;
      const amp = Math.exp(-6.9 * x);
      const alpha = Math.max(0.06, bright - dark * Math.pow(x, 0.6));
      lp += alpha * ((rnd() * 2 - 1) * amp - lp);
      d[i] = lp * Math.min(1, i / (sr * 0.004)); // tiny fade in, no click at the head
    }
  }
  return buf;
}

// Gentle asymmetric tanh: tape-like warmth, unity gain for small signals
function tapeCurve() {
  const n = 2048, c = new Float32Array(n), k = 1.35, b = 0.07;
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / (n - 1) - 1;
    c[i] = (Math.tanh(k * x + b) - Math.tanh(b)) / k;
  }
  return c;
}

export function buildFx(ac, out) {
  const all = [];
  const lfos = [];
  const G = (v = 1) => { const n = ac.createGain(); n.gain.value = v; all.push(n); return n; };
  const F = (type, f, q = 0.7) => { const n = ac.createBiquadFilter(); n.type = type; n.frequency.value = f; n.Q.value = q; all.push(n); return n; };
  const D = (max, t) => { const n = ac.createDelay(max); n.delayTime.value = t; all.push(n); return n; };
  const P = (p) => { const n = ac.createStereoPanner(); n.pan.value = p; all.push(n); return n; };
  const lfo = (rate, depth, param) => {
    const o = ac.createOscillator(); o.frequency.value = rate;
    const g = G(depth); o.connect(g); g.connect(param); o.start(); lfos.push(o);
  };

  // master chain: mix -> tape saturation -> tape lowpass -> flutter -> trim -> out
  const mix = G(1);
  const sat = ac.createWaveShaper(); sat.curve = tapeCurve(); sat.oversample = '2x'; all.push(sat);
  const tapeLP = F('lowpass', 11500, 0.5);
  const tapeHP = F('highpass', 26, 0.7);
  const flutter = D(0.05, 0.012);
  lfo(0.55, 0.00026, flutter.delayTime);
  lfo(0.13, 0.00035, flutter.delayTime);
  lfo(5.7, 0.00004, flutter.delayTime);
  const master = G(0.9);
  mix.connect(sat); sat.connect(tapeLP); tapeLP.connect(tapeHP); tapeHP.connect(flutter); flutter.connect(master); master.connect(out);

  // dark reverb (shared): send -> highpass -> predelay -> convolver -> return
  const revSend = G(1);
  const revHP = F('highpass', 170, 0.6);
  const pre = D(0.1, 0.028);
  const conv = ac.createConvolver(); conv.buffer = makeIR(ac, 3.4, { bright: 0.5, dark: 0.44, seed: 3 }); all.push(conv);
  const revRet = G(0.62);
  revSend.connect(revHP); revHP.connect(pre); pre.connect(conv); conv.connect(revRet); revRet.connect(mix);

  // drums: kick bus and snare bus (dry, plus hard-gated reverb)
  const kickBus = G(1); kickBus.connect(mix);
  const snareBus = G(1); snareBus.connect(mix);
  const gateSend = G(1);
  const gateConv = ac.createConvolver(); gateConv.buffer = makeIR(ac, 0.5, { bright: 0.62, dark: 0.2, seed: 9 }); all.push(gateConv);
  const gateGain = G(0);
  const gateRet = G(0.75);
  snareBus.connect(gateSend); gateSend.connect(gateConv); gateConv.connect(gateGain); gateGain.connect(gateRet); gateRet.connect(mix);
  const hatBus = G(1); hatBus.connect(mix);

  // ducked buses
  const bassBus = G(1), duckBass = G(1);
  bassBus.connect(duckBass); duckBass.connect(mix);

  const padBus = G(1), duckPad = G(1);
  padBus.connect(duckPad);
  const chIn = G(1), chOut = G(1);
  duckPad.connect(chIn);
  const chDry = G(0.72); chIn.connect(chDry); chDry.connect(chOut);
  const c1 = D(0.06, 0.019), c2 = D(0.06, 0.027);
  lfo(0.27, 0.0042, c1.delayTime); lfo(0.19, 0.0046, c2.delayTime);
  const p1 = P(-0.85), p2 = P(0.85), w1 = G(0.55), w2 = G(0.55);
  chIn.connect(c1); c1.connect(p1); p1.connect(w1); w1.connect(chOut);
  chIn.connect(c2); c2.connect(p2); p2.connect(w2); w2.connect(chOut);
  chOut.connect(mix);
  const padRev = G(0.38); chOut.connect(padRev); padRev.connect(revSend);

  const arpBus = G(1), duckArp = G(1), arpOut = G(1);
  arpBus.connect(duckArp); duckArp.connect(arpOut); arpOut.connect(mix);
  const arpRev = G(0.3); arpOut.connect(arpRev); arpRev.connect(revSend);

  const leadBus = G(1); leadBus.connect(mix);
  const leadRev = G(0.42); leadBus.connect(leadRev); leadRev.connect(revSend);

  // dark ping-pong delay, dotted eighth. Every echo passes a lowpass so the repeats get progressively dimmer.
  const delIn = G(1);
  const delHP = F('highpass', 230, 0.6);
  const dL = D(2, BEAT * 0.75), dR = D(2, BEAT * 0.75);
  const lpL = F('lowpass', 1700, 0.4), lpR = F('lowpass', 1500, 0.4);
  const fbL = G(0.46), fbR = G(0.46);
  const merger = ac.createChannelMerger(2); all.push(merger);
  const delRet = G(0.55);
  delIn.connect(delHP); delHP.connect(dL);
  dL.connect(lpL); lpL.connect(fbL); fbL.connect(dR);
  dR.connect(lpR); lpR.connect(fbR); fbR.connect(dL);
  lpL.connect(merger, 0, 0); lpR.connect(merger, 0, 1);
  merger.connect(delRet); delRet.connect(mix);
  const arpDel = G(0.5); arpOut.connect(arpDel); arpDel.connect(delIn);
  const leadDel = G(0.42); leadBus.connect(leadDel); leadDel.connect(delIn);
  // pad gets a whisper of delay too
  const padDel = G(0.08); chOut.connect(padDel); padDel.connect(delIn);

  return {
    kickBus, snareBus, hatBus, bassBus, padBus, arpBus, leadBus,
    // sidechain-style pump: bass ducks hardest, pad and arp a little
    duck(t, depth = 0.34, rel = 0.26) {
      const list = [[duckBass, depth], [duckPad, 1 - (1 - depth) * 0.42], [duckArp, 1 - (1 - depth) * 0.55]];
      for (const [n, d] of list) {
        n.gain.setValueAtTime(1, t);
        n.gain.linearRampToValueAtTime(d, t + 0.007);
        n.gain.linearRampToValueAtTime(1, t + rel);
      }
    },
    // hard gate on the snare reverb tail
    gate(t, hold = 0.17) {
      const g = gateGain.gain;
      g.setValueAtTime(0, t - 0.002);
      g.setValueAtTime(1, t);
      g.setValueAtTime(1, t + hold);
      g.linearRampToValueAtTime(0, t + hold + 0.02);
    },
    dispose() {
      for (const o of lfos) { try { o.stop(); } catch (e) { /* ignore */ } }
      for (const n of all) { try { n.disconnect(); } catch (e) { /* ignore */ } }
    },
  };
}
