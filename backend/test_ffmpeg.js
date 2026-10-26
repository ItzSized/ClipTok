const cp = require('child_process');
const fp = require('ffmpeg-static');
try {
  cp.execSync('"' + fp + '" -i temp/test_android.mp4', { encoding: 'utf8', stdio: 'pipe' });
} catch (e) {
  console.log(e.stderr);
}
