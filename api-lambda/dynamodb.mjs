// /home/admin/imgu/api-lambda/dynamodb.mjs (Updated for Sync State Read)
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
// 使用 lib-dynamodb 的命令配合 DocumentClient
import { DynamoDBDocumentClient, ScanCommand, GetCommand } from '@aws-sdk/lib-dynamodb'; // 添加 GetCommand
import config from './config.mjs';
import process from 'node:process';

const ddbClient = new DynamoDBClient({ region: process.env.AWS_REGION });
const marshallOptions = { removeUndefinedValues: true };
const unmarshallOptions = {};
const translateConfig = { marshallOptions, unmarshallOptions };
const ddbDocClient = DynamoDBDocumentClient.from(ddbClient, translateConfig);

/**
 * 从 DynamoDB 获取分页的图片元数据 (保持不变)
 * @param {number} limit - 每页返回的最大项目数
 * @param {Object | undefined} startKey - DynamoDB Scan 操作的 ExclusiveStartKey
 * @returns {Promise<{items: Array<Object>, nextToken: Object | undefined}>}
 */
async function getImageDataPage(limit = 20, startKey = undefined) {
  console.log(`Scanning DynamoDB table: ${config.dynamoDbTableName} with Limit=${limit}`, startKey ? `StartKey=${JSON.stringify(startKey)}` : '');
  const scanParams = {
    TableName: config.dynamoDbTableName,
    Limit: limit,
    ExclusiveStartKey: startKey,
  };
  try {
    const scanCommand = new ScanCommand(scanParams);
    const scanResult = await ddbDocClient.send(scanCommand);
    console.log(`Scan returned ${scanResult.Count || 0} items.`);
    return { items: scanResult.Items || [], nextToken: scanResult.LastEvaluatedKey };
  } catch (error) {
    console.error(`Error scanning DynamoDB table ${config.dynamoDbTableName}:`, error);
    throw new Error(`Failed to retrieve data from DynamoDB: ${error.message}`);
  }
}

/**
 * 从 sync_control 表获取同步状态
 * @param {string} syncType - 同步类型标识符 (主键)
 * @returns {Promise<Object | undefined>} 返回状态对象 { syncType, lastProcessedPage, lastSyncTimestamp } 或 undefined
 */
async function getSyncState(syncType) {
  if (!config.dynamoDbSyncControlTableName) {
      console.error("Sync control table name not configured.");
      throw new Error("Sync control table name not configured.");
  }
  console.log(`Getting sync state for type: ${syncType} from table: ${config.dynamoDbSyncControlTableName}`);
  const getParams = {
    TableName: config.dynamoDbSyncControlTableName,
    Key: { syncType: syncType }, // 使用 'syncType' 作为 Key
  };
  try {
    const command = new GetCommand(getParams);
    const result = await ddbDocClient.send(command);
    console.log(`Get sync state result for ${syncType}:`, result.Item ? 'Found' : 'Not Found');
    return result.Item; // 返回整个项目，包含 lastProcessedPage 等
  } catch (error) {
    console.error(`Error getting sync state for ${syncType} from DynamoDB:`, error);
    throw error; // 让错误冒泡
  }
}

// 导出两个函数
export { getImageDataPage, getSyncState };
