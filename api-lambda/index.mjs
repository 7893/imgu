// /home/admin/imgu/api-lambda/index.mjs (Updated: API prepares initial SFN state, implements status check)
import config from './config.mjs';
// 导入 getSyncState 和 updateApiSyncState
import { getImageDataPage, getSyncState, updateApiSyncState } from './dynamodb.mjs';
import { startSyncStateMachine, stopSyncStateMachine, describeStateMachineExecution } from './stepfunctions.mjs';

const encodeBase64 = (data) => Buffer.from(JSON.stringify(data)).toString('base64url');
const decodeBase64 = (data) => {
    try { return JSON.parse(Buffer.from(data, 'base64url').toString('utf8')); }
    catch (e) { console.error("Failed to decode base64 token:", e); return undefined; }
};

// 定义同步类型常量
const SYNC_TYPE_OLDEST = 'UNSPLASH_OLDEST_SYNC';

// 定义 Step Functions 所需的静态迭代器参数
const SFN_BATCH_SIZE = 30;
const SFN_WAIT_TIME_SECONDS = 120;

// 定义同步状态常量
const STATUS_IDLE = 'IDLE';
const STATUS_RUNNING = 'RUNNING';
const STATUS_SUCCEEDED = 'SUCCEEDED';
const STATUS_FAILED = 'FAILED';
const STATUS_TIMED_OUT = 'TIMED_OUT';
const STATUS_ABORTED = 'ABORTED';
const STATUS_STOPPING = 'STOPPING'; // 中间状态
const STATUS_UNKNOWN = 'UNKNOWN';   // 未知或错误状态

