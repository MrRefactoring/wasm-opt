import { Agent, createServer, request as forwardRequest, type Server } from 'node:http';
import { connect } from 'node:net';

export function recordingProxy(seen: string[]): Server {
  const agent = new Agent({ proxyEnv: {} });
  const server = createServer((request, response) => {
    seen.push(request.url ?? '');
    const upstream = forwardRequest(
      request.url ?? '',
      { method: request.method, headers: request.headers, agent },
      (incoming) => {
        response.writeHead(incoming.statusCode ?? 502, incoming.headers);
        incoming.pipe(response);
      },
    );

    upstream.on('error', () => response.destroy());
    request.pipe(upstream);
  });

  server.on('close', () => agent.destroy());

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
