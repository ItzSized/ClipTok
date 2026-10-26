require('dotenv').config();
const { findViralMoment } = require('./services/curator');
const fs = require('fs');
const path = require('path');

const tempDirs = fs.readdirSync('./temp').filter(name => fs.statSync(path.join('./temp', name)).isDirectory() && fs.existsSync(path.join('./temp', name, 'transcript.json')));
if (tempDirs.length > 0) {
    const latestDir = tempDirs[tempDirs.length - 1]; // Just take one
    const t = JSON.parse(fs.readFileSync(path.join('./temp', latestDir, 'transcript.json'), 'utf8'));
    findViralMoment(t, path.join('./temp', latestDir), 60, 8).then(res => {
        console.log('SUCCESS:', res);
    }).catch(err => {
        console.error('ERROR:', err);
    });
} else {
    console.log('No transcript found.');
}
