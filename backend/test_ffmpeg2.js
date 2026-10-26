const cp = require('child_process');
const fp = require('ffmpeg-static');
cp.execSync('"' + fp + '" -y -i temp/test_android.mp4 -vn -ac 1 -ar 16000 -ab 64k -c:a libmp3lame temp/test_audio.mp3', {stdio: 'inherit'});
