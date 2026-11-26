// 系統狀態：CPU、記憶體（Node 內建）、NVIDIA 顯示卡（nvidia-smi）
import { cpus, totalmem, freemem, uptime } from 'node:os';
import { execFile } from 'node:child_process';

let prev = snapshot();

function snapshot() {
  let idle = 0;
  let total = 0;
  for (const c of cpus()) {
    const t = c.times;
    idle += t.idle;
    total += t.user + t.nice + t.sys + t.idle + t.irq;
  }
  return { idle, total };
}

/** 距離上次呼叫這段時間的 CPU 使用率（%） */
function cpuPercent() {
  const now = snapshot();
  const dTotal = now.total - prev.total;
  const dIdle = now.idle - prev.idle;
  prev = now;
  return dTotal > 0 ? Math.round((1 - dIdle / dTotal) * 100) : 0;
}

interface Gpu { name: string; util: number; temp: number; memUsed: number; memTotal: number }
let gpuCache: { at: number; gpu: Gpu | null } = { at: 0, gpu: null };

function queryGpu(): Promise<Gpu | null> {
  if (Date.now() - gpuCache.at < 1500) return Promise.resolve(gpuCache.gpu);
  return new Promise((resolve) => {
    execFile(
      'nvidia-smi',
      ['--query-gpu=name,utilization.gpu,temperature.gpu,memory.used,memory.total', '--format=csv,noheader,nounits'],
      { timeout: 2000, windowsHide: true },
      (err, out) => {
        let gpu: Gpu | null = null;
        if (!err) {
          const [name, util, temp, used, total] = out.trim().split('\n')[0].split(',').map((s) => s.trim());
          gpu = { name, util: +util, temp: +temp, memUsed: +used, memTotal: +total };
        }
        gpuCache = { at: Date.now(), gpu };
        resolve(gpu);
      },
    );
  });
}

export async function getSysInfo() {
  const total = totalmem();
  const used = total - freemem();
  return {
    cpu: { percent: cpuPercent(), cores: cpus().length, model: cpus()[0]?.model.trim() ?? '' },
    mem: { percent: Math.round((used / total) * 100), usedGB: +(used / 1e9).toFixed(1), totalGB: +(total / 1e9).toFixed(1) },
    gpu: await queryGpu(),
    uptimeH: +(uptime() / 3600).toFixed(1),
  };
}
