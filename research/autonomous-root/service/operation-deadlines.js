'use strict';
// Fixed response budgets, independent of command/job execution deadlines.
// Callers cannot extend these with an operation field. Keep the Python client
// and parity contract in sync; tests check both against that contract.
const DEFAULT_MS=30000;
const STORAGE_MS=Object.freeze({
 'file.open':120000,'file.commit':120000,'helper.prepare':120000,
 'file.read':60000,'file.write':60000
});
function operationDeadline(op){return Object.prototype.hasOwnProperty.call(STORAGE_MS,op)?STORAGE_MS[op]:DEFAULT_MS;}
module.exports={operationDeadline,HTTP_MARGIN_MS:5000,CLIENT_MARGIN_MS:10000};
