/**
 * jobs.js
 *
 * Gestionnaire de tâches longues commun (génération de clips, sous-titres,
 * export de l'éditeur, composer) :
 *   - file d'attente avec concurrence limitée (le pipeline est lourd en CPU/GPU) ;
 *   - historique d'événements rejoué aux clients SSE qui se (re)connectent ;
 *   - annulation réelle via AbortController : les processus enfants
 *     (yt-dlp, Whisper, ffmpeg...) reçoivent le signal et sont tués.
 */
const { v4: uuidv4 } = require('uuid');

const MAX_CONCURRENT_JOBS = Number(process.env.MAX_CONCURRENT_JOBS) || 1;
const JOB_TTL_MS = 60 * 60 * 1000;

const jobs = new Map();
const queue = [];
let running = 0;

class JobCancelledError extends Error {
  constructor() {
    super("Tâche annulée par l'utilisateur.");
    this.name = 'JobCancelledError';
  }
}

function emit(jobId, type, data) {
  const job = jobs.get(jobId);
  if (!job) return;
  const event = { type, data };
  job.history.push(event);
  // On ne garde pas un historique infini de progression (seul le dernier compte).
  if (job.history.length > 400) job.history.splice(1, job.history.length - 300);
  for (const res of job.listeners) res.write(`data: ${JSON.stringify(event)}\n\n`);
}

function acquireSlot() {
  if (running < MAX_CONCURRENT_JOBS) {
    running += 1;
    return Promise.resolve();
  }
  return new Promise((resolve) => queue.push(resolve));
}

function releaseSlot() {
  const next = queue.shift();
  if (next) next();
  else running = Math.max(0, running - 1);
}

/**
 * Crée et lance une tâche. `run(ctx)` reçoit :
 *   ctx.emit(type, data)    : envoie un événement aux clients
 *   ctx.step(n, message, %) : raccourci pour un événement 'step'
 *   ctx.progress(data)      : raccourci pour un événement 'progress'
 *   ctx.signal              : AbortSignal à passer aux processus enfants
 *   ctx.throwIfCancelled()  : lève JobCancelledError si l'utilisateur a annulé
 * La valeur retournée par `run` est envoyée dans l'événement 'done'.
 */
function startJob({ kind = 'job', run, onFinally, exclusive = true } = {}) {
  const id = uuidv4();
  const controller = new AbortController();
  const job = { id, kind, history: [], listeners: new Set(), done: false, controller, createdAt: Date.now() };
  jobs.set(id, job);

  const ctx = {
    id,
    signal: controller.signal,
    emit: (type, data) => emit(id, type, data),
    step: (step, message, percent = 0) => emit(id, 'step', { step, message, percent }),
    progress: (data) => emit(id, 'progress', data),
    throwIfCancelled: () => {
      if (controller.signal.aborted) throw new JobCancelledError();
    },
  };

  (async () => {
    if (exclusive) {
      emit(id, 'queued', { position: queue.length + (running >= MAX_CONCURRENT_JOBS ? 1 : 0) });
      await acquireSlot();
    }
    try {
      ctx.throwIfCancelled();
      const result = await run(ctx);
      ctx.throwIfCancelled();
      emit(id, 'done', result === undefined ? {} : result);
    } catch (err) {
      const cancelled = controller.signal.aborted || err instanceof JobCancelledError;
      if (!cancelled) console.error(`[job ${kind} ${id}] Erreur :`, err);
      emit(id, 'error', { error: cancelled ? new JobCancelledError().message : err.message || 'Erreur interne du serveur.', cancelled });
    } finally {
      if (exclusive) releaseSlot();
      try {
        if (onFinally) await onFinally();
      } catch (e) {
        console.warn(`[job ${id}] Nettoyage échoué : ${e.message}`);
      }
      job.done = true;
      for (const res of job.listeners) {
        res.write(`data: ${JSON.stringify({ type: 'closed' })}\n\n`);
        res.end();
      }
      job.listeners.clear();
      setTimeout(() => jobs.delete(id), JOB_TTL_MS).unref?.();
    }
  })();

  return id;
}

function getJob(id) {
  return jobs.get(id) || null;
}

function cancelJob(id) {
  const job = jobs.get(id);
  if (!job) return false;
  job.controller.abort();
  return true;
}

/** Handler Express : flux SSE de la tâche (rejoue l'historique puis suit le direct). */
function sseHandler(req, res) {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Tâche introuvable.' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  for (const event of job.history) res.write(`data: ${JSON.stringify(event)}\n\n`);
  if (job.done) {
    res.write(`data: ${JSON.stringify({ type: 'closed' })}\n\n`);
    return res.end();
  }

  job.listeners.add(res);
  // Ping régulier pour éviter que des proxys ne coupent la connexion inactive.
  const ping = setInterval(() => res.write(': ping\n\n'), 20000);
  req.on('close', () => {
    clearInterval(ping);
    job.listeners.delete(res);
  });
}

function cancelHandler(req, res) {
  if (cancelJob(req.params.jobId)) return res.json({ success: true });
  return res.status(404).json({ error: 'Tâche introuvable.' });
}

module.exports = { startJob, getJob, cancelJob, sseHandler, cancelHandler, JobCancelledError };
