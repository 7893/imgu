// /home/admin/imgu/sync-lambda/dynamodb.mjs (Updated for Sync State Write)
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
// 添加 UpdateCommand
import { DynamoDBDocumentClient, PutCommand, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import config from './config.mjs';
import process from 'node:process';

const ddbClient = new DynamoDBClient({ region: process.env.AWS_REGION });
const marshallOptions = { removeUndefinedValues: true };
const unmarshallOptions = {};
const translateConfig = { marshallOptions, unmarshallOptions };
const ddbDocClient = DynamoDBDocumentClient.from(ddbClient, translateConfig);

/**
 * 保存图片元数据到 DynamoDB (保持不变)
 * @param {Object} itemData
 * @returns {Promise<void>}
 */
async function saveMetadata(itemData) {
  const photoId = itemData.photo_id;
  console.log(`Saving metadata to DynamoDB: Table=${config.dynamoDbTableName}, PhotoID=${photoId}`);
  const putParams = { TableName: config.dynamoDbTableName, Item: itemData };
  try {
    const command = new PutCommand(putParams);
    await ddbDocClient.send(command);
    console.log(`Successfully saved metadata for ${photoId} to DynamoDB.`);
  } catch (error) {
    console.error(`Error saving metadata for ${photoId} to DynamoDB:`, error);
    throw error;
  }
}

/**
 * 从 DynamoDB 获取单个图片项目 (保持不变)
 * @param {string} photoId
 * @returns {Promise<Object|undefined>}
 */
async function getDynamoDBItem(photoId) {
  console.log(`Getting item from DynamoDB: Table=${config.dynamoDbTableName}, PhotoID=${photoId}`);
  const getParams = { TableName: config.dynamoDbTableName, Key: { photo_id: photoId } };
  try {
    const command = new GetCommand(getParams);
    const result = await ddbDocClient.send(command);
    console.log(`GetItem result for ${photoId}:`, result.Item ? 'Found' : 'Not Found');
    return result.Item;
  } catch (error) {
    console.error(`Error getting item ${photoId} from DynamoDB:`, error);
    throw error;
  }
}

/**
 * 更新 sync_control 表中的同步状态
 * @param {string} syncType - 同步类型标识符 (主键)
 * @param {number} processedPage - 已成功处理的页码
 * @returns {Promise<void>}
 */
async function updateSyncState(syncType, processedPage) {
    if (!config.dynamoDbSyncControlTableName) {
        console.error("Sync control table name not configured.");
        // 不抛出错误，但记录，因为这可能是次要任务
        return;
    }
    // 校验页码是否为有效数字
    if (typeof processedPage !== 'number' || !Number.isInteger(processedPage) || processedPage < 0) {
        console.warn(`Invalid processedPage number received: ${processedPage}. Skipping state update.`);
        return;
    }
    console.log(`Updating sync state for type: ${syncType} to page: ${processedPage} in table: ${config.dynamoDbSyncControlTableName}`);

    const updateParams = {
        TableName: config.dynamoDbSyncControlTableName,
        Key: { syncType: syncType }, // 使用 'syncType' 作为 Key
        // 使用 SET 更新或创建属性
        UpdateExpression: "SET lastProcessedPage = :page, lastSyncTimestamp = :ts",
        ExpressionAttributeValues: {
            ":page": processedPage,
            ":ts": new Date().toISOString(),
        },
        // ReturnValues: "UPDATED_NEW", // 可以移除或保留用于调试
    };

    try {
        const command = new UpdateCommand(updateParams);
        const result = await ddbDocClient.send(command);
        console.log(`Successfully updated sync state for ${syncType} to page ${processedPage}.`);
    } catch (error) {
        console.error(`Error updating sync state for ${syncType} to page ${processedPage}:`, error);
        // 记录错误，但通常不应让它中断 Step Function 的主流程
        // 可以根据需要添加更复杂的错误处理，例如重试或告警
    }
}

// 导出所有函数
export { saveMetadata, getDynamoDBItem, updateSyncState };
