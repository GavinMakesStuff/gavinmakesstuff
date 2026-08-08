'use strict';

// ffprobe-static bundles a real ffprobe binary (incl. a Windows .exe), so
// electron-builder can ship it inside the packaged app - no separate
// "install ffmpeg" step for Gavin. If either package is missing (or the
// binary fails on some exotic file), probing degrades to null and callers
// fall back to file-size-only quality comparison instead of crashing.
let ffprobeStatic = null;
let ffmpeg = null;
try {
  ffprobeStatic = require('ffprobe-static');
  ffmpeg = require('fluent-ffmpeg');
  ffmpeg.setFfprobePath(ffprobeStatic.path);
} catch (err) {
  // optional dependency not installed - probing will just be unavailable
}

/**
 * Probes a video/audio file for quality-relevant metadata.
 * @returns {Promise<{width?: number, height?: number, durationSec?: number, bitRate?: number, codec?: string} | null>}
 */
function probeMedia(filePath) {
  if (!ffmpeg) return Promise.resolve(null);
  return new Promise((resolve) => {
    ffmpeg.ffprobe(filePath, (err, data) => {
      if (err || !data) return resolve(null);
      const videoStream = (data.streams || []).find((s) => s.codec_type === 'video');
      const audioStream = (data.streams || []).find((s) => s.codec_type === 'audio');
      const primary = videoStream || audioStream;
      resolve({
        width: videoStream ? videoStream.width : undefined,
        height: videoStream ? videoStream.height : undefined,
        durationSec: data.format && data.format.duration ? Number(data.format.duration) : undefined,
        bitRate: data.format && data.format.bit_rate ? Number(data.format.bit_rate) : undefined,
        codec: primary ? primary.codec_name : undefined,
      });
    });
  });
}

module.exports = { probeMedia, isAvailable: () => Boolean(ffmpeg) };
