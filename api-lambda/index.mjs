// /home/admin/imgu/api-lambda/index.mjs (Updated for Sync State Read)
import config from './config.mjs';
// 导入 getSyncState
import { getImageDataPage, getSyncState } from './dynamodb.mjs';
import { startSyncStateMachine, stopSyncStateMachine, describeStateMachineExecution } from './stepfunctions.mjs';

const encodeBase64 = (data) => Buffer.from(JSON.stringify(data)).toString('base64url');
const decodeBase64 = (data) => {
    try { return JSON.parse(Buffer.from(data, 'base64url').toString('utf8')); }
    catch (e) { console.error("Failed to decode base64 token:", e); return undefined; }
};

// 定义同步类型常量
const SYNC_TYPE_OLDEST = 'UNSPLASH_OLDEST_SYNC';

export const handler = async (event) => {
  console.log('API request received:', JSON.stringify(event, null, 2));

  const corsHeaders = {
    'Access-Control-Allow-Origin': config.allowedOrigin,
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  };

  const httpMethod = event.requestContext?.http?.method;
  const path = event.rawPath;
  const queryParams = event.queryStringParameters || {};

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
      return {
        statusCode: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: items, nextToken: encodedNextPageToken }),
      };
    } catch (error) {
        console.error('Error handling GET request:', error);
        return { statusCode: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'Internal Server Error', error: error.message }) };
    }
  }

  // Handle POST /start-sync
  if (httpMethod === 'POST' && path === '/start-sync') {
    console.log('Handling POST request to start sync');
    try {
      // --- 读取同步状态 ---
      let startPage = 1; // 默认从第一页开始
      const syncState = await getSyncState(SYNC_TYPE_OLDEST);
      if (syncState && typeof syncState.lastProcessedPage === 'number' && syncState.lastProcessedPage >= 0) {
        // 确保 lastProcessedPage 是有效的数字
        startPage = syncState.lastProcessedPage + 1;
        console.log(`Found sync state. Resuming from page: ${startPage}`);
      } else {
        console.log('No previous sync state found or invalid page number. Starting from page 1.');
        startPage = 1; // 确保无效状态也从 1 开始
      }
      // --- 结束读取同步状态 ---

      // TODO: Add logic here to check if a sync is already running via /sync-status

      // --- 将 startPage 传递给 Step Functions ---
      console.log(`Starting Step Function execution with input: ${JSON.stringify({ startPage: startPage })}`);
      const executionArn = await startSyncStateMachine({ startPage: startPage });
      // --- 结束传递 startPage ---

      return {
        statusCode: 202,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        // 更新返回消息
        body: JSON.stringify({ message: `Sync process initiated, starting from page ${startPage}.`, executionArn: executionArn }),
      };
    } catch (error) {
        console.error('Error handling POST /start-sync request:', error);
        return { statusCode: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'Failed to start sync process', error: error.message }) };
    }
  }

  // Handle POST /stop-sync (保持不变)
  if (httpMethod === 'POST' && path === '/stop-sync') {
      console.log('Handling POST request to stop sync');
      let executionArn;
      try {
          if (event.body) {
              const body = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
              const parsedBody = JSON.parse(body);
              executionArn = parsedBody.executionArn;
          }
          if (!executionArn) {
              throw new Error("Missing executionArn in request body");
          }
          await stopSyncStateMachine(executionArn);
          return {
              statusCode: 200,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
              body: JSON.stringify({ message: 'Sync process stop request sent.' }),
          };
      } catch (error) {
          console.error('Error handling POST /stop-sync request:', error);
          let statusCode = 500;
          if (error.message.includes("Missing executionArn")) statusCode = 400;
          else if (error.message.includes("ExecutionDoesNotExist")) statusCode = 404;
          return {
              statusCode: statusCode,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
              body: JSON.stringify({ message: 'Failed to stop sync process', error: error.message }),
          };
      }
  }

  // Handle GET /sync-status (保持不变，仍是待办)
  if (httpMethod === 'GET' && path === '/sync-status') {
       console.log('Handling GET request for sync status (Not fully implemented)');
       return {
           statusCode: 200,
           headers: { ...corsHeaders, 'Content-Type': 'application/json' },
           body: JSON.stringify({ status: 'UNKNOWN', message: 'Status check not fully implemented yet.' }),
       };
  }

  // Handle other paths/methods
  console.log(`Unsupported route or method: ${httpMethod} ${path}`);
  return {
    statusCode: 404,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'Not Found' }),
  };
};
