// /home/admin/imgu/api-lambda/index.mjs (Added Stop Logic)
import config from './config.mjs';
import { getImageDataPage } from './dynamodb.mjs';
// 导入所有 SFN 相关函数
import { startSyncStateMachine, stopSyncStateMachine, describeStateMachineExecution } from './stepfunctions.mjs';

// Base64 辅助函数
const encodeBase64 = (data) => Buffer.from(JSON.stringify(data)).toString('base64url');
const decodeBase64 = (data) => {
    try { return JSON.parse(Buffer.from(data, 'base64url').toString('utf8')); }
    catch (e) { console.error("Failed to decode base64 token:", e); return undefined; }
};

export const handler = async (event) => {
  console.log('API request received:', JSON.stringify(event, null, 2));

  const corsHeaders = {
    'Access-Control-Allow-Origin': config.allowedOrigin,
    'Access-Control-Allow-Headers': 'Content-Type', // 允许 Content-Type 头
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', // 确保包含 POST
  };

  const httpMethod = event.requestContext?.http?.method;
  const path = event.rawPath;
  const queryParams = event.queryStringParameters || {};

  // Handle CORS Preflight Request
  if (httpMethod === 'OPTIONS') {
    console.log('Handling OPTIONS preflight request');
    return { statusCode: 204, headers: corsHeaders };
  }

  // Handle GET / (Image list with Pagination)
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
    } catch (error) { /* ... error handling ... */
        console.error('Error handling GET request:', error);
        return { statusCode: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'Internal Server Error', error: error.message }) };
    }
  }

  // Handle POST /start-sync
  if (httpMethod === 'POST' && path === '/start-sync') {
    console.log('Handling POST request to start sync');
    try {
      // TODO: Add logic here to check if a sync is already running via /sync-status or DynamoDB flag
      const nextPageToFetch = 1; // For now, always start from page 1. Add resume logic later.
      const executionArn = await startSyncStateMachine({ startPage: nextPageToFetch });
      return {
        statusCode: 202,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'Sync process initiated.', executionArn: executionArn }),
      };
    } catch (error) { /* ... error handling ... */
        console.error('Error handling POST /start-sync request:', error);
        return { statusCode: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'Failed to start sync process', error: error.message }) };
    }
  }

  // --- Handle POST /stop-sync (New Stop Route) ---
  if (httpMethod === 'POST' && path === '/stop-sync') {
      console.log('Handling POST request to stop sync');
      let executionArn;
      try {
          // 解析请求体获取 executionArn
          if (event.body) {
              const body = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
              const parsedBody = JSON.parse(body);
              executionArn = parsedBody.executionArn;
          }
          if (!executionArn) {
              throw new Error("Missing executionArn in request body");
          }

          await stopSyncStateMachine(executionArn);

          // TODO: Optionally update sync status in DynamoDB here

          return {
              statusCode: 200, // OK
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
              body: JSON.stringify({ message: 'Sync process stop request sent.' }),
          };
      } catch (error) {
          console.error('Error handling POST /stop-sync request:', error);
          let statusCode = 500;
          if (error.message.includes("Missing executionArn")) {
              statusCode = 400; // Bad Request
          } else if (error.message.includes("ExecutionDoesNotExist")) {
              statusCode = 404; // Not Found (or maybe 200 is ok too)
          }
          return {
              statusCode: statusCode,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
              body: JSON.stringify({ message: 'Failed to stop sync process', error: error.message }),
          };
      }
  }

  // --- Handle GET /sync-status (Placeholder for future) ---
  if (httpMethod === 'GET' && path === '/sync-status') {
       console.log('Handling GET request for sync status (Not fully implemented)');
       // TODO: Implement logic to get lastExecutionArn and call describeStateMachineExecution
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
