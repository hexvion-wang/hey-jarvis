export class CameraError extends Error {}

/** 開啟前鏡頭並接到 video 元素上，回傳實際的影像尺寸 */
export async function startCamera(video: HTMLVideoElement): Promise<{ width: number; height: number }> {
  if (!window.isSecureContext) {
    throw new CameraError('需要 HTTPS 網址才能開鏡頭');
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new CameraError('這個瀏覽器不支援鏡頭存取');
  }

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: 'user',
        width: { ideal: 640 },
        height: { ideal: 480 },
      },
    });
  } catch (e) {
    const name = (e as DOMException).name;
    if (name === 'NotAllowedError') {
      throw new CameraError('鏡頭權限被拒絕：請到「設定 › Safari › 相機」改成允許，再重新整理');
    }
    if (name === 'NotFoundError') throw new CameraError('找不到鏡頭');
    throw new CameraError(`無法開啟鏡頭（${name}）`);
  }

  video.srcObject = stream;
  // iOS Safari：必須 muted + playsinline 才能在頁面內自動播放
  video.muted = true;
  video.setAttribute('playsinline', '');
  await video.play();

  if (!video.videoWidth) {
    await new Promise<void>((r) => video.addEventListener('loadedmetadata', () => r(), { once: true }));
  }
  return { width: video.videoWidth, height: video.videoHeight };
}
