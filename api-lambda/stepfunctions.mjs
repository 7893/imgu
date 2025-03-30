// /home/admin/imgu/api-lambda/stepfunctions.mjs (New File)
import { SFNClient, StartExecutionCommand } from "@aws-sdk/client-sfn";
import config from './config.mjs';
import process from 'node:process';

const sfnClient = new SFNClient({ region: process.env.AWS_REGION });

/**
 * 启动 Step Functions State Machine 执行
 * @returns {Promise<string>} Execution ARN
 */
async function startSyncStateMachine() {
  console.log(`Starting Step Functions execution for ARN: ${config.syncStateMachineArn}`);
  const params = {
    stateMachineArn: config.syncStateMachineArn,
    // 可以传递初始输入给状态机，如果需要的话
    // input: JSON.stringify({ initialData: 'someValue' }),
    // 可以为执行指定名称，方便追踪，但需保证唯一性或让 Step Functions 自动生成
    // name: `SyncExecution-${Date.now()}`
  };
  const command = new StartExecutionCommand(params);

  try {
    const data = await sfnClient.send(command);
    console.log("Step Functions execution started successfully:", data.executionArn);
    return data.executionArn; // 返回执行 ARN
  } catch (error) {
    console.error("Error starting Step Functions execution:", error);
    throw new Error(`Could not start sync state machine: ${error.message}`);
  }
}

export { startSyncStateMachine };
