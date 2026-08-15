import { AdminServer } from '../src/infrastructure/web/admin-server.js';
import http from 'http';
import fs from 'fs';

async function main() {
  const server = new AdminServer({ port: 4101 });
  await server.start();

  const html = await new Promise((resolve) => {
    http.get('http://localhost:4101/', (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => resolve(body));
    });
  });

  await server.stop();

  const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);
  if (scriptMatch) {
    const jsCode = scriptMatch[1];
    fs.writeFileSync('scratch/extracted_admin_client.js', jsCode);
    console.log('Saved extracted JS to scratch/extracted_admin_client.js');
  }
}

main().catch(console.error);
