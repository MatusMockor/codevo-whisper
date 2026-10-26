import manifest from '../package.json' with { type: 'json' };

export const SERVER_VERSION: string = manifest.version;
