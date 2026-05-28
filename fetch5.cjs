const play = require('play-dl');
const fs = require('fs');

async function download() {
  try {
    const stream = await play.stream('https://www.youtube.com/watch?v=ux0Qnn2XEgM');
    const writeStream = fs.createWriteStream('godfather_temp.mp3');
    stream.stream.pipe(writeStream);
    writeStream.on('finish', () => {
      console.log('done');
      const { execSync } = require('child_process');
      execSync('ffmpeg -y -i godfather_temp.mp3 -ss 00:00:20 -t 15 godfather-theme-15s.mp3');
      console.log('ffmpeg done');
    });
  } catch(e) { console.error('play-dl error', e); }
}
download();
