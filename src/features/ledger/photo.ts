import { MAX_PHOTOS, MAX_PHOTO_CHARS } from '../../domain/records';

/** 逐级降边与降质，直到压进 MAX_PHOTO_CHARS 以内，避免撑爆 localStorage 与云端请求体。 */
const EDGE_STEPS = [720, 560, 440] as const;
const QUALITY_STEPS = [0.72, 0.6, 0.5] as const;

export async function imageToDataUrl(file: File, maxEdge = 720): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('读取照片失败'));
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => reject(new Error('这个照片格式暂时读不了'));
      image.onload = () => {
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        if (!context) { reject(new Error('无法处理这张照片')); return; }
        for (const edge of EDGE_STEPS) {
          const limit = Math.min(maxEdge, edge);
          const scale = Math.min(1, limit / Math.max(image.width, image.height));
          canvas.width = Math.max(1, Math.round(image.width * scale));
          canvas.height = Math.max(1, Math.round(image.height * scale));
          context.clearRect(0, 0, canvas.width, canvas.height);
          context.drawImage(image, 0, 0, canvas.width, canvas.height);
          for (const quality of QUALITY_STEPS) {
            const dataUrl = canvas.toDataURL('image/jpeg', quality);
            if (dataUrl.length <= MAX_PHOTO_CHARS) { resolve(dataUrl); return; }
          }
        }
        reject(new Error('照片压到上限仍然太大，换一张或裁剪后再试。'));
      };
      image.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

export type PhotoImportResult = { photos: string[]; error: string };

export async function filesToPhotos(
  files: readonly File[],
  convert: (file: File) => Promise<string> = imageToDataUrl,
): Promise<PhotoImportResult> {
  const images = files.filter((file) => file.type.startsWith('image/')).slice(0, MAX_PHOTOS);
  if (!images.length) return { photos: [], error: files.length ? '只能添加图片文件。' : '' };
  const results = await Promise.all(images.map(async (file) => {
    try {
      return { photo: await convert(file), error: '' };
    } catch (reason) {
      return { photo: '', error: reason instanceof Error ? reason.message : '读取照片失败' };
    }
  }));
  const photos = results.map((item) => item.photo).filter(Boolean);
  const errors = results.map((item) => item.error).filter(Boolean);
  const detail = [...new Set(errors)][0] ?? '';
  return {
    photos,
    error: errors.length ? `${errors.length} 张照片未能添加${detail ? `：${detail}` : '。'}` : '',
  };
}
