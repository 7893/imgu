// /home/admin/imgu/api-lambda/index.mjs (Updated for Pagination)
import config from './config.mjs';
// 确保导入的是新的分页函数
import { getImageDataPage } from './dynamodb.mjs';
import { startSyncStateMachine } from './stepfunctions.mjs';

// Base64 辅助函数 (Node.js Buffer 自带)
const encodeBase64 = (data) => Buffer.from(JSON.stringify(data)).toString('base64url'); // 使用 base64url 安全编码
const decodeBase64 = (data) => {
    try {
        return JSON.parse(Buffer.from(data, 'base64url').toString('utf8'));
    } catch (e) {
        console.error("Failed to decode base64 token:", e);
        return undefined; // 解码失败返回 undefined
    }
};


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

  // Handle CORS Preflight Request
  if (httpMethod === 'OPTIONS') {
    console.log('Handling OPTIONS preflight request');
    return { statusCode: 204, headers: corsHeaders };
  }

  // --- Handle GET / (Image list with Pagination) ---
  if (httpMethod === 'GET' && path === '/') {
    console.log('Handling GET request for image gallery page');
    try {
      const limit = parseInt(queryParams.limit || '20', 10); // 默认或从查询参数获取 limit
      const encodedNextToken = queryParams.nextToken;
      let startKey = undefined;

      if (encodedNextToken) {
        startKey = decodeBase64(encodedNextToken);
        if (!startKey) {
            console.warn("Received invalid nextToken parameter.");
            // 可以选择返回错误或忽略无效 token 继续从头开始
        }
      }

      // 从 DynamoDB 获取分页数据
      const { items, nextToken: nextExclusiveStartKey } = await getImageDataPage(limit, startKey);

      // 将 DynamoDB 返回的 LastEvaluatedKey (对象) 编码为 Base64 字符串
      const encodedNextPageToken = nextExclusiveStartKey ? encodeBase64(nextExclusiveStartKey) : null;

      // 成功响应
      return {
        statusCode: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        // 返回包含项目列表和下一页令牌的对象
        body: JSON.stringify({
            items: items,
            nextToken: encodedNextPageToken // 返回编码后的令牌给前端
        }),
      };

    } catch (error) {
      console.error('Error handling GET request:', error);
      return {
        statusCode: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'Internal Server Error', error: error.message }),
      };
    }
  }

  // --- Handle POST /start-sync ---
  if (httpMethod === 'POST' && path === '/start-sync') {
    // ... (这部分代码与上次相同，无需修改) ...
    console.log('Handling POST request to start sync');
    try {
      const executionArn = await startSyncStateMachine();
      return {
        statusCode: 202,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'Sync process initiated.', executionArn: executionArn }),
      };
    } catch (error) {
      console.error('Error handling POST /start-sync request:', error);
      return {
        statusCode: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'Failed to start sync process', error: error.message }),
      };
    }
  }

  // Handle other paths/methods
  console.log(`Unsupported route or method: ${httpMethod} ${path}`);
  return {
    statusCode: 404,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'Not Found' }),
  };
};
