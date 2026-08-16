import { Client } from 'ssh2';

const conn = new Client();
conn.on('ready', () => {
  console.log('✅ SSH Connected to fetch production logs');
  
  conn.exec(`cd /var/www/werewolf && docker compose logs --tail 50 app`, (err, stream) => {
    if (err) { console.error('Error getting logs:', err); conn.end(); return; }
    let out = '';
    stream.on('data', d => out += d.toString());
    stream.stderr.on('data', d => out += d.toString());
    stream.on('close', () => {
      console.log('\n=== Production Logs (Last 50 lines) ===');
      console.log(out);
      conn.end();
    });
  });
});

conn.on('error', err => console.error('SSH Error:', err));

conn.connect({
  host: '95.111.249.141',
  port: 22,
  username: 'root',
  password: 'TAnkeu987000',
  readyTimeout: 20000,
});
