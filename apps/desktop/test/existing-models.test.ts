import { describe, expect, it } from 'vitest';
import { existingLocations } from '../src/main/models/existing-models';

const HOME = '/home/ana';

describe('existingLocations', () => {
  it('uses the default Hugging Face cache and Handy folder on Linux', () => {
    expect(existingLocations({}, HOME, 'linux')).toEqual({
      hubCaches: ['/home/ana/.cache/huggingface/hub'],
      folders: ['/home/ana/.local/share/com.pais.handy/models'],
    });
  });

  it('follows the XDG and Hugging Face variables on Linux, without duplicates', () => {
    const env = { HF_HUB_CACHE: '/data/hub', HF_HOME: '/data', XDG_CACHE_HOME: '/xdg/cache', XDG_DATA_HOME: '/xdg/data' };

    expect(existingLocations(env, HOME, 'linux')).toEqual({
      hubCaches: ['/data/hub', '/xdg/cache/huggingface/hub', '/home/ana/.cache/huggingface/hub'],
      folders: ['/xdg/data/com.pais.handy/models'],
    });
  });

  it('ignores empty variables', () => {
    const env = { HF_HUB_CACHE: '', HF_HOME: '', XDG_CACHE_HOME: '', XDG_DATA_HOME: '' };

    expect(existingLocations(env, HOME, 'linux')).toEqual(existingLocations({}, HOME, 'linux'));
  });

  it('uses Application Support for Handy on macOS', () => {
    expect(existingLocations({ HF_HOME: '/Volumes/hf' }, '/Users/ana', 'darwin')).toEqual({
      hubCaches: ['/Volumes/hf/hub', '/Users/ana/.cache/huggingface/hub'],
      folders: ['/Users/ana/Library/Application Support/com.pais.handy/models'],
    });
  });
});
