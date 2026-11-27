export async function imageToDataUrl(file: File, maxEdge = 720): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('读取照片失败'));
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => reject(new Error('这个照片格式暂时读不了'));
      image.onload = () => {
        const scale = Math.min(1, maxEdge / Math.max(image.width, image.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));
        const context = canvas.getContext('2d');
        if (!context) { reject(new Error('无法处理这张照片')); return; }
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.72));
      };
      image.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

export async function filesToPhotos(files: readonly File[]): Promise<string[]> {
  const images = files.filter((file) => file.type.startsWith('image/'));
  const result = await Promise.all(images.map((file) => imageToDataUrl(file).catch(() => null)));
  return result.filter((value): value is string => value !== null);
}
