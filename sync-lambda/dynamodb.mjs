// /home/admin/imgu/sync-lambda/dynamodb.mjs (Updated to handle more sync state attributes)
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import config from './config.mjs';
import process from 'node:process';

const ddbClient = new DynamoDBClient({ region: process.env.AWS_REGION });
const marshallOptions = { removeUndefinedValues: true };
const unmarshallOptions = {};
const translateConfig = { marshallOptions, unmarshallOptions };
const ddbDocClient = DynamoDBDocumentClient.from(ddbClient, translateConfig);

// saveMetadata 函数保持不变
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

// getDynamoDBItem 函数保持不变
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
 * 更新 sync_control 表中的同步状态 (支持 currentSyncPage 和 apiLimits)
 * @param {string} syncType - 同步类型标识符 (主键)
 * @param {object} attributesToUpdate - 包含要更新的属性的对象, e.g., { currentSyncPage: 5, apiLimits: { unsplashLimit: 50, unsplashRemaining: 45, lastCheckedTimestamp: '...' } }
 * 如果属性值为 null，则会尝试移除该属性。
 * @returns {Promise<void>}
 */
async function updateSyncState(syncType, attributesToUpdate) {
    if (!config.dynamoDbSyncControlTableName) {
        console.error("Sync control table name not configured.");
        return;
    }
    if (!attributesToUpdate || Object.keys(attributesToUpdate).length === 0) {
        console.log("No attributes provided to update sync state.");
        return;
    }

    console.log(`Updating sync state for type: ${syncType} with attributes:`, attributesToUpdate);

    let updateExpression = 'SET #uts = :uts'; // Always update lastSyncTimestamp
    const removeExpressions = [];
    const expressionAttributeNames = { '#uts': 'lastSyncTimestamp' }; // Changed from API's lastUpdatedTimestamp
    const expressionAttributeValues = { ':uts': new Date().toISOString() };
    let nameIndex = 0;
    let valueIndex = 0;

    // Helper function to add attribute names/values safely
    const addExpressionAttribute = (key, value) => {
        const namePlaceholder = `#n${nameIndex}`;
        expressionAttributeNames[namePlaceholder] = key;
        nameIndex++;
        if (value !== null && value !== undefined) {
            const valuePlaceholder = `:v${valueIndex}`;
            expressionAttributeValues[valuePlaceholder] = value;
            valueIndex++;
            return { name: namePlaceholder, value: valuePlaceholder };
        } else {
            // Mark for removal
            removeExpressions.push(namePlaceholder);
            return { name: namePlaceholder, value: null };
        }
    };

    for (const key in attributesToUpdate) {
        if (attributesToUpdate.hasOwnProperty(key)) {
            const value = attributesToUpdate[key];
            const attrInfo = addExpressionAttribute(key, value);

            if (attrInfo.value !== null) {
                 updateExpression += `, ${attrInfo.name} = ${attrInfo.value}`;
            }
            // REMOVE expression handled later
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
        // ReturnValues: "UPDATED_NEW", // Can be useful for debugging
    };

    if (Object.keys(expressionAttributeValues).length === 0) {
       delete updateParams.ExpressionAttributeValues;
    }

    console.log("UpdateSyncState parameters:", JSON.stringify(updateParams, null, 2));

    try {
        const command = new UpdateCommand(updateParams);
        await ddbDocClient.send(command);
        console.log(`Successfully updated sync state for ${syncType}.`);
    } catch (error) {
        console.error(`Error updating sync state for ${syncType}:`, error);
        // Log error but don't throw to prevent SFN failure just for state update
    }
}

// 导出所有函数
export { saveMetadata, getDynamoDBItem, updateSyncState };
