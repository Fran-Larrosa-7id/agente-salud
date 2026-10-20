import type { Request, Response } from 'express';
import type { ImportJob, JobEvent } from '../jobs/job.js';

const HEARTBEAT_MS = 15_000;

function write(res: Response, id: number | null, type: string, data: unknown): void {
  if (id !== null) res.write(`id: ${id}\n`);
  res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
}

/**
 * GET /api/imports/:jobId/events
 * Primero envía un "snapshot" con el estado completo (para quien se conecta tarde o se reconecta)
 * y después cada evento. Solo estados resumidos: nunca razonamiento interno del agente.
 */
export function streamJobEvents(req: Request, res: Response, job: ImportJob, authorized: () => boolean = () => true): void {
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-store',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });
  res.write('retry: 2000\n\n');
  write(res, null, 'snapshot', job.snapshot());

  const onEvent = (ev: JobEvent) => { if (!authorized()) { res.end(); return; } write(res, ev.seq, ev.type, { state: ev.state, at: ev.at, ...(ev.data ?? {}) }); };
  job.on('event', onEvent);
  const beat = setInterval(() => { if (!authorized()) res.end(); else res.write(': ping\n\n'); }, HEARTBEAT_MS);
  beat.unref();

  const close = () => {
    clearInterval(beat);
    job.off('event', onEvent);
  };
  req.on('close', close);
  if (job.isTerminal) {
    close();
    res.end();
  } else {
    job.once('terminal', () => {
      // Deja salir el último evento antes de cerrar.
      setTimeout(() => {
        close();
        res.end();
      }, 50);
    });
  }
}
