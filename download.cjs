const https = require('https');
const fs = require('fs');
const { spawn } = require('child_process');

https.get('https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp', (response) => {
  if (response.statusCode === 302) {
    https.get(response.headers.location, (res) => {
      const file = fs.createWriteStream('./yt-dlp');
      res.pipe(file);
      file.on('finish', () => {
        file.close();
        fs.chmodSync('./yt-dlp', '755');
        const dl = spawn('./yt-dlp', ['-f', 'ba', '-x', '--audio-format', 'mp3', '-o', 'godfather_temp.mp3', 'https://www.youtube.com/watch?v=ux0Qnn2XEgM']);
        dl.stdout.on('data', d => console.log(d.toString()));
        dl.stderr.on('data', d => console.error(d.toString()));
        dl.on('close', code => {
          if (code === 0) {
            const ff = spawn('ffmpeg', ['-i', 'godfather_temp.mp3', '-ss', '00:00:20', '-t', '15', 'godfather-theme-15s.mp3']);
            ff.on('close', c => console.log('FFMPEG done', c));
          }
        });
      });
    });
  }
});
