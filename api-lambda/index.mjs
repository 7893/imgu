// /home/admin/imgu/api-lambda/index.mjs (Updated: Add GET /summary endpoint)
import config from './config.mjs';
import { getImageDataPage, getSyncState, updateApiSyncState } from './dynamodb.mjs';
import { startSyncStateMachine, stopSyncStateMachine, describeStateMachineExecution } from './stepfunctions.mjs';
// 新增: 从 @aws-sdk/client-dynamodb 导入 DescribeTableCommand
import { DynamoDBClient, DescribeTableCommand } from '@aws-sdk/client-dynamodb';
import process from 'node:process';

// --- DynamoDB Client (用于 DescribeTable) ---
// 注意: dynamodb.mjs 中已有 ddbClient，但为保持模块独立性或方便未来拆分，这里也初始化一个
// 如果 dynamoDb.mjs 导出了 ddbClient，也可以直接导入使用
const ddbClient = new DynamoDBClient({ region: process.env.AWS_REGION });
// --- 结束 DynamoDB Client ---


// --- 辅助函数 ---
const encodeBase64 = (data) => Buffer.from(JSON.stringify(data)).toString('base64url');
const decodeBase64 = (data) => {
    try { return JSON.parse(Buffer.from(data, 'base64url').toString('utf8')); }
    catch (e) { console.error("Failed to decode base64 token:", e); return undefined; }
};

// 添加 formatBytes 函数 (与前端版本一致)
function formatBytes(bytes, decimals = 2) {
  if (!+bytes && bytes !== 0) return 'N/A'; // 处理 null, undefined, NaN
  const absBytes = Math.abs(bytes); // 处理负数情况（虽然不太可能）
  if (absBytes === 0) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ["Bytes", "KB", "MB", "GB", "TB", "PB", "EB", "ZB", "YB"];
  const i = Math.floor(Math.log(absBytes) / Math.log(k));
  // 处理超出 YB 的情况或计算错误
  if (i < 0 || i >= sizes.length) { return `${bytes} Bytes`; }
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

// 估算 Unsplash API 下次重置时间 (下一个 UTC 整点)
function estimateApiResetTime(lastCheckedIsoTimestamp) {
    if (!lastCheckedIsoTimestamp) return null;
    try {
        const lastCheckedDate = new Date(lastCheckedIsoTimestamp);
        // 设置为下一个小时的 0 分 0 秒 0 毫秒 (UTC)
        lastCheckedDate.setUTCHours(lastCheckedDate.getUTCHours() + 1, 0, 0, 0);
        return lastCheckedDate.toISOString();
    } catch (e) {
        console.error("Error estimating reset time:", e);
        return null;
    }
}
// --- 结束辅助函数 ---


// 定义同步类型常量
const SYNC_TYPE_OLDEST = 'UNSPLASH_OLDEST_SYNC';

// 定义同步状态常量
const STATUS_IDLE = 'IDLE';
const STATUS_RUNNING = 'RUNNING';
const STATUS_SUCCEEDED = 'SUCCEEDED';
const STATUS_FAILED = 'FAILED';
const STATUS_TIMED_OUT = 'TIMED_OUT';
const STATUS_ABORTED = 'ABORTED';
const STATUS_STOPPING = 'STOPPING';
const STATUS_UNKNOWN = 'UNKNOWN';

function mapSfnStatus(sfnStatus) { /* ... (保持不变) ... */ }
const isTerminalStatus = (status) => ![STATUS_RUNNING, STATUS_STOPPING, STATUS_IDLE, STATUS_UNKNOWN].includes(status);


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

  // Handle GET / (保持不变)
  if (httpMethod === 'GET' && path === '/') { /* ... (代码保持不变) ... */ }

  // Handle POST /start-sync (保持不变)
  if (httpMethod === 'POST' && path === '/start-sync') { /* ... (代码保持不变) ... */ }

  // Handle POST /stop-sync (保持不变)
  if (httpMethod === 'POST' && path === '/stop-sync') { /* ... (代码保持不变) ... */ }

  // Handle GET /sync-status (保持不变)
  if (httpMethod === 'GET' && path === '/sync-status') { /* ... (代码保持不变) ... */ }


  // --- 新增: Handle GET /summary ---
  if (httpMethod === 'GET' && path === '/summary') {
      console.log('Handling GET request for summary');
      try {
          // 1. 获取 sync_control 状态
          const syncState = await getSyncState(SYNC_TYPE_OLDEST);

          // 2. 获取 images_metadata 表信息
          let tableDescription = null;
          try {
              const describeCommand = new DescribeTableCommand({ TableName: config.dynamoDbTableName });
              tableDescription = await ddbClient.send(describeCommand);
              console.log("DescribeTable result:", tableDescription.Table?.ItemCount);
          } catch (describeError) {
              console.error(`Error describing table ${config.dynamoDbTableName}:`, describeError);
              // 即使获取表信息失败，也继续返回其他信息
          }

          // 3. 组装响应
          const summary = {
              currentSyncPage: syncState?.currentSyncPage || null, // 当前正在处理的页码
              lastRun: syncState?.lastRunStats ? { // 上次运行统计
                  startTime: syncState.lastRunStats.startTime || null,
                  endTime: syncState.lastRunStats.endTime || null,
                  status: syncState.lastRunStats.status || null,
                  errorInfo: syncState.lastRunStats.errorInfo || null,
                  // fileCount: syncState.lastRunStats.fileCount || 0, // 暂未实现
                  // totalSizeFormatted: formatBytes(syncState.lastRunStats.totalSizeInBytes || 0), // 暂未实现
              } : null,
              apiLimits: syncState?.apiLimits ? { // API 限制
                  limit: syncState.apiLimits.unsplashLimit || null,
                  remaining: syncState.apiLimits.unsplashRemaining ?? null, // Use ?? for 0 case
                  lastChecked: syncState.apiLimits.lastCheckedTimestamp || null,
                  estimatedReset: estimateApiResetTime(syncState.apiLimits.lastCheckedTimestamp)
              } : null,
              overallStats: { // 总体统计 (近似值)
                  approxFileCount: tableDescription?.Table?.ItemCount ?? null,
                  approxTotalSizeInBytes: tableDescription?.Table?.TableSizeBytes ?? null,
                  approxTotalSizeFormatted: formatBytes(tableDescription?.Table?.TableSizeBytes || 0),
              },
              // 可以加入当前的 lastKnownStatus (从 syncState 获取)
              currentSyncStatus: syncState?.lastKnownStatus || STATUS_IDLE
          };

          return {
              statusCode: 200,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
              body: JSON.stringify(summary),
          };

      } catch (error) {
           console.error('Error handling GET /summary request:', error);
           return {
               statusCode: 500,
               headers: { ...corsHeaders, 'Content-Type': 'application/json' },
               body: JSON.stringify({ message: 'Failed to get summary data', error: error.message }),
           };
      }
  }
  // --- 结束新增 /summary ---


  // Handle other paths/methods (保持不变)
  console.log(`Unsupported route or method: ${httpMethod} ${path}`);
  return {
    statusCode: 404,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'Not Found' }),
  };
};

// --- 省略 getImageDataPage, getSyncState, updateApiSyncState, startSyncStateMachine 等函数的重复代码 ---
// --- 确保这些函数已在 dynamodb.mjs 和 stepfunctions.mjs 中正确定义并导出 ---
// --- 这里只粘贴 handler 和新增/修改的辅助函数 ---
