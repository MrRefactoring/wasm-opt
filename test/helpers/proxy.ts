import { createServer, type Server } from 'node:http';
import { connect } from 'node:net';

export function recordingProxy(seen: string[]): Server {
  const server = createServer((request, response) => {
    seen.push(request.url ?? '');
    response.writeHead(200, { 'content-type': 'text/plain' });
    response.end('via-proxy');
  });

  server.on('connect', (request, socket, head) => {
    seen.push(request.url ?? '');
    socket.pause();

    const [host, port] = (request.url ?? '').split(':');
    const upstream = connect(Number(port), host, () => {
      socket.write('HTTP/1.1 200 Connection Established\r\n\r\n', () => {
        if (head.length > 0) {
          upstream.write(head);
        }

        upstream.pipe(socket);
        socket.pipe(upstream);
        socket.resume();
      });
    });

    upstream.on('error', () => socket.destroy());
    socket.on('error', () => upstream.destroy());
  });

  return server;
}
