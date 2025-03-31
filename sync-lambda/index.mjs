// /home/admin/imgu/api-lambda/index.mjs (Updated: Added debug logging for path matching)
import config from './config.mjs';
import { getImageDataPage, getSyncState, updateApiSyncState } from './dynamodb.mjs';
import { startSyncStateMachine, stopSyncStateMachine, describeStateMachineExecution } from './stepfunctions.mjs';
import { DynamoDBClient, DescribeTableCommand } from '@aws-sdk/client-dynamodb'; // 保持 DescribeTableCommand 导入
import process from 'node:process';

const ddbClient = new DynamoDBClient({ region: process.env.AWS_REGION });

// --- 辅助函数 (保持不变) ---
const encodeBase64 = (data) => Buffer.from(JSON.stringify(data)).toString('base64url');
const decodeBase64 = (data) => {
    try { return JSON.parse(Buffer.from(data, 'base64url').toString('utf8')); }
    catch (e) { console.error("Failed to decode base64 token:", e); return undefined; }
};
function formatBytes(bytes, decimals = 2) { /* ... (保持不变) ... */ }
function estimateApiResetTime(lastCheckedIsoTimestamp) { /* ... (保持不变) ... */ }
// --- 结束辅助函数 ---

const SYNC_TYPE_OLDEST = 'UNSPLASH_OLDEST_SYNC';
const STATUS_IDLE = 'IDLE';
const STATUS_RUNNING = 'RUNNING';
// ... (其他 STATUS 常量保持不变) ...
const STATUS_UNKNOWN = 'UNKNOWN';
function mapSfnStatus(sfnStatus) { /* ... (保持不变) ... */ }
const isTerminalStatus = (status) => ![STATUS_RUNNING, STATUS_STOPPING, STATUS_IDLE, STATUS_UNKNOWN].includes(status);

export const handler = async (event) => {
  // 打印原始事件，有助于完整调试（如果需要可以取消注释下一行）
  // console.log('API request received:', JSON.stringify(event, null, 2));

  const corsHeaders = {
    'Access-Control-Allow-Origin': config.allowedOrigin,
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  };

  const httpMethod = event.requestContext?.http?.method;
  const path = event.rawPath; // 我们用来做路由判断的路径
  const queryParams = event.queryStringParameters || {};

  // *** 新增的调试日志 ***
  console.log(`>>> Received Request - Method: [${httpMethod}], Path: [${path}]`);
  // *** 结束新增的调试日志 ***

  // Handle CORS Preflight Request
  if (httpMethod === 'OPTIONS') {
    console.log('Handling OPTIONS preflight request');
    return { statusCode: 204, headers: corsHeaders };
  }

  // Handle GET /
  if (httpMethod === 'GET' && path === '/') {
    console.log('Handling GET request for image gallery page');
    try {
      // ... (获取图片列表的逻辑保持不变) ...
      const limit = parseInt(queryParams.limit || '20', 10);
      const encodedNextToken = queryParams.nextToken;
      let startKey = encodedNextToken ? decodeBase64(encodedNextToken) : undefined;
      const { items, nextToken: nextExclusiveStartKey } = await getImageDataPage(limit, startKey);
      const encodedNextPageToken = nextExclusiveStartKey ? encodeBase64(nextExclusiveStartKey) : null;
      return {
        statusCode: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: items, nextToken: encodedNextPageToken }),
      };
    } catch (error) {
        console.error('Error handling GET / request:', error); // 添加具体路径的错误日志
        return { statusCode: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'Internal Server Error on GET /', error: error.message }) };
    }
  }

  // Handle POST /start-sync
  if (httpMethod === 'POST' && path === '/start-sync') {
    // ... (代码保持不变) ...
  }

  // Handle POST /stop-sync
  if (httpMethod === 'POST' && path === '/stop-sync') {
    // ... (代码保持不变) ...
  }

  // Handle GET /sync-status
  if (httpMethod === 'GET' && path === '/sync-status') {
       console.log('Handling GET request for sync status');
       try {
         // ... (获取同步状态的逻辑保持不变) ...
         const syncState = await getSyncState(SYNC_TYPE_OLDEST);
         const currentArn = syncState?.currentExecutionArn;
         const lastStatusInDb = syncState?.lastKnownStatus || STATUS_IDLE;
         // ... (后续逻辑不变) ...
       } catch(error) {
            console.error('Error handling GET /sync-status request:', error); // 添加具体路径的错误日志
            return {
                statusCode: 500,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: STATUS_UNKNOWN, message: 'Failed to get sync status', error: error.message }),
            };
       }
  }


  // Handle GET /summary
  if (httpMethod === 'GET' && path === '/summary') {
      console.log('Handling GET request for summary');
      try {
        // ... (获取概要信息的逻辑保持不变) ...
        const syncState = await getSyncState(SYNC_TYPE_OLDEST);
        let tableDescription = null;
        try {
            const describeCommand = new DescribeTableCommand({ TableName: config.dynamoDbTableName });
            tableDescription = await ddbClient.send(describeCommand);
        } catch (describeError) { /* ... */ }
        const summary = { /* ... */ };
        return { /* ... 200 OK response ... */ };
      } catch (error) {
           console.error('Error handling GET /summary request:', error); // 添加具体路径的错误日志
           return {
               statusCode: 500,
               headers: { ...corsHeaders, 'Content-Type': 'application/json' },
               body: JSON.stringify({ message: 'Failed to get summary data', error: error.message }),
           };
      }
  }


  // Handle other paths/methods
  console.log(`Unsupported route or method: [${httpMethod}], Path: [${path}]`); // 在这里也加上括号
  return {
    statusCode: 404,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'Not Found' }),
  };
};

// --- 省略了辅助函数 formatBytes, estimateApiResetTime 等的完整代码，假设它们已正确添加 ---
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
    } catch (e) { return null; }
}
