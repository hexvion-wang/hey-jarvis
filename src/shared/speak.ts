/** 中文語音回應（speechSynthesis）。優先選台灣中文的聲音。 */

let voice: SpeechSynthesisVoice | null = null;

function pickVoice() {
  const voices = speechSynthesis.getVoices();
  const score = (v: SpeechSynthesisVoice) => {
    let s = 0;
    if (v.lang === 'zh-TW') s += 10;
    else if (v.lang.startsWith('zh')) s += 5;
    if (/google/i.test(v.name)) s += 3; // Chrome 的 Google 國語（臺灣）比較自然
    if (/natural|online/i.test(v.name)) s += 2; // Edge 的線上自然語音
    if (/male|zhiwei|yunjhe/i.test(v.name)) s += 1; // 男聲比較有 Jarvis 的感覺
    return s;
  };
  voice = voices.filter((v) => v.lang.startsWith('zh')).sort((a, b) => score(b) - score(a))[0] ?? null;
}

if ('speechSynthesis' in window) {
  pickVoice();
  speechSynthesis.addEventListener('voiceschanged', pickVoice);
}

export function voiceName() {
  return voice ? voice.name : '（找不到中文語音）';
}

export function speak(text: string): Promise<void> {
  return new Promise((resolve) => {
    if (!('speechSynthesis' in window)) return resolve();
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    if (voice) u.voice = voice;
    u.lang = voice?.lang ?? 'zh-TW';
    u.rate = 1.05;
    u.pitch = 0.9;
    u.onend = () => resolve();
    u.onerror = () => resolve();
    speechSynthesis.speak(u);
    // 保險：有些情況 onend 不會觸發
    setTimeout(resolve, 8000);
  });
}
