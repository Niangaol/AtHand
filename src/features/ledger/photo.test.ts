import { describe, expect, it } from 'vitest';
import { filesToPhotos } from './photo';

const image = (name: string) => new File(['x'], name, { type: 'image/jpeg' });

describe('photo import', () => {
  it('keeps successful photos and reports the ones that could not be read', async () => {
    const result = await filesToPhotos(
      [image('ok.jpg'), image('broken.jpg')],
      async (file) => {
        if (file.name === 'broken.jpg') throw new Error('这个照片格式暂时读不了');
        return 'data:image/jpeg;base64,ok';
      },
    );

    expect(result.photos).toEqual(['data:image/jpeg;base64,ok']);
    expect(result.error).toContain('1 张');
  });
});