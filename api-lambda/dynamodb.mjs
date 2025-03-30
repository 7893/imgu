// /home/admin/imgu/api-lambda/dynamodb.mjs (Updated for Sync State Read/Write)
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
// 使用 lib-dynamodb 的命令配合 DocumentClient
import { DynamoDBDocumentClient, ScanCommand, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb'; // 添加 GetCommand, UpdateCommand
import config from './config.mjs';
import process from 'node:process';

const ddbClient = new DynamoDBClient({ region: process.env.AWS_REGION });
const marshallOptions = { removeUndefinedValues: true };
const unmarshallOptions = {};
const translateConfig = { marshallOptions, unmarshallOptions };
const ddbDocClient = DynamoDBDocumentClient.from(ddbClient, translateConfig);

/**
 * 从 DynamoDB 获取分页的图片元数据 (保持不变)
 */
async function getImageDataPage(limit = 20, startKey = undefined) {
  // ... (代码保持不变) ...
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
 * 从 sync_control 表获取同步状态 (保持不变)
 */
async function getSyncState(syncType) {
  // ... (代码保持不变) ...
  if (!config.dynamoDbSyncControlTableName) {
      console.error("Sync control table name not configured.");
      throw new Error("Sync control table name not configured.");
  }
  console.log(`Getting sync state for type: ${syncType} from table: ${config.dynamoDbSyncControlTableName}`);
  const getParams = {
    TableName: config.dynamoDbSyncControlTableName,
    Key: { syncType: syncType },
  };
  try {
    const command = new GetCommand(getParams);
    const result = await ddbDocClient.send(command);
    console.log(`Get sync state result for ${syncType}:`, result.Item ? 'Found' : 'Not Found');
    return result.Item;
  } catch (error) {
    console.error(`Error getting sync state for ${syncType} from DynamoDB:`, error);
    throw error;
  }
}

/**
 * 更新 sync_control 表中的同步状态 (API Lambda 使用)
 * @param {string} syncType - 同步类型标识符 (主键)
 * @param {object} attributesToUpdate - 包含要更新的属性的对象, e.g., { currentExecutionArn: '...', lastKnownStatus: 'RUNNING' }
 * 如果属性值为 null，则会尝试移除该属性。
 * @returns {Promise<object>} 更新后的属性 (可选)
 */
async function updateApiSyncState(syncType, attributesToUpdate) {
    if (!config.dynamoDbSyncControlTableName) {
        console.error("Sync control table name not configured.");
        throw new Error("Sync control table name not configured.");
    }
    console.log(`Updating API sync state for type: ${syncType} in table: ${config.dynamoDbSyncControlTableName} with attributes:`, attributesToUpdate);

    let updateExpression = 'SET ';
    const removeExpressions = [];
    const expressionAttributeNames = {};
    const expressionAttributeValues = {};
    let nameIndex = 0;
    let valueIndex = 0;

    // 添加通用时间戳更新
    expressionAttributeNames[`#ts`] = 'lastUpdatedTimestamp'; // API 更新时间戳
    expressionAttributeValues[`:ts`] = new Date().toISOString();
    updateExpression += `#ts = :ts`;

    for (const key in attributesToUpdate) {
        if (attributesToUpdate.hasOwnProperty(key)) {
            const value = attributesToUpdate[key];
            const namePlaceholder = `#n${nameIndex}`;
            expressionAttributeNames[namePlaceholder] = key;

            if (value !== null && value !== undefined) {
                // 设置或更新属性
                const valuePlaceholder = `:v${valueIndex}`;
                updateExpression += `, ${namePlaceholder} = ${valuePlaceholder}`;
                expressionAttributeValues[valuePlaceholder] = value;
                valueIndex++;
            } else {
                // 移除属性 (值为 null 或 undefined 时)
                removeExpressions.push(namePlaceholder);
            }
            nameIndex++;
        }
    }

    if (removeExpressions.length > 0) {
        updateExpression += ' REMOVE ' + removeExpressions.join(', ');
    }

    const updateParams = {
        TableName: config.dynamoDbSyncControlTableName,
        Key: { syncType: syncType },
        UpdateExpression: updateExpression,
        ExpressionAttributeNames: expressionAttributeNames,
        ExpressionAttributeValues: Object.keys(expressionAttributeValues).length > 0 ? expressionAttributeValues : undefined,
        ReturnValues: "UPDATED_NEW",
    };

    // 清理空的 ExpressionAttributeValues (如果只有 REMOVE 操作)
    if (Object.keys(expressionAttributeValues).length === 0) {
       delete updateParams.ExpressionAttributeValues;
    }


    console.log("Update parameters:", JSON.stringify(updateParams, null, 2));

    try {
        const command = new UpdateCommand(updateParams);
        const result = await ddbDocClient.send(command);
        console.log(`Successfully updated API sync state for ${syncType}.`);
        return result.Attributes;
    } catch (error) {
        console.error(`Error updating API sync state for ${syncType}:`, error);
        throw error; // 让上层处理错误
    }
}

// 导出所有函数
export { getImageDataPage, getSyncState, updateApiSyncState };