// 辅助函数：将 SFN 状态映射到我们的状态常量
function mapSfnStatus(sfnStatus) {
    switch (sfnStatus) {
        case 'RUNNING': return STATUS_RUNNING;
        case 'SUCCEEDED': return STATUS_SUCCEEDED;
        case 'FAILED': return STATUS_FAILED;
        case 'TIMED_OUT': return STATUS_TIMED_OUT;
        case 'ABORTED': return STATUS_ABORTED;
        default: return STATUS_UNKNOWN; // SFN 可能有其他状态
    }
}
// 辅助函数：判断是否为终态
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
      // --- 检查是否已有任务在运行 ---
      let currentSyncState = await getSyncState(SYNC_TYPE_OLDEST);
      // 如果明确是 RUNNING 状态，则阻止启动
      if (currentSyncState?.lastKnownStatus === STATUS_RUNNING) {
           // 可以选择性地再次调用 SFN DescribeExecution 确认状态
           if(currentSyncState.currentExecutionArn) {
               try {
                   const executionDetails = await describeStateMachineExecution(currentSyncState.currentExecutionArn);
                   if (executionDetails.status === 'RUNNING') {
                       console.warn(`Sync is already running with ARN: ${currentSyncState.currentExecutionArn}. Preventing new execution.`);
                       return {
                         statusCode: 409, // Conflict
                         headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                         body: JSON.stringify({ message: 'Sync process is already running.', status: STATUS_RUNNING, executionArn: currentSyncState.currentExecutionArn }),
                       };
                   } else {
                       // 如果 SFN 不是 RUNNING，但 DB 状态是 RUNNING，说明状态不一致，允许继续并覆盖
                       console.warn(`DB status is RUNNING but SFN status is ${executionDetails.status}. Proceeding to start new execution.`);
                       // 可以考虑先清理 currentExecutionArn
                       await updateApiSyncState(SYNC_TYPE_OLDEST, { currentExecutionArn: null, lastKnownStatus: mapSfnStatus(executionDetails.status) });
                   }
               } catch (describeError) {
                    console.error("Error describing existing execution during start check:", describeError);
                    // 如果无法描述，为安全起见，可能也阻止启动，或者允许启动（取决于策略）
                    // 这里选择允许启动，但记录警告
                    console.warn("Could not verify status of potentially running execution. Proceeding with caution.");
               }
           } else {
                // DB 是 RUNNING 但没有 ARN，状态异常，允许启动新任务覆盖
                console.warn("DB status is RUNNING but no execution ARN found. Proceeding to start new execution.");
           }
      }
      // --- 结束运行检查 ---


      // --- 读取上次同步页码 ---
      let startPage = 1;
      // 使用获取到的（可能已更新的）currentSyncState
      currentSyncState = await getSyncState(SYNC_TYPE_OLDEST); // 重新获取一下以防万一
      if (currentSyncState && typeof currentSyncState.lastProcessedPage === 'number' && currentSyncState.lastProcessedPage >= 0) {
        startPage = currentSyncState.lastProcessedPage + 1;
        console.log(`Found sync state. Resuming from page: ${startPage}`);
      } else {
        console.log('No previous sync state found or invalid page number. Starting from page 1.');
        startPage = 1;
      }
      // --- 结束读取页码 ---


      // --- 构建 SFN 输入 ---
      const sfnInput = {
        iterator: { currentPage: startPage, batchSize: SFN_BATCH_SIZE, waitTimeSeconds: SFN_WAIT_TIME_SECONDS }
      };
      console.log(`Starting Step Function execution with input: ${JSON.stringify(sfnInput)}`);
      // --- 结束构建输入 ---


      // --- 调用 SFN ---
      const executionArn = await startSyncStateMachine(sfnInput);
      // --- 结束调用 SFN ---


      // --- 更新 sync_control 表状态 ---
      console.log(`Updating sync state: ARN=${executionArn}, Status=${STATUS_RUNNING}`);
      await updateApiSyncState(SYNC_TYPE_OLDEST, {
          currentExecutionArn: executionArn,
          lastKnownStatus: STATUS_RUNNING
      });
      // --- 结束更新状态 ---

      return {
        statusCode: 202,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: `Sync process initiated, starting from page ${startPage}.`, executionArn: executionArn, status: STATUS_RUNNING }),
      };
    } catch (error) {
        console.error('Error handling POST /start-sync request:', error);
        // 尝试将状态更新为 FAILED？可能不需要，让 status 接口来发现
        return { statusCode: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'Failed to start sync process', error: error.message }) };
    }
  }

  // Handle POST /stop-sync
  if (httpMethod === 'POST' && path === '/stop-sync') {
      console.log('Handling POST request to stop sync');
      let executionArnToStop;
      try {
          // 解析请求体获取 executionArn
          if (event.body) {
              const body = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
              const parsedBody = JSON.parse(body);
              executionArnToStop = parsedBody.executionArn;
          }
          if (!executionArnToStop) {
               // 如果请求中没有提供 ARN，尝试从数据库获取当前的 ARN
               console.log("No ARN in request body, trying to fetch from DB state...");
               const syncState = await getSyncState(SYNC_TYPE_OLDEST);
               if (syncState?.currentExecutionArn && syncState?.lastKnownStatus === STATUS_RUNNING) {
                    executionArnToStop = syncState.currentExecutionArn;
                    console.log(`Found running execution ARN from DB: ${executionArnToStop}`);
               } else {
                   // 如果 DB 中没有运行的 ARN，也可能是 STOPPING 状态残留，尝试用 lastKnownStatus 判断？
                   // 为简单起见，如果没有提供 ARN 且 DB 中没有 RUNNING 的 ARN，则报错
                   throw new Error("Missing executionArn in request body and no running execution found in state.");
               }
          }

          // 调用 SFN 停止执行
          await stopSyncStateMachine(executionArnToStop);

          // 可选: 更新状态为 STOPPING，这只是一个临时标记
          console.log(`Updating sync state: Status=${STATUS_STOPPING} for ARN=${executionArnToStop}`);
          await updateApiSyncState(SYNC_TYPE_OLDEST, {
              // 不清除 ARN，让 /sync-status 来确认最终状态并清理
              lastKnownStatus: STATUS_STOPPING
          });


          return {
              statusCode: 200, // OK
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
              body: JSON.stringify({ message: 'Sync process stop request sent.', status: STATUS_STOPPING }),
          };
      } catch (error) {
          console.error('Error handling POST /stop-sync request:', error);
          let statusCode = 500;
          if (error.message.includes("Missing executionArn")) statusCode = 400;
          else if (error.name === 'ExecutionDoesNotExist' || error.message.includes("does not exist")) {
              // 如果执行不存在，可能DB状态需要清理，让 /sync-status 处理
              statusCode = 404;
          }
          // 停止失败时，不应更改 DB 状态，让 /sync-status 来处理
          return {
              statusCode: statusCode,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
              body: JSON.stringify({ message: 'Failed to stop sync process', error: error.message }),
          };
      }
  }

  // Handle GET /sync-status
  if (httpMethod === 'GET' && path === '/sync-status') {
       console.log('Handling GET request for sync status');
       try {
            const syncState = await getSyncState(SYNC_TYPE_OLDEST);
            const currentArn = syncState?.currentExecutionArn;
            const lastStatusInDb = syncState?.lastKnownStatus || STATUS_IDLE;

            if (currentArn) {
                console.log(`Found active execution ARN: ${currentArn}. Describing execution...`);
                let executionDetails;
                try {
                    executionDetails = await describeStateMachineExecution(currentArn);
                } catch (describeError) {
                     console.error(`Error describing execution ${currentArn}:`, describeError);
                     if (describeError.name === 'ExecutionDoesNotExist') {
                         console.log(`Execution ${currentArn} does not exist. Clearing state.`);
                         await updateApiSyncState(SYNC_TYPE_OLDEST, { currentExecutionArn: null, lastKnownStatus: STATUS_IDLE }); // 认为它不存在就是 IDLE
                         return {
                             statusCode: 200,
                             headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                             body: JSON.stringify({ status: STATUS_IDLE, message: "Execution not found, state cleared."}),
                         };
                     }
                     // 对于其他描述错误，返回上次DB状态，并标记为可能过时
                     console.warn("Failed to describe execution, returning last known DB status.");
                      return {
                         statusCode: 200, // 仍然返回成功，但状态可能不准
                         headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                         body: JSON.stringify({ status: lastStatusInDb, executionArn: currentArn, stale: true, error: describeError.message }),
                     };
                }

                const latestSfnStatus = mapSfnStatus(executionDetails.status);
                console.log(`SFN execution status: ${executionDetails.status} -> Mapped status: ${latestSfnStatus}`);

                const attributesToUpdate = { lastKnownStatus: latestSfnStatus };
                let responseStatus = latestSfnStatus;

                if (isTerminalStatus(latestSfnStatus)) {
                    console.log(`Execution ${currentArn} reached terminal state: ${latestSfnStatus}. Clearing ARN in DB state.`);
                    attributesToUpdate.currentExecutionArn = null; // 清除 ARN
                } else if (latestSfnStatus === STATUS_RUNNING && lastStatusInDb === STATUS_STOPPING) {
                     // 如果 SFN 仍在运行，但 DB 标记为 STOPPING，则保持 STOPPING 状态，等待 SFN 真正停止
                     console.log("SFN is RUNNING, but DB status is STOPPING. Reporting STOPPING.");
                     attributesToUpdate.lastKnownStatus = STATUS_STOPPING; // 保持 STOPPING
                     responseStatus = STATUS_STOPPING;
                 }


                // 只有当状态变化或需要清除 ARN 时才更新 DB
                if (lastStatusInDb !== attributesToUpdate.lastKnownStatus || attributesToUpdate.currentExecutionArn === null) {
                    console.log("Updating DB state:", attributesToUpdate);
                    await updateApiSyncState(SYNC_TYPE_OLDEST, attributesToUpdate);
                }

                 return {
                     statusCode: 200,
                     headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                     body: JSON.stringify({ status: responseStatus, executionArn: isTerminalStatus(latestSfnStatus) ? null : currentArn }),
                 };

            } else {
                // 没有 currentExecutionArn
                console.log(`No active execution ARN found. Last known DB status: ${lastStatusInDb}`);
                let finalStatus = lastStatusInDb;
                 // 如果上次状态是 RUNNING 或 STOPPING 但 ARN 丢失了，重置为 IDLE 或 FAILED 更合适？
                 if (lastStatusInDb === STATUS_RUNNING || lastStatusInDb === STATUS_STOPPING) {
                     console.warn("Inconsistent state: No ARN found but last status was RUNNING/STOPPING. Reporting as FAILED (assumed).");
                     // 假设这种情况是异常结束，标记为 FAILED 比 IDLE 更能反映问题
                     finalStatus = STATUS_FAILED;
                     // 更新 DB 状态以反映此假设
                     await updateApiSyncState(SYNC_TYPE_OLDEST, { lastKnownStatus: finalStatus });
                 }
                 return {
                     statusCode: 200,
                     headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                     body: JSON.stringify({ status: finalStatus }),
                 };
            }

       } catch(error) {
            console.error('Error handling GET /sync-status request:', error);
            return {
                statusCode: 500,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: STATUS_UNKNOWN, message: 'Failed to get sync status', error: error.message }),
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
