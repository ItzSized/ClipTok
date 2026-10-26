const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const { path: ffprobePath } = require('@ffprobe-installer/ffprobe');

ffmpeg.setFfmpegPath(ffmpegPath);
ffmpeg.setFfprobePath(ffprobePath);

function probeClip(videoPath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(videoPath, (err, data) => {
      if (err) return reject(err);
      
      const vStream = data.streams.find((s) => s.codec_type === 'video');
      if (!vStream) return reject(new Error('Aucun flux vidéo détecté.'));

      const aStream = data.streams.find((s) => s.codec_type === 'audio');

      // Parse fps (e.g., "30/1" or "60000/1001")
      let fps = 30; // default fallback
      if (vStream.r_frame_rate) {
        const parts = vStream.r_frame_rate.split('/');
        if (parts.length === 2 && parseInt(parts[1], 10) !== 0) {
          fps = parseFloat(parts[0]) / parseFloat(parts[1]);
        } else if (parts.length === 1) {
          fps = parseFloat(parts[0]);
        }
      }

      resolve({
        duration: parseFloat(data.format.duration) || 0,
        width: vStream.width,
        height: vStream.height,
        fps: fps,
        codec: vStream.codec_name,
        pixelFormat: vStream.pix_fmt,
        hasAudio: !!aStream,
        audioCodec: aStream ? aStream.codec_name : null,
      });
    });
  });
}

module.exports = { probeClip };
