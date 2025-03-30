// /home/admin/imgu/api-lambda/stepfunctions.mjs (Updated)
import { SFNClient, StartExecutionCommand, StopExecutionCommand, DescribeExecutionCommand } from "@aws-sdk/client-sfn";
import config from './config.mjs';
import process from 'node:process';

const sfnClient = new SFNClient({ region: process.env.AWS_REGION });

/**
 * 启动 Step Functions State Machine 执行
 * @param {object} input - 传递给状态机的输入对象
 * @returns {Promise<string>} Execution ARN
 */
async function startSyncStateMachine(input = {}) {
  console.log(`Starting Step Functions execution for ARN: ${config.syncStateMachineArn}`);
  const params = {
    stateMachineArn: config.syncStateMachineArn,
    input: JSON.stringify(input), // 将输入对象转为 JSON 字符串
  };
  const command = new StartExecutionCommand(params);
  try {
    const data = await sfnClient.send(command);
    console.log("Step Functions execution started successfully:", data.executionArn);
    return data.executionArn;
  } catch (error) {
    console.error("Error starting Step Functions execution:", error);
    throw new Error(`Could not start sync state machine: ${error.message}`);
  }
}

/**
 * 停止 Step Functions State Machine 执行
 * @param {string} executionArn - 要停止的执行实例 ARN
 * @returns {Promise<Date|undefined>} 停止日期
 */
async function stopSyncStateMachine(executionArn) {
  console.log(`Stopping Step Functions execution: ${executionArn}`);
  const params = {
    executionArn: executionArn,
    // 可以添加 error 和 cause
    // error: 'StoppedByUser',
    // cause: 'User requested stop via API'
  };
  const command = new StopExecutionCommand(params);
  try {
    const data = await sfnClient.send(command);
    console.log("Step Functions execution stopped successfully.");
    return data.stopDate; // 返回停止日期
  } catch (error) {
    console.error(`Error stopping Step Functions execution ${executionArn}:`, error);
    // 区分执行已结束和真正错误
    if (error.name === 'ExecutionDoesNotExist') {
         console.warn(`Execution ${executionArn} does not exist or already finished.`);
         return undefined; // 可以认为停止操作“完成”了
    }
    throw new Error(`Could not stop sync state machine: ${error.message}`);
  }
}

/**
 * 获取 Step Functions State Machine 执行状态 (为后续状态检查准备)
 * @param {string} executionArn - 要查询的执行实例 ARN
 * @returns {Promise<object>} 包含状态等信息的对象
 */
async function describeStateMachineExecution(executionArn) {
    console.log(`Describing Step Functions execution: ${executionArn}`);
    const params = { executionArn: executionArn };
    const command = new DescribeExecutionCommand(params);
    try {
        const data = await sfnClient.send(command);
        console.log(`Execution status for ${executionArn}: ${data.status}`);
        // 返回重要信息，例如状态、开始/结束时间等
        return {
            arn: data.executionArn,
            status: data.status, // e.g., RUNNING, SUCCEEDED, FAILED, TIMED_OUT, ABORTED
            startDate: data.startDate,
            stopDate: data.stopDate,
        };
    } catch (error) {
        console.error(`Error describing Step Functions execution ${executionArn}:`, error);
        if (error.name === 'ExecutionDoesNotExist') {
             return { status: 'DOES_NOT_EXIST' };
        }
        throw new Error(`Could not describe sync state machine execution: ${error.message}`);
    }
}


export { startSyncStateMachine, stopSyncStateMachine, describeStateMachineExecution };
