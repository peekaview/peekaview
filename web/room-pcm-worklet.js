// One second of 16 kHz mono PCM for the local transcript. Output stays silent.
class RoomPcm extends AudioWorkletProcessor {
  constructor() { super(); this.samples=new Int16Array(16000);this.offset=0 }
  process(inputs) {
    const channels=inputs[0]
    if(!channels?.length) return true
    for(let i=0;i<channels[0].length;i++) {
      let sample=0
      for(const channel of channels) sample+=channel[i]/channels.length
      this.samples[this.offset++]=Math.max(-1,Math.min(1,sample))*32767
      if(this.offset===this.samples.length){this.port.postMessage(this.samples.buffer,[this.samples.buffer]);this.samples=new Int16Array(16000);this.offset=0}
    }
    return true
  }
}
registerProcessor('peekaview-room-pcm',RoomPcm)
