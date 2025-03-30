// /home/admin/imgu/sync-lambda/clear_data.js (Using CommonJS require)
const { S3Client, ListObjectsV2Command, DeleteObjectsCommand } = require('@aws-sdk/client-s3');
const { DynamoDBClient, ScanCommand, BatchWriteItemCommand } = require('@aws-sdk/client-dynamodb'); // Correct require
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb'); // Correct require
const process = require('node:process');
const readline = require('node:readline/promises');

// --- 配置 (从环境变量读取) ---
const config = { /* ... same as before ... */ };
const requiredEnvVars = [ /* ... same as before ... */ ];
const missingEnvVars = requiredEnvVars.filter(varName => !process.env[varName]);
if (missingEnvVars.length > 0) { /* ... same as before ... */ process.exit(1); }

// --- 初始化 AWS 客户端 ---
const s3Client = new S3Client({ /* ... same as before ... */ });
const ddbClient = new DynamoDBClient({ region: config.awsRegion });
const marshallOptions = { removeUndefinedValues: true };
const unmarshallOptions = {};
const translateConfig = { marshallOptions, unmarshallOptions };
const ddbDocClient = DynamoDBDocumentClient.from(ddbClient, translateConfig);
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

// --- 辅助函数 ---
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// --- 清理函数 ---
async function clearR2Bucket() { /* ... same as before ... */ }
async function sendBatchWriteWithRetry(tableName, deleteRequests, maxRetries = 5, initialDelayMs = 200) { /* ... same as before, ensure require for BatchWriteItemCommand works... wait, it's initialized outside*/ }
async function clearDynamoDBTable() { /* ... same as before, ensure require for ScanCommand works... wait, it's initialized outside */ }

// --- 主执行函数 ---
async function main() { /* ... same as before ... */ }

main();
