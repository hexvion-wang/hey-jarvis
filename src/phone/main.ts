import '../style.css';
import { startCamera, CameraError } from './camera';

const video = document.getElementById('cam') as HTMLVideoElement;
const startScreen = document.getElementById('start')!;
const startBtn = document.getElementById('startBtn') as HTMLButtonElement;
const errorEl = document.getElementById('error')!;
const clockEl = document.getElementById('clock')!;
const stateEl = document.getElementById('state')!;

function tickClock() {
  clockEl.textContent = new Date().toLocaleTimeString('zh-TW', { hour12: false });
}
setInterval(tickClock, 1000);
tickClock();

startBtn.addEventListener('click', async () => {
  startBtn.disabled = true;
  errorEl.textContent = '';
  stateEl.textContent = 'BOOTING';
  try {
    const { width, height } = await startCamera(video);
    console.log(`camera ${width}x${height}`);
    startScreen.classList.add('hidden');
    document.body.classList.add('online');
    stateEl.textContent = 'ONLINE';
  } catch (e) {
    errorEl.textContent = e instanceof CameraError ? e.message : String(e);
    stateEl.textContent = 'ERROR';
    startBtn.disabled = false;
  }
});
