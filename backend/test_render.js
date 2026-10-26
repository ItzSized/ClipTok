const { renderClip } = require('./services/renderer');
const path = require('path');
const fs = require('fs/promises');

async function test() {
  await fs.mkdir('./temp', { recursive: true });
  await fs.writeFile('./temp/face_track.json', JSON.stringify({
    samples: [{ t: 0, cx: 500, cy: 500 }],
    width: 1920,
    height: 1080
  }));
  renderClip({
    sourceVideoPath: '../temp/test.mp4',
    clip: { start: 10, end: 15 },
    transcript: { words: [{start: 10.5, end: 11, word: "bonjour"}, {start: 11, end: 12, word: "quelqu'un"}] },
    jobDir: './temp',
    outputDir: './output',
    jobId: 'test_job',
    quality: '1080p',
    withSubtitles: true,
    format: 'portrait',
    videoSpeed: 1.0,
    onProgress: console.log
  }).then(console.log).catch(console.error);
}

test();
