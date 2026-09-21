import { parentPort, workerData } from 'node:worker_threads';
import { sanitizeDrawing } from './drawings-api.js';
try { parentPort.postMessage({ png: sanitizeDrawing(Buffer.from(workerData)) }); }
catch (error) { parentPort.postMessage({ status: error.status || 400, error: error.status ? error.message : 'Invalid drawing.' }); }
