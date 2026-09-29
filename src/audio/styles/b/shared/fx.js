// Effects graph for the style B tracks (same signal flow as the B title theme, parametrised per track):
// tape saturation and flutter, dark convolution reverb (procedural impulse response), hard-gated snare reverb,
// dark ping-pong delay tied to the tempo, pad chorus and sidechain-style duck gains.
import { mulberry32 } from './util.js';

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
      d[i] = lp * Math.min(1, i / (sr * 0.004));
    }
  }
  return buf;
}

// Gentle asymmetric tanh: tape-like warmth, unity gain for small signals
function tapeCurve(k = 1.35) {
  const n = 2048, c = new Float32Array(n), b = 0.07;
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / (n - 1) - 1;
    c[i] = (Math.tanh(k * x + b) - Math.tanh(b)) / k;
  }
  return c;
}

export function buildFx(ac, out, o = {}) {
  const {
    bpm = 92, trim = 0.9, satK = 1.35, tapeHz = 11500,
    revSec = 3.4, revBright = 0.5, revDark = 0.44, revHP = 170, revRet = 0.62, revPre = 0.028, revSeed = 3,
    delBeats = 0.75, delFb = 0.46, delLpL = 1700, delLpR = 1500, delRet = 0.55, delHP = 230,
    padRev = 0.38, arpRev = 0.3, leadRev = 0.42, percRev = 0.18, arpDel = 0.5, leadDel = 0.42, padDel = 0.08, percDel = 0.12,
    gateRet = 0.75, gateSec = 0.5, duckPad = 0.42, duckArp = 0.55, chorus = 1,
  } = o;
  const beat = 60 / bpm;
  const all = [];
  const lfos = [];
  const G = (v = 1) => { const n = ac.createGain(); n.gain.value = v; all.push(n); return n; };
  const F = (type, f, q = 0.7) => { const n = ac.createBiquadFilter(); n.type = type; n.frequency.value = f; n.Q.value = q; all.push(n); return n; };
  const D = (max, t) => { const n = ac.createDelay(max); n.delayTime.value = t; all.push(n); return n; };
  const P = (p) => { const n = ac.createStereoPanner(); n.pan.value = p; all.push(n); return n; };
  const lfo = (rate, depth, param) => {
    const os = ac.createOscillator(); os.frequency.value = rate;
    const g = G(depth); os.connect(g); g.connect(param); os.start(); lfos.push(os);
  };

  // master chain: mix -> tape saturation -> tape lowpass -> flutter -> trim -> out
  const mix = G(1);
  const sat = ac.createWaveShaper(); sat.curve = tapeCurve(satK); sat.oversample = '2x'; all.push(sat);
  const tapeLP = F('lowpass', tapeHz, 0.5);
  const tapeHP = F('highpass', 26, 0.7);
  const flutter = D(0.05, 0.012);
  lfo(0.55, 0.00026, flutter.delayTime);
  lfo(0.13, 0.00035, flutter.delayTime);
  lfo(5.7, 0.00004, flutter.delayTime);
  const master = G(trim);
  mix.connect(sat); sat.connect(tapeLP); tapeLP.connect(tapeHP); tapeHP.connect(flutter); flutter.connect(master); master.connect(out);

  // dark reverb (shared): send -> highpass -> predelay -> convolver -> return
  const revSend = G(1);
  const rHP = F('highpass', revHP, 0.6);
  const pre = D(0.1, revPre);
  const conv = ac.createConvolver(); conv.buffer = makeIR(ac, revSec, { bright: revBright, dark: revDark, seed: revSeed }); all.push(conv);
  const rRet = G(revRet);
  revSend.connect(rHP); rHP.connect(pre); pre.connect(conv); conv.connect(rRet); rRet.connect(mix);

  // drums: kick bus and snare bus (dry, plus hard-gated reverb), hats, extra percussion
  const kickBus = G(1); kickBus.connect(mix);
  const snareBus = G(1); snareBus.connect(mix);
  const gateSend = G(1);
  const gateConv = ac.createConvolver(); gateConv.buffer = makeIR(ac, gateSec, { bright: 0.62, dark: 0.2, seed: 9 }); all.push(gateConv);
  const gateGain = G(0);
  const gRet = G(gateRet);
  snareBus.connect(gateSend); gateSend.connect(gateConv); gateConv.connect(gateGain); gateGain.connect(gRet); gRet.connect(mix);
  const hatBus = G(1); hatBus.connect(mix);
  const percBus = G(1); percBus.connect(mix);
  const pRev = G(percRev); percBus.connect(pRev); pRev.connect(revSend);

  // ducked buses
  const bassBus = G(1), dBass = G(1);
  bassBus.connect(dBass); dBass.connect(mix);

  const padBus = G(1), dPad = G(1);
  padBus.connect(dPad);
  const chIn = G(1), chOut = G(1);
  dPad.connect(chIn);
  const chDry = G(0.72); chIn.connect(chDry); chDry.connect(chOut);
  const c1 = D(0.06, 0.019), c2 = D(0.06, 0.027);
  lfo(0.27, 0.0042, c1.delayTime); lfo(0.19, 0.0046, c2.delayTime);
  const p1 = P(-0.85), p2 = P(0.85), w1 = G(0.55 * chorus), w2 = G(0.55 * chorus);
  chIn.connect(c1); c1.connect(p1); p1.connect(w1); w1.connect(chOut);
  chIn.connect(c2); c2.connect(p2); p2.connect(w2); w2.connect(chOut);
  chOut.connect(mix);
  const pdRev = G(padRev); chOut.connect(pdRev); pdRev.connect(revSend);

  const arpBus = G(1), dArp = G(1), arpOut = G(1);
  arpBus.connect(dArp); dArp.connect(arpOut); arpOut.connect(mix);
  const aRev = G(arpRev); arpOut.connect(aRev); aRev.connect(revSend);

  const leadBus = G(1); leadBus.connect(mix);
  const lRev = G(leadRev); leadBus.connect(lRev); lRev.connect(revSend);

  // dark ping-pong delay. Every echo passes a lowpass so the repeats get progressively dimmer.
  const delIn = G(1);
  const dHP = F('highpass', delHP, 0.6);
  const dL = D(2.5, beat * delBeats), dR = D(2.5, beat * delBeats);
  const lpL = F('lowpass', delLpL, 0.4), lpR = F('lowpass', delLpR, 0.4);
  const fbL = G(delFb), fbR = G(delFb);
  const merger = ac.createChannelMerger(2); all.push(merger);
  const dRet = G(delRet);
  delIn.connect(dHP); dHP.connect(dL);
  dL.connect(lpL); lpL.connect(fbL); fbL.connect(dR);
  dR.connect(lpR); lpR.connect(fbR); fbR.connect(dL);
  lpL.connect(merger, 0, 0); lpR.connect(merger, 0, 1);
  merger.connect(dRet); dRet.connect(mix);
  const aDel = G(arpDel); arpOut.connect(aDel); aDel.connect(delIn);
  const lDel = G(leadDel); leadBus.connect(lDel); lDel.connect(delIn);
  const pdDel = G(padDel); chOut.connect(pdDel); pdDel.connect(delIn);
  const pcDel = G(percDel); percBus.connect(pcDel); pcDel.connect(delIn);

  return {
    kickBus, snareBus, hatBus, percBus, bassBus, padBus, arpBus, leadBus, master, mix, delIn, revSend,
    // sidechain-style pump: bass ducks hardest, pad and arp a little
    duck(t, depth = 0.34, rel = 0.26) {
      const list = [[dBass, depth], [dPad, 1 - (1 - depth) * duckPad], [dArp, 1 - (1 - depth) * duckArp]];
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
      for (const os of lfos) { try { os.stop(); } catch (e) { /* ignore */ } }
      for (const n of all) { try { n.disconnect(); } catch (e) { /* ignore */ } }
    },
  };
}
