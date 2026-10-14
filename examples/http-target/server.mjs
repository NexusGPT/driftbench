// A stand-in agent behind a URL, for the http target example. It answers each block with an
// OpenAI-compatible chat completion that repeats the user's last message.
//   node examples/http-target/server.mjs          (listens on 127.0.0.1:8787)
import { createServer } from 'node:http';

export function createEchoServer() {
  return createServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => {
      body += chunk;
    });
    request.on('end', () => {
      const { messages = [] } = JSON.parse(body || '{}');
      const last = messages.filter((message) => message.role === 'user').at(-1);
      const content = `You said: ${last?.content ?? ''}`;
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({ choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }] }),
      );
    });
  });
}

if (process.argv[1] !== undefined && import.meta.url.endsWith(process.argv[1].replace(/^.*[\\/]/, ''))) {
  const port = Number(process.env.PORT ?? 8787);
  createEchoServer().listen(port, '127.0.0.1', () => {
    console.log(`The echo agent listens on http://127.0.0.1:${port}/turn`);
  });
}
