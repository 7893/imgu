// /home/admin/imgu/api-lambda/index.mjs (Corrected: Removed duplicate functions)
import config from './config.mjs';
import { getImageDataPage, getSyncState, updateApiSyncState } from './dynamodb.mjs';
import { startSyncStateMachine, stopSyncStateMachine, describeStateMachineExecution } from './stepfunctions.mjs';
import { DynamoDBClient, DescribeTableCommand } from '@aws-sdk/client-dynamodb';
import process from 'node:process';

const ddbClient = new DynamoDBClient({ region: process.env.AWS_REGION });

// --- 辅助函数 (只保留一组定义) ---
const encodeBase64 = (data) => Buffer.from(JSON.stringify(data)).toString('base64url');
const decodeBase64 = (data) => {
    try { return JSON.parse(Buffer.from(data, 'base64url').toString('utf8')); }
    catch (e) { console.error("Failed to decode base64 token:", e); return undefined; }
};

function formatBytes(bytes, decimals = 2) {
  if (!+bytes && bytes !== 0) return 'N/A';
  const absBytes = Math.abs(bytes);
  if (absBytes === 0) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ["Bytes", "KB", "MB", "GB", "TB", "PB", "EB", "ZB", "YB"];
  const i = Math.floor(Math.log(absBytes) / Math.log(k));
  if (i < 0 || i >= sizes.length) { return `${bytes} Bytes`; }
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

function estimateApiResetTime(lastCheckedIsoTimestamp) {
    if (!lastCheckedIsoTimestamp) return null;
    try {
        const lastCheckedDate = new Date(lastCheckedIsoTimestamp);
        lastCheckedDate.setUTCHours(lastCheckedDate.getUTCHours() + 1, 0, 0, 0);
        return lastCheckedDate.toISOString();
    } catch (e) {
        console.error("Error estimating reset time:", e);
        return null;
    }
}
// --- 结束辅助函数 ---


const SYNC_TYPE_OLDEST = 'UNSPLASH_OLDEST_SYNC';
const STATUS_IDLE = 'IDLE';
const STATUS_RUNNING = 'RUNNING';
const STATUS_SUCCEEDED = 'SUCCEEDED';
const STATUS_FAILED = 'FAILED';
const STATUS_TIMED_OUT = 'TIMED_OUT';
const STATUS_ABORTED = 'ABORTED';
const STATUS_STOPPING = 'STOPPING';
const STATUS_UNKNOWN = 'UNKNOWN';

function mapSfnStatus(sfnStatus) {
    switch (sfnStatus) {
        case 'RUNNING': return STATUS_RUNNING; case 'SUCCEEDED': return STATUS_SUCCEEDED;
        case 'FAILED': return STATUS_FAILED; case 'TIMED_OUT': return STATUS_TIMED_OUT;
        case 'ABORTED': return STATUS_ABORTED; default: return STATUS_UNKNOWN;
    }
}
const isTerminalStatus = (status) => ![STATUS_RUNNING, STATUS_STOPPING, STATUS_IDLE, STATUS_UNKNOWN].includes(status);

export const handler = async (event) => {
  // console.log('API request received:', JSON.stringify(event, null, 2));

  const corsHeaders = {
    'Access-Control-Allow-Origin': config.allowedOrigin,
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  };

  const httpMethod = event.requestContext?.http?.method;
  const path = event.rawPath;
  const queryParams = event.queryStringParameters || {};

  // *** 调试日志 (保留) ***
  console.log(`>>> Received Request - Method: [${httpMethod}], Path: [${path}]`);

  if (httpMethod === 'OPTIONS') {
    console.log('Handling OPTIONS preflight request');
    return { statusCode: 204, headers: corsHeaders };
  }

  if (httpMethod === 'GET' && path === '/') {
    console.log('Handling GET request for image gallery page');
    try {
      const limit = parseInt(queryParams.limit || '20', 10);
      const encodedNextToken = queryParams.nextToken;
      let startKey = encodedNextToken ? decodeBase64(encodedNextToken) : undefined;
      const { items, nextToken: nextExclusiveStartKey } = await getImageDataPage(limit, startKey);
      const encodedNextPageToken = nextExclusiveStartKey ? encodeBase64(nextExclusiveStartKey) : null;
      return { statusCode: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ items: items, nextToken: encodedNextPageToken }) };
    } catch (error) { console.error('Error handling GET / request:', error); return { statusCode: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'Internal Server Error on GET /', error: error.message }) }; }
  }

  if (httpMethod === 'POST' && path === '/start-sync') {
     console.log('Handling POST request to start sync'); try { let currentSyncState = await getSyncState(SYNC_TYPE_OLDEST); if (currentSyncState?.lastKnownStatus === STATUS_RUNNING) { if(currentSyncState.currentExecutionArn) { try { const executionDetails = await describeStateMachineExecution(currentSyncState.currentExecutionArn); if (executionDetails.status === 'RUNNING') { console.warn(`Sync is already running with ARN: ${currentSyncState.currentExecutionArn}. Preventing new execution.`); return { statusCode: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'Sync process is already running.', status: STATUS_RUNNING, executionArn: currentSyncState.currentExecutionArn })}; } else { console.warn(`DB status is RUNNING but SFN status is ${executionDetails.status}. Proceeding to start new execution.`); await updateApiSyncState(SYNC_TYPE_OLDEST, { currentExecutionArn: null, lastKnownStatus: mapSfnStatus(executionDetails.status) }); } } catch (describeError) { console.error("Error describing existing execution during start check:", describeError); console.warn("Could not verify status of potentially running execution. Proceeding with caution."); } } else { console.warn("DB status is RUNNING but no execution ARN found. Proceeding to start new execution."); } } let startPage = 1; currentSyncState = await getSyncState(SYNC_TYPE_OLDEST); if (currentSyncState && typeof currentSyncState.lastProcessedPage === 'number' && currentSyncState.lastProcessedPage >= 0) { startPage = currentSyncState.lastProcessedPage + 1; console.log(`Found sync state. Resuming from page: ${startPage}`); } else { console.log('No previous sync state found or invalid page number. Starting from page 1.'); startPage = 1; } const SFN_BATCH_SIZE = 30; const SFN_WAIT_TIME_SECONDS = 120; const sfnInput = { iterator: { currentPage: startPage, batchSize: SFN_BATCH_SIZE, waitTimeSeconds: SFN_WAIT_TIME_SECONDS } }; console.log(`Starting Step Function execution with input: ${JSON.stringify(sfnInput)}`); const executionArn = await startSyncStateMachine(sfnInput); console.log(`Updating sync state: ARN=${executionArn}, Status=${STATUS_RUNNING}`); await updateApiSyncState(SYNC_TYPE_OLDEST, { currentExecutionArn: executionArn, lastKnownStatus: STATUS_RUNNING }); return { statusCode: 202, headers: { ...corsHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ message: `Sync process initiated, starting from page ${startPage}.`, executionArn: executionArn, status: STATUS_RUNNING })}; } catch (error) { console.error('Error handling POST /start-sync request:', error); return { statusCode: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'Failed to start sync process', error: error.message }) }; }
  }

  if (httpMethod === 'POST' && path === '/stop-sync') {
    console.log('Handling POST request to stop sync'); let executionArnToStop; try { if (event.body) { const body = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body; const parsedBody = JSON.parse(body); executionArnToStop = parsedBody.executionArn; } if (!executionArnToStop) { console.log("No ARN in request body, trying to fetch from DB state..."); const syncState = await getSyncState(SYNC_TYPE_OLDEST); if (syncState?.currentExecutionArn && syncState?.lastKnownStatus === STATUS_RUNNING) { executionArnToStop = syncState.currentExecutionArn; console.log(`Found running execution ARN from DB: ${executionArnToStop}`); } else { throw new Error("Missing executionArn in request body and no running execution found in state."); } } await stopSyncStateMachine(executionArnToStop); console.log(`Updating sync state: Status=${STATUS_STOPPING} for ARN=${executionArnToStop}`); await updateApiSyncState(SYNC_TYPE_OLDEST, { lastKnownStatus: STATUS_STOPPING }); return { statusCode: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'Sync process stop request sent.', status: STATUS_STOPPING })}; } catch (error) { console.error('Error handling POST /stop-sync request:', error); let statusCode = 500; if (error.message.includes("Missing executionArn")) statusCode = 400; else if (error.name === 'ExecutionDoesNotExist' || error.message.includes("does not exist")) { statusCode = 404; } return { statusCode: statusCode, headers: { ...corsHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'Failed to stop sync process', error: error.message }) }; }
  }

  if (httpMethod === 'GET' && path === '/sync-status') {
       console.log('Handling GET request for sync status');
       try {
         const syncState = await getSyncState(SYNC_TYPE_OLDEST); const currentArn = syncState?.currentExecutionArn; const lastStatusInDb = syncState?.lastKnownStatus || STATUS_IDLE; if (currentArn) { console.log(`Found active execution ARN: ${currentArn}. Describing execution...`); let executionDetails; try { executionDetails = await describeStateMachineExecution(currentArn); } catch (describeError) { console.error(`Error describing execution ${currentArn}:`, describeError); if (describeError.name === 'ExecutionDoesNotExist') { console.log(`Execution ${currentArn} does not exist. Clearing state.`); await updateApiSyncState(SYNC_TYPE_OLDEST, { currentExecutionArn: null, lastKnownStatus: STATUS_IDLE }); return { statusCode: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ status: STATUS_IDLE, message: "Execution not found, state cleared."})}; } console.warn("Failed to describe execution, returning last known DB status."); return { statusCode: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ status: lastStatusInDb, executionArn: currentArn, stale: true, error: describeError.message })}; } const latestSfnStatus = mapSfnStatus(executionDetails.status); console.log(`SFN execution status: ${executionDetails.status} -> Mapped status: ${latestSfnStatus}`); const attributesToUpdate = { lastKnownStatus: latestSfnStatus }; let responseStatus = latestSfnStatus; if (isTerminalStatus(latestSfnStatus)) { console.log(`Execution ${currentArn} reached terminal state: ${latestSfnStatus}. Clearing ARN in DB state.`); attributesToUpdate.currentExecutionArn = null; } else if (latestSfnStatus === STATUS_RUNNING && lastStatusInDb === STATUS_STOPPING) { console.log("SFN is RUNNING, but DB status is STOPPING. Reporting STOPPING."); attributesToUpdate.lastKnownStatus = STATUS_STOPPING; responseStatus = STATUS_STOPPING; } if (lastStatusInDb !== attributesToUpdate.lastKnownStatus || attributesToUpdate.currentExecutionArn === null) { console.log("Updating DB state:", attributesToUpdate); await updateApiSyncState(SYNC_TYPE_OLDEST, attributesToUpdate); } return { statusCode: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ status: responseStatus, executionArn: isTerminalStatus(latestSfnStatus) ? null : currentArn })}; } else { console.log(`No active execution ARN found. Last known DB status: ${lastStatusInDb}`); let finalStatus = lastStatusInDb; if (lastStatusInDb === STATUS_RUNNING || lastStatusInDb === STATUS_STOPPING) { console.warn("Inconsistent state: No ARN found but last status was RUNNING/STOPPING. Reporting as FAILED (assumed)."); finalStatus = STATUS_FAILED; await updateApiSyncState(SYNC_TYPE_OLDEST, { lastKnownStatus: finalStatus }); } return { statusCode: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ status: finalStatus })}; }
       } catch(error) {
            console.error('Error handling GET /sync-status request:', error);
            return { statusCode: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ status: STATUS_UNKNOWN, message: 'Failed to get sync status', error: error.message })};
       }
  }


  if (httpMethod === 'GET' && path === '/summary') {
      console.log('Handling GET request for summary');
      try {
        const syncState = await getSyncState(SYNC_TYPE_OLDEST); let tableDescription = null; try { const describeCommand = new DescribeTableCommand({ TableName: config.dynamoDbTableName }); tableDescription = await ddbClient.send(describeCommand); console.log("DescribeTable result:", tableDescription.Table?.ItemCount); } catch (describeError) { console.error(`Error describing table ${config.dynamoDbTableName}:`, describeError); } const summary = { currentSyncPage: syncState?.currentSyncPage || null, lastRun: syncState?.lastRunStats ? { startTime: syncState.lastRunStats.startTime || null, endTime: syncState.lastRunStats.endTime || null, status: syncState.lastRunStats.status || null, errorInfo: syncState.lastRunStats.errorInfo || null } : null, apiLimits: syncState?.apiLimits ? { limit: syncState.apiLimits.unsplashLimit || null, remaining: syncState.apiLimits.unsplashRemaining ?? null, lastChecked: syncState.apiLimits.lastCheckedTimestamp || null, estimatedReset: estimateApiResetTime(syncState.apiLimits.lastCheckedTimestamp) } : null, overallStats: { approxFileCount: tableDescription?.Table?.ItemCount ?? null, approxTotalSizeInBytes: tableDescription?.Table?.TableSizeBytes ?? null, approxTotalSizeFormatted: formatBytes(tableDescription?.Table?.TableSizeBytes || 0), }, currentSyncStatus: syncState?.lastKnownStatus || STATUS_IDLE }; return { statusCode: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify(summary)};
      } catch (error) {
           console.error('Error handling GET /summary request:', error);
           return { statusCode: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'Failed to get summary data', error: error.message })};
      }
  }

  // Default 404
  console.log(`Unsupported route or method: [${httpMethod}], Path: [${path}]`);
  return { statusCode: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'Not Found' }) };
};

// Note: The duplicate helper functions near the end have been removed in this version.
