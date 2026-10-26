const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
ffmpeg.setFfmpegPath(ffmpegPath);

ffmpeg('temp/a9ef17bf-d945-4de5-940b-e4409ef1b1e5/source.mkv')
  .outputOptions([
    '-filter_complex_script', 'temp/a9ef17bf-d945-4de5-940b-e4409ef1b1e5/filter.txt',
    '-map', '[vout]',
    '-map', '[a1]',
    '-c:v', 'h264_nvenc',
    '-preset', 'p6',
    '-t', '5'
  ])
  .on('progress', p => console.log('progress:', p))
  .on('end', () => console.log('Done!'))
  .on('error', e => console.error('Error:', e))
  .save('temp/test.mp4');
