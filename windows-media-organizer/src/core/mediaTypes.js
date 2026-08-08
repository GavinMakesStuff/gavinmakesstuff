'use strict';

const IMAGE_EXT = new Set([
  '.jpg', '.jpeg', '.png', '.heic', '.heif', '.tif', '.tiff', '.bmp', '.gif',
  '.webp', '.raw', '.cr2', '.cr3', '.nef', '.arw', '.dng', '.orf', '.rw2',
]);

const VIDEO_EXT = new Set([
  '.mp4', '.mov', '.avi', '.mkv', '.wmv', '.m4v', '.mpg', '.mpeg', '.3gp', '.webm',
]);

const AUDIO_EXT = new Set([
  '.mp3', '.wav', '.flac', '.aac', '.m4a', '.wma', '.ogg', '.aiff', '.alac',
]);

function classify(ext) {
  const e = ext.toLowerCase();
  if (IMAGE_EXT.has(e)) return 'image';
  if (VIDEO_EXT.has(e)) return 'video';
  if (AUDIO_EXT.has(e)) return 'audio';
  return 'other';
}

function isMediaExt(ext) {
  return classify(ext) !== 'other';
}

module.exports = { IMAGE_EXT, VIDEO_EXT, AUDIO_EXT, classify, isMediaExt };
