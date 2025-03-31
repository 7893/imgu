// /home/admin/imgu/sync-lambda/secrets.mjs (New file for fetching secrets)
import { SSMClient, GetParametersCommand } from "@aws-sdk/client-ssm";
import config from './config.mjs'; // 导入包含 SSM 参数名的配置
import process from 'node:process';

const ssmClient = new SSMClient({ region: process.env.AWS_REGION });

// 内存缓存
let cachedSecrets = null;
let isFetching = false;
let fetchPromise = null;

// 获取所有需要的密钥
async function fetchSecretsFromSSM() {
  const parameterNames = [
    config.ssmParamNames.r2AccessKeyId,
    config.ssmParamNames.r2SecretAccessKey,
    config.ssmParamNames.unsplashApiKey,
  ];

  console.log("Fetching secrets from SSM Parameter Store:", parameterNames);

  const command = new GetParametersCommand({
    Names: parameterNames,
    WithDecryption: true,
  });

  try {
    const { Parameters, InvalidParameters } = await ssmClient.send(command);

    if (InvalidParameters && InvalidParameters.length > 0) {
      console.error("Could not find the following parameters in SSM:", InvalidParameters);
      throw new Error(`Missing SSM parameters: ${InvalidParameters.join(', ')}`);
    }

    if (!Parameters || Parameters.length !== parameterNames.length) {
         throw new Error("Did not receive all expected parameters from SSM.");
    }

    const secrets = {};
    Parameters.forEach(param => {
      if (param.Name === config.ssmParamNames.r2AccessKeyId) {
        secrets.r2AccessKeyId = param.Value;
      } else if (param.Name === config.ssmParamNames.r2SecretAccessKey) {
        secrets.r2SecretAccessKey = param.Value;
      } else if (param.Name === config.ssmParamNames.unsplashApiKey) {
        secrets.unsplashApiKey = param.Value;
      }
    });

    // 验证是否所有密钥都获取到了
    if (!secrets.r2AccessKeyId || !secrets.r2SecretAccessKey || !secrets.unsplashApiKey) {
        console.error("Failed to retrieve all required secret values.", secrets);
        throw new Error("Failed to retrieve all required secret values from SSM parameters.");
    }

    console.log("Successfully fetched secrets from SSM.");
    return secrets;

  } catch (error) {
    console.error("Error fetching secrets from SSM Parameter Store:", error);
    throw error; // Re-throw error after logging
  }
}

// 导出的函数，用于获取密钥（带缓存和并发处理）
export async function getSecrets() {
  if (cachedSecrets) {
    console.log("Returning cached secrets.");
    return cachedSecrets;
  }

  if (isFetching && fetchPromise) {
    console.log("Waiting for ongoing secret fetch...");
    return await fetchPromise;
  }

  console.log("No cached secrets found, initiating fetch.");
  isFetching = true;
  fetchPromise = fetchSecretsFromSSM();

  try {
    cachedSecrets = await fetchPromise;
    return cachedSecrets;
  } finally {
    isFetching = false;
    fetchPromise = null; // Reset promise after completion/failure
  }
}
