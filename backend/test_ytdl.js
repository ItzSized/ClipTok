const ytdl = require('@distube/ytdl-core');

async function test() {
  try {
    const info = await ytdl.getInfo('https://www.youtube.com/watch?v=Zs2oRw1_TWU');
    console.log('Title:', info.videoDetails.title);
  } catch (err) {
    console.error('Error:', err.message);
  }
}
test();
