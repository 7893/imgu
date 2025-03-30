// index.mjs
import config from './config.mjs';
import { getAllImageData } from './dynamodb.mjs';

/**
 * AWS Lambda Handler for API Gateway or Function URL (HTTP Request)
 */
export const handler = async (event) => {
  console.log('API request received:', JSON.stringify(event, null, 2));

  // --- CORS Headers ---
  // 从配置中读取允许的来源
  const corsHeaders = {
    'Access-Control-Allow-Origin': config.allowedOrigin,
    'Access-Control-Allow-Headers': 'Content-Type', // 根据前端实际发送的 Headers 调整
    'Access-Control-Allow-Methods': 'GET, OPTIONS', // 此 API 只支持 GET 和 OPTIONS
  };

  const httpMethod = event.requestContext?.http?.method;

  // --- Handle CORS Preflight Request (OPTIONS) ---
  if (httpMethod === 'OPTIONS') {
    console.log('Handling OPTIONS preflight request');
    return {
      statusCode: 204, // No Content
      headers: corsHeaders,
    };
  }

  // --- Handle GET Request ---
  if (httpMethod === 'GET') {
    console.log('Handling GET request');
    try {
      // 从 DynamoDB 获取数据
      const imageData = await getAllImageData();

      // 成功响应
      return {
        statusCode: 200,
        headers: {
            ...corsHeaders, // 合并 CORS 头
            'Content-Type': 'application/json', // 返回 JSON
        },
        body: JSON.stringify(imageData), // 将数据数组转为 JSON 字符串
      };

    } catch (error) {
      console.error('Error handling GET request:', error);
      // 错误响应
      return {
        statusCode: 500,
        headers: {
            ...corsHeaders,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ message: 'Internal Server Error', error: error.message }),
      };
    }
  }

  // --- Handle Other Methods ---
  console.log(`Unsupported HTTP method: ${httpMethod}`);
  return {
    statusCode: 405, // Method Not Allowed
    headers: {
        ...corsHeaders,
        'Content-Type': 'application/json',
    },
    body: JSON.stringify({ message: `Method ${httpMethod} Not Allowed` }),
  };
};