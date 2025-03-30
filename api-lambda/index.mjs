// /home/admin/imgu/api-lambda/index.mjs (Updated)
import config from './config.mjs';
import { getAllImageData } from './dynamodb.mjs';
import { startSyncStateMachine } from './stepfunctions.mjs'; // <--- 导入新函数

export const handler = async (event) => {
  console.log('API request received:', JSON.stringify(event, null, 2));

  const corsHeaders = {
    'Access-Control-Allow-Origin': config.allowedOrigin,
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', // <--- 添加 POST
  };

  const httpMethod = event.requestContext?.http?.method;
  const path = event.rawPath; // Function URL 通常使用 rawPath

  // Handle CORS Preflight Request
  if (httpMethod === 'OPTIONS') {
    console.log('Handling OPTIONS preflight request');
    return { statusCode: 204, headers: corsHeaders };
  }

  // Handle GET / (Existing image gallery request)
  if (httpMethod === 'GET' && path === '/') {
    console.log('Handling GET request for image gallery');
    try {
      const imageData = await getAllImageData();
      return {
        statusCode: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify(imageData),
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

  // --- Handle POST /start-sync (New route) ---
  if (httpMethod === 'POST' && path === '/start-sync') {
    console.log('Handling POST request to start sync');
    try {
      // 这里可以加逻辑检查是否已有任务在运行 (需要额外实现)
      const executionArn = await startSyncStateMachine();
      return {
        statusCode: 202, // Accepted: 请求已被接受处理，但处理尚未完成
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
    statusCode: 404, // Not Found or 405 Method Not Allowed
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'Not Found' }),
  };
};
