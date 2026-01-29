const path = require('path');

// 基础路径锁定
const runRoot = global.runRootDir || process.cwd();
const srcPath = path.join(runRoot, 'src');

// 预定义别名规则
const regexpRule = {
  '@utils': path.join(srcPath, 'utils'),
  '@services': path.join(srcPath, 'services'),
  '@controllers': path.join(srcPath, 'controllers'),
  '@models': path.join(srcPath, 'models'),
  '@routes': path.join(srcPath, 'routes'),
  '@validations': path.join(srcPath, 'validations'),
  '@middlewares': path.join(srcPath, 'middlewares'),
  '@config': path.join(srcPath, 'config'),
  '@libs': path.join(srcPath, 'libs'),
};

/**
 * 增强型模块导入工具
 * @param {string} modulePath 导入路径
 * @param {string} [callerFile] 手动指定调用者路径（可选）
 */
const requireMainProcessModule = (modulePath, callerFile = null) => {
  // 1. 参数安全性验证 [针对风险点 3]
  if (!modulePath || typeof modulePath !== 'string') {
    throw new TypeError(
      `[RequireError] modulePath must be a string, received: ${typeof modulePath}`
    );
  }

  let finalPath = modulePath;

  try {
    // 2. 处理定义的别名 (如 @utils/xxx) [针对风险点 1]
    const alias = Object.keys(regexpRule).find((key) =>
      modulePath.startsWith(key)
    );
    if (alias) {
      finalPath = modulePath.replace(alias, regexpRule[alias]);
      return require(finalPath);
    }

    // 3. 处理相对路径 [针对风险点 2]
    if (modulePath.startsWith('.')) {
      // 获取调用该函数的文件所在目录。如果未传入，则尝试获取主项目根目录。
      // 在复杂场景下，推荐使用 path.resolve(runRoot, modulePath) 确保指向主项目。
      const baseDir = callerFile ? path.dirname(callerFile) : runRoot;
      finalPath = path.resolve(baseDir, modulePath);
      return require(finalPath);
    }

    // 4. 处理绝对路径
    if (path.isAbsolute(modulePath)) {
      return require(modulePath);
    }

    // 5. 处理 node_modules (如 'express') [针对风险点 4]
    try {
      const mainNodeModulesPath = path.join(runRoot, 'node_modules');
      // 强制优先从主项目 node_modules 寻找，解决 Link 模式多实例问题
      const resolvedPath = require.resolve(modulePath, {
        paths: [mainNodeModulesPath, runRoot],
      });
      return require(resolvedPath);
    } catch (firstError) {
      // 如果主项目没找到，尝试默认 require（可能在插件自身的 node_modules 里）
      return require(modulePath);
    }
  } catch (err) {
    // 统一错误处理，保留原始堆栈信息 [针对风险点 1, 4, 6]
    const errorMsg = `[requireMainProcessModule] Failed to load: "${modulePath}" (Resolved: "${finalPath}")`;
    console.error(`${errorMsg}\nError: ${err.message}`);
    throw new Error(`${errorMsg} -> ${err.stack}`);
  }
};

module.exports = {
  requireMainProcessModule,
};
